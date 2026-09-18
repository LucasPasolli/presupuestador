// src/services/proveedoresService.js
// Todas las operaciones de Proveedor pasan por aquí.

import { supabase } from '../lib/supabase'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function manejarError(operacion, error) {
  console.error(`[proveedoresService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

// Mensajes controlados para los códigos de error que puede lanzar el RPC
// `actualizar_precio_por_proveedor` (ver sql/actualizar_precio_por_proveedor.sql).
// Traduce códigos internos a texto para el usuario sin filtrar detalles de
// infraestructura (nombres de constraint, de función, etc.) hacia la UI.
const MENSAJES_ERROR_ACTUALIZACION_PRECIOS = {
  margen_invalido:         'El margen debe ser un número mayor a 0%.',
  margen_fuera_de_rango:   'Ese margen es demasiado alto. Revisá el valor antes de continuar.',
  proveedor_no_encontrado: 'El proveedor seleccionado ya no existe. Actualizá la página e intentá de nuevo.',
}

function manejarErrorActualizacionPrecios(operacion, error) {
  console.error(`[proveedoresService] ${operacion}:`, error.message)
  throw new Error(MENSAJES_ERROR_ACTUALIZACION_PRECIOS[error.message] ?? error.message)
}

function mapProveedor(row) {
  if (!row) return null
  return {
    idProveedor:              row.id_proveedor,
    nombreFiscal:             row.nombre_fiscal,
    nombreComercial:          row.nombre_comercial,
    identificacionTributaria: row.identificacion_tributaria,
    telefono:                 row.telefono,
    email:                    row.email,
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Devuelve todos los proveedores ordenados por nombre fiscal.
 * Equivale a: SELECT * FROM Proveedor ORDER BY nombreFiscal
 */
export async function obtenerProveedores() {
  const { data, error } = await supabase
    .from('proveedor')
    .select('*')
    .order('nombre_fiscal')

  if (error) manejarError('obtenerProveedores', error)
  return data.map(mapProveedor)
}

/**
 * Devuelve un proveedor por su ID.
 * Equivale a: SELECT * FROM Proveedor WHERE idProveedor = ?
 */
export async function obtenerProveedorPorId(idProveedor) {
  const { data, error } = await supabase
    .from('proveedor')
    .select('*')
    .eq('id_proveedor', idProveedor)
    .single()

  if (error) manejarError('obtenerProveedorPorId', error)
  return mapProveedor(data)
}

// ─── Mutaciones ───────────────────────────────────────────────────────────────

/**
 * Crea un nuevo proveedor. Devuelve el proveedor creado con su ID asignado.
 * Equivale a: INSERT INTO Proveedor (...) VALUES (...)
 */
export async function crearProveedor(proveedor) {
  const { data, error } = await supabase
    .from('proveedor')
    .insert({
      nombre_fiscal:             proveedor.nombreFiscal,
      nombre_comercial:          proveedor.nombreComercial          ?? null,
      identificacion_tributaria: proveedor.identificacionTributaria ?? null,
      telefono:                  proveedor.telefono                 ?? null,
      email:                     proveedor.email                    ?? null,
    })
    .select()
    .single()

  if (error) manejarError('crearProveedor', error)
  return mapProveedor(data)
}

/**
 * Actualiza los datos de un proveedor existente.
 * Equivale a: UPDATE Proveedor SET ... WHERE idProveedor = ?
 */
export async function actualizarProveedor(idProveedor, proveedor) {
  const { error } = await supabase
    .from('proveedor')
    .update({
      nombre_fiscal:             proveedor.nombreFiscal,
      nombre_comercial:          proveedor.nombreComercial          ?? null,
      identificacion_tributaria: proveedor.identificacionTributaria ?? null,
      telefono:                  proveedor.telefono                 ?? null,
      email:                     proveedor.email                    ?? null,
    })
    .eq('id_proveedor', idProveedor)

  if (error) manejarError('actualizarProveedor', error)
}

/**
 * Elimina un proveedor. A diferencia de Cliente, Proveedor sí admite
 * borrado físico porque PedidoCompra usa ON DELETE SET NULL —
 * los pedidos históricos conservan el nombre en la columna nombre_proveedor.
 * Equivale a: DELETE FROM Proveedor WHERE idProveedor = ?
 */
export async function eliminarProveedor(idProveedor) {
  const { error } = await supabase
    .from('proveedor')
    .delete()
    .eq('id_proveedor', idProveedor)

  if (error) manejarError('eliminarProveedor', error)
}

// ─── Actualización masiva de precio por proveedor ────────────────────────────

/**
 * Cuenta cuántos productos tiene asociados un proveedor (vía la relación
 * N:M producto_proveedor), sin traer las filas completas.
 *
 * Se usa para la vista previa de "Actualizar precio por proveedor": apenas
 * se selecciona un proveedor, el modal muestra cuántos productos se van a
 * ver afectados (o avisa que no hay ninguno — Escenario 3 de la historia)
 * ANTES de que el usuario llegue a cargar un margen y confirmar.
 *
 * Equivale a: SELECT COUNT(*) FROM producto_proveedor WHERE idProveedor = ?
 */
export async function contarProductosDeProveedor(idProveedor) {
  const { count, error } = await supabase
    .from('producto_proveedor')
    .select('id_producto', { count: 'exact', head: true })
    .eq('id_proveedor', idProveedor)

  if (error) manejarError('contarProductosDeProveedor', error)
  return count ?? 0
}

/**
 * Aplica un margen de aumento porcentual sobre el precio_proveedor (costo
 * de compra, NO el precio de venta) de todos los productos asociados a un
 * proveedor. Ej: margenPorcentaje = 10 → cada precio_proveedor se
 * multiplica por 1.10.
 *
 * Delegado íntegramente en la función de base `actualizar_precio_por_proveedor`
 * (ver sql/actualizar_precio_por_proveedor.sql) para que el cálculo y el
 * UPDATE masivo corran en una única transacción atómica del lado del
 * servidor — nunca en un loop de updates individuales desde el cliente.
 *
 * Protección de idempotencia (mutación NO naturalmente idempotente: aplicar
 * el mismo margen dos veces COMPONE el aumento — 10% dos veces ≈ 21%, no
 * 10% — así que un doble click, doble pestaña o reintento de red no puede
 * tener ese efecto):
 *   1) UI: el botón de confirmar se deshabilita mientras `loading` es true.
 *   2) Se genera una clave de idempotencia por intento de guardado (una
 *      sola vez, al abrir el modal) y viaja al servidor en cada llamada.
 *   3) La función de base reserva esa clave contra `idempotency_key`
 *      (PK = UNIQUE) ANTES de tocar `producto`, como red de seguridad final.
 *
 * @param {number} idProveedor
 * @param {number} margenPorcentaje  Ej: 10 → aumenta un 10% el precio_proveedor.
 * @param {string} [idempotencyKey]  Pasar la MISMA clave para reintentar tras
 *        un error de red sin riesgo de aplicar el margen dos veces.
 * @returns {{resultado: 'ok'|'sin_productos', cantidadProductos: number, productos: Array}}
 */
export async function actualizarPrecioPorProveedor(idProveedor, margenPorcentaje, idempotencyKey = crypto.randomUUID()) {
  const { data, error } = await supabase.rpc('actualizar_precio_por_proveedor', {
    p_id_proveedor:      idProveedor,
    p_margen_porcentaje: margenPorcentaje,
    p_idempotency_key:   idempotencyKey,
  })

  if (error) manejarErrorActualizacionPrecios('actualizarPrecioPorProveedor', error)

  return {
    resultado:         data.resultado,
    cantidadProductos: data.cantidad_productos,
    productos: (data.productos ?? []).map((p) => ({
      idProducto:           p.id_producto,
      nombre:                p.nombre,
      precioProveedorNuevo: Number(p.precio_proveedor_nuevo),
    })),
  }
}