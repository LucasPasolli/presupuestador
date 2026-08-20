// src/services/pedidosCuotasService.js
// Todo lo relacionado a Cuenta Corriente fraccionada (cuotas) de Pedidos de
// Compra pasa por acá. Complementa a pedidosService.js sin reemplazarlo:
// los pedidos SIN cuotas (efectivo/transferencia/echeck/CC simple) siguen
// usando pedidosService.crearPedido / actualizarPedido sin ningún cambio.
//
// ─── Edición de planes existentes ──────────────────────────────────────────
// Un plan de cuotas SÍ se puede editar una vez creado el pedido, pero con
// una regla dura: las cuotas con estado 'pagada' son inmutables (dinero ya
// entregado). Sólo las 'pendiente' se pueden reformular (%, días,
// agregar/quitar). La invariante Σ% == 100% se valida acá en el cliente
// (feedback inmediato) y se REVALIDA en el RPC `editar_plan_cuotas_pedido`
// (fuente de verdad — el cliente nunca es la única barrera para una mutación
// financiera).

import { supabase } from '../lib/supabase'
import { mapPedido } from './pedidosService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function manejarError(operacion, error) {
  console.error(`[pedidosCuotasService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

function mapCuota(row) {
  if (!row) return null
  return {
    idCuota:          row.id_cuota,
    idPedido:         row.id_pedido,
    numeroCuota:      row.numero_cuota,
    porcentaje:       Number(row.porcentaje),
    diasVencimiento:  row.dias_vencimiento,
    monto:            Number(row.monto),
    fechaVencimiento: row.fecha_vencimiento,
    estado:           row.estado,
    fechaPago:        row.fecha_pago,
    metodoPagoCuota:  row.metodo_pago_cuota,
  }
}

const EPSILON = 0.01 // tolerancia para comparaciones de punto flotante en %

// ─── Cálculo de plan de cuotas (uso 100% frontend, sin red) ────────────────────

/**
 * Dado un monto total y un borrador de cuotas [{ porcentaje, diasVencimiento }],
 * calcula el monto de cada cuota. La ÚLTIMA cuota absorbe el remanente de
 * redondeo para garantizar que sum(monto) === total exacto (nunca hay
 * descalce de centavos entre las cuotas y el total del pedido).
 *
 * Se reutiliza también en la EDICIÓN de un plan existente: en ese caso
 * `total` no es el total del pedido sino el "restante" (total - lo ya
 * pagado), ver calcularPlanCuotas() invocado desde PlanCuotasCC en modo
 * edición.
 *
 * @param {number} total
 * @param {{porcentaje:number, diasVencimiento:number}[]} cuotasDraft
 * @returns {{numeroCuota:number, porcentaje:number, diasVencimiento:number, monto:number}[]}
 */
export function calcularPlanCuotas(total, cuotasDraft) {
  if (!cuotasDraft.length) return []

  const montos = cuotasDraft.map(c => Math.round(total * (c.porcentaje / 100) * 100) / 100)
  const sumaParcial = montos.slice(0, -1).reduce((a, m) => a + m, 0)
  const ultimoMonto = Math.round((total - sumaParcial) * 100) / 100
  montos[montos.length - 1] = ultimoMonto

  return cuotasDraft.map((c, i) => ({
    numeroCuota:     i + 1,
    porcentaje:      c.porcentaje,
    diasVencimiento: c.diasVencimiento,
    monto:           montos[i],
  }))
}

/**
 * Valida un plan de cuotas antes de enviarlo al backend (creación).
 * Devuelve un string de error o null si es válido.
 *
 * @param {object[]} cuotasDraft
 * @param {number} [pctBloqueado=0]  % ya cubierto por cuotas pagadas e
 *   inmutables — se usa cuando esta misma función se reutiliza para
 *   EDICIÓN de un plan existente (ver validarEdicionPlanCuotas más abajo,
 *   que la envuelve con el mensaje específico de edición). En creación
 *   siempre es 0.
 */
export function validarPlanCuotas(cuotasDraft, pctBloqueado = 0) {
  if (!cuotasDraft.length) return 'Agregá al menos una cuota.'

  for (const [i, c] of cuotasDraft.entries()) {
    if (!c.porcentaje || c.porcentaje <= 0) return `La cuota ${i + 1} necesita un porcentaje mayor a 0.`
    if (c.diasVencimiento === '' || c.diasVencimiento === null || Number(c.diasVencimiento) < 0) {
      return `La cuota ${i + 1} necesita días de vencimiento válidos (0 o más).`
    }
  }

  const suma = pctBloqueado + cuotasDraft.reduce((a, c) => a + Number(c.porcentaje), 0)
  if (Math.abs(suma - 100) > EPSILON) {
    const objetivo = (100 - pctBloqueado).toFixed(2)
    return pctBloqueado > 0
      ? `Las cuotas pendientes suman ${(suma - pctBloqueado).toFixed(2)}%, deben sumar ${objetivo}% `
        + `(100% menos el ${pctBloqueado.toFixed(2)}% ya pagado).`
      : `La suma de los porcentajes es ${suma.toFixed(2)}%, debe ser exactamente 100%.`
  }
  return null
}

/**
 * Valida la EDICIÓN de un plan de cuotas ya existente. A diferencia de
 * validarPlanCuotas() (creación), acá el 100% se reparte entre lo ya
 * pagado (fijo, inmutable) y el borrador de cuotas pendientes editado por
 * el usuario.
 *
 * @param {object[]} cuotasPagadas          cuotas con estado === 'pagada'
 * @param {object[]} cuotasPendientesDraft  borrador editable [{porcentaje, diasVencimiento}]
 * @returns {string|null} error o null si es válido
 */
export function validarEdicionPlanCuotas(cuotasPagadas, cuotasPendientesDraft) {
  if (!cuotasPendientesDraft.length) {
    return 'Debe quedar al menos una cuota pendiente mientras haya saldo por cobrar.'
  }
  const pctPagado = cuotasPagadas.reduce((a, c) => a + Number(c.porcentaje), 0)
  return validarPlanCuotas(cuotasPendientesDraft, pctPagado)
}

// ─── Creación atómica (pedido + detalle + cuotas) ──────────────────────────────

/**
 * Crea un pedido de compra completo, incluyendo su plan de cuotas si lo
 * tiene, en una única transacción server-side (RPC). Usar SIEMPRE que
 * metodoPago === 'cuenta_corriente' — para el resto de los métodos, seguir
 * usando pedidosService.crearPedido (sin cambios).
 *
 * @param {object} pedidoPayload  mismo shape que pedidosService.crearPedido
 * @param {object[]} detallesPayload
 * @param {object[]|null} cuotas  resultado de calcularPlanCuotas(), o null/[]
 */
export async function crearPedidoConCuotas(pedidoPayload, detallesPayload, cuotas = null) {
  const { data, error } = await supabase.rpc('crear_pedido_compra_con_cuotas', {
    p_pedido: {
      fecha:             pedidoPayload.fecha,
      monto:              pedidoPayload.monto,
      estadoPago:         pedidoPayload.estadoPago,
      estadoLogistico:    pedidoPayload.estadoLogistico,
      metodoPago:         pedidoPayload.metodoPago,
      idProveedor:        pedidoPayload.idProveedor,
      nombreProveedor:    pedidoPayload.nombreProveedor,
      diasVencimientoCC:  pedidoPayload.diasVencimientoCC ?? null,
    },
    p_detalles: detallesPayload,
    p_cuotas:   cuotas && cuotas.length ? cuotas : null,
  })

  if (error) manejarError('crearPedidoConCuotas', error)
  return mapPedido(data) // mismo shape camelCase que pedidosService.crearPedido
}

// ─── Edición atómica del plan (SÓLO cuotas pendientes) ─────────────────────

/**
 * Reemplaza las cuotas PENDIENTES de un pedido existente vía RPC
 * transaccional. Las cuotas ya pagadas son intocables — el servidor las
 * protege independientemente de lo que valide (o no) el cliente:
 *   - lockea el pedido y sus cuotas (FOR UPDATE) para serializar contra
 *     un marcarCuotaPagada concurrente,
 *   - relee el monto del pedido desde la fila lockeada (nunca confía en un
 *     total mandado por parámetro),
 *   - recalcula el monto de cada cuota pendiente contra el "restante"
 *     (monto del pedido − lo ya cobrado), con la última absorbiendo el
 *     redondeo — misma lógica que calcularPlanCuotas(),
 *   - revalida Σ% (pagado + pendiente) == 100%.
 *
 * Usar sólo cuando pedido.tieneCuotas === true. Es idempotente: se puede
 * reintentar sin efectos secundarios si falla a mitad de camino.
 *
 * @param {number} idPedido
 * @param {{porcentaje:number, diasVencimiento:number}[]} cuotasPendientesDraft
 * @returns {object[]} plan de cuotas completo actualizado (pagadas + pendientes), camelCase
 */
export async function actualizarPlanCuotas(idPedido, cuotasPendientesDraft) {
  const payload = cuotasPendientesDraft.map(c => ({
    porcentaje:       Number(c.porcentaje),
    dias_vencimiento: Number(c.diasVencimiento),
  }))

  const { data, error } = await supabase.rpc('editar_plan_cuotas_pedido', {
    p_id_pedido:          idPedido,
    p_cuotas_pendientes:  payload,
  })

  if (error) manejarError('actualizarPlanCuotas', error)
  return data.map(mapCuota)
}

// ─── Consulta de cuotas ─────────────────────────────────────────────────────────

/**
 * Devuelve el plan de cuotas de un pedido, ordenado por número de cuota.
 */
export async function obtenerCuotasDePedido(idPedido) {
  const { data, error } = await supabase
    .from('pedido_compra_cuota')
    .select('*')
    .eq('id_pedido', idPedido)
    .order('numero_cuota')

  if (error) manejarError('obtenerCuotasDePedido', error)
  return data.map(mapCuota)
}

/**
 * Trae, en una sola query, el resumen de cuotas de varios pedidos a la vez.
 * Pensado para el listado de Pedidos de Compra: evita 1 query por pedido y
 * permite mostrar "N cuotas pendientes" + recalcular la deuda real (el
 * monto que falta cobrar, no el monto total del pedido) cuando hay pagos
 * parciales.
 *
 * @param {number[]} idsPedidos
 * @returns {Record<number, {totalCuotas:number, cuotasPendientes:number, montoPendiente:number, montoPagado:number}>}
 */
export async function obtenerResumenCuotasPorPedidos(idsPedidos) {
  if (!idsPedidos || !idsPedidos.length) return {}

  const { data, error } = await supabase
    .from('pedido_compra_cuota')
    .select('id_pedido, monto, estado')
    .in('id_pedido', idsPedidos)

  if (error) manejarError('obtenerResumenCuotasPorPedidos', error)

  const resumen = {}
  for (const row of data) {
    const key = row.id_pedido
    if (!resumen[key]) {
      resumen[key] = { totalCuotas: 0, cuotasPendientes: 0, montoPendiente: 0, montoPagado: 0 }
    }
    resumen[key].totalCuotas += 1
    if (row.estado === 'pagada') {
      resumen[key].montoPagado += Number(row.monto)
    } else {
      resumen[key].cuotasPendientes += 1
      resumen[key].montoPendiente += Number(row.monto)
    }
  }
  return resumen
}

// ─── Pago de una cuota individual ────────────────────────────────────────────────

/**
 * Marca una cuota puntual como pagada. Si era la última cuota pendiente del
 * pedido, el RPC marca automáticamente el pedido completo como pagado.
 */
export async function marcarCuotaPagada(idCuota, fechaPago, metodoPagoCuota = null) {
  const { data, error } = await supabase.rpc('marcar_cuota_pagada', {
    p_id_cuota:    idCuota,
    p_fecha_pago:  fechaPago,
    p_metodo_pago: metodoPagoCuota,
  })

  if (error) manejarError('marcarCuotaPagada', error)
  return mapCuota(data)
}
