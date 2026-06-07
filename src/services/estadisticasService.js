// src/services/estadisticasService.js
// Todas las queries de Estadisticas.jsx pasan por aquí.
// Son exclusivamente de lectura — ninguna mutación vive en este service.
//
// Reemplaza completamente a la función calcularMetricas() que vivía en
// Estadisticas.jsx y que llamaba a query() sobre SQLite/localStorage.
//
// La función principal es obtenerMetricas(desde, hasta), que ejecuta todas
// las consultas en paralelo (Promise.all) y devuelve el mismo objeto `m`
// que ya consume el componente.

import { supabase } from '../lib/supabase'

// ─── Helper de error ──────────────────────────────────────────────────────────

function manejarError(operacion, error) {
  console.error(`[estadisticasService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

// ─── Helpers de fecha ─────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10)
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUERIES INDIVIDUALES (privadas)
// Cada una corresponde a un bloque de calcularMetricas() en Estadisticas.jsx
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Bloque 1: Presupuestos del período (aprobados + pagados).
 * Devuelve los presupuestos y, en la misma llamada, los subtotales por promoción
 * de cada uno (necesarios para calcular descuentos).
 *
 * Equivale a:
 *   SELECT p.*, SUM(dp.subtotal) AS subtotalConPromos
 *   FROM Presupuesto p
 *   LEFT JOIN DetallePresupuesto dp ON dp.idPresupuesto = p.idPresupuesto
 *   WHERE p.fecha BETWEEN ? AND ? AND p.estado IN ('aprobado','pagado')
 *   GROUP BY p.idPresupuesto
 */
async function _obtenerPresupuestosPeriodo(desde, hasta) {
  // 1a. Cabeceras
  const { data: pres, error: e1 } = await supabase
    .from('presupuesto')
    .select('id_presupuesto, monto, monto_original, metodo_pago, fecha, id_cliente, estado')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .in('estado', ['aprobado', 'pagado'])

  if (e1) manejarError('_obtenerPresupuestosPeriodo(cabeceras)', e1)
  if (!pres.length) return { presupuestos: [], mapaSubtotal: {} }

  // 1b. Subtotales con promos para esos presupuestos
  const ids = pres.map(p => p.id_presupuesto)
  const { data: subs, error: e2 } = await supabase
    .from('detalle_presupuesto')
    .select('id_presupuesto, subtotal')
    .in('id_presupuesto', ids)

  if (e2) manejarError('_obtenerPresupuestosPeriodo(subtotales)', e2)

  // Acumular subtotal por presupuesto
  const mapaSubtotal = {}
  for (const row of subs) {
    mapaSubtotal[row.id_presupuesto] = (mapaSubtotal[row.id_presupuesto] ?? 0) + Number(row.subtotal)
  }

  const presupuestos = pres.map(row => ({
    idPresupuesto: row.id_presupuesto,
    monto:         Number(row.monto),
    montoOriginal: Number(row.monto_original),
    metodoPago:    row.metodo_pago,
    fecha:         row.fecha,
    idCliente:     row.id_cliente,
    estado:        row.estado,
  }))

  return { presupuestos, mapaSubtotal }
}

/**
 * Bloque 2: Saldos CC generados por presupuestos del período.
 * Equivale a:
 *   SELECT s.monto, s.estado FROM Saldo s
 *   JOIN Presupuesto p ON p.idPresupuesto = s.idPresupuesto
 *   WHERE p.fecha BETWEEN ? AND ?
 */
async function _obtenerSaldosDelPeriodo(desde, hasta) {
  // Supabase no soporta JOIN cross-table en .select() sin relación directa;
  // usamos una RPC o hacemos dos queries. Optamos por dos queries (simple y sin RPC extra).
  const { data: pres, error: e1 } = await supabase
    .from('presupuesto')
    .select('id_presupuesto')
    .gte('fecha', desde)
    .lte('fecha', hasta)

  if (e1) manejarError('_obtenerSaldosDelPeriodo(presupuestos)', e1)
  if (!pres.length) return []

  const ids = pres.map(p => p.id_presupuesto)
  const { data, error: e2 } = await supabase
    .from('saldo')
    .select('monto, estado, id_presupuesto')
    .in('id_presupuesto', ids)

  if (e2) manejarError('_obtenerSaldosDelPeriodo(saldos)', e2)
  return data.map(r => ({ monto: Number(r.monto), estado: r.estado }))
}

/**
 * Bloque 3a: Suma de ingresos extra del período (tabla ingreso).
 * Equivale a: SELECT COALESCE(SUM(monto),0) FROM Ingreso WHERE fecha BETWEEN ? AND ?
 */
async function _obtenerIngresosExtra(desde, hasta) {
  const { data, error } = await supabase
    .from('ingreso')
    .select('monto')
    .gte('fecha', desde)
    .lte('fecha', hasta)

  if (error) manejarError('_obtenerIngresosExtra', error)
  return data.reduce((a, r) => a + Number(r.monto), 0)
}

/**
 * Bloque 3b: Dinero invertido activo (global, sin filtro de período).
 * Equivale a: SELECT monto, estado FROM Inversion
 */
async function _obtenerInversionesGlobal() {
  const { data, error } = await supabase
    .from('inversion')
    .select('monto, estado')

  if (error) manejarError('_obtenerInversionesGlobal', error)
  return data.map(r => ({ monto: Number(r.monto), estado: r.estado }))
}

/**
 * Bloque 4: Saldos pendientes globales con nombre del cliente
 * (para vencidos / por vencer / próximos vencimientos).
 *
 * Equivale a:
 *   SELECT s.monto, s.fechaFin,
 *          COALESCE(p.nombreCliente, c.nombre, '')   AS nombre,
 *          COALESCE(p.apellidoCliente, c.apellido,'') AS apellido
 *   FROM Saldo s
 *   JOIN Presupuesto p ON p.idPresupuesto = s.idPresupuesto
 *   LEFT JOIN Cliente c ON c.idCliente = s.idCliente
 *   WHERE s.estado = 'pendiente'
 *   ORDER BY s.fechaFin ASC
 *
 * Nota: se usa fecha_vto (campo en BD PostgreSQL). La columna SQLite era fechaFin,
 * pero en el schema Supabase el campo se llama fecha_vto (ver saldosService.js).
 */
async function _obtenerSaldosPendientesGlobal() {
  const { data, error } = await supabase
    .from('saldo')
    .select(`
      monto,
      fecha_vto,
      presupuesto ( nombre_cliente, apellido_cliente ),
      cliente     ( nombre, apellido )
    `)
    .eq('estado', 'pendiente')
    .order('fecha_vto', { ascending: true })

  if (error) manejarError('_obtenerSaldosPendientesGlobal', error)

  return data.map(row => ({
    monto:    Number(row.monto),
    fechaFin: row.fecha_vto,
    nombre:   row.presupuesto?.nombre_cliente  ?? row.cliente?.nombre  ?? '',
    apellido: row.presupuesto?.apellido_cliente ?? row.cliente?.apellido ?? '',
  }))
}

/**
 * Bloque 5: Mix de métodos de pago — calculado desde los presupuestos del período
 * (ya disponibles, no requiere query extra).
 */
function _calcularMixMetodos(presupuestos) {
  const metodoLabels = {
    efectivo:      'Efectivo',
    transferencia: 'Transferencia',
    cc15:          'CC 15d',
    cc30:          'CC 30d',
  }
  const porMetodo = {}
  for (const p of presupuestos) {
    if (!porMetodo[p.metodoPago]) porMetodo[p.metodoPago] = 0
    porMetodo[p.metodoPago] += p.monto
  }
  return Object.entries(porMetodo)
    .map(([k, v]) => ({ value: k, label: metodoLabels[k] ?? k, monto: v }))
    .sort((a, b) => b.monto - a.monto)
}

/**
 * Bloque 6 + 9 (top productos + todos para modal):
 * Devuelve { topProductos, todosProductosVendidos }.
 *
 * Equivale a las dos queries GROUP BY sobre DetallePresupuesto con JOIN a Presupuesto.
 * Se hace en una sola query y se corta en JS para el top 10.
 */
async function _obtenerProductosVendidos(desde, hasta) {
  // Obtenemos los IDs de presupuestos aprobados/pagados del período
  const { data: pres, error: e1 } = await supabase
    .from('presupuesto')
    .select('id_presupuesto')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .in('estado', ['aprobado', 'pagado'])

  if (e1) manejarError('_obtenerProductosVendidos(presupuestos)', e1)
  if (!pres.length) return { topProductos: [], todosProductosVendidos: [] }

  const ids = pres.map(p => p.id_presupuesto)

  // Detalles con nombre del producto como fallback
  const { data: detalles, error: e2 } = await supabase
    .from('detalle_presupuesto')
    .select(`
      id_producto,
      nombre_producto,
      cantidad,
      subtotal,
      producto ( nombre )
    `)
    .in('id_presupuesto', ids)

  if (e2) manejarError('_obtenerProductosVendidos(detalles)', e2)

  // Agregar en JS (equivale al GROUP BY de la query SQLite)
  const mapa = {}
  for (const d of detalles) {
    const nombre = d.nombre_producto ?? d.producto?.nombre ?? '(producto eliminado)'
    const key    = `${d.id_producto ?? 'null'}::${nombre}`
    if (!mapa[key]) {
      mapa[key] = { idProducto: d.id_producto, nombre, unidades: 0, monto: 0 }
    }
    mapa[key].unidades += Number(d.cantidad)
    mapa[key].monto    += Number(d.subtotal)
  }

  const todos = Object.values(mapa).sort((a, b) => b.unidades - a.unidades)

  return {
    topProductos:          todos.slice(0, 10),
    todosProductosVendidos: todos,
  }
}

/**
 * Bloque 7: Top 10 clientes por volumen del período.
 *
 * Equivale a:
 *   SELECT COALESCE(p.nombreCliente, c.nombre, 'Cliente eliminado') || ' ' ||
 *          COALESCE(p.apellidoCliente, c.apellido, '') AS nombre,
 *          COUNT(DISTINCT p.idPresupuesto) AS presupuestos,
 *          SUM(p.monto) AS monto
 *   FROM Presupuesto p LEFT JOIN Cliente c ON c.idCliente = p.idCliente
 *   WHERE p.fecha BETWEEN ? AND ? AND p.estado IN ('aprobado','pagado')
 *   GROUP BY p.idCliente ORDER BY monto DESC LIMIT 10
 */
async function _obtenerTopClientes(desde, hasta) {
  const { data, error } = await supabase
    .from('presupuesto')
    .select(`
      id_cliente,
      id_presupuesto,
      nombre_cliente,
      apellido_cliente,
      monto,
      cliente ( nombre, apellido )
    `)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .in('estado', ['aprobado', 'pagado'])

  if (error) manejarError('_obtenerTopClientes', error)

  // Agregar por idCliente en JS
  const mapa = {}
  for (const row of data) {
    const key    = row.id_cliente ?? 'null'
    const nombre = row.nombre_cliente  ?? row.cliente?.nombre  ?? 'Cliente eliminado'
    const apell  = row.apellido_cliente ?? row.cliente?.apellido ?? ''
    if (!mapa[key]) {
      mapa[key] = { nombre: `${nombre} ${apell}`.trim(), presupuestos: 0, monto: 0 }
    }
    mapa[key].presupuestos += 1
    mapa[key].monto        += Number(row.monto)
  }

  return Object.values(mapa)
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 10)
}

/**
 * Bloque 8: Clientes únicos del período (COUNT DISTINCT).
 */
async function _obtenerClientesUnicos(desde, hasta) {
  const { data, error } = await supabase
    .from('presupuesto')
    .select('id_cliente')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .in('estado', ['aprobado', 'pagado'])

  if (error) manejarError('_obtenerClientesUnicos', error)
  return new Set(data.map(r => r.id_cliente)).size
}

/**
 * Bloque 9: Egresos de pedidos pagados del período.
 * Equivale a:
 *   SELECT COALESCE(SUM(monto),0) FROM PedidoCompra
 *   WHERE fecha BETWEEN ? AND ? AND estadoPago = 'pagado'
 */
async function _obtenerEgresosPedidosPagados(desde, hasta) {
  const { data, error } = await supabase
    .from('pedido_compra')
    .select('monto')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .eq('estado_pago', 'pagado')

  if (error) manejarError('_obtenerEgresosPedidosPagados', error)
  return data.reduce((a, r) => a + Number(r.monto), 0)
}

/**
 * Bloque 9b: Egresos extra (tabla egreso) del período.
 * Equivale a:
 *   SELECT COALESCE(SUM(monto),0) FROM Egreso WHERE fecha BETWEEN ? AND ?
 */
async function _obtenerEgresosExtra(desde, hasta) {
  const { data, error } = await supabase
    .from('egreso')
    .select('monto')
    .gte('fecha', desde)
    .lte('fecha', hasta)

  if (error) manejarError('_obtenerEgresosExtra', error)
  return data.reduce((a, r) => a + Number(r.monto), 0)
}

/**
 * Bloque 9c: Pedidos pendientes de pago del período — deuda con proveedores.
 * Equivale a:
 *   SELECT COALESCE(SUM(monto),0) FROM PedidoCompra
 *   WHERE fecha BETWEEN ? AND ? AND estadoPago = 'pendiente'
 */
async function _obtenerPedidosPendientesMonto(desde, hasta) {
  const { data, error } = await supabase
    .from('pedido_compra')
    .select('monto')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .eq('estado_pago', 'pendiente')

  if (error) manejarError('_obtenerPedidosPendientesMonto', error)
  return data.reduce((a, r) => a + Number(r.monto), 0)
}

/**
 * Bloque 11: Todos los presupuestos del período (todos los estados) para
 * calcular tasa de conversión.
 * Equivale a:
 *   SELECT estado FROM Presupuesto WHERE fecha BETWEEN ? AND ?
 */
async function _obtenerEstadosPresupuestos(desde, hasta) {
  const { data, error } = await supabase
    .from('presupuesto')
    .select('estado')
    .gte('fecha', desde)
    .lte('fecha', hasta)

  if (error) manejarError('_obtenerEstadosPresupuestos', error)
  return data.map(r => r.estado)
}

/**
 * Bloque 12: Stock crítico (global, independiente del período).
 *
 * Equivale a:
 *   SELECT p.nombre, p.cantidad, p.puntoReposicion, c.nombre AS categoria
 *   FROM Producto p LEFT JOIN Categoria c ON c.idCategoria = p.idCategoria
 *   WHERE p.puntoReposicion > 0 AND p.cantidad <= p.puntoReposicion
 *   ORDER BY (p.cantidad / p.puntoReposicion) ASC LIMIT 10
 *
 * Usa la misma RPC que dashboardService / productosService para consistencia.
 */
async function _obtenerStockCritico() {
  const { data, error } = await supabase.rpc('productos_stock_critico')
  if (error) manejarError('_obtenerStockCritico', error)

  // La RPC devuelve todos; limitamos a 10 y extraemos el count
  const todos = data ?? []
  const top10 = todos
    .sort((a, b) => {
      const ratioA = a.punto_reposicion > 0 ? a.cantidad / a.punto_reposicion : 0
      const ratioB = b.punto_reposicion > 0 ? b.cantidad / b.punto_reposicion : 0
      return ratioA - ratioB
    })
    .slice(0, 10)
    .map(row => ({
      nombre:          row.nombre,
      cantidad:        row.cantidad,
      puntoReposicion: row.punto_reposicion,
      categoria:       row.categoria_nombre ?? null,
    }))

  return { stockCritico: top10, cantidadStockCritico: todos.length }
}

/**
 * Bloque 13: Top 8 categorías por ventas del período.
 *
 * Equivale a:
 *   SELECT COALESCE(cat.nombre,'Sin categoría') AS nombre,
 *          SUM(dp.cantidad) AS unidades, SUM(dp.subtotal) AS monto
 *   FROM DetallePresupuesto dp
 *   JOIN Presupuesto p ON ...
 *   LEFT JOIN Producto pr ON ...
 *   LEFT JOIN Categoria cat ON cat.idCategoria = pr.idCategoria
 *   WHERE p.fecha BETWEEN ? AND ? AND p.estado IN ('aprobado','pagado')
 *   GROUP BY cat.idCategoria ORDER BY monto DESC LIMIT 8
 */
async function _obtenerTopCategorias(desde, hasta) {
  const { data: pres, error: e1 } = await supabase
    .from('presupuesto')
    .select('id_presupuesto')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .in('estado', ['aprobado', 'pagado'])

  if (e1) manejarError('_obtenerTopCategorias(presupuestos)', e1)
  if (!pres.length) return []

  const ids = pres.map(p => p.id_presupuesto)

  const { data, error: e2 } = await supabase
    .from('detalle_presupuesto')
    .select(`
      cantidad,
      subtotal,
      producto ( id_categoria, categoria ( nombre ) )
    `)
    .in('id_presupuesto', ids)

  if (e2) manejarError('_obtenerTopCategorias(detalles)', e2)

  const mapa = {}
  for (const d of data) {
    const key    = d.producto?.id_categoria ?? 'null'
    const nombre = d.producto?.categoria?.nombre ?? 'Sin categoría'
    if (!mapa[key]) mapa[key] = { nombre, unidades: 0, monto: 0 }
    mapa[key].unidades += Number(d.cantidad)
    mapa[key].monto    += Number(d.subtotal)
  }

  return Object.values(mapa)
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 8)
}

/**
 * Bloque 14: Egresos agrupados por categoría del período.
 * Usa la RPC egresos_por_categoria (consistente con movimientosService).
 *
 * Equivale a:
 *   SELECT categoria AS label, SUM(monto) AS monto
 *   FROM Egreso WHERE fecha BETWEEN ? AND ?
 *   GROUP BY categoria ORDER BY monto DESC
 */
async function _obtenerEgresosPorCategoria(desde, hasta) {
  const { data, error } = await supabase.rpc('egresos_por_categoria', {
    p_fecha_desde: desde,
    p_fecha_hasta: hasta,
  })

  if (error) manejarError('_obtenerEgresosPorCategoria', error)
  return (data ?? []).map(row => ({
    label: row.categoria,
    monto: Number(row.total),
  }))
}

/**
 * Bloque 15: Top 8 proveedores por volumen de compras del período.
 *
 * Equivale a:
 *   SELECT COALESCE(nombreProveedor,'Sin proveedor') AS nombre,
 *          COUNT(*) AS pedidos, SUM(monto) AS monto
 *   FROM PedidoCompra
 *   WHERE fecha BETWEEN ? AND ?
 *   GROUP BY COALESCE(nombreProveedor,'Sin proveedor')
 *   ORDER BY monto DESC LIMIT 8
 */
async function _obtenerTopProveedores(desde, hasta) {
  const { data, error } = await supabase
    .from('pedido_compra')
    .select('nombre_proveedor, monto')
    .gte('fecha', desde)
    .lte('fecha', hasta)

  if (error) manejarError('_obtenerTopProveedores', error)

  const mapa = {}
  for (const row of data) {
    const key = row.nombre_proveedor ?? 'Sin proveedor'
    if (!mapa[key]) mapa[key] = { nombre: key, pedidos: 0, monto: 0 }
    mapa[key].pedidos += 1
    mapa[key].monto   += Number(row.monto)
  }

  return Object.values(mapa)
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 8)
}

/**
 * Bloque 16: Clientes recurrentes vs. nuevos del período.
 *
 * "Recurrente" = tuvo al menos 1 presupuesto aprobado/pagado ANTES del período.
 *
 * Equivale a las N queries individuales dentro del for-loop de Estadisticas.jsx.
 * Aquí se resuelve de forma eficiente con dos queries (sin loop por cliente):
 *   - IDs únicos del período
 *   - IDs de esos clientes que tienen algún pres. ANTERIOR al período
 */
async function _obtenerClientesRecurrentesVsNuevos(desde, hasta) {
  // IDs únicos del período
  const { data: delPeriodo, error: e1 } = await supabase
    .from('presupuesto')
    .select('id_cliente')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .in('estado', ['aprobado', 'pagado'])

  if (e1) manejarError('_obtenerClientesRecurrentesVsNuevos(período)', e1)

  const idsUnicos = [...new Set(delPeriodo.map(r => r.id_cliente).filter(Boolean))]
  if (!idsUnicos.length) return { clientesRecurrentes: 0, clientesNuevos: 0 }

  // De esos IDs, cuáles tuvieron presupuestos ANTES del período
  const { data: anteriores, error: e2 } = await supabase
    .from('presupuesto')
    .select('id_cliente')
    .in('id_cliente', idsUnicos)
    .lt('fecha', desde)
    .in('estado', ['aprobado', 'pagado'])

  if (e2) manejarError('_obtenerClientesRecurrentesVsNuevos(anteriores)', e2)

  const conHistorial = new Set(anteriores.map(r => r.id_cliente))
  const recurrentes  = idsUnicos.filter(id => conHistorial.has(id)).length

  return {
    clientesRecurrentes: recurrentes,
    clientesNuevos:      idsUnicos.length - recurrentes,
  }
}

/**
 * Bloque 17: Margen bruto estimado (precio venta vs. costo proveedor).
 *
 * Equivale a:
 *   SELECT SUM(dp.subtotal) AS ventaTotal,
 *          SUM(dp.cantidad * COALESCE(pr.precioProveedor,0)) AS costoTotal
 *   FROM DetallePresupuesto dp
 *   JOIN Presupuesto p ON ...
 *   LEFT JOIN Producto pr ON pr.idProducto = dp.idProducto
 *   WHERE p.fecha BETWEEN ? AND ? AND p.estado IN ('aprobado','pagado')
 */
async function _obtenerMargenBruto(desde, hasta) {
  const { data: pres, error: e1 } = await supabase
    .from('presupuesto')
    .select('id_presupuesto')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .in('estado', ['aprobado', 'pagado'])

  if (e1) manejarError('_obtenerMargenBruto(presupuestos)', e1)
  if (!pres.length) return { margenBrutoMonto: 0, margenBrutoPct: 0 }

  const ids = pres.map(p => p.id_presupuesto)

  const { data, error: e2 } = await supabase
    .from('detalle_presupuesto')
    .select(`
      cantidad,
      subtotal,
      producto ( precio_proveedor )
    `)
    .in('id_presupuesto', ids)

  if (e2) manejarError('_obtenerMargenBruto(detalles)', e2)

  let ventaTotal = 0
  let costoTotal = 0
  for (const d of data) {
    ventaTotal += Number(d.subtotal)
    costoTotal += Number(d.cantidad) * Number(d.producto?.precio_proveedor ?? 0)
  }

  const margenBrutoMonto = ventaTotal - costoTotal
  const margenBrutoPct   = ventaTotal > 0 ? (margenBrutoMonto / ventaTotal) * 100 : 0

  return { margenBrutoMonto, margenBrutoPct }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calcula todas las métricas que necesita Estadisticas.jsx para un rango de fechas.
 *
 * Reemplaza completamente a calcularMetricas(desde, hasta) de Estadisticas.jsx.
 * Devuelve el mismo objeto `m` que el componente ya consume sin modificación.
 *
 * Ejecuta los grupos independientes en paralelo para minimizar latencia:
 *   - Grupo A (independientes del período): stock crítico, inversiones globales, saldos globales
 *   - Grupo B (dependen del período):       todos los demás
 *
 * @param {string} desde  'YYYY-MM-DD'
 * @param {string} hasta  'YYYY-MM-DD'
 * @returns {Object}      Objeto con todas las métricas que usa Estadisticas.jsx
 */
export async function obtenerMetricas(desde, hasta) {
  // ── Disparar todas las queries en paralelo ────────────────────────────────
  const [
    // Grupo A: globales (no dependen del rango)
    { stockCritico, cantidadStockCritico },
    inversionesGlobal,
    saldosPendientesGlobal,

    // Grupo B: del período
    { presupuestos, mapaSubtotal },
    ingresosExtra,
    egresosPedidosPagados,
    egresosExtra,
    pedidosPendientesMonto,
    estados,
    { topProductos, todosProductosVendidos },
    topClientes,
    clientesUnicos,
    topCategorias,
    egresosPorCategoria,
    topProveedores,
    { clientesRecurrentes, clientesNuevos },
    { margenBrutoMonto, margenBrutoPct },
    saldosDelPeriodo,
  ] = await Promise.all([
    // Globales
    _obtenerStockCritico(),
    _obtenerInversionesGlobal(),
    _obtenerSaldosPendientesGlobal(),

    // Del período
    _obtenerPresupuestosPeriodo(desde, hasta),
    _obtenerIngresosExtra(desde, hasta),
    _obtenerEgresosPedidosPagados(desde, hasta),
    _obtenerEgresosExtra(desde, hasta),
    _obtenerPedidosPendientesMonto(desde, hasta),
    _obtenerEstadosPresupuestos(desde, hasta),
    _obtenerProductosVendidos(desde, hasta),
    _obtenerTopClientes(desde, hasta),
    _obtenerClientesUnicos(desde, hasta),
    _obtenerTopCategorias(desde, hasta),
    _obtenerEgresosPorCategoria(desde, hasta),
    _obtenerTopProveedores(desde, hasta),
    _obtenerClientesRecurrentesVsNuevos(desde, hasta),
    _obtenerMargenBruto(desde, hasta),
    _obtenerSaldosDelPeriodo(desde, hasta),
  ])

  // ── Cálculos derivados (pura lógica JS, sin más queries) ──────────────────

  const m = {}

  // 1. KPIs de presupuestos
  m.facturadoTotal    = presupuestos.reduce((a, p) => a + p.monto, 0)
  m.totalPresupuestos = presupuestos.length
  m.ticketPromedio    = m.totalPresupuestos ? m.facturadoTotal / m.totalPresupuestos : 0

  // 2. Descuentos
  m.descuentosPromos = presupuestos.reduce((a, p) => {
    const lista     = p.montoOriginal ?? p.monto
    const conPromos = mapaSubtotal[p.idPresupuesto] ?? lista
    const diff = lista - conPromos
    return a + (diff > 0 ? diff : 0)
  }, 0)

  m.descuentosMetodoPago = presupuestos.reduce((a, p) => {
    const conPromos = mapaSubtotal[p.idPresupuesto] ?? (p.montoOriginal ?? p.monto)
    const diff = conPromos - p.monto
    return a + (diff > 0 ? diff : 0)
  }, 0)

  m.recargosCC = presupuestos.reduce((a, p) => {
    const conPromos = mapaSubtotal[p.idPresupuesto] ?? (p.montoOriginal ?? p.monto)
    const diff = p.monto - conPromos
    return a + (diff > 0 ? diff : 0)
  }, 0)

  m.descuentosOtorgados = presupuestos.reduce((a, p) => {
    const diff = (p.montoOriginal ?? p.monto) - p.monto
    return a + (diff > 0 ? diff : 0)
  }, 0)

  // 3. Cobrado real vs. pendiente CC
  const montoCCPagado    = saldosDelPeriodo.filter(s => s.estado === 'pagado').reduce((a, s) => a + s.monto, 0)
  const montoCCPendiente = saldosDelPeriodo.filter(s => s.estado === 'pendiente').reduce((a, s) => a + s.monto, 0)
  const montoContado     = presupuestos
    .filter(p => (p.metodoPago === 'efectivo' || p.metodoPago === 'transferencia') && p.estado === 'pagado')
    .reduce((a, p) => a + p.monto, 0)
  m.cobradoReal = montoContado + montoCCPagado
  m.pendienteCC = montoCCPendiente

  // 4. Ingresos extra y dinero invertido
  m.ingresosExtra  = ingresosExtra
  const totalInvertido = inversionesGlobal.filter(r => r.estado === 'invertido').reduce((a, r) => a + r.monto, 0)
  const totalRetirado  = inversionesGlobal.filter(r => r.estado === 'retirado').reduce((a, r) => a + r.monto, 0)
  m.dineroInvertido = totalInvertido - totalRetirado

  // 5. Saldos por vencer (globales)
  const hoy     = today()
  const en15    = new Date(); en15.setDate(en15.getDate() + 15)
  const en30    = new Date(); en30.setDate(en30.getDate() + 30)
  const en15Str = en15.toISOString().slice(0, 10)
  const en30Str = en30.toISOString().slice(0, 10)

  m.saldosVencidos    = saldosPendientesGlobal
    .filter(s => s.fechaFin && s.fechaFin < hoy)
    .reduce((a, s) => a + s.monto, 0)
  m.saldosPorVencer15 = saldosPendientesGlobal
    .filter(s => s.fechaFin && s.fechaFin >= hoy && s.fechaFin <= en15Str)
    .reduce((a, s) => a + s.monto, 0)
  m.saldosPorVencer30 = saldosPendientesGlobal
    .filter(s => s.fechaFin && s.fechaFin > en15Str && s.fechaFin <= en30Str)
    .reduce((a, s) => a + s.monto, 0)
  m.proxSaldos = saldosPendientesGlobal
    .filter(s => s.fechaFin && s.fechaFin >= hoy)
    .slice(0, 5)

  // 6. Mix de métodos de pago
  m.mixMetodos = _calcularMixMetodos(presupuestos)

  // 7. Top productos
  m.topProductos          = topProductos
  m.todosProductosVendidos = todosProductosVendidos

  // 8. Top clientes
  m.topClientes = topClientes

  // 9. Clientes únicos
  m.clientesUnicos = clientesUnicos

  // 10. Egresos
  m.egresosPedidos = egresosPedidosPagados
  m.egresosExtra   = egresosExtra
  m.egresosTotal   = m.egresosPedidos + m.egresosExtra
  m.pedidosPendientes = pedidosPendientesMonto

  // 11. Resultado operativo
  m.resultadoEstimado = m.cobradoReal + m.ingresosExtra - m.egresosTotal

  // 12. Tasa de conversión
  const totalTodos       = estados.length
  const totalConvertidos = estados.filter(e => e === 'aprobado' || e === 'pagado').length
  const totalRechazados  = estados.filter(e => e === 'rechazado').length
  const totalBorradores  = estados.filter(e => e === 'borrador').length
  m.tasaConversion    = totalTodos ? (totalConvertidos / totalTodos) * 100 : 0
  m.totalTodosEstados = totalTodos
  m.totalRechazados   = totalRechazados
  m.totalBorradores   = totalBorradores

  // 13. Stock crítico
  m.stockCritico          = stockCritico
  m.cantidadStockCritico  = cantidadStockCritico

  // 14. Top categorías
  m.topCategorias = topCategorias

  // 15. Egresos por categoría
  m.egresosPorCategoria = egresosPorCategoria

  // 16. Top proveedores
  m.topProveedores = topProveedores

  // 17. Clientes recurrentes vs. nuevos
  m.clientesRecurrentes = clientesRecurrentes
  m.clientesNuevos      = clientesNuevos

  // 18. Margen bruto
  m.margenBrutoMonto = margenBrutoMonto
  m.margenBrutoPct   = margenBrutoPct

  return m
}
