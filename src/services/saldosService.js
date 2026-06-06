// src/services/saldosService.js
// Todas las operaciones de Saldo pasan por aquí.

import { supabase } from '../lib/supabase'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function manejarError(operacion, error) {
  console.error(`[saldosService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

function mapSaldo(row) {
  if (!row) return null
  return {
    idSaldo:        row.id_saldo,
    idPresupuesto:  row.id_presupuesto,
    idCliente:      row.id_cliente,
    fechaInicio:    row.fecha_inicio,
    fechaVto:       row.fecha_vto,
    monto:          Number(row.monto),
    estado:         row.estado,
    fechaPago:      row.fecha_pago,
    // si viene con JOIN de cliente
    nombreCliente:  row.cliente?.nombre   ?? null,
    apellidoCliente: row.cliente?.apellido ?? null,
    apodo:          row.cliente?.apodo    ?? null,
    // si viene con JOIN de presupuesto
    metodoPago:     row.presupuesto?.metodo_pago ?? null,
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Devuelve todos los saldos con datos del cliente y presupuesto asociado.
 * Mueve al servidor el filtrado que antes hacía Saldos.jsx en React.
 *
 * Equivale a:
 *   SELECT s.*, c.nombre, c.apellido, c.apodo, p.metodoPago
 *   FROM Saldo s
 *   JOIN Cliente c ON s.idCliente = c.idCliente
 *   JOIN Presupuesto p ON s.idPresupuesto = p.idPresupuesto
 *   WHERE s.estado = ?
 *   ORDER BY s.fechaVto ASC
 */
export async function obtenerSaldos({
  estado     = null,   // 'pendiente' | 'pagado'
  idCliente  = null,
  fechaDesde = null,   // 'YYYY-MM-DD'
  fechaHasta = null,   // 'YYYY-MM-DD'
  vencidos   = false,  // true → solo saldos con fechaVto < hoy
  orden      = 'asc',
  limite     = 500,
} = {}) {
  let q = supabase
    .from('saldo')
    .select(`
      *,
      cliente ( nombre, apellido, apodo ),
      presupuesto ( metodo_pago )
    `)
    .order('fecha_vto', { ascending: orden === 'asc' })
    .limit(limite)

  if (estado)    q = q.eq('estado', estado)
  if (idCliente) q = q.eq('id_cliente', idCliente)
  if (fechaDesde) q = q.gte('fecha_inicio', fechaDesde)
  if (fechaHasta) q = q.lte('fecha_inicio', fechaHasta)

  if (vencidos) {
    const hoy = new Date().toISOString().split('T')[0]
    q = q.lt('fecha_vto', hoy).eq('estado', 'pendiente')
  }

  const { data, error } = await q
  if (error) manejarError('obtenerSaldos', error)
  return data.map(mapSaldo)
}

/**
 * Devuelve un saldo por su ID.
 * Equivale a: SELECT * FROM Saldo WHERE idSaldo = ?
 */
export async function obtenerSaldoPorId(idSaldo) {
  const { data, error } = await supabase
    .from('saldo')
    .select(`
      *,
      cliente ( nombre, apellido, apodo ),
      presupuesto ( metodo_pago )
    `)
    .eq('id_saldo', idSaldo)
    .single()

  if (error) manejarError('obtenerSaldoPorId', error)
  return mapSaldo(data)
}

/**
 * Devuelve el saldo asociado a un presupuesto, si existe.
 * Equivale a: SELECT * FROM Saldo WHERE idPresupuesto = ?
 * Usado en: Historial.jsx para mostrar si un presupuesto tiene saldo pendiente.
 */
export async function obtenerSaldoPorPresupuesto(idPresupuesto) {
  const { data, error } = await supabase
    .from('saldo')
    .select('*')
    .eq('id_presupuesto', idPresupuesto)
    .maybeSingle() // puede no existir → devuelve null sin error

  if (error) manejarError('obtenerSaldoPorPresupuesto', error)
  return data ? mapSaldo(data) : null
}

/**
 * Devuelve todos los saldos pendientes de un cliente específico.
 * Usado en: Presupuestador.jsx para alertar sobre deudas del cliente.
 * Equivale a:
 *   SELECT * FROM Saldo WHERE idCliente = ? AND estado = 'pendiente'
 */
export async function obtenerSaldosPendientesDeCliente(idCliente) {
  const { data, error } = await supabase
    .from('saldo')
    .select('*')
    .eq('id_cliente', idCliente)
    .eq('estado', 'pendiente')
    .order('fecha_vto', { ascending: true })

  if (error) manejarError('obtenerSaldosPendientesDeCliente', error)
  return data.map(mapSaldo)
}

/**
 * Devuelve el total de saldos pendientes (suma de montos).
 * Usado en: Dashboard.jsx para el indicador de cuenta corriente.
 * Equivale a: SELECT SUM(monto) FROM Saldo WHERE estado = 'pendiente'
 */
export async function obtenerTotalSaldosPendientes() {
  const { data, error } = await supabase
    .from('saldo')
    .select('monto')
    .eq('estado', 'pendiente')

  if (error) manejarError('obtenerTotalSaldosPendientes', error)
  return data.reduce((acc, row) => acc + Number(row.monto), 0)
}

// ─── Mutaciones ───────────────────────────────────────────────────────────────

/**
 * Crea un nuevo saldo (cuenta corriente) asociado a un presupuesto.
 * Equivale a: INSERT INTO Saldo (...) VALUES (...)
 * Usado en: Historial.jsx al aprobar un presupuesto con método 'cc30' o 'cc15'.
 */
export async function crearSaldo(saldo) {
  const { data, error } = await supabase
    .from('saldo')
    .insert({
      id_presupuesto: saldo.idPresupuesto,
      id_cliente:     saldo.idCliente,
      fecha_inicio:   saldo.fechaInicio,
      fecha_vto:      saldo.fechaVto   ?? null,
      monto:          saldo.monto,
      estado:         saldo.estado     ?? 'pendiente',
      fecha_pago:     saldo.fechaPago  ?? null,
    })
    .select()
    .single()

  if (error) manejarError('crearSaldo', error)
  return mapSaldo(data)
}

/**
 * Marca un saldo como pagado con la fecha de pago indicada.
 * Equivale a:
 *   UPDATE Saldo SET estado='pagado', fechaPago=? WHERE idSaldo=?
 * Usado en: Saldos.jsx (botón "Marcar como pagado").
 */
export async function marcarSaldoPagado(idSaldo, fechaPago) {
  const { error } = await supabase
    .from('saldo')
    .update({
      estado:     'pagado',
      fecha_pago: fechaPago,
    })
    .eq('id_saldo', idSaldo)

  if (error) manejarError('marcarSaldoPagado', error)
}

/**
 * Actualiza el monto y/o la fecha de vencimiento de un saldo.
 * Equivale a: UPDATE Saldo SET monto=?, fechaVto=? WHERE idSaldo=?
 * Usado en: Saldos.jsx (edición de saldo existente), ABMC.jsx.
 */
export async function actualizarSaldo(idSaldo, { monto, fechaVto }) {
  const campos = {}
  if (monto    !== undefined) campos.monto     = monto
  if (fechaVto !== undefined) campos.fecha_vto = fechaVto ?? null

  const { error } = await supabase
    .from('saldo')
    .update(campos)
    .eq('id_saldo', idSaldo)

  if (error) manejarError('actualizarSaldo', error)
}

/**
 * Revierte un saldo a estado pendiente.
 * Equivale a: UPDATE Saldo SET estado='pendiente', fechaPago=NULL WHERE idSaldo=?
 * Usado en: ABMC.jsx cuando se revierte un pago marcado por error.
 */
export async function revertirPagoSaldo(idSaldo) {
  const { error } = await supabase
    .from('saldo')
    .update({
      estado:     'pendiente',
      fecha_pago: null,
    })
    .eq('id_saldo', idSaldo)

  if (error) manejarError('revertirPagoSaldo', error)
}

/**
 * Elimina un saldo. Se usa cuando se rechaza o elimina el presupuesto asociado.
 * El CASCADE en BD lo elimina automáticamente al borrar el presupuesto,
 * pero esta función permite borrarlo de forma explícita e independiente.
 * Equivale a: DELETE FROM Saldo WHERE idSaldo=?
 */
export async function eliminarSaldo(idSaldo) {
  const { error } = await supabase
    .from('saldo')
    .delete()
    .eq('id_saldo', idSaldo)

  if (error) manejarError('eliminarSaldo', error)
}

/**
 * Elimina el saldo asociado a un presupuesto específico.
 * Equivale a: DELETE FROM Saldo WHERE idPresupuesto=?
 * Usado en: presupuestosService.eliminarPresupuesto() como paso previo.
 */
export async function eliminarSaldoPorPresupuesto(idPresupuesto) {
  const { error } = await supabase
    .from('saldo')
    .delete()
    .eq('id_presupuesto', idPresupuesto)

  if (error) manejarError('eliminarSaldoPorPresupuesto', error)
}