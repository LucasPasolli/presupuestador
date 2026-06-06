// src/services/pedidosService.js
// Todas las operaciones de PedidoCompra y DetallePedidoCompra pasan por aquí.

import { supabase } from '../lib/supabase'
import { agregarStock, descontarStock, actualizarPrecioProveedor, obtenerMaxPrecioProveedorEnPedidos } from './productosService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function manejarError(operacion, error) {
  console.error(`[pedidosService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

function mapPedido(row) {
  if (!row) return null
  return {
    idPedido:        row.id_pedido,
    fecha:           row.fecha,
    monto:           Number(row.monto),
    estadoPago:      row.estado_pago,
    estadoLogistico: row.estado_logistico,
    fechaRecepcion:  row.fecha_recepcion,
    fechaPago:       row.fecha_pago,
    metodoPago:      row.metodo_pago,
    idProveedor:     row.id_proveedor,
    nombreProveedor: row.nombre_proveedor,
  }
}

function mapDetallePedido(row) {
  if (!row) return null
  return {
    idDetallePedido: row.id_detalle_pedido,
    idPedido:        row.id_pedido,
    idProducto:      row.id_producto,
    nombreProducto:  row.nombre_producto,
    medida:          row.medida,
    cantidad:        row.cantidad,
    precioUnitario:  Number(row.precio_unitario),
    subtotal:        Number(row.subtotal),
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Devuelve pedidos con filtros opcionales.
 * Mueve al servidor el filtrado que antes hacía PedidosCompra.jsx en React.
 * Equivale a las queries dinámicas de PedidosCompra.jsx.
 */
export async function obtenerPedidos({
  estadoPago      = null,  // 'pendiente' | 'pagado'
  estadoLogistico = null,  // 'encargado' | 'recibido' | 'revisar'
  idProveedor     = null,
  fechaDesde      = null,  // 'YYYY-MM-DD'
  fechaHasta      = null,  // 'YYYY-MM-DD'
  orden           = 'desc',
  limite          = 500,
} = {}) {
  let q = supabase
    .from('pedido_compra')
    .select('*')
    .order('fecha', { ascending: orden === 'asc' })
    .order('id_pedido', { ascending: orden === 'asc' })
    .limit(limite)

  if (estadoPago)      q = q.eq('estado_pago', estadoPago)
  if (estadoLogistico) q = q.eq('estado_logistico', estadoLogistico)
  if (idProveedor)     q = q.eq('id_proveedor', idProveedor)
  if (fechaDesde)      q = q.gte('fecha', fechaDesde)
  if (fechaHasta)      q = q.lte('fecha', fechaHasta)

  const { data, error } = await q
  if (error) manejarError('obtenerPedidos', error)
  return data.map(mapPedido)
}

/**
 * Devuelve un pedido por su ID.
 * Equivale a: SELECT * FROM PedidoCompra WHERE idPedido = ?
 */
export async function obtenerPedidoPorId(idPedido) {
  const { data, error } = await supabase
    .from('pedido_compra')
    .select('*')
    .eq('id_pedido', idPedido)
    .single()

  if (error) manejarError('obtenerPedidoPorId', error)
  return mapPedido(data)
}

/**
 * Devuelve los detalles de un pedido.
 * Equivale a: SELECT * FROM DetallePedidoCompra WHERE idPedido = ?
 */
export async function obtenerDetallesDePedido(idPedido) {
  const { data, error } = await supabase
    .from('detalle_pedido_compra')
    .select('*')
    .eq('id_pedido', idPedido)

  if (error) manejarError('obtenerDetallesDePedido', error)
  return data.map(mapDetallePedido)
}

/**
 * Devuelve pedidos junto con sus detalles en una sola llamada.
 * Usado en PedidosCompra.jsx para expandir el detalle de un pedido.
 */
export async function obtenerPedidoConDetalles(idPedido) {
  const { data, error } = await supabase
    .from('pedido_compra')
    .select(`
      *,
      detalle_pedido_compra (*)
    `)
    .eq('id_pedido', idPedido)
    .single()

  if (error) manejarError('obtenerPedidoConDetalles', error)

  return {
    ...mapPedido(data),
    detalles: (data.detalle_pedido_compra ?? []).map(mapDetallePedido),
  }
}

// ─── Mutaciones ───────────────────────────────────────────────────────────────

/**
 * Crea un pedido nuevo con sus detalles.
 * Equivale a:
 *   run(`INSERT INTO PedidoCompra ...`)
 *   run(`INSERT INTO DetallePedidoCompra ...`) × N ítems
 *
 * Devuelve el pedido creado con su ID asignado.
 */
export async function crearPedido(pedido, detalles) {
  // 1. Insertar cabecera
  const { data: ped, error: e1 } = await supabase
    .from('pedido_compra')
    .insert({
      fecha:            pedido.fecha,
      monto:            pedido.monto           ?? 0,
      estado_pago:      pedido.estadoPago       ?? 'pendiente',
      estado_logistico: pedido.estadoLogistico  ?? 'encargado',
      fecha_recepcion:  pedido.fechaRecepcion   ?? null,
      fecha_pago:       pedido.fechaPago        ?? null,
      metodo_pago:      pedido.metodoPago       ?? 'efectivo',
      id_proveedor:     pedido.idProveedor      ?? null,
      nombre_proveedor: pedido.nombreProveedor  ?? null,
    })
    .select()
    .single()

  if (e1) manejarError('crearPedido(cabecera)', e1)

  // 2. Insertar detalles
  if (detalles.length > 0) {
    const rows = detalles.map(d => ({
      id_pedido:       ped.id_pedido,
      id_producto:     d.idProducto     ?? null,
      nombre_producto: d.nombreProducto ?? null,
      medida:          d.medida         ?? null,
      cantidad:        d.cantidad,
      precio_unitario: d.precioUnitario,
      subtotal:        d.subtotal,
    }))

    const { error: e2 } = await supabase
      .from('detalle_pedido_compra')
      .insert(rows)

    if (e2) manejarError('crearPedido(detalles)', e2)
  }

  return mapPedido(ped)
}

/**
 * Actualiza cabecera y detalles de un pedido existente.
 * Si el pedido cambia de estado logístico a 'recibido', ajusta el stock.
 * Equivale a la lógica compleja de guardarPedido() en PedidosCompra.jsx.
 */
export async function actualizarPedido(idPedido, pedido, detalles) {
  // 1. Leer estado logístico anterior para saber si hay que ajustar stock
  const pedidoAnterior = await obtenerPedidoPorId(idPedido)
  const estabaRecibido = pedidoAnterior.estadoLogistico === 'recibido'
  const pasaARecibido  = pedido.estadoLogistico === 'recibido'

  // 2. Actualizar cabecera
  const { error: e1 } = await supabase
    .from('pedido_compra')
    .update({
      fecha:            pedido.fecha,
      monto:            pedido.monto,
      estado_pago:      pedido.estadoPago,
      estado_logistico: pedido.estadoLogistico,
      fecha_recepcion:  pedido.fechaRecepcion  ?? null,
      fecha_pago:       pedido.fechaPago       ?? null,
      metodo_pago:      pedido.metodoPago      ?? null,
      id_proveedor:     pedido.idProveedor     ?? null,
      nombre_proveedor: pedido.nombreProveedor ?? null,
    })
    .eq('id_pedido', idPedido)

  if (e1) manejarError('actualizarPedido(cabecera)', e1)

  // 3. Obtener detalles anteriores antes de borrarlos (para revertir stock si hace falta)
  const detallesAnteriores = await obtenerDetallesDePedido(idPedido)

  // 4. Reemplazar detalles
  const { error: e2 } = await supabase
    .from('detalle_pedido_compra')
    .delete()
    .eq('id_pedido', idPedido)

  if (e2) manejarError('actualizarPedido(delete detalles)', e2)

  if (detalles.length > 0) {
    const rows = detalles.map(d => ({
      id_pedido:       idPedido,
      id_producto:     d.idProducto     ?? null,
      nombre_producto: d.nombreProducto ?? null,
      medida:          d.medida         ?? null,
      cantidad:        d.cantidad,
      precio_unitario: d.precioUnitario,
      subtotal:        d.subtotal,
    }))

    const { error: e3 } = await supabase
      .from('detalle_pedido_compra')
      .insert(rows)

    if (e3) manejarError('actualizarPedido(insert detalles)', e3)
  }

  // 5. Ajuste de stock según cambio de estado logístico
  if (!estabaRecibido && pasaARecibido) {
    // Acaba de marcarse como recibido → sumar stock
    await _aplicarStockRecepcion(detalles)
  } else if (estabaRecibido && !pasaARecibido) {
    // Se revierte la recepción → descontar el stock que se había sumado
    await _revertirStockRecepcion(detallesAnteriores)
  } else if (estabaRecibido && pasaARecibido) {
    // Sigue recibido pero cambiaron las cantidades:
    // revertir el stock anterior y aplicar el nuevo
    await _revertirStockRecepcion(detallesAnteriores)
    await _aplicarStockRecepcion(detalles)
  }

  // 6. Actualizar precios proveedor con el máximo pagado
  for (const d of detalles) {
    if (!d.idProducto || d.precioUnitario <= 0) continue
    const maxPrecio = await obtenerMaxPrecioProveedorEnPedidos(d.idProducto)
    if (maxPrecio > 0) {
      await actualizarPrecioProveedor(d.idProducto, maxPrecio)
    }
  }
}

/**
 * Marca un pedido como pagado.
 * Equivale a:
 *   UPDATE PedidoCompra SET estadoPago='pagado', fechaPago=? WHERE idPedido=?
 * Usado en: PedidosCompra.jsx (botón "Marcar como pagado").
 */
export async function marcarPedidoPagado(idPedido, fechaPago) {
  const { error } = await supabase
    .from('pedido_compra')
    .update({
      estado_pago: 'pagado',
      fecha_pago:  fechaPago,
    })
    .eq('id_pedido', idPedido)

  if (error) manejarError('marcarPedidoPagado', error)
}

/**
 * Marca un pedido como recibido y ajusta el stock de todos sus productos.
 * Equivale a la lógica de recibirPedido() en PedidosCompra.jsx.
 */
export async function recibirPedido(idPedido, fechaRecepcion) {
  // 1. Leer estado anterior
  const pedidoAnterior = await obtenerPedidoPorId(idPedido)
  if (pedidoAnterior.estadoLogistico === 'recibido') return // ya estaba recibido

  // 2. Actualizar estado logístico
  const { error } = await supabase
    .from('pedido_compra')
    .update({
      estado_logistico: 'recibido',
      fecha_recepcion:  fechaRecepcion,
    })
    .eq('id_pedido', idPedido)

  if (error) manejarError('recibirPedido', error)

  // 3. Leer detalles y ajustar stock
  const detalles = await obtenerDetallesDePedido(idPedido)
  await _aplicarStockRecepcion(detalles)
}

/**
 * Actualiza estado logístico, pago, método y fechas desde ABMC.
 * Equivale al UPDATE compuesto de ABMC.jsx sobre pedidos.
 */
export async function actualizarEstadosPedido(idPedido, {
  estadoPago,
  estadoLogistico,
  metodoPago,
  fechaRecepcion,
  fechaPago,
}) {
  // Leer estado anterior para saber si hay que ajustar stock
  const anterior = await obtenerPedidoPorId(idPedido)
  const estabaRecibido = anterior.estadoLogistico === 'recibido'
  const pasaARecibido  = estadoLogistico === 'recibido'

  const { error } = await supabase
    .from('pedido_compra')
    .update({
      estado_pago:      estadoPago,
      estado_logistico: estadoLogistico,
      metodo_pago:      metodoPago      ?? null,
      fecha_recepcion:  fechaRecepcion  ?? null,
      fecha_pago:       fechaPago       ?? null,
    })
    .eq('id_pedido', idPedido)

  if (error) manejarError('actualizarEstadosPedido', error)

  // Ajuste de stock si cambió el estado logístico
  if (!estabaRecibido && pasaARecibido) {
    const detalles = await obtenerDetallesDePedido(idPedido)
    await _aplicarStockRecepcion(detalles)
  } else if (estabaRecibido && !pasaARecibido) {
    const detalles = await obtenerDetallesDePedido(idPedido)
    await _revertirStockRecepcion(detalles)
  }
}

/**
 * Elimina un pedido y sus detalles (CASCADE en BD).
 * Si estaba recibido, descuenta el stock que había sumado.
 * Equivale a: DELETE FROM PedidoCompra WHERE idPedido = ?
 */
export async function eliminarPedido(idPedido) {
  const pedido = await obtenerPedidoPorId(idPedido)

  // Si estaba recibido, revertir el stock antes de borrar
  if (pedido.estadoLogistico === 'recibido') {
    const detalles = await obtenerDetallesDePedido(idPedido)
    await _revertirStockRecepcion(detalles)
  }

  const { error } = await supabase
    .from('pedido_compra')
    .delete()
    .eq('id_pedido', idPedido)

  if (error) manejarError('eliminarPedido', error)
}

// ─── Helpers privados de stock ────────────────────────────────────────────────

/**
 * Suma stock a los productos de una lista de detalles.
 * Actualiza también el precio proveedor con el máximo pagado.
 */
async function _aplicarStockRecepcion(detalles) {
  for (const d of detalles) {
    if (!d.idProducto) continue
    await agregarStock(d.idProducto, d.cantidad, d.medida ?? null)

    if (d.precioUnitario > 0) {
      const maxPrecio = await obtenerMaxPrecioProveedorEnPedidos(d.idProducto)
      const precio = maxPrecio > 0 ? maxPrecio : d.precioUnitario
      await actualizarPrecioProveedor(d.idProducto, precio)
    }
  }
}

/**
 * Revierte el stock sumado por una recepción anterior.
 */
async function _revertirStockRecepcion(detalles) {
  for (const d of detalles) {
    if (!d.idProducto) continue
    await descontarStock(d.idProducto, d.cantidad, d.medida ?? null)
  }
}