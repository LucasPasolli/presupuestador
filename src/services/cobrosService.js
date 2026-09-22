// src/services/cobrosService.js
//
// Fuente de verdad ÚNICA para "cuánto dinero entró realmente en un rango de
// fechas", sin importar qué pantalla lo consuma (Dashboard, Estadísticas,
// Facturas). Antes esta lógica vivía duplicada/parcialmente reimplementada
// en distintos services, cada uno con su propio criterio de fecha — que es
// justo la causa raíz del bug de KPIs de cobro (ver TASK "Corrección del
// criterio de fecha en KPIs de cobro"):
//
//   - Un presupuesto CONTADO (efectivo/transferencia) se cobra el día que
//     se confirma el pago → `presupuesto.fecha_pago` (Día Y), NUNCA
//     `presupuesto.fecha` (Día X, fecha de creación/emisión).
//   - Un presupuesto de CUENTA CORRIENTE (cc15/cc30) puede cobrarse de una
//     sola vez → `saldo.fecha_pago`, o en cuotas/pagos parciales → cada
//     aplicación parcial cae en la fecha de SU propio pago (`pago.fecha`
//     vía `pago_aplicacion`), no en una única fecha del presupuesto.
//   - Un presupuesto sin fecha de pago registrada (todavía no cobrado) NO
//     debe contabilizarse en NINGÚN período (Escenario 3 de la task).
//
// Toda esta lógica se resuelve del lado del servidor con la RPC
// `obtener_presupuestos_facturables(fecha_desde, fecha_hasta)`, que ya hace
// el COALESCE(saldo.fecha_pago, presupuesto.fecha_pago, presupuesto.fecha)
// correcto por método de pago. Este módulo es solo la capa fina (Repository)
// sobre esa RPC + la agregación de pagos parciales.
//
// Cualquier KPI nuevo que necesite "monto cobrado en un rango" DEBE pasar
// por acá — no reimplementar el filtro de fechas a mano contra `presupuesto`.

import { supabase } from '../lib/supabase'

function manejarError(operacion, error) {
  console.error(`[cobrosService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

/**
 * Pagos parciales de Cuenta Corriente cuya fecha de aplicación
 * (`pago.fecha`, el Día Y real de ESE pago puntual) cae en el rango.
 * Cada aplicación se imputa por su propia fecha, no por la del saldo ni la
 * del presupuesto — así un saldo cobrado en dos cuotas en meses distintos
 * reparte correctamente el monto entre ambos períodos.
 *
 * @param {string} desde 'YYYY-MM-DD'
 * @param {string} hasta 'YYYY-MM-DD'
 * @returns {Promise<{idPresupuesto:number, montoAplicado:number}[]>}
 */
export async function obtenerPagosParcialesEnPeriodo(desde, hasta) {
  const { data: pagos, error: e1 } = await supabase
    .from('pago')
    .select('id_pago, fecha')
    .gte('fecha', desde)
    .lte('fecha', hasta)

  if (e1) manejarError('obtenerPagosParcialesEnPeriodo(pagos)', e1)
  if (!pagos?.length) return []

  const idsPago = pagos.map(p => p.id_pago)

  const { data: aplicaciones, error: e2 } = await supabase
    .from('pago_aplicacion')
    .select(`
      id_aplicacion,
      id_pago,
      monto_aplicado,
      saldo ( id_presupuesto )
    `)
    .in('id_pago', idsPago)

  if (e2) manejarError('obtenerPagosParcialesEnPeriodo(aplicaciones)', e2)

  return (aplicaciones ?? [])
    .filter(a => a.saldo?.id_presupuesto != null)
    .map(a => ({
      idPresupuesto: a.saldo.id_presupuesto,
      montoAplicado: Number(a.monto_aplicado),
    }))
}

/**
 * Dinero REALMENTE cobrado en el rango [desde, hasta] (base caja), separado
 * en Contado vs. Cuenta Corriente, según la fecha real de cada cobro y no
 * la fecha de creación del presupuesto asociado.
 *
 * Regla de deduplicación: un presupuesto de CC con AL MENOS un pago parcial
 * ya está representado por esos pagos parciales — no se vuelve a sumar
 * completo desde la RPC, para no duplicar lo cobrado.
 *
 * @param {string} desde 'YYYY-MM-DD'
 * @param {string} hasta 'YYYY-MM-DD'
 * @returns {Promise<{contado:number, cc:number, total:number}>}
 */
export async function obtenerCobradoEnPeriodo(desde, hasta) {
  const [rpcResult, pagosParciales] = await Promise.all([
    supabase.rpc('obtener_presupuestos_facturables', {
      fecha_desde: desde,
      fecha_hasta: hasta,
    }),
    obtenerPagosParcialesEnPeriodo(desde, hasta),
  ])

  const { data: presupuestos, error } = rpcResult
  if (error) manejarError('obtenerCobradoEnPeriodo(rpc)', error)

  const idsConPagoParcial = new Set(pagosParciales.map(pp => pp.idPresupuesto))
  const ventas = (presupuestos ?? []).filter(p => !idsConPagoParcial.has(p.id_presupuesto))

  const montoContado = ventas
    .filter(p => p.metodo_pago === 'efectivo' || p.metodo_pago === 'transferencia')
    .reduce((a, p) => a + Number(p.monto), 0)

  const montoCCDirecto = ventas
    .filter(p => p.metodo_pago === 'cc15' || p.metodo_pago === 'cc30')
    .reduce((a, p) => a + Number(p.monto), 0)

  const montoCCParcial = pagosParciales.reduce((a, pp) => a + pp.montoAplicado, 0)

  return {
    contado: montoContado,
    cc:      montoCCDirecto + montoCCParcial,
    total:   montoContado + montoCCDirecto + montoCCParcial,
  }
}
