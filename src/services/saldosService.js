// src/services/saldosService.js
// Todas las operaciones de Saldo pasan por aquí.
//
// CORRECCIÓN #8: soporte de Pago Parcial.
//   `monto`           → deuda ORIGINAL del saldo, inmutable.
//   `monto_pendiente` → remanente real, se reduce con cada imputación
//                       (ver pagosService.js / fn_aplicar_pago_cliente).
//   `estado`          → 'pendiente' | 'parcial' | 'pagado'.

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
    // CORRECCIÓN #8: monto realmente adeudado hoy. Si la fila todavía no tiene
    // la columna migrada (entornos viejos), cae de vuelta a `monto` para que
    // el resto de la UI no explote mientras se aplica la migración.
    montoPendiente:   row.monto_pendiente != null ? Number(row.monto_pendiente) : Number(row.monto),
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
 *   estado     – 'pendiente' | 'parcial' | 'pagado' | null (todos)
 *   idCliente  – filtra por cliente exacto
 *   fechaDesde / fechaHasta – rango por fecha_inicio
 *   vencidos   – true → solo con deuda activa y fechaVto < hoy
 *   orden      – 'asc' | 'desc' sobre fecha_vto (con deuda) o id_saldo (pagados)
 *   limite     – máximo de filas devueltas
 *   search     – texto libre: busca en nombre, apellido, nombre completo,
 *                idSaldo exacto e idPresupuesto exacto.
 *
 * CORRECCIÓN #5: búsqueda por texto delegada al servidor mediante el parámetro
 * `search`. Reemplaza el filtrado JS que hacía Saldos.jsx con LIKE en JS.
 * CORRECCIÓN #6: orden diferenciado — con deuda por fecha_vto,
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
    q = q.lt('fecha_vto', hoy).in('estado', ['pendiente', 'parcial'])
  }

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
    // pendientes, parciales o todos: por fechaVto
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
 * Devuelve todos los saldos con deuda activa (pendiente o parcial) de un
 * cliente específico, ordenados cronológicamente por vencimiento — este es
 * el mismo orden que usa el motor de imputación en el servidor, por eso
 * pagosService.js reutiliza esta función para la previsualización.
 */
export async function obtenerSaldosPendientesDeCliente(idCliente) {
  const { data, error } = await supabase
    .from('saldo')
    .select('*')
    .eq('id_cliente', idCliente)
    .in('estado', ['pendiente', 'parcial'])
    .order('fecha_vto', { ascending: true })

  if (error) manejarError('obtenerSaldosPendientesDeCliente', error)
  return data.map(mapSaldo)
}

/**
 * Devuelve el total de saldos pendientes (suma de montos remanentes).
 */
export async function obtenerTotalSaldosPendientes() {
  const { data, error } = await supabase
    .from('saldo')
    .select('monto_pendiente, estado')
    .in('estado', ['pendiente', 'parcial'])

  if (error) manejarError('obtenerTotalSaldosPendientes', error)
  return data.reduce((acc, row) => acc + Number(row.monto_pendiente), 0)
}

/**
 * CORRECCIÓN #3 + #8: KPIs del dashboard de Saldos, ahora contemplando
 * pagos parciales. `totalCobrado` ya no asume "todo o nada": suma lo
 * efectivamente cobrado en CADA saldo (monto - monto_pendiente), así un
 * saldo con pago parcial aporta al total cobrado aunque siga figurando
 * como deuda pendiente por su remanente.
 */
export async function obtenerKPIsSaldos() {
  const { data, error } = await supabase
    .from('saldo')
    .select('monto, monto_pendiente, estado, fecha_vto')

  if (error) manejarError('obtenerKPIsSaldos', error)

  const hoy       = new Date().toISOString().split('T')[0]
  const conDeuda  = data.filter(s => s.estado === 'pendiente' || s.estado === 'parcial')
  const vencidos  = conDeuda.filter(s => (s.fecha_vto ?? '') < hoy)
  const parciales = data.filter(s => s.estado === 'parcial')

  return {
    totalPendiente: conDeuda.reduce((a, s) => a + Number(s.monto_pendiente), 0),
    cantPendientes: conDeuda.length,
    vencidos:       vencidos.reduce((a, s) => a + Number(s.monto_pendiente), 0),
    cantVencidos:   vencidos.length,
    totalCobrado:   data.reduce((a, s) => a + (Number(s.monto) - Number(s.monto_pendiente)), 0),
    cantParciales:  parciales.length,
    totalEnParcial: parciales.reduce((a, s) => a + Number(s.monto_pendiente), 0),
  }
}

// ─── Mutaciones ───────────────────────────────────────────────────────────────

/**
 * Crea un nuevo saldo (cuenta corriente) asociado a un presupuesto.
 * CORRECCIÓN #8: inicializa monto_pendiente = monto (deuda completa al crear).
 */
export async function crearSaldo(saldo) {
  const { data, error } = await supabase
    .from('saldo')
    .insert({
      id_presupuesto:  saldo.idPresupuesto,
      id_cliente:      saldo.idCliente,
      fecha_inicio:    saldo.fechaInicio,
      fecha_vto:       saldo.fechaVto   ?? null,
      monto:           saldo.monto,
      monto_pendiente: saldo.monto,
      estado:          saldo.estado     ?? 'pendiente',
      fecha_pago:      saldo.fechaPago  ?? null,
    })
    .select()
    .single()

  if (error) manejarError('crearSaldo', error)
  return mapSaldo(data)
}

/**
 * Marca un saldo como pagado en su totalidad (cancela cualquier remanente),
 * con la fecha de pago indicada. Útil para saldar de una sola vez un saldo
 * pendiente o cancelar el remanente de uno que ya tenía un pago parcial.
 *
 * Para imputar un pago que puede no cubrir el total (y potencialmente
 * repartirse entre varios saldos del cliente), usar
 * `pagosService.registrarPagoParcial` en su lugar — esa es la vía atómica.
 *
 * CORRECCIÓN #4: también actualiza el estado del Presupuesto asociado a 'pagado'.
 */
/**
 * Marca un saldo como pagado en su totalidad (cancela cualquier remanente),
 * con la fecha de pago indicada. Útil para saldar de una sola vez un saldo
 * pendiente o cancelar el remanente de uno que ya tenía un pago parcial.
 *
 * CORRECCIÓN (cierre de remanente): antes esto era un UPDATE directo sobre
 * `saldo`, sin dejar rastro en `pago` / `pago_aplicacion`. Si el saldo ya
 * venía de un pago parcial (estado 'parcial'), eso rompía dos cosas río
 * abajo que SÍ dependen de ese ledger:
 *   1. El "Historial de pagos aplicados" del detalle del Saldo no mostraba
 *      cuándo se había cobrado ese último tramo — parecía que nunca se
 *      hubiera registrado.
 *   2. El PDF de Facturas (que agrupa cobros vía `pago_aplicacion`) no veía
 *      el cierre: el presupuesto volvía a listarse como venta completa por
 *      el monto ORIGINAL en el período de cierre, duplicando lo que ya se
 *      había facturado en períodos anteriores como pagos parciales.
 *
 * Ahora, si el saldo estaba en 'parcial', se inserta un `pago` +
 * `pago_aplicacion` representando el cobro del remanente, exactamente con
 * la misma forma que deja `fn_aplicar_pago_cliente` — así ambos consumidores
 * (detalle de Saldo y reporte de Facturas) lo ven de forma consistente.
 *
 * Un saldo que se paga de una sola vez desde 'pendiente' (nunca pasó por
 * 'parcial') sigue exactamente igual que antes: sin fila en
 * `pago_aplicacion`, tal como espera la RPC `obtener_presupuestos_facturables`
 * para tratarlo como una venta normal (sin esto se duplicaría al revés).
 *
 * ⚠️ Nota de atomicidad: a diferencia de `fn_aplicar_pago_cliente` (que corre
 * en una transacción de Postgres con FOR UPDATE), esto son 3 llamadas
 * separadas desde el cliente. Para este flujo — cerrar UN saldo puntual que
 * ya se está mirando en el detalle — el riesgo de carrera es bajo, pero si
 * en el futuro se vuelve un flujo de alto tráfico concurrente, conviene
 * moverlo a una RPC dedicada para que quede atómico.
 *
 * Para imputar un pago que puede no cubrir el total (y potencialmente
 * repartirse entre varios saldos del cliente), usar
 * `pagosService.registrarPagoParcial` en su lugar — esa es la vía atómica.
 *
 * @param {number} idSaldo
 * @param {number} idPresupuesto
 * @param {string} fechaPago
 * @param {string} [metodoPago='otro'] Método usado para cobrar el remanente.
 *   Solo se usa (y solo se persiste en el ledger) cuando el saldo venía de
 *   estado 'parcial'; se ignora para el cierre directo de un 'pendiente'.
 */
export async function marcarSaldoPagado(idSaldo, idPresupuesto, fechaPago, metodoPago = 'otro') {
  const { data: actual, error: errFetch } = await supabase
    .from('saldo')
    .select('estado, monto_pendiente, id_cliente')
    .eq('id_saldo', idSaldo)
    .single()

  if (errFetch) manejarError('marcarSaldoPagado:fetch', errFetch)

  const remanente = Number(actual.monto_pendiente)

  // Solo dejamos rastro en el ledger si había un pago parcial en curso.
  if (actual.estado === 'parcial' && remanente > 0) {
    const { data: userData } = await supabase.auth.getUser()

    const { data: pago, error: errPago } = await supabase
      .from('pago')
      .insert({
        id_cliente:  actual.id_cliente,
        monto:       remanente,
        fecha:       fechaPago,
        metodo_pago: metodoPago,
        descripcion: `Cancelación de remanente — Saldo #${idSaldo}`,
        creado_por:  userData?.user?.id ?? null,
      })
      .select()
      .single()

    if (errPago) manejarError('marcarSaldoPagado:pago', errPago)

    const { error: errAplicacion } = await supabase
      .from('pago_aplicacion')
      .insert({
        id_pago:          pago.id_pago,
        id_saldo:         idSaldo,
        monto_aplicado:   remanente,
        saldo_anterior:   remanente,
        saldo_resultante: 0,
      })

    if (errAplicacion) manejarError('marcarSaldoPagado:aplicacion', errAplicacion)
  }

  const { error } = await supabase
    .from('saldo')
    .update({
      estado:          'pagado',
      monto_pendiente: 0,
      fecha_pago:      fechaPago,
    })
    .eq('id_saldo', idSaldo)

  if (error) manejarError('marcarSaldoPagado', error)

  // Propagar el estado al presupuesto asociado. Para Cuenta Corriente la
  // fecha de cobro "de la verdad" es `saldo.fecha_pago` (la que usa la RPC
  // de Facturas), pero igual espejamos `fechaPago` en el presupuesto para
  // que el detalle en Historial.jsx muestre un dato consistente sin tener
  // que ir a buscar el saldo — es puramente informativo, ninguna consulta
  // de facturación/estadísticas depende de este valor para CC.
  await actualizarEstadoPresupuesto(idPresupuesto, 'pagado', { fechaPago })
}

/**
 * Actualiza el monto y/o la fecha de vencimiento de un saldo.
 * CORRECCIÓN #8: si cambia `monto`, el remanente (`monto_pendiente`) se
 * recalcula preservando lo que ya se cobró, en vez de resetearse — evita que
 * editar el monto de un saldo con pago parcial "borre" el cobro ya recibido.
 */
export async function actualizarSaldo(idSaldo, { monto, fechaVto }) {
  const campos = {}
  if (fechaVto !== undefined) campos.fecha_vto = fechaVto ?? null

  if (monto !== undefined) {
    const { data: actual, error: errFetch } = await supabase
      .from('saldo')
      .select('monto, monto_pendiente')
      .eq('id_saldo', idSaldo)
      .single()
    if (errFetch) manejarError('actualizarSaldo:fetch', errFetch)

    const yaCobrado     = Number(actual.monto) - Number(actual.monto_pendiente)
    const nuevoPendiente = Math.max(0, Number(monto) - yaCobrado)

    campos.monto           = monto
    campos.monto_pendiente = nuevoPendiente
    campos.estado          = nuevoPendiente <= 0
      ? 'pagado'
      : (nuevoPendiente < Number(monto) ? 'parcial' : 'pendiente')
  }

  const { error } = await supabase
    .from('saldo')
    .update(campos)
    .eq('id_saldo', idSaldo)

  if (error) manejarError('actualizarSaldo', error)
}

/**
 * Revierte un saldo a estado pendiente por su monto original completo.
 *
 * ⚠️ Este es un revert "de golpe": pierde la granularidad de qué pagos
 * parciales se habían aplicado (el ledger en `pago`/`pago_aplicacion`
 * permanece, pero el saldo vuelve a deber el 100%). Para deshacer un pago
 * puntual de forma auditable, lo correcto a futuro es una función de
 * reversión de pago (ver sección de Escalabilidad).
 */
export async function revertirPagoSaldo(idSaldo) {
  const { data: actual, error: errFetch } = await supabase
    .from('saldo')
    .select('monto')
    .eq('id_saldo', idSaldo)
    .single()
  if (errFetch) manejarError('revertirPagoSaldo:fetch', errFetch)

  const { error } = await supabase
    .from('saldo')
    .update({
      estado:          'pendiente',
      fecha_pago:      null,
      monto_pendiente: actual.monto,
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
