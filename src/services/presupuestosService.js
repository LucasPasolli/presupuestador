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
 * Devuelve los detalles de un presupuesto con fallback de nombre de producto.
 * Si `nombre_producto` fue guardado como snapshot lo usa directamente.
 * Si es null (dato antiguo), intenta traer el nombre actual del producto vía JOIN.
 * Si el producto ya no existe, usa '(producto eliminado #ID)'.
 * Usado exclusivamente por pdfPresupuesto.js.
 */
export async function obtenerDetallesConNombreDePresupuesto(idPresupuesto) {
  const { data, error } = await supabase
    .from('detalle_presupuesto')
    .select(`
      *,
      producto ( nombre )
    `)
    .eq('id_presupuesto', idPresupuesto)
    .order('id_detalle', { ascending: true })

  if (error) manejarError('obtenerDetallesConNombreDePresupuesto', error)

  return data.map(row => {
    const base = mapDetalle(row)
    base.nombreProducto =
      row.nombre_producto
      ?? row.producto?.nombre
      ?? `(producto eliminado #${row.id_producto})`
    return base
  })
}

/**
 * Devuelve presupuestos junto con sus detalles en una sola llamada.
 * Usado en Facturas.jsx para mostrar el listado completo con ítems.
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

/**
 * Devuelve los presupuestos facturables en un rango de fechas, con detalles incluidos.
 *
 * Lógica de negocio (replica exactamente la query de Facturas.jsx):
 *   - Solo presupuestos con estado = 'pagado'
 *   - Con saldo CC (cc15/cc30): se incluye si s.estado='pagado' y s.fechaPago
 *     cae dentro del período. La fecha de facturación es s.fechaPago.
 *   - Sin saldo (efectivo/transferencia directa): se incluye si p.fecha cae
 *     dentro del período. La fecha de facturación es p.fecha.
 *   - Se incluye el CUIT del cliente (JOIN real, no snapshot).
 *   - Los detalles se enriquecen con el nombre del producto (snapshot → JOIN → placeholder).
 *
 * Requiere la función RPC `obtener_presupuestos_facturables` en Supabase.
 *
 * @param {string} desde  'YYYY-MM-DD'
 * @param {string} hasta  'YYYY-MM-DD'
 * @returns {Array} presupuestos con { ...campos, cuit, fechaFacturacion, detalles[] }
 */
export async function obtenerFacturasConDetalles(desde, hasta) {
  // 1. Traer presupuestos facturables con la lógica de fecha via RPC
  const { data: presupuestos, error: e1 } = await supabase
    .rpc('obtener_presupuestos_facturables', {
      fecha_desde: desde,
      fecha_hasta: hasta,
    })

  if (e1) manejarError('obtenerFacturasConDetalles(rpc)', e1)
  if (!presupuestos?.length) return []

  // 2. Traer detalles de todos los presupuestos en una sola query
  const ids = presupuestos.map(p => p.id_presupuesto)

  const { data: detallesRaw, error: e2 } = await supabase
    .from('detalle_presupuesto')
    .select(`
      *,
      producto ( nombre )
    `)
    .in('id_presupuesto', ids)
    .order('id_detalle', { ascending: true })

  if (e2) manejarError('obtenerFacturasConDetalles(detalles)', e2)

  // 3. Indexar detalles por presupuesto
  const detallesPor = {}
  for (const row of detallesRaw ?? []) {
    const id = row.id_presupuesto
    if (!detallesPor[id]) detallesPor[id] = []

    const det = mapDetalle(row)
    // Fallback de nombre: snapshot → nombre actual → placeholder
    det.nombreProducto =
      row.nombre_producto
      ?? row.producto?.nombre
      ?? `(producto eliminado #${row.id_producto})`

    detallesPor[id].push(det)
  }

  // 4. Combinar y mapear al formato camelCase que usa Facturas.jsx
  return presupuestos.map(p => ({
    idPresupuesto:    p.id_presupuesto,
    idCliente:        p.id_cliente,
    fecha:            p.fecha,
    metodoPago:       p.metodo_pago,
    monto:            Number(p.monto),
    montoOriginal:    Number(p.monto_original),
    nombreCliente:    p.nombre_cliente,
    apellidoCliente:  p.apellido_cliente,
    cuit:             p.cuit,
    fechaPagoSaldo:   p.fecha_pago_saldo,
    fechaFacturacion: p.fecha_facturacion,
    detalles:         detallesPor[p.id_presupuesto] ?? [],
  }))
}

// ─── Mutaciones ───────────────────────────────────────────────────────────────

/**
 * Crea un presupuesto completo con sus detalles en una sola transacción.
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

  // 2. Borrar detalles anteriores
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
 */
export async function eliminarPresupuesto(idPresupuesto) {
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
