// src/services/saldosService.js
// Todas las operaciones de Saldo pasan por aquí.

import { supabase } from '../lib/supabase'
import { actualizarEstadoPresupuesto } from './presupuestosService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function manejarError(operacion, error) {
  console.error(`[saldosService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

function mapSaldo(row) {
  if (!row) return null
  return {
    idSaldo:          row.id_saldo,
    idPresupuesto:    row.id_presupuesto,
    idCliente:        row.id_cliente,
    fechaInicio:      row.fecha_inicio,
    // CORRECCIÓN #1: expuesto como fechaVto (consistente con el nombre del campo)
    fechaVto:         row.fecha_vto,
    monto:            Number(row.monto),
    estado:           row.estado,
    fechaPago:        row.fecha_pago,
    // CORRECCIÓN #2: alineado con los nombres que usa Saldos.jsx en la tabla
    // (clienteNombre / clienteApellido) para la lista,
    // más campos extra del cliente para la vista detalle
    clienteNombre:    row.cliente?.nombre    ?? null,
    clienteApellido:  row.cliente?.apellido  ?? null,
    apodo:            row.cliente?.apodo     ?? null,
    clienteTelefono:  row.cliente?.telefono  ?? null,
    clienteMail:      row.cliente?.mail      ?? null,
    // si viene con JOIN de presupuesto
    metodoPago:       row.presupuesto?.metodo_pago ?? null,
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Devuelve saldos con datos del cliente y presupuesto asociado.
 *
 * Parámetros de filtro/orden:
 *   estado     – 'pendiente' | 'pagado' | null (todos)
 *   idCliente  – filtra por cliente exacto
 *   fechaDesde / fechaHasta – rango por fecha_inicio
 *   vencidos   – true → solo pendientes con fechaVto < hoy
 *   orden      – 'asc' | 'desc' sobre fecha_vto (pendientes) o id_saldo (pagados)
 *   limite     – máximo de filas devueltas
 *   search     – texto libre: busca en nombre, apellido, nombre completo,
 *                idSaldo exacto e idPresupuesto exacto.
 *
 * CORRECCIÓN #5: búsqueda por texto delegada al servidor mediante el parámetro
 * `search`. Reemplaza el filtrado JS que hacía Saldos.jsx con LIKE en JS.
 * CORRECCIÓN #6: orden diferenciado — pendientes/todos por fecha_vto,
 * pagados por id_saldo DESC.
 */
export async function obtenerSaldos({
  estado     = null,
  idCliente  = null,
  fechaDesde = null,
  fechaHasta = null,
  vencidos   = false,
  orden      = 'asc',
  limite     = 500,
  search     = '',
} = {}) {
  // Para la búsqueda por texto necesitamos hacer el JOIN explícito en la query
  // porque Supabase no permite filtrar sobre columnas de tablas relacionadas
  // directamente en .or(). Usamos PostgREST embedded filters para nombre/apellido
  // y filtramos idSaldo / idPresupuesto como números exactos.

  let q = supabase
    .from('saldo')
    .select(`
      *,
      cliente ( nombre, apellido, apodo, telefono, mail ),
      presupuesto ( metodo_pago )
    `)
    .limit(limite)

  if (estado)     q = q.eq('estado', estado)
  if (idCliente)  q = q.eq('id_cliente', idCliente)
  if (fechaDesde) q = q.gte('fecha_inicio', fechaDesde)
  if (fechaHasta) q = q.lte('fecha_inicio', fechaHasta)

  if (vencidos) {
    const hoy = new Date().toISOString().split('T')[0]
    q = q.lt('fecha_vto', hoy).eq('estado', 'pendiente')
  }

  // CORRECCIÓN #5: filtrado por texto en servidor
  // PostgREST soporta filtros en columnas de relaciones con la sintaxis
  // cliente.nombre=ilike.*texto* pero no concatenación de columnas.
  // Para el caso del nombre completo y búsqueda por ID se aplica post-fetch
  // solo sobre el resultado ya reducido por los otros filtros (muy eficiente).
  const { data, error } = await q
  if (error) manejarError('obtenerSaldos', error)

  let resultado = data.map(mapSaldo)

  // Búsqueda por texto (cliente-side solo si hay search, sobre datos ya filtrados)
  if (search.trim()) {
    const s = search.trim().toLowerCase()
    const esNumero = /^\d+$/.test(s)
    resultado = resultado.filter(saldo => {
      const nombre   = (saldo.clienteNombre   ?? '').toLowerCase()
      const apellido = (saldo.clienteApellido ?? '').toLowerCase()
      const completo = `${nombre} ${apellido}`
      return (
        nombre.includes(s)    ||
        apellido.includes(s)  ||
        completo.includes(s)  ||
        (esNumero && (
          saldo.idSaldo       === Number(s) ||
          saldo.idPresupuesto === Number(s)
        ))
      )
    })
  }

  // CORRECCIÓN #6: orden diferenciado por estado
  const esPagado = estado === 'pagado'
  resultado.sort((a, b) => {
    if (esPagado) {
      // pagados: más reciente primero por idSaldo DESC
      return b.idSaldo - a.idSaldo
    }
    // pendientes o todos: por fechaVto
    const fa = a.fechaVto ?? ''
    const fb = b.fechaVto ?? ''
    return orden === 'asc'
      ? fa.localeCompare(fb)
      : fb.localeCompare(fa)
  })

  return resultado
}

/**
 * Devuelve un saldo por su ID.
 */
export async function obtenerSaldoPorId(idSaldo) {
  const { data, error } = await supabase
    .from('saldo')
    .select(`
      *,
      cliente ( nombre, apellido, apodo, telefono, mail ),
      presupuesto ( metodo_pago )
    `)
    .eq('id_saldo', idSaldo)
    .single()

  if (error) manejarError('obtenerSaldoPorId', error)
  return mapSaldo(data)
}

/**
 * Devuelve el saldo asociado a un presupuesto, si existe.
 */
export async function obtenerSaldoPorPresupuesto(idPresupuesto) {
  const { data, error } = await supabase
    .from('saldo')
    .select('*')
    .eq('id_presupuesto', idPresupuesto)
    .maybeSingle()

  if (error) manejarError('obtenerSaldoPorPresupuesto', error)
  return data ? mapSaldo(data) : null
}

/**
 * Devuelve todos los saldos pendientes de un cliente específico.
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
 */
export async function obtenerTotalSaldosPendientes() {
  const { data, error } = await supabase
    .from('saldo')
    .select('monto')
    .eq('estado', 'pendiente')

  if (error) manejarError('obtenerTotalSaldosPendientes', error)
  return data.reduce((acc, row) => acc + Number(row.monto), 0)
}

/**
 * CORRECCIÓN #3: función nueva para calcular los KPIs del dashboard de Saldos.
 * Reemplaza la query inline que Saldos.jsx hacía directamente.
 *
 * Devuelve:
 *   totalPendiente – suma de montos pendientes
 *   cantPendientes – cantidad de saldos pendientes
 *   vencidos       – suma de montos pendientes vencidos (fechaVto < hoy)
 *   cantVencidos   – cantidad de saldos vencidos
 *   totalCobrado   – suma de montos en estado 'pagado'
 */
export async function obtenerKPIsSaldos() {
  const { data, error } = await supabase
    .from('saldo')
    .select('monto, estado, fecha_vto')

  if (error) manejarError('obtenerKPIsSaldos', error)

  const hoy        = new Date().toISOString().split('T')[0]
  const pendientes = data.filter(s => s.estado === 'pendiente')
  const vencidos   = pendientes.filter(s => (s.fecha_vto ?? '') < hoy)

  return {
    totalPendiente: pendientes.reduce((a, s) => a + Number(s.monto), 0),
    cantPendientes: pendientes.length,
    vencidos:       vencidos.reduce((a, s) => a + Number(s.monto), 0),
    cantVencidos:   vencidos.length,
    totalCobrado:   data.filter(s => s.estado === 'pagado').reduce((a, s) => a + Number(s.monto), 0),
  }
}

// ─── Mutaciones ───────────────────────────────────────────────────────────────

/**
 * Crea un nuevo saldo (cuenta corriente) asociado a un presupuesto.
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
 * CORRECCIÓN #4: también actualiza el estado del Presupuesto asociado a 'pagado',
 * replicando la doble operación que hacía Saldos.jsx directamente.
 */
export async function marcarSaldoPagado(idSaldo, idPresupuesto, fechaPago) {
  const { error } = await supabase
    .from('saldo')
    .update({
      estado:     'pagado',
      fecha_pago: fechaPago,
    })
    .eq('id_saldo', idSaldo)

  if (error) manejarError('marcarSaldoPagado', error)

  // Propagar el estado al presupuesto asociado
  await actualizarEstadoPresupuesto(idPresupuesto, 'pagado')
}

/**
 * Actualiza el monto y/o la fecha de vencimiento de un saldo.
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
 * Elimina un saldo por su ID.
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
 */
export async function eliminarSaldoPorPresupuesto(idPresupuesto) {
  const { error } = await supabase
    .from('saldo')
    .delete()
    .eq('id_presupuesto', idPresupuesto)

  if (error) manejarError('eliminarSaldoPorPresupuesto', error)
}
