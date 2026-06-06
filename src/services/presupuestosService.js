// src/services/presupuestosService.js
// Todas las operaciones de Presupuesto y DetallePresupuesto pasan por aquí.

import { supabase } from '../lib/supabase'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function manejarError(operacion, error) {
  console.error(`[presupuestosService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

function mapPresupuesto(row) {
  if (!row) return null
  return {
    idPresupuesto:   row.id_presupuesto,
    idCliente:       row.id_cliente,
    fecha:           row.fecha,
    metodoPago:      row.metodo_pago,
    montoOriginal:   Number(row.monto_original),
    monto:           Number(row.monto),
    nombreCliente:   row.nombre_cliente,
    apellidoCliente: row.apellido_cliente,
    estado:          row.estado,
    esExcepcion:     row.es_excepcion ? 1 : 0,
  }
}

function mapDetalle(row) {
  if (!row) return null
  return {
    idDetalle:       row.id_detalle,
    idPresupuesto:   row.id_presupuesto,
    idProducto:      row.id_producto,
    nombreProducto:  row.nombre_producto,
    medida:          row.medida,
    cantidad:        row.cantidad,
    precioUnitario:  Number(row.precio_unitario),
    precioConPromo:  row.precio_con_promo != null ? Number(row.precio_con_promo) : null,
    idPromocion:     row.id_promocion,
    subtotal:        Number(row.subtotal),
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Devuelve presupuestos con filtros opcionales.
 * Mueve al servidor toda la lógica de filtrado que antes hacía Historial.jsx en React.
 *
 * Equivale a las queries dinámicas de Historial.jsx y Facturas.jsx.
 */
export async function obtenerPresupuestos({
  estado        = null,   // 'borrador' | 'aprobado' | 'pagado' | 'rechazado'
  idCliente     = null,
  fechaDesde    = null,   // 'YYYY-MM-DD'
  fechaHasta    = null,   // 'YYYY-MM-DD'
  metodoPago    = null,
  esExcepcion   = null,
  orden         = 'desc', // 'asc' | 'desc'
  limite        = 500,
} = {}) {
  let q = supabase
    .from('presupuesto')
    .select('*')
    .order('fecha', { ascending: orden === 'asc' })
    .order('id_presupuesto', { ascending: orden === 'asc' })
    .limit(limite)

  if (estado)      q = q.eq('estado', estado)
  if (idCliente)   q = q.eq('id_cliente', idCliente)
  if (fechaDesde)  q = q.gte('fecha', fechaDesde)
  if (fechaHasta)  q = q.lte('fecha', fechaHasta)
  if (metodoPago)  q = q.eq('metodo_pago', metodoPago)
  if (esExcepcion !== null) q = q.eq('es_excepcion', esExcepcion)

  const { data, error } = await q
  if (error) manejarError('obtenerPresupuestos', error)
  return data.map(mapPresupuesto)
}

/**
 * Devuelve un presupuesto por su ID.
 * Equivale a: SELECT * FROM Presupuesto WHERE idPresupuesto = ?
 */
export async function obtenerPresupuestoPorId(idPresupuesto) {
  const { data, error } = await supabase
    .from('presupuesto')
    .select('*')
    .eq('id_presupuesto', idPresupuesto)
    .single()

  if (error) manejarError('obtenerPresupuestoPorId', error)
  return mapPresupuesto(data)
}

/**
 * Devuelve los detalles (ítems) de un presupuesto.
 * Equivale a: SELECT * FROM DetallePresupuesto WHERE idPresupuesto = ?
 */
export async function obtenerDetallesDePresupuesto(idPresupuesto) {
  const { data, error } = await supabase
    .from('detalle_presupuesto')
    .select('*')
    .eq('id_presupuesto', idPresupuesto)

  if (error) manejarError('obtenerDetallesDePresupuesto', error)
  return data.map(mapDetalle)
}

/**
 * Devuelve presupuestos junto con sus detalles en una sola llamada.
 * Usado en Facturas.jsx para mostrar el listado completo con ítems.
 * Equivale al JOIN de Facturas.jsx entre Presupuesto y DetallePresupuesto.
 */
export async function obtenerPresupuestosConDetalles({
  estado     = null,
  fechaDesde = null,
  fechaHasta = null,
  limite     = 200,
} = {}) {
  let q = supabase
    .from('presupuesto')
    .select(`
      *,
      detalle_presupuesto (*)
    `)
    .order('fecha', { ascending: false })
    .order('id_presupuesto', { ascending: false })
    .limit(limite)

  if (estado)     q = q.eq('estado', estado)
  if (fechaDesde) q = q.gte('fecha', fechaDesde)
  if (fechaHasta) q = q.lte('fecha', fechaHasta)

  const { data, error } = await q
  if (error) manejarError('obtenerPresupuestosConDetalles', error)

  return data.map(row => ({
    ...mapPresupuesto(row),
    detalles: (row.detalle_presupuesto ?? []).map(mapDetalle),
  }))
}

// ─── Mutaciones ───────────────────────────────────────────────────────────────

/**
 * Crea un presupuesto completo con sus detalles en una sola transacción.
 * Equivale a las dos operaciones de Presupuestador.jsx:
 *   run(`INSERT INTO Presupuesto ...`)
 *   run(`INSERT INTO DetallePresupuesto ...`) × N ítems
 *
 * Devuelve el presupuesto creado con su ID asignado.
 */
export async function crearPresupuesto(presupuesto, detalles) {
  // 1. Insertar cabecera
  const { data: pres, error: e1 } = await supabase
    .from('presupuesto')
    .insert({
      id_cliente:       presupuesto.idCliente,
      fecha:            presupuesto.fecha,
      metodo_pago:      presupuesto.metodoPago,
      monto_original:   presupuesto.montoOriginal ?? presupuesto.monto,
      monto:            presupuesto.monto,
      nombre_cliente:   presupuesto.nombreCliente   ?? null,
      apellido_cliente: presupuesto.apellidoCliente ?? null,
      estado:           presupuesto.estado          ?? 'borrador',
      es_excepcion:     Boolean(presupuesto.esExcepcion),
    })
    .select()
    .single()

  if (e1) manejarError('crearPresupuesto(cabecera)', e1)

  // 2. Insertar detalles referenciando el ID recién creado
  if (detalles.length > 0) {
    const rows = detalles.map(d => ({
      id_presupuesto:  pres.id_presupuesto,
      id_producto:     d.idProducto,
      nombre_producto: d.nombreProducto ?? null,
      medida:          d.medida         ?? null,
      cantidad:        d.cantidad,
      precio_unitario: d.precioUnitario,
      precio_con_promo: d.precioConPromo ?? null,
      id_promocion:    d.idPromocion    ?? null,
      subtotal:        d.subtotal,
    }))

    const { error: e2 } = await supabase
      .from('detalle_presupuesto')
      .insert(rows)

    if (e2) manejarError('crearPresupuesto(detalles)', e2)
  }

  return mapPresupuesto(pres)
}

/**
 * Actualiza un presupuesto existente y reemplaza sus detalles.
 * Equivale a:
 *   UPDATE Presupuesto SET ... WHERE idPresupuesto = ?
 *   DELETE FROM DetallePresupuesto WHERE idPresupuesto = ?
 *   INSERT INTO DetallePresupuesto ... × N ítems
 */
export async function actualizarPresupuesto(idPresupuesto, presupuesto, detalles) {
  // 1. Actualizar cabecera
  const { error: e1 } = await supabase
    .from('presupuesto')
    .update({
      id_cliente:       presupuesto.idCliente,
      fecha:            presupuesto.fecha,
      metodo_pago:      presupuesto.metodoPago,
      monto_original:   presupuesto.montoOriginal ?? presupuesto.monto,
      monto:            presupuesto.monto,
      nombre_cliente:   presupuesto.nombreCliente   ?? null,
      apellido_cliente: presupuesto.apellidoCliente ?? null,
      estado:           presupuesto.estado,
      es_excepcion:     Boolean(presupuesto.esExcepcion),
    })
    .eq('id_presupuesto', idPresupuesto)

  if (e1) manejarError('actualizarPresupuesto(cabecera)', e1)

  // 2. Borrar detalles anteriores (CASCADE los elimina, pero lo hacemos
  //    explícito para mayor claridad y control)
  const { error: e2 } = await supabase
    .from('detalle_presupuesto')
    .delete()
    .eq('id_presupuesto', idPresupuesto)

  if (e2) manejarError('actualizarPresupuesto(delete detalles)', e2)

  // 3. Reinsertar detalles actualizados
  if (detalles.length > 0) {
    const rows = detalles.map(d => ({
      id_presupuesto:   idPresupuesto,
      id_producto:      d.idProducto,
      nombre_producto:  d.nombreProducto ?? null,
      medida:           d.medida         ?? null,
      cantidad:         d.cantidad,
      precio_unitario:  d.precioUnitario,
      precio_con_promo: d.precioConPromo ?? null,
      id_promocion:     d.idPromocion    ?? null,
      subtotal:         d.subtotal,
    }))

    const { error: e3 } = await supabase
      .from('detalle_presupuesto')
      .insert(rows)

    if (e3) manejarError('actualizarPresupuesto(insert detalles)', e3)
  }
}

/**
 * Actualiza solo el estado de un presupuesto.
 * Equivale a: UPDATE Presupuesto SET estado = ? WHERE idPresupuesto = ?
 * Usado en: Historial.jsx, ABMC.jsx.
 */
export async function actualizarEstadoPresupuesto(idPresupuesto, estado) {
  const { error } = await supabase
    .from('presupuesto')
    .update({ estado })
    .eq('id_presupuesto', idPresupuesto)

  if (error) manejarError('actualizarEstadoPresupuesto', error)
}

/**
 * Actualiza estado, método de pago y esExcepcion.
 * Equivale al UPDATE compuesto de ABMC.jsx sobre presupuestos.
 */
export async function actualizarMetadataPresupuesto(idPresupuesto, { estado, metodoPago, esExcepcion }) {
  const { error } = await supabase
    .from('presupuesto')
    .update({
      estado,
      metodo_pago:  metodoPago,
      es_excepcion: Boolean(esExcepcion),
    })
    .eq('id_presupuesto', idPresupuesto)

  if (error) manejarError('actualizarMetadataPresupuesto', error)
}

/**
 * Elimina un presupuesto y sus detalles (CASCADE en BD).
 * También elimina el saldo asociado si existe.
 * Equivale a:
 *   DELETE FROM Saldo WHERE idPresupuesto = ?
 *   DELETE FROM Presupuesto WHERE idPresupuesto = ?
 */
export async function eliminarPresupuesto(idPresupuesto) {
  // El saldo se elimina primero porque tiene FK hacia presupuesto
  // con ON DELETE CASCADE — pero lo hacemos explícito por claridad.
  const { error: e1 } = await supabase
    .from('saldo')
    .delete()
    .eq('id_presupuesto', idPresupuesto)

  if (e1) manejarError('eliminarPresupuesto(saldo)', e1)

  const { error: e2 } = await supabase
    .from('presupuesto')
    .delete()
    .eq('id_presupuesto', idPresupuesto)

  if (e2) manejarError('eliminarPresupuesto(presupuesto)', e2)
}