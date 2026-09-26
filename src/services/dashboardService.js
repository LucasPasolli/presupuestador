// src/services/dashboardService.js
// Todas las queries del Dashboard pasan por aquí.
// Son exclusivamente de lectura — ninguna mutación vive en este service.

import { supabase } from '../lib/supabase'
import { obtenerCobradoEnPeriodo } from './cobrosService'

function manejarError(operacion, error) {
  console.error(`[dashboardService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

// ─── Queries individuales ─────────────────────────────────────────────────────

/**
 * Cuenta clientes activos.
 * Equivale a: SELECT COUNT(*) FROM Cliente WHERE activo = 1
 */
async function contarClientesActivos() {
  const { count, error } = await supabase
    .from('cliente')
    .select('*', { count: 'exact', head: true })
    .eq('activo', true)

  if (error) manejarError('contarClientesActivos', error)
  return count ?? 0
}

/**
 * Cuenta productos totales en inventario.
 * Equivale a: SELECT COUNT(*) FROM Producto
 */
async function contarProductos() {
  const { count, error } = await supabase
    .from('producto')
    .select('*', { count: 'exact', head: true })

  if (error) manejarError('contarProductos', error)
  return count ?? 0
}

/**
 * Cuenta productos con stock crítico (cantidad <= puntoReposicion).
 * Equivale a: SELECT COUNT(*) FROM Producto WHERE cantidad <= puntoReposicion
 * Usa la misma RPC de productosService para consistencia.
 */
async function contarProductosStockCritico() {
  const { data, error } = await supabase.rpc('productos_stock_critico')
  if (error) manejarError('contarProductosStockCritico', error)
  return data?.length ?? 0
}

/**
 * Cuenta presupuestos en borrador (pendientes de aprobar).
 * Equivale a: SELECT COUNT(*) FROM Presupuesto WHERE estado = 'borrador'
 */
async function contarPresupuestosBorrador() {
  const { count, error } = await supabase
    .from('presupuesto')
    .select('*', { count: 'exact', head: true })
    .eq('estado', 'borrador')

  if (error) manejarError('contarPresupuestosBorrador', error)
  return count ?? 0
}

/**
 * Cuenta presupuestos aprobados del mes actual.
 *
 * NOTA (alcance de la corrección de KPIs de cobro): esta métrica mide
 * ACTIVIDAD comercial (cuántos presupuestos se aprobaron este mes), no
 * dinero cobrado — por eso sigue filtrando por `presupuesto.fecha`
 * (fecha de creación/aprobación) a propósito. No confundir con
 * `sumarCobradoMes()`, que sí depende de la fecha real de pago. Un
 * presupuesto 'aprobado' puede no tener `fecha_pago` todavía (Cuenta
 * Corriente pendiente) y aun así debe contar acá.
 *
 * Equivale a:
 *   SELECT COUNT(*) FROM Presupuesto
 *   WHERE estado = 'aprobado'
 *   AND fecha >= primer día del mes
 *   AND fecha <= último día del mes
 */
async function contarPresupuestosAprobadosMes() {
  const { primerDia, ultimoDia } = _rangoMesActual()

  const { count, error } = await supabase
    .from('presupuesto')
    .select('*', { count: 'exact', head: true })
    .eq('estado', 'aprobado')
    .gte('fecha', primerDia)
    .lte('fecha', ultimoDia)

  if (error) manejarError('contarPresupuestosAprobadosMes', error)
  return count ?? 0
}

/**
 * Calcula el rango [primerDia, ultimoDia] del mes calendario actual, en
 * formato 'YYYY-MM-DD'. Compartido por las métricas mensuales del Dashboard.
 */
function _rangoMesActual() {
  const ahora     = new Date()
  const primerDia = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
    .toISOString().split('T')[0]
  const ultimoDia = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0)
    .toISOString().split('T')[0]
  return { primerDia, ultimoDia }
}

/**
 * Dinero REALMENTE cobrado en lo que va del mes actual (base caja).
 *
 * CORRECCIÓN (criterio de fecha en KPIs de cobro): esta métrica se llamaba
 * `sumarVentasMes` y sumaba `presupuesto.monto` para estado IN
 * ('aprobado','pagado') filtrando por `presupuesto.fecha` — la fecha de
 * CREACIÓN del presupuesto (Día X), no la fecha en que efectivamente entró
 * el dinero (Día Y). Consecuencias del bug original:
 *   - Un presupuesto creado en enero y cobrado en febrero sumaba en el KPI
 *     de enero, y no aparecía en el de febrero (Escenario 1 de la task).
 *   - Un presupuesto 'aprobado' pero todavía sin cobrar (Cuenta Corriente
 *     pendiente) ya sumaba como si fuera plata en caja (Escenario 3: no
 *     debe contabilizarse hasta que exista fecha de pago real).
 *
 * Ahora reutiliza `cobrosService.obtenerCobradoEnPeriodo`, la misma fuente
 * de verdad que ya usan Estadísticas y Facturas: resuelve, por método de
 * pago, `presupuesto.fecha_pago` (contado), `saldo.fecha_pago` (CC pagada
 * de una vez) o la suma de `pago.fecha` de cada aplicación parcial (CC
 * cobrada de a partes) — nunca la fecha de creación. Un presupuesto
 * 'aprobado' sin fecha de pago simplemente no aparece en ningún período,
 * hasta que se registre su cobro.
 *
 * Equivale a:
 *   SELECT COALESCE(SUM(monto_realmente_cobrado), 0)
 *   FROM <fuente resuelta por cobrosService>
 *   WHERE fecha_de_cobro_real BETWEEN primer_dia_del_mes AND hoy
 */
async function sumarCobradoMes() {
  const { primerDia, ultimoDia } = _rangoMesActual()
  const { total } = await obtenerCobradoEnPeriodo(primerDia, ultimoDia)
  return total
}

/**
 * Suma total de saldos pendientes (cuenta corriente).
 * Equivale a: SELECT SUM(monto) FROM Saldo WHERE estado = 'pendiente'
 */
async function sumarSaldosPendientes() {
  const { data, error } = await supabase
    .from('saldo')
    .select('monto')
    .eq('estado', 'pendiente')

  if (error) manejarError('sumarSaldosPendientes', error)
  return data.reduce((acc, row) => acc + Number(row.monto), 0)
}

/**
 * Cuenta pedidos de compra pendientes de recibir.
 * Equivale a:
 *   SELECT COUNT(*) FROM PedidoCompra
 *   WHERE estadoLogistico IN ('encargado','revisar')
 */
async function contarPedidosPendientes() {
  const { count, error } = await supabase
    .from('pedido_compra')
    .select('*', { count: 'exact', head: true })
    .in('estado_logistico', ['encargado', 'revisar'])

  if (error) manejarError('contarPedidosPendientes', error)
  return count ?? 0
}

/**
 * Devuelve los últimos N presupuestos creados con nombre del cliente.
 * Equivale a:
 *   SELECT * FROM Presupuesto ORDER BY fecha DESC, idPresupuesto DESC LIMIT ?
 */
async function obtenerUltimosPresupuestos(limite = 5) {
  const { data, error } = await supabase
    .from('presupuesto')
    .select('id_presupuesto, fecha, monto, estado, nombre_cliente, apellido_cliente, metodo_pago')
    .order('fecha',          { ascending: false })
    .order('id_presupuesto', { ascending: false })
    .limit(limite)

  if (error) manejarError('obtenerUltimosPresupuestos', error)
  return data.map(row => ({
    idPresupuesto:   row.id_presupuesto,
    fecha:           row.fecha,
    monto:           Number(row.monto),
    estado:          row.estado,
    nombreCliente:   row.nombre_cliente,
    apellidoCliente: row.apellido_cliente,
    metodoPago:      row.metodo_pago,
  }))
}

// ─── Query principal combinada ────────────────────────────────────────────────

/**
 * Carga todos los datos del Dashboard en paralelo.
 * Reemplaza las N llamadas secuenciales que hacía Dashboard.jsx.
 * Todas las queries corren simultáneamente con Promise.all().
 *
 * @returns {Object} Todos los indicadores que necesita Dashboard.jsx
 */
export async function obtenerDatosDashboard() {
  const [
    totalClientes,
    totalProductos,
    stockCritico,
    presupuestosBorrador,
    presupuestosAprobadosMes,
    cobradoMes,
    saldosPendientes,
    pedidosPendientes,
    ultimosPresupuestos,
  ] = await Promise.all([
    contarClientesActivos(),
    contarProductos(),
    contarProductosStockCritico(),
    contarPresupuestosBorrador(),
    contarPresupuestosAprobadosMes(),
    sumarCobradoMes(),
    sumarSaldosPendientes(),
    contarPedidosPendientes(),
    obtenerUltimosPresupuestos(5),
  ])

  return {
    totalClientes,
    totalProductos,
    stockCritico,
    presupuestosBorrador,
    presupuestosAprobadosMes,
    // RENOMBRADO desde `ventasMes` → `cobradoMes`: el valor ya representa
    // dinero efectivamente cobrado en el mes (fecha de pago real), no
    // presupuestos creados/aprobados en el mes. Ver nota de ⚠️ BREAKING
    // CHANGE en la respuesta — requiere actualizar el consumidor en
    // Dashboard.jsx (`datos.ventasMes` → `datos.cobradoMes`).
    cobradoMes,
    saldosPendientes,
    pedidosPendientes,
    ultimosPresupuestos,
  }
}