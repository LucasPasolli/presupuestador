// src/services/promocionesService.js
// Todas las operaciones de Promocion pasan por aquí.
// La lógica de cálculo de precios con promoción también vive aquí,
// reemplazando completamente a src/lib/promociones.js.

import { supabase } from '../lib/supabase'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function manejarError(operacion, error) {
  console.error(`[promocionesService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

function mapPromocion(row) {
  if (!row) return null
  return {
    idPromocion:  row.id_promocion,
    nombre:       row.nombre,
    descripcion:  row.descripcion,
    tipo:         row.tipo,
    alcance:      row.alcance,
    idProducto:   row.id_producto,
    idCategoria:  row.id_categoria,
    fechaInicio:  row.fecha_inicio,
    fechaFin:     row.fecha_fin,
    valor:        row.valor != null ? Number(row.valor) : null,
    activo:       row.activo,
    // si viene con JOIN
    nombreProducto:  row.producto?.nombre   ?? null,
    nombreCategoria: row.categoria?.nombre  ?? null,
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Devuelve todas las promociones con datos de producto y categoría asociados.
 * Equivale a:
 *   SELECT pr.*, p.nombre as nombreProducto, c.nombre as nombreCategoria
 *   FROM Promocion pr
 *   LEFT JOIN Producto p ON pr.idProducto = p.idProducto
 *   LEFT JOIN Categoria c ON pr.idCategoria = c.idCategoria
 *   ORDER BY pr.fechaInicio DESC
 */
export async function obtenerPromociones({
  soloActivas = false,
  orden       = 'desc',
} = {}) {
  let q = supabase
    .from('promocion')
    .select(`
      *,
      producto  ( nombre ),
      categoria ( nombre )
    `)
    .order('fecha_inicio', { ascending: orden === 'asc' })

  if (soloActivas) q = q.eq('activo', true)

  const { data, error } = await q
  if (error) manejarError('obtenerPromociones', error)
  return data.map(mapPromocion)
}

/**
 * Devuelve las promociones vigentes a la fecha indicada.
 * "Vigente" = activo = true AND fechaInicio <= fecha AND fechaFin >= fecha.
 * Equivale a la query principal de src/lib/promociones.js (calcularPromocion).
 * Usado en: Presupuestador.jsx al agregar un ítem al carrito.
 */
export async function obtenerPromocionesVigentes(fecha = null) {
  const hoy = fecha ?? new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('promocion')
    .select(`
      *,
      producto  ( nombre ),
      categoria ( nombre )
    `)
    .eq('activo', true)
    .lte('fecha_inicio', hoy)
    .gte('fecha_fin', hoy)

  if (error) manejarError('obtenerPromocionesVigentes', error)
  return data.map(mapPromocion)
}

/**
 * Devuelve una promoción por su ID.
 * Equivale a: SELECT * FROM Promocion WHERE idPromocion = ?
 */
export async function obtenerPromocionPorId(idPromocion) {
  const { data, error } = await supabase
    .from('promocion')
    .select(`
      *,
      producto  ( nombre ),
      categoria ( nombre )
    `)
    .eq('id_promocion', idPromocion)
    .single()

  if (error) manejarError('obtenerPromocionPorId', error)
  return mapPromocion(data)
}

// ─── Mutaciones ───────────────────────────────────────────────────────────────

/**
 * Crea una nueva promoción.
 * Equivale a: INSERT INTO Promocion (...) VALUES (...)
 */
export async function crearPromocion(promo) {
  const { data, error } = await supabase
    .from('promocion')
    .insert({
      nombre:       promo.nombre,
      descripcion:  promo.descripcion  ?? null,
      tipo:         promo.tipo,
      alcance:      promo.alcance,
      id_producto:  promo.idProducto   ?? null,
      id_categoria: promo.idCategoria  ?? null,
      fecha_inicio: promo.fechaInicio,
      fecha_fin:    promo.fechaFin,
      valor:        promo.valor        ?? null,
      activo:       promo.activo       ?? true,
    })
    .select()
    .single()

  if (error) manejarError('crearPromocion', error)
  return mapPromocion(data)
}

/**
 * Actualiza una promoción existente.
 * Equivale a: UPDATE Promocion SET ... WHERE idPromocion = ?
 */
export async function actualizarPromocion(idPromocion, promo) {
  const { error } = await supabase
    .from('promocion')
    .update({
      nombre:       promo.nombre,
      descripcion:  promo.descripcion  ?? null,
      tipo:         promo.tipo,
      alcance:      promo.alcance,
      id_producto:  promo.idProducto   ?? null,
      id_categoria: promo.idCategoria  ?? null,
      fecha_inicio: promo.fechaInicio,
      fecha_fin:    promo.fechaFin,
      valor:        promo.valor        ?? null,
      activo:       promo.activo       ?? true,
    })
    .eq('id_promocion', idPromocion)

  if (error) manejarError('actualizarPromocion', error)
}

/**
 * Activa o desactiva una promoción sin borrarla.
 * Equivale a: UPDATE Promocion SET activo = ? WHERE idPromocion = ?
 * Usado en: Promociones.jsx (toggle activo/inactivo).
 */
export async function togglePromocion(idPromocion, activo) {
  const { error } = await supabase
    .from('promocion')
    .update({ activo })
    .eq('id_promocion', idPromocion)

  if (error) manejarError('togglePromocion', error)
}

/**
 * Elimina una promoción.
 * Equivale a: DELETE FROM Promocion WHERE idPromocion = ?
 */
export async function eliminarPromocion(idPromocion) {
  const { error } = await supabase
    .from('promocion')
    .delete()
    .eq('id_promocion', idPromocion)

  if (error) manejarError('eliminarPromocion', error)
}

// ═══════════════════════════════════════════════════════════════════════════════
// LÓGICA DE CÁLCULO DE PRECIOS CON PROMOCIÓN
// Reemplaza completamente a src/lib/promociones.js
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Dada una lista de promociones vigentes y un ítem del carrito,
 * devuelve la promoción aplicable y el precio final calculado.
 *
 * Orden de prioridad (de mayor a menor especificidad):
 *   1. Promoción de producto exacto  (alcance = 'producto')
 *   2. Promoción de categoría        (alcance = 'categoria')
 *   3. Promoción global              (alcance = 'global')
 *
 * Esta función es PURA (sin side effects) — recibe datos y devuelve resultado.
 * Equivale a calcularPromocion() de src/lib/promociones.js.
 *
 * @param {Object}   item       - Ítem del carrito { idProducto, idCategoria, precioUnitario, cantidad }
 * @param {Array}    promos     - Lista de promociones vigentes (resultado de obtenerPromocionesVigentes)
 * @returns {{ promoAplicada, precioFinal, ahorro }}
 */
export function calcularPromocionParaItem(item, promos) {
  if (!promos?.length) {
    return { promoAplicada: null, precioFinal: item.precioUnitario, ahorro: 0 }
  }

  // 1. Buscar por especificidad descendente
  const promoProducto  = promos.find(p =>
    p.alcance === 'producto'  && p.idProducto  === item.idProducto
  )
  const promoCategoria = promos.find(p =>
    p.alcance === 'categoria' && p.idCategoria === item.idCategoria
  )
  const promoGlobal    = promos.find(p =>
    p.alcance === 'global'
  )

  const promo = promoProducto ?? promoCategoria ?? promoGlobal

  if (!promo) {
    return { promoAplicada: null, precioFinal: item.precioUnitario, ahorro: 0 }
  }

  let precioFinal = item.precioUnitario
  let ahorro      = 0

  switch (promo.tipo) {

    case 'porcentaje_producto': {
      // Descuento porcentual sobre el precio unitario
      const descuento = item.precioUnitario * (promo.valor / 100)
      precioFinal = Math.max(0, item.precioUnitario - descuento)
      ahorro      = descuento
      break
    }

    case 'precio_fijo': {
      // Precio fijo absoluto, independiente del precio unitario
      precioFinal = Math.max(0, promo.valor)
      ahorro      = Math.max(0, item.precioUnitario - precioFinal)
      break
    }

    case '2x1': {
      // En una compra de N unidades, solo se cobran la mitad (redondeando hacia arriba)
      // El ahorro se refleja en el precio unitario efectivo
      const unidadesPagas = Math.ceil(item.cantidad / 2)
      const totalConPromo = item.precioUnitario * unidadesPagas
      precioFinal = item.cantidad > 0
        ? totalConPromo / item.cantidad
        : item.precioUnitario
      ahorro = item.precioUnitario - precioFinal
      break
    }

    default:
      break
  }

  return {
    promoAplicada: promo,
    precioFinal:   Math.round(precioFinal * 100) / 100, // redondear a 2 decimales
    ahorro:        Math.round(ahorro      * 100) / 100,
  }
}

/**
 * Aplica promociones a todos los ítems de un carrito de una sola vez.
 * Carga las promociones vigentes una sola vez y las reutiliza para cada ítem.
 * Evita el antipatrón de llamar a la BD una vez por cada producto del carrito.
 *
 * @param {Array}  items  - Ítems del carrito
 * @param {string} fecha  - Fecha de referencia 'YYYY-MM-DD' (default: hoy)
 * @returns {Array}       - Ítems con { ...item, promoAplicada, precioFinal, ahorro }
 */
export async function aplicarPromocionesACarrito(items, fecha = null) {
  if (!items?.length) return []

  // Una sola llamada a la BD para todas las promociones vigentes
  const promos = await obtenerPromocionesVigentes(fecha)

  return items.map(item => {
    const { promoAplicada, precioFinal, ahorro } = calcularPromocionParaItem(item, promos)
    return {
      ...item,
      promoAplicada,
      precioConPromo: promoAplicada ? precioFinal : null,
      idPromocion:    promoAplicada?.idPromocion ?? null,
      ahorro,
    }
  })
}