// src/services/estadisticasService.js
// Todas las queries analíticas de Estadisticas.jsx pasan por aquí.
// Son exclusivamente de lectura — ninguna mutación vive en este service.

import { supabase }            from '../lib/supabase'
import { obtenerResumenFlujoCaja } from './movimientosService'

function manejarError(operacion, error) {
  console.error(`[estadisticasService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

// ─── Ventas ───────────────────────────────────────────────────────────────────

/**
 * Devuelve ventas agrupadas por día en un rango de fechas.
 * Mueve al servidor la agregación que antes hacía Estadisticas.jsx con reduce().
 * Equivale a:
 *   SELECT fecha, COUNT(*) as cantidad, SUM(monto) as total
 *   FROM Presupuesto
 *   WHERE estado IN ('aprobado','pagado')
 *   AND fecha BETWEEN ? AND ?
 *   GROUP BY fecha
 *   ORDER BY fecha ASC
 */
export async function obtenerVentasPorDia({ fechaDesde, fechaHasta }) {
  const { data, error } = await supabase.rpc('ventas_por_dia', {
    p_fecha_desde: fechaDesde,
    p_fecha_hasta: fechaHasta,
  })

  if (error) manejarError('obtenerVentasPorDia', error)
  return data.map(row => ({
    fecha:    row.fecha,
    cantidad: Number(row.cantidad),
    total:    Number(row.total),
  }))
}

/**
 * Devuelve ventas agrupadas por método de pago en un rango de fechas.
 * Equivale a:
 *   SELECT metodoPago, COUNT(*) as cantidad, SUM(monto) as total
 *   FROM Presupuesto
 *   WHERE estado IN ('aprobado','pagado')
 *   AND fecha BETWEEN ? AND ?
 *   GROUP BY metodoPago
 */
export async function obtenerVentasPorMetodoPago({ fechaDesde, fechaHasta }) {
  const { data, error } = await supabase.rpc('ventas_por_metodo_pago', {
    p_fecha_desde: fechaDesde,
    p_fecha_hasta: fechaHasta,
  })

  if (error) manejarError('obtenerVentasPorMetodoPago', error)
  return data.map(row => ({
    metodoPago: row.metodo_pago,
    cantidad:   Number(row.cantidad),
    total:      Number(row.total),
  }))
}

/**
 * Devuelve los productos más vendidos por cantidad en un rango de fechas.
 * Equivale a:
 *   SELECT dp.nombreProducto, SUM(dp.cantidad) as totalUnidades, SUM(dp.subtotal) as totalPesos
 *   FROM DetallePresupuesto dp
 *   JOIN Presupuesto p ON dp.idPresupuesto = p.idPresupuesto
 *   WHERE p.estado IN ('aprobado','pagado')
 *   AND p.fecha BETWEEN ? AND ?
 *   GROUP BY dp.nombreProducto
 *   ORDER BY totalUnidades DESC
 *   LIMIT ?
 */
export async function obtenerProductosMasVendidos({
  fechaDesde,
  fechaHasta,
  limite = 10,
}) {
  const { data, error } = await supabase.rpc('productos_mas_vendidos', {
    p_fecha_desde: fechaDesde,
    p_fecha_hasta: fechaHasta,
    p_limite:      limite,
  })

  if (error) manejarError('obtenerProductosMasVendidos', error)
  return data.map(row => ({
    nombreProducto: row.nombre_producto,
    totalUnidades:  Number(row.total_unidades),
    totalPesos:     Number(row.total_pesos),
  }))
}

/**
 * Devuelve los clientes con mayor volumen de compra en un rango de fechas.
 * Equivale a:
 *   SELECT p.nombreCliente, p.apellidoCliente, COUNT(*) as cantPresupuestos,
 *          SUM(p.monto) as totalComprado
 *   FROM Presupuesto p
 *   WHERE p.estado IN ('aprobado','pagado')
 *   AND p.fecha BETWEEN ? AND ?
 *   GROUP BY p.idCliente, p.nombreCliente, p.apellidoCliente
 *   ORDER BY totalComprado DESC
 *   LIMIT ?
 */
export async function obtenerClientesTopCompras({
  fechaDesde,
  fechaHasta,
  limite = 10,
}) {
  const { data, error } = await supabase.rpc('clientes_top_compras', {
    p_fecha_desde: fechaDesde,
    p_fecha_hasta: fechaHasta,
    p_limite:      limite,
  })

  if (error) manejarError('obtenerClientesTopCompras', error)
  return data.map(row => ({
    nombreCliente:   row.nombre_cliente,
    apellidoCliente: row.apellido_cliente,
    cantPresupuestos: Number(row.cant_presupuestos),
    totalComprado:   Number(row.total_comprado),
  }))
}

// ─── Query principal combinada ────────────────────────────────────────────────

/**
 * Carga todos los datos de Estadisticas.jsx en paralelo para un rango de fechas.
 * Reemplaza las N queries secuenciales que hacía el componente.
 *
 * @param {{ fechaDesde: string, fechaHasta: string }} rango
 * @returns {Object} Todos los datos analíticos que necesita Estadisticas.jsx
 */
export async function obtenerEstadisticasCompletas({ fechaDesde, fechaHasta }) {
  const filtro = { fechaDesde, fechaHasta }

  const [
    ventasPorDia,
    ventasPorMetodoPago,
    productosMasVendidos,
    clientesTop,
    flujoCaja,
  ] = await Promise.all([
    obtenerVentasPorDia(filtro),
    obtenerVentasPorMetodoPago(filtro),
    obtenerProductosMasVendidos({ ...filtro, limite: 10 }),
    obtenerClientesTopCompras({ ...filtro, limite: 10 }),
    obtenerResumenFlujoCaja(filtro),
  ])

  // Totales de ventas calculados desde los datos ya traídos
  const totalVentas    = ventasPorDia.reduce((acc, d) => acc + d.total, 0)
  const cantVentas     = ventasPorDia.reduce((acc, d) => acc + d.cantidad, 0)
  const ticketPromedio = cantVentas > 0
    ? Math.round((totalVentas / cantVentas) * 100) / 100
    : 0

  return {
    ventasPorDia,
    ventasPorMetodoPago,
    productosMasVendidos,
    clientesTop,
    flujoCaja,
    resumen: {
      totalVentas,
      cantVentas,
      ticketPromedio,
      totalEgresos:   flujoCaja.totalEgresos,
      totalIngresos:  flujoCaja.totalIngresos,
      balance:        flujoCaja.balance,
    },
  }
}