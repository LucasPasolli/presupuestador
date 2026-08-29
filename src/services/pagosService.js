// src/services/pagosService.js
//
// Motor de Pago Parcial. Toda la lógica de imputación cronológica vive en
// el servidor (función `fn_aplicar_pago_cliente` en Postgres, ver
// migration_pago_parcial.sql) para garantizar atomicidad: si dos pagos del
// mismo cliente llegan casi al mismo tiempo, la transacción de Postgres con
// FOR UPDATE evita que se pisen o dupliquen imputaciones.
//
// Este archivo solo hace de capa fina (Repository) hacia ese RPC, más
// utilidades de búsqueda y una previsualización client-side (no autoritativa,
// solo para UX) que replica la misma regla de negocio.

import { supabase } from '../lib/supabase'
import { obtenerSaldosPendientesDeCliente } from './saldosService'

const METODOS_VALIDOS = ['efectivo', 'transferencia', 'cheque', 'otro']
const MONTO_MAXIMO    = 100_000_000 // guardrail de sanidad, ajustar según el negocio

function manejarError(operacion, error) {
  console.error(`[pagosService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

// Sanitización defensiva de texto libre (descripciones ingresadas por el usuario)
// antes de mandarlo a la base — previene payloads anómalos y acota longitud.
function sanitizarTexto(valor, maxLen = 200) {
  if (typeof valor !== 'string') return null
  const limpio = valor.trim().slice(0, maxLen)
  return limpio || null
}

/**
 * Busca clientes que tengan al menos un saldo con deuda activa
 * (estado 'pendiente' o 'parcial'), agregando su deuda total.
 * Se usa para el selector de cliente del modal de Pago Parcial:
 * solo tiene sentido registrar un pago contra alguien que debe algo.
 */
export async function buscarClientesConDeuda(search = '', limite = 15) {
  const texto = sanitizarTexto(search, 80) ?? ''

  const { data, error } = await supabase
    .from('saldo')
    .select(`
      id_cliente,
      monto_pendiente,
      cliente ( id_cliente, nombre, apellido, apodo )
    `)
    .in('estado', ['pendiente', 'parcial'])
    .gt('monto_pendiente', 0)
    .limit(1000)

  if (error) manejarError('buscarClientesConDeuda', error)

  // Agregación por cliente (un cliente puede tener varias cuentas corrientes)
  const porCliente = new Map()
  for (const row of data) {
    const c = row.cliente
    if (!c) continue
    if (!porCliente.has(c.id_cliente)) {
      porCliente.set(c.id_cliente, {
        idCliente:  c.id_cliente,
        nombre:     c.nombre,
        apellido:   c.apellido,
        apodo:      c.apodo,
        deudaTotal: 0,
        cantSaldos: 0,
      })
    }
    const acc = porCliente.get(c.id_cliente)
    acc.deudaTotal += Number(row.monto_pendiente)
    acc.cantSaldos += 1
  }

  let resultado = Array.from(porCliente.values())

  if (texto) {
    const t = texto.toLowerCase()
    const esNumero = /^\d+$/.test(t)
    resultado = resultado.filter(c => {
      const nombre   = (c.nombre   ?? '').toLowerCase()
      const apellido = (c.apellido ?? '').toLowerCase()
      const apodo    = (c.apodo    ?? '').toLowerCase()
      const completo = `${nombre} ${apellido}`
      return (
        nombre.includes(t)   || apellido.includes(t) ||
        apodo.includes(t)    || completo.includes(t) ||
        (esNumero && c.idCliente === Number(t))
      )
    })
  }

  resultado.sort((a, b) => b.deudaTotal - a.deudaTotal)
  return resultado.slice(0, limite)
}

/**
 * Saldos con deuda de un cliente, ordenados cronológicamente
 * (mismo orden que usará el RPC del servidor al imputar).
 */
export async function obtenerSaldosImputablesDeCliente(idCliente) {
  const saldos = await obtenerSaldosPendientesDeCliente(idCliente)
  return saldos.filter(s => (s.montoPendiente ?? s.monto) > 0)
}

/**
 * Previsualización client-side de cómo se imputaría un monto dado sobre
 * una lista de saldos ya ordenada cronológicamente. NO es autoritativa:
 * es solo para mostrarle al usuario "esto es lo que va a pasar" antes de
 * confirmar. La imputación real siempre la calcula y persiste el servidor.
 */
export function previsualizarImputacion(saldosOrdenados, monto) {
  let restante = Number(monto) || 0
  const detalle = []

  for (const saldo of saldosOrdenados) {
    const pendiente = saldo.montoPendiente ?? saldo.monto

    if (restante <= 0) {
      detalle.push({ ...saldo, montoAplicado: 0, montoPendienteResultante: pendiente, estadoResultante: saldo.estado })
      continue
    }

    const aplicar   = Math.min(restante, pendiente)
    const nuevoPend = pendiente - aplicar

    detalle.push({
      ...saldo,
      montoAplicado: aplicar,
      montoPendienteResultante: nuevoPend,
      estadoResultante: nuevoPend <= 0 ? 'pagado' : 'parcial',
    })

    restante -= aplicar
  }

  return { detalle, sobrante: Math.max(restante, 0) }
}

/**
 * Registra un pago de cliente y dispara la imputación cronológica atómica
 * en el servidor. Validaciones client-side son solo primera línea de UX:
 * la base de datos vuelve a validar (monto > 0, cliente existente, etc.)
 * porque nunca hay que confiar en el cliente para reglas de negocio financieras.
 */
export async function registrarPagoParcial({
  idCliente,
  monto,
  metodoPago = 'efectivo',
  fecha = null,
  descripcion = '',
}) {
  const montoNum = Number(monto)

  if (!idCliente || !Number.isFinite(idCliente)) {
    throw new Error('Debe seleccionar un cliente válido.')
  }
  if (!Number.isFinite(montoNum) || montoNum <= 0) {
    throw new Error('El monto debe ser un número mayor a cero.')
  }
  if (montoNum > MONTO_MAXIMO) {
    throw new Error('El monto ingresado excede el máximo permitido.')
  }

  const metodo     = METODOS_VALIDOS.includes(metodoPago) ? metodoPago : 'efectivo'
  const fechaPago  = fecha ?? new Date().toISOString().slice(0, 10)
  const desc       = sanitizarTexto(descripcion, 300)

  const { data, error } = await supabase.rpc('fn_aplicar_pago_cliente', {
    p_id_cliente:  idCliente,
    p_monto:       montoNum,
    p_metodo_pago: metodo,
    p_fecha:       fechaPago,
    p_descripcion: desc,
  })

  if (error) manejarError('registrarPagoParcial', error)

  return {
    idPago:         data.idPago,
    montoTotal:     Number(data.montoTotal),
    montoAplicado:  Number(data.montoAplicado),
    montoSobrante:  Number(data.montoSobrante),
    saldosAfectados: (data.saldosAfectados ?? []).map(s => ({
      idSaldo:                  s.idSaldo,
      idPresupuesto:            s.idPresupuesto,
      montoAplicado:            Number(s.montoAplicado),
      montoPendienteAnterior:   Number(s.montoPendienteAnterior),
      montoPendienteResultante: Number(s.montoPendienteResultante),
      estadoResultante:         s.estadoResultante,
    })),
  }
}

/**
 * Historial de imputaciones aplicadas sobre un saldo puntual.
 * Se usa en la vista de detalle de Saldo para mostrar "quién pagó qué y cuándo".
 */
export async function obtenerAplicacionesDeSaldo(idSaldo) {
  const { data, error } = await supabase
    .from('pago_aplicacion')
    .select(`
      id_aplicacion,
      monto_aplicado,
      saldo_anterior,
      saldo_resultante,
      created_at,
      pago ( id_pago, fecha, metodo_pago, descripcion )
    `)
    .eq('id_saldo', idSaldo)
    .order('created_at', { ascending: true })

  if (error) manejarError('obtenerAplicacionesDeSaldo', error)

  return data.map(row => ({
    idAplicacion:    row.id_aplicacion,
    montoAplicado:   Number(row.monto_aplicado),
    saldoAnterior:   Number(row.saldo_anterior),
    saldoResultante: Number(row.saldo_resultante),
    fecha:           row.pago?.fecha ?? null,
    metodoPago:      row.pago?.metodo_pago ?? null,
    descripcion:     row.pago?.descripcion ?? null,
    idPago:          row.pago?.id_pago ?? null,
  }))
}

/**
 * Historial de pagos de un cliente (cabeceras), útil para una futura
 * ficha de cliente / cuenta corriente consolidada.
 */
export async function obtenerHistorialPagosCliente(idCliente, limite = 50) {
  const { data, error } = await supabase
    .from('pago')
    .select(`
      id_pago, monto, fecha, metodo_pago, descripcion, created_at,
      pago_aplicacion ( id_saldo, monto_aplicado )
    `)
    .eq('id_cliente', idCliente)
    .order('fecha', { ascending: false })
    .limit(limite)

  if (error) manejarError('obtenerHistorialPagosCliente', error)

  return data.map(p => ({
    idPago:              p.id_pago,
    monto:               Number(p.monto),
    fecha:               p.fecha,
    metodoPago:          p.metodo_pago,
    descripcion:         p.descripcion,
    cantSaldosAfectados: p.pago_aplicacion?.length ?? 0,
  }))
}
