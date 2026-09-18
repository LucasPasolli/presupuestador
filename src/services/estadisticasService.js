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
 * Bloque 2: Dinero REALMENTE cobrado en el período (base caja), tanto de
 * contado (Efectivo/Transferencia) como de Cuenta Corriente.
 *
 * CORRECCIÓN (Estadísticas mostraba mal Saldos Pendientes / Cobrado):
 * la versión anterior (`_obtenerSaldosDelPeriodo`) buscaba los saldos de CC
 * a partir de los IDs de `presupuesto` cuya `fecha` (creación/emisión, Día X)
 * caía en el rango — es decir, un saldo se contaba en el período en que se
 * CREÓ el presupuesto, no en el que se COBRÓ. Encima, el "contado"
 * (Efectivo/Transferencia) se sumaba por separado usando ese mismo criterio
 * de `presupuesto.fecha`. Con eso:
 *   - Una venta emitida en enero y cobrada en febrero aparecía como cobrada
 *     en enero (o ni aparecía en el período de febrero, que es cuando el
 *     dinero realmente entró).
 *   - Daba igual el método de pago: todo se ataba a la fecha de creación.
 *
 * Ahora se reutiliza exactamente la misma fuente de verdad que ya usa
 * Facturas.jsx para "qué se cobró en este rango" — la RPC
 * `obtener_presupuestos_facturables` (que ya resuelve Día Y real:
 * `presupuesto.fecha_pago` para contado, `saldo.fecha_pago` para CC pagado
 * de una vez) + las aplicaciones de pago parcial (`pago_aplicacion`, vía
 * `pago.fecha`) para CC cobrado de a partes. Es la misma lógica de
 * deduplicación (un saldo con pago parcial no se cuenta dos veces) que ya
 * está probada en `presupuestosService.obtenerFacturasConDetalles`.
 *
 * NOTA (Pago Parcial): este enfoque SUBSUME la corrección de pago parcial que
 * tenía `_obtenerSaldosDelPeriodo` — un saldo cobrado a medias no "desaparece"
 * del KPI, porque cada aplicación parcial se suma por su `pago.fecha` real
 * (ver `_obtenerPagosParcialesEnPeriodo`), que además es más preciso que
 * derivarlo de `monto − monto_pendiente`: si un saldo se cobró en dos cuotas
 * en meses distintos, cada parte cae en el mes en que entró la plata.
 */
async function _obtenerPagosParcialesEnPeriodo(desde, hasta) {
  const { data: pagos, error: e1 } = await supabase
    .from('pago')
    .select('id_pago, fecha')
    .gte('fecha', desde)
    .lte('fecha', hasta)

  if (e1) manejarError('_obtenerPagosParcialesEnPeriodo(pagos)', e1)
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

  if (e2) manejarError('_obtenerPagosParcialesEnPeriodo(aplicaciones)', e2)

  return (aplicaciones ?? [])
    .filter(a => a.saldo?.id_presupuesto != null)
    .map(a => ({
      idPresupuesto: a.saldo.id_presupuesto,
      montoAplicado: Number(a.monto_aplicado),
    }))
}

async function _obtenerCobradoEnPeriodo(desde, hasta) {
  const [rpcResult, pagosParciales] = await Promise.all([
    supabase.rpc('obtener_presupuestos_facturables', {
      fecha_desde: desde,
      fecha_hasta: hasta,
    }),
    _obtenerPagosParcialesEnPeriodo(desde, hasta),
  ])

  const { data: presupuestos, error } = rpcResult
  if (error) manejarError('_obtenerCobradoEnPeriodo(rpc)', error)

  // Igual que en Facturas: un presupuesto con AL MENOS un pago parcial no se
  // cuenta también como "venta completa" — evita duplicar lo cobrado.
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
 *   SELECT s.monto_pendiente, s.fechaFin,
 *          COALESCE(p.nombreCliente, c.nombre, '')   AS nombre,
 *          COALESCE(p.apellidoCliente, c.apellido,'') AS apellido
 *   FROM Saldo s
 *   JOIN Presupuesto p ON p.idPresupuesto = s.idPresupuesto
 *   LEFT JOIN Cliente c ON c.idCliente = s.idCliente
 *   WHERE s.estado IN ('pendiente', 'parcial')
 *   ORDER BY s.fechaFin ASC
 *
 * Nota: se usa fecha_vto (campo en BD PostgreSQL). La columna SQLite era fechaFin,
 * pero en el schema Supabase el campo se llama fecha_vto (ver saldosService.js).
 *
 * CORRECCIÓN (Pago Parcial): antes filtraba solo `estado = 'pendiente'` y
 * usaba `monto` (deuda ORIGINAL). Esto tenía dos problemas:
 *   1. Un saldo con pago parcial pasa a estado 'parcial', así que quedaba
 *      totalmente afuera de vencidos/por-vencer/próximos vencimientos —
 *      desaparecía del radar aunque siguiera debiendo dinero.
 *   2. Aun si se lo incluyera, `monto` no refleja lo ya cobrado.
 * Ahora se incluyen ambos estados con deuda activa y se expone
 * `montoPendiente` (remanente real) en vez de `monto`.
 */
async function _obtenerSaldosPendientesGlobal() {
  const { data, error } = await supabase
    .from('saldo')
    .select(`
      monto,
      monto_pendiente,
      fecha_vto,
      presupuesto ( nombre_cliente, apellido_cliente ),
      cliente     ( nombre, apellido )
    `)
    .in('estado', ['pendiente', 'parcial'])
    .order('fecha_vto', { ascending: true })

  if (error) manejarError('_obtenerSaldosPendientesGlobal', error)

  return data.map(row => ({
    montoPendiente: row.monto_pendiente != null ? Number(row.monto_pendiente) : Number(row.monto),
    fechaFin:       row.fecha_vto,
    nombre:         row.presupuesto?.nombre_cliente  ?? row.cliente?.nombre  ?? '',
    apellido:       row.presupuesto?.apellido_cliente ?? row.cliente?.apellido ?? '',
  }))
}

/**
 * Bloque 4b (global): Demora promedio de pago por cliente — Cuenta Corriente.
 *
 * Historia de usuario: "Como encargado de cobranzas quiero visualizar el
 * tiempo promedio de demora en el pago de cada cliente para identificar
 * morosos, evaluar riesgo crediticio y priorizar acciones de cobranza."
 *
 * Alcance de datos: solo las ventas en Cuenta Corriente generan una fila en
 * `saldo` con `fecha_vto` (fecha de vencimiento pactada). Las ventas de
 * contado (efectivo/transferencia) se cobran en el acto y no tienen
 * vencimiento que pueda demorarse, así que esta métrica vive sobre `saldo`
 * y no sobre `presupuesto`.
 *
 *   demora (días) = fecha_pago − fecha_vto
 *     > 0  → el cliente pagó tarde
 *     = 0  → pagó justo al vencimiento
 *     < 0  → pagó antes de vencer
 *
 * Escenario 3 (AC): un saldo sin `fecha_pago` (estado 'pendiente' o
 * 'parcial', deuda todavía abierta) no tiene una demora "cerrada" — se
 * excluye filtrando `estado = 'pagado'`, nunca se promedia sobre deuda viva.
 * También se excluyen saldos sin `fecha_vto` (no hay contra qué medir) —
 * ambos filtros los aplica la función SQL, no este archivo.
 *
 * Es una métrica GLOBAL, no se recorta por el [desde, hasta] del selector
 * de período de la pantalla: el objetivo es evaluar el riesgo crediticio
 * histórico completo de cada cliente (Escenario 1: "promediada entre TODAS
 * las transacciones del cliente"), igual que ya hace
 * `_obtenerSaldosPendientesGlobal` para la deuda viva.
 *
 * La agregación (GROUP BY) corre en Postgres vía la RPC
 * `fn_demora_pago_por_cliente` (ver migration_demora_pago_cliente.sql) —
 * mismo enfoque que ya usa `pagosService.registrarPagoParcial` con
 * `fn_aplicar_pago_cliente` — así que este helper solo mapea snake_case
 * → camelCase, no trae filas sueltas ni agrega nada en JS.
 */
async function _obtenerDemoraPagoPorCliente() {
  const { data, error } = await supabase.rpc('fn_demora_pago_por_cliente')

  if (error) manejarError('_obtenerDemoraPagoPorCliente', error)

  // La RPC ya devuelve una fila agregada por cliente y ordenada de mayor a
  // menor demora (Escenario 2 del AC) — acá solo se mapea snake_case → camelCase,
  // igual que en el resto del service.
  return (data ?? []).map(row => ({
    idCliente:          row.id_cliente,
    nombre:             `${row.nombre ?? ''} ${row.apellido ?? ''}`.trim() || `Cliente #${row.id_cliente}`,
    apodo:              row.apodo,
    cantPagos:          Number(row.cant_pagos),
    demoraPromedioDias: Number(row.demora_promedio_dias),
    demoraMaximaDias:   Number(row.demora_maxima_dias),
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
 * Bloque 6 + 9 (top productos + todos para modal + ranking por ingresos):
 * Devuelve { topProductos, todosProductosVendidos, productosPorIngresos }.
 *
 * Usa la RPC productos_vendidos_periodo() (Postgres), que hace el JOIN
 * presupuesto↔detalle_presupuesto↔producto y el GROUP BY por producto
 * server-side, devolviendo ya una fila por producto (no una por venta) y
 * ordenada por monto DESC. Ver /sql/2026_productos_vendidos_periodo_rpc.sql.
 *
 * - productosPorIngresos: se usa tal cual viene de la RPC (ya ordenado por
 *   monto DESC), sin reordenar en JS.
 * - todosProductosVendidos / topProductos: se reordena por unidades en JS,
 *   pero sobre el dataset ya agregado por producto (chico), no sobre las
 *   filas crudas de venta.
 */
async function _obtenerProductosVendidos(desde, hasta) {
  const { data, error } = await supabase.rpc('productos_vendidos_periodo', {
    p_fecha_desde: desde,
    p_fecha_hasta: hasta,
  })

  if (error) manejarError('_obtenerProductosVendidos', error)

  const productosPorIngresos = (data ?? []).map(row => ({
    idProducto: row.id_producto,
    nombre:     row.nombre,
    unidades:   Number(row.unidades),
    monto:      Number(row.monto),
  }))

  const todosProductosVendidos = [...productosPorIngresos].sort((a, b) => b.unidades - a.unidades)

  return {
    topProductos:            todosProductosVendidos.slice(0, 10),
    todosProductosVendidos,
    productosPorIngresos,
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
 * Drill-down del KPI global "Ticket promedio" → ticket promedio INDIVIDUAL
 * por cliente. Consumida directamente por el modal de detalle en
 * Estadisticas.jsx (no forma parte de `obtenerMetricas`: es una consulta más
 * pesada — cubre todos los clientes, no un Top 10 — y solo se paga su costo
 * cuando el usuario efectivamente hace drill-down, no en cada carga del
 * dashboard).
 *
 * La agregación y el filtro de búsqueda corren en Postgres vía la RPC
 * `fn_ticket_promedio_por_cliente` (misma estrategia que ya usa
 * `_obtenerDemoraPagoPorCliente` con `fn_demora_pago_por_cliente`): acá solo
 * se mapea snake_case → camelCase sobre filas ya agregadas, sin traer todo
 * `presupuesto` + `cliente` al navegador.
 *
 * Escenario 2 del AC ("Cálculo correcto del ticket promedio por cliente"):
 *   ticketPromedio = montoTotalFacturado / cantidadDeTickets
 * Mismo universo que ya usa el KPI global `m.ticketPromedio` de
 * `obtenerMetricas`: presupuestos con estado 'aprobado' o 'pagado', dentro
 * del rango [desde, hasta] vigente en el selector de la pantalla (no un
 * histórico completo del cliente — el drill-down respeta el mismo período
 * que el indicador del que se originó), y se usa `presupuesto.monto` (monto
 * final, ya con promos/descuentos/recargos aplicados).
 *
 * Escenario 3 del AC ("Ordenamiento y búsqueda"): `busqueda` filtra por
 * nombre/apodo (ILIKE + unaccent, sin distinguir acentos ni mayúsculas) del
 * lado del servidor. El ordenamiento por columna se resuelve en el
 * componente, sobre el resultado ya filtrado.
 *
 * Escenario 4 del AC ("Cliente sin compras registradas"): la RPC arranca
 * desde TODOS los clientes activos (no solo los que aparecen en
 * `presupuesto`) y solo divide cuando hay tickets > 0 — la división por cero
 * es imposible por construcción, no por un `if` que alguien podría romper.
 *
 * NOTA DE SUPUESTOS: se listan los clientes activos como universo base; un
 * cliente dado de baja que igual facturó dentro del período no se esconde
 * (no se le borra una venta ya registrada); y un presupuesto sin
 * `id_cliente` se agrupa bajo "Cliente eliminado" en vez de descartarse,
 * para no perder facturación real del período.
 *
 * @param {string} desde  Fecha inicio del período (YYYY-MM-DD).
 * @param {string} hasta  Fecha fin del período (YYYY-MM-DD).
 * @param {string|null} [busqueda] Texto de búsqueda por nombre/apodo. `null`
 *   o cadena vacía trae el listado completo sin filtrar.
 */
export async function obtenerTicketPromedioPorCliente(desde, hasta, busqueda = null) {
  const { data, error } = await supabase.rpc('fn_ticket_promedio_por_cliente', {
    fecha_desde: desde,
    fecha_hasta: hasta,
    busqueda:    busqueda?.trim() || null,
  })

  if (error) manejarError('obtenerTicketPromedioPorCliente', error)

  return (data ?? []).map(row => ({
    idCliente:      row.id_cliente,
    nombre:         row.nombre,
    apodo:          row.apodo,
    presupuestos:   Number(row.presupuestos),
    monto:          Number(row.monto),
    ticketPromedio: Number(row.ticket_promedio),
  }))
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
 * Bloque 9c: Pedidos pendientes de pago del período — deuda real con proveedores.
 *
 * Para pedidos "todo o nada" (efectivo/transferencia/echeck/CC simple),
 * la deuda es el monto completo mientras estado_pago sea 'pendiente'
 * (sin cambios respecto al comportamiento original).
 *
 * Para pedidos CC con plan de cuotas (tiene_cuotas = true), un pago parcial
 * de una cuota NO cierra el pedido (sigue en estado_pago='pendiente' hasta
 * que se paga la última cuota — ver marcar_cuota_pagada() en la DB), así
 * que sumar pedido.monto sobreestimaría la deuda real. En su lugar, se
 * suman únicamente las cuotas de pedido_compra_cuota con estado <> 'pagada'.
 *
 * Equivale a:
 *   SELECT COALESCE(SUM(monto),0) FROM PedidoCompra
 *   WHERE fecha BETWEEN ? AND ? AND estadoPago = 'pendiente' AND NOT tieneCuotas
 *   +
 *   SELECT COALESCE(SUM(c.monto),0) FROM PedidoCompraCuota c
 *   JOIN PedidoCompra p ON p.idPedido = c.idPedido
 *   WHERE p.fecha BETWEEN ? AND ? AND p.estadoPago = 'pendiente'
 *     AND p.tieneCuotas AND c.estado <> 'pagada'
 */
async function _obtenerPedidosPendientesMonto(desde, hasta) {
  const { data, error } = await supabase
    .from('pedido_compra')
    .select('id_pedido, monto, tiene_cuotas')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .eq('estado_pago', 'pendiente')

  if (error) manejarError('_obtenerPedidosPendientesMonto', error)

  const sinCuotas = data.filter(r => !r.tiene_cuotas)
  const conCuotas  = data.filter(r => r.tiene_cuotas)

  // Pedidos sin plan de cuotas: deuda = monto completo (igual que antes)
  let total = sinCuotas.reduce((a, r) => a + Number(r.monto), 0)

  // Pedidos CC fraccionada: deuda = sólo lo que falta cobrar de cada plan
  if (conCuotas.length) {
    const ids = conCuotas.map(r => r.id_pedido)
    const { data: cuotasPendientes, error: e2 } = await supabase
      .from('pedido_compra_cuota')
      .select('monto')
      .in('id_pedido', ids)
      .neq('estado', 'pagada')

    if (e2) manejarError('_obtenerPedidosPendientesMonto(cuotas)', e2)
    total += cuotasPendientes.reduce((a, c) => a + Number(c.monto), 0)
  }

  return total
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

/**
 * Bloque 18: Valor actual del inventario — a precio de costo (proveedor) y a
 * precio de venta (lista). Global — refleja el stock ACTUAL, no depende del
 * rango de fechas seleccionado en el dashboard (a diferencia del resto de
 * las métricas de este service).
 *
 * Usa la RPC obtener_valor_inventario() (Postgres), que agrega SUM(cantidad ×
 * precio) server-side sobre productos activos y devuelve además el listado
 * de productos con precio incompleto. Un solo round-trip, y solo viajan
 * agregados + una lista normalmente chica — nunca el catálogo completo.
 * Ver /sql/2026_valor_inventario_rpc.sql para la definición de la función.
 *
 * Escenario 6 (datos incompletos): las columnas precio_proveedor/precio_unitario
 * son NOT NULL en el schema, así que "sin precio cargado" se representa como
 * $0 (mismo criterio que el resto de la app — ver los `?? 0` de
 * productosService.js). Un precio en $0 no rompe el cálculo: simplemente
 * aporta $0 a ESA valorización puntual. La RPC ya filtra por stock > 0, así
 * que un producto sin stock y sin precio no genera ruido en el aviso.
 */
async function _obtenerValorInventario() {
  const { data, error } = await supabase.rpc('obtener_valor_inventario')
  if (error) manejarError('_obtenerValorInventario', error)

  const resultado = data ?? { valor_costo: 0, valor_venta: 0, productos_incompletos: [] }

  return {
    valorInventarioCosto: Number(resultado.valor_costo) || 0,
    valorInventarioVenta: Number(resultado.valor_venta) || 0,
    productosValorIncompleto: (resultado.productos_incompletos ?? []).map(row => ({
      idProducto:         row.id_producto,
      nombre:             row.nombre,
      cantidad:           row.cantidad,
      sinPrecioProveedor: row.sin_precio_proveedor,
      sinPrecioVenta:     row.sin_precio_venta,
    })),
  }
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
    demoraPagoPorCliente,
    { valorInventarioCosto, valorInventarioVenta, productosValorIncompleto },

    // Grupo B: del período
    { presupuestos, mapaSubtotal },
    ingresosExtra,
    egresosPedidosPagados,
    egresosExtra,
    pedidosPendientesMonto,
    estados,
    { topProductos, todosProductosVendidos, productosPorIngresos },
    topClientes,
    clientesUnicos,
    topCategorias,
    egresosPorCategoria,
    topProveedores,
    { clientesRecurrentes, clientesNuevos },
    { margenBrutoMonto, margenBrutoPct },
    cobradoEnPeriodo,
  ] = await Promise.all([
    // Globales
    _obtenerStockCritico(),
    _obtenerInversionesGlobal(),
    _obtenerSaldosPendientesGlobal(),
    _obtenerDemoraPagoPorCliente(),
    _obtenerValorInventario(),

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
    _obtenerCobradoEnPeriodo(desde, hasta),
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

  // 3. Cobrado real (base caja) vs. deuda pendiente CC
  //
  // CORRECCIÓN (montos mal mostrados en Saldos Pendientes / Ingresos):
  // antes ambas cosas se calculaban filtrando por `presupuesto.fecha`
  // (fecha de CREACIÓN), sin importar el método de pago. Ahora:
  //
  //   - `cobradoReal` sale de `_obtenerCobradoEnPeriodo`, que mide dinero
  //     efectivamente cobrado DENTRO del rango [desde, hasta] según la
  //     fecha real de cada cobro (`presupuesto.fecha_pago` para contado,
  //     `saldo.fecha_pago` para CC saldado de una vez, `pago.fecha` para
  //     cada aplicación parcial de CC) — no la fecha de emisión.
  //
  //   - `pendienteCC` deja de estar recortado por período. La deuda
  //     pendiente no "pertenece" a un rango de fechas — es una foto del
  //     estado actual, sea cual sea el período que se esté mirando en
  //     pantalla. Por eso ahora reusa el mismo total que ya calcula
  //     `_obtenerSaldosPendientesGlobal` para la sección "Saldos pendientes
  //     globales" de más abajo: antes ambos números podían no coincidir
  //     (se calculaban con criterios distintos) y eso también hacía parecer
  //     "mal mostrados" los saldos pendientes.
  //
  //   - Los saldos con pago parcial siguen contemplados en ambos lados:
  //     `_obtenerSaldosPendientesGlobal` ya filtra `['pendiente','parcial']`
  //     y suma `montoPendiente`, y lo ya cobrado de esos saldos entra por
  //     `pago_aplicacion` con su fecha de pago real.
  m.cobradoReal = cobradoEnPeriodo.total
  m.pendienteCC = saldosPendientesGlobal.reduce((a, s) => a + s.montoPendiente, 0)

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
    .reduce((a, s) => a + s.montoPendiente, 0)
  m.saldosPorVencer15 = saldosPendientesGlobal
    .filter(s => s.fechaFin && s.fechaFin >= hoy && s.fechaFin <= en15Str)
    .reduce((a, s) => a + s.montoPendiente, 0)
  m.saldosPorVencer30 = saldosPendientesGlobal
    .filter(s => s.fechaFin && s.fechaFin > en15Str && s.fechaFin <= en30Str)
    .reduce((a, s) => a + s.montoPendiente, 0)
  m.proxSaldos = saldosPendientesGlobal
    .filter(s => s.fechaFin && s.fechaFin >= hoy)
    .slice(0, 5)

  // 6. Mix de métodos de pago
  m.mixMetodos = _calcularMixMetodos(presupuestos)

  // 7. Top productos
  m.topProductos          = topProductos
  m.todosProductosVendidos = todosProductosVendidos

  // 7b. Ranking de productos por ingresos (monto = cantidad × precio de venta).
  // Ya viene ordenado por monto DESC desde la RPC productos_vendidos_periodo()
  // — no se reordena en JS. El componente pagina esta lista completa
  // mostrando un Top 20 por página (Escenario 3).
  m.productosPorIngresos = productosPorIngresos

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

  // 19. Valor actual del inventario (costo proveedor vs. precio de venta)
  m.valorInventarioCosto        = valorInventarioCosto
  m.valorInventarioVenta        = valorInventarioVenta
  m.productosValorIncompleto    = productosValorIncompleto
  m.cantidadProductosValorIncompleto = productosValorIncompleto.length

  // 20. Demora de pago por cliente (Cuenta Corriente, histórico global)
  m.demoraPagoPorCliente = demoraPagoPorCliente

  return m
}
