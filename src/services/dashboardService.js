// src/services/dashboardService.js
// Todas las queries del Dashboard pasan por aquí.
// Son exclusivamente de lectura — ninguna mutación vive en este service.

import { supabase } from '../lib/supabase'

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
 * Equivale a:
 *   SELECT COUNT(*) FROM Presupuesto
 *   WHERE estado = 'aprobado'
 *   AND fecha >= primer día del mes
 *   AND fecha <= último día del mes
 */
async function contarPresupuestosAprobadosMes() {
  const ahora      = new Date()
  const primerDia  = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
    .toISOString().split('T')[0]
  const ultimoDia  = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0)
    .toISOString().split('T')[0]

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
 * Suma ventas (monto) del mes actual para presupuestos aprobados y pagados.
 * Equivale a:
 *   SELECT SUM(monto) FROM Presupuesto
 *   WHERE estado IN ('aprobado','pagado')
 *   AND fecha >= primer día del mes
 */
async function sumarVentasMes() {
  const ahora     = new Date()
  const primerDia = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
    .toISOString().split('T')[0]
  const ultimoDia = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0)
    .toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('presupuesto')
    .select('monto')
    .in('estado', ['aprobado', 'pagado'])
    .gte('fecha', primerDia)
    .lte('fecha', ultimoDia)

  if (error) manejarError('sumarVentasMes', error)
  return data.reduce((acc, row) => acc + Number(row.monto), 0)
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
    ventasMes,
    saldosPendientes,
    pedidosPendientes,
    ultimosPresupuestos,
  ] = await Promise.all([
    contarClientesActivos(),
    contarProductos(),
    contarProductosStockCritico(),
    contarPresupuestosBorrador(),
    contarPresupuestosAprobadosMes(),
    sumarVentasMes(),
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
    ventasMes,
    saldosPendientes,
    pedidosPendientes,
    ultimosPresupuestos,
  }
}