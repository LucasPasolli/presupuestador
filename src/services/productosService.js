// src/services/productosService.js
// Todas las operaciones de Producto, ProductoMedida y Categoria pasan por aquí.

import { supabase } from '../lib/supabase'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function manejarError(operacion, error) {
  console.error(`[productosService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

function mapProducto(row) {
  if (!row) return null
  return {
    idProducto:      row.id_producto,
    idCategoria:     row.id_categoria,
    nombre:          row.nombre,
    precioProveedor: Number(row.precio_proveedor),
    precioUnitario:  Number(row.precio_unitario),
    cantidad:        row.cantidad,
    tieneMedidas:    row.tiene_medidas ? 1 : 0, // los componentes esperan 0/1
    puntoReposicion: row.punto_reposicion,
    // si viene con JOIN de categoria
    categoria:       row.categoria ?? null,
  }
}

function mapMedida(row) {
  if (!row) return null
  return {
    idMedida:   row.id_medida,
    idProducto: row.id_producto,
    medida:     row.medida,
    cantidad:   row.cantidad,
  }
}

function mapCategoria(row) {
  if (!row) return null
  return {
    idCategoria: row.id_categoria,
    nombre:      row.nombre,
  }
}

// ─── Categorias ───────────────────────────────────────────────────────────────

/**
 * Devuelve todas las categorías ordenadas por nombre.
 * Equivale a: SELECT * FROM Categoria ORDER BY nombre
 */
export async function obtenerCategorias() {
  const { data, error } = await supabase
    .from('categoria')
    .select('*')
    .order('nombre')

  if (error) manejarError('obtenerCategorias', error)
  return data.map(mapCategoria)
}

/**
 * Crea una nueva categoría. Devuelve la categoría creada.
 * Equivale a: INSERT INTO Categoria (nombre) VALUES (?)
 */
export async function crearCategoria(nombre) {
  const { data, error } = await supabase
    .from('categoria')
    .insert({ nombre: nombre.trim() })
    .select()
    .single()

  if (error) manejarError('crearCategoria', error)
  return mapCategoria(data)
}

/**
 * Actualiza el nombre de una categoría.
 * Equivale a: UPDATE Categoria SET nombre = ? WHERE idCategoria = ?
 */
export async function actualizarCategoria(idCategoria, nombre) {
  const { error } = await supabase
    .from('categoria')
    .update({ nombre: nombre.trim() })
    .eq('id_categoria', idCategoria)

  if (error) manejarError('actualizarCategoria', error)
}

/**
 * Elimina una categoría. Fallará si tiene productos asociados (ON DELETE RESTRICT).
 * Equivale a: DELETE FROM Categoria WHERE idCategoria = ?
 */
export async function eliminarCategoria(idCategoria) {
  const { error } = await supabase
    .from('categoria')
    .delete()
    .eq('id_categoria', idCategoria)

  if (error) manejarError('eliminarCategoria', error)
}

// ─── Queries de Producto ──────────────────────────────────────────────────────

/**
 * Devuelve todos los productos con su categoría, ordenados por nombre.
 * Equivale a: SELECT p.*, c.nombre as categoria FROM Producto p
 *             JOIN Categoria c ON p.idCategoria = c.idCategoria
 *             ORDER BY p.nombre
 * Usado en: Inventario, ABMC listado completo.
 */
export async function obtenerProductos() {
  const { data, error } = await supabase
    .from('producto')
    .select(`
      *,
      categoria ( nombre )
    `)
    .order('nombre')

  if (error) manejarError('obtenerProductos', error)

  return data.map(row => ({
    ...mapProducto(row),
    categoria: row.categoria?.nombre ?? null,
  }))
}

/**
 * Devuelve productos filtrados por nombre y/o categoría.
 * Mueve al servidor el filtrado que antes se hacía en React.
 * Usado en: Inventario (búsqueda), Presupuestador, PedidosCompra.
 */
export async function buscarProductos({ texto = '', idCategoria = null, soloStockCritico = false } = {}) {
  let q = supabase
    .from('producto')
    .select(`
      *,
      categoria ( nombre )
    `)
    .order('nombre')

  if (texto.trim()) {
    q = q.ilike('nombre', `%${texto.trim()}%`)
  }

  if (idCategoria) {
    q = q.eq('id_categoria', idCategoria)
  }

  if (soloStockCritico) {
    // productos donde cantidad <= punto_reposicion
    q = q.filter('cantidad', 'lte', supabase.rpc) // ver nota abajo
    // Supabase no soporta filtros entre columnas directamente,
    // usamos RPC para este caso específico:
    const { data, error } = await supabase.rpc('productos_stock_critico')
    if (error) manejarError('buscarProductos(stockCritico)', error)
    return data.map(row => ({ ...mapProducto(row), categoria: row.categoria_nombre ?? null }))
  }

  const { data, error } = await q
  if (error) manejarError('buscarProductos', error)

  return data.map(row => ({
    ...mapProducto(row),
    categoria: row.categoria?.nombre ?? null,
  }))
}

/**
 * Devuelve un producto por su ID.
 * Equivale a: SELECT * FROM Producto WHERE idProducto = ?
 */
export async function obtenerProductoPorId(idProducto) {
  const { data, error } = await supabase
    .from('producto')
    .select(`*, categoria ( nombre )`)
    .eq('id_producto', idProducto)
    .single()

  if (error) manejarError('obtenerProductoPorId', error)
  return { ...mapProducto(data), categoria: data.categoria?.nombre ?? null }
}

/**
 * Devuelve las medidas disponibles de un producto.
 * Equivale a: SELECT * FROM ProductoMedida WHERE idProducto = ? ORDER BY medida
 */
export async function obtenerMedidasDeProducto(idProducto) {
  const { data, error } = await supabase
    .from('producto_medida')
    .select('*')
    .eq('id_producto', idProducto)
    .order('medida')

  if (error) manejarError('obtenerMedidasDeProducto', error)
  return data.map(mapMedida)
}

// ─── Mutaciones de Producto ───────────────────────────────────────────────────

/**
 * Crea un nuevo producto. Devuelve el producto creado con su ID.
 * Equivale a: INSERT INTO Producto (...) VALUES (...)
 */
export async function crearProducto(producto) {
  const { data, error } = await supabase
    .from('producto')
    .insert({
      id_categoria:     producto.idCategoria,
      nombre:           producto.nombre,
      precio_proveedor: producto.precioProveedor ?? 0,
      precio_unitario:  producto.precioUnitario  ?? 0,
      cantidad:         producto.cantidad        ?? 0,
      tiene_medidas:    Boolean(producto.tieneMedidas),
      punto_reposicion: producto.puntoReposicion ?? 0,
    })
    .select()
    .single()

  if (error) manejarError('crearProducto', error)
  return mapProducto(data)
}

/**
 * Actualiza los datos de un producto existente.
 * Equivale a: UPDATE Producto SET ... WHERE idProducto = ?
 */
export async function actualizarProducto(idProducto, producto) {
  const { error } = await supabase
    .from('producto')
    .update({
      id_categoria:     producto.idCategoria,
      nombre:           producto.nombre,
      precio_proveedor: producto.precioProveedor ?? 0,
      precio_unitario:  producto.precioUnitario  ?? 0,
      cantidad:         producto.cantidad        ?? 0,
      tiene_medidas:    Boolean(producto.tieneMedidas),
      punto_reposicion: producto.puntoReposicion ?? 0,
    })
    .eq('id_producto', idProducto)

  if (error) manejarError('actualizarProducto', error)
}

/**
 * Actualiza solo la cantidad de un producto.
 * Equivale a: UPDATE Producto SET cantidad = ? WHERE idProducto = ?
 * Usado en: Inventario (ajuste rápido de stock).
 */
export async function actualizarCantidadProducto(idProducto, cantidad) {
  const { error } = await supabase
    .from('producto')
    .update({ cantidad })
    .eq('id_producto', idProducto)

  if (error) manejarError('actualizarCantidadProducto', error)
}

/**
 * Actualiza solo el precio proveedor de un producto.
 * Equivale a: UPDATE Producto SET precioProveedor = ? WHERE idProducto = ?
 * Usado en: PedidosCompra al recibir mercadería.
 */
export async function actualizarPrecioProveedor(idProducto, precioProveedor) {
  const { error } = await supabase
    .from('producto')
    .update({ precio_proveedor: precioProveedor })
    .eq('id_producto', idProducto)

  if (error) manejarError('actualizarPrecioProveedor', error)
}

/**
 * Elimina un producto. Fallará si tiene detalles de presupuesto (ON DELETE RESTRICT).
 * Equivale a: DELETE FROM Producto WHERE idProducto = ?
 */
export async function eliminarProducto(idProducto) {
  const { error } = await supabase
    .from('producto')
    .delete()
    .eq('id_producto', idProducto)

  if (error) manejarError('eliminarProducto', error)
}

// ─── Mutaciones de Stock (con medidas) ───────────────────────────────────────

/**
 * Descuenta stock de un producto. Si tiene medidas, descuenta de la medida
 * específica y recalcula el total. Si no tiene medidas, descuenta directo.
 * Usado en: Historial (anular presupuesto aprobado), ABMC.
 */
export async function descontarStock(idProducto, cantidad, medida = null) {
  const producto = await obtenerProductoPorId(idProducto)

  if (producto.tieneMedidas && medida) {
    // 1. Descontar de la medida específica
    const { data: medidaRow, error: e1 } = await supabase
      .from('producto_medida')
      .select('cantidad')
      .eq('id_producto', idProducto)
      .eq('medida', medida)
      .single()

    if (e1) manejarError('descontarStock(medida select)', e1)

    const nuevaCantMedida = Math.max(0, medidaRow.cantidad - cantidad)
    const { error: e2 } = await supabase
      .from('producto_medida')
      .update({ cantidad: nuevaCantMedida })
      .eq('id_producto', idProducto)
      .eq('medida', medida)

    if (e2) manejarError('descontarStock(medida update)', e2)

    // 2. Recalcular total sumando todas las medidas
    const { data: medidas, error: e3 } = await supabase
      .from('producto_medida')
      .select('cantidad')
      .eq('id_producto', idProducto)

    if (e3) manejarError('descontarStock(sum medidas)', e3)

    const total = medidas.reduce((acc, m) => acc + m.cantidad, 0)
    await actualizarCantidadProducto(idProducto, total)

  } else {
    // Sin medidas: descontar directo con MAX(0, cantidad - n)
    const nuevaCant = Math.max(0, producto.cantidad - cantidad)
    await actualizarCantidadProducto(idProducto, nuevaCant)
  }
}

/**
 * Agrega stock a un producto. Si tiene medidas, upsert en producto_medida
 * y recalcula el total. Si no tiene medidas, suma directo.
 * Usado en: PedidosCompra (recepción de mercadería), ABMC.
 */
export async function agregarStock(idProducto, cantidad, medida = null) {
  const producto = await obtenerProductoPorId(idProducto)

  if (producto.tieneMedidas && medida) {
    // Upsert: si ya existe la medida suma, si no existe la crea
    const { data: existente } = await supabase
      .from('producto_medida')
      .select('id_medida, cantidad')
      .eq('id_producto', idProducto)
      .eq('medida', medida)
      .maybeSingle()

    if (existente) {
      const { error } = await supabase
        .from('producto_medida')
        .update({ cantidad: existente.cantidad + cantidad })
        .eq('id_medida', existente.id_medida)

      if (error) manejarError('agregarStock(update medida)', error)
    } else {
      const { error } = await supabase
        .from('producto_medida')
        .insert({ id_producto: idProducto, medida, cantidad })

      if (error) manejarError('agregarStock(insert medida)', error)
    }

    // Recalcular total
    const { data: medidas, error: e2 } = await supabase
      .from('producto_medida')
      .select('cantidad')
      .eq('id_producto', idProducto)

    if (e2) manejarError('agregarStock(sum medidas)', e2)

    const total = medidas.reduce((acc, m) => acc + m.cantidad, 0)
    await actualizarCantidadProducto(idProducto, total)

  } else {
    await actualizarCantidadProducto(idProducto, producto.cantidad + cantidad)
  }
}

/**
 * Devuelve el precio proveedor máximo entre los detalles de un pedido.
 * Equivale a: SELECT MAX(precioUnitario) FROM DetallePedidoCompra
 *             WHERE idProducto = ? AND precioUnitario > 0
 * Usado en: PedidosCompra al actualizar precio proveedor.
 */
export async function obtenerMaxPrecioProveedorEnPedidos(idProducto) {
  const { data, error } = await supabase
    .from('detalle_pedido_compra')
    .select('precio_unitario')
    .eq('id_producto', idProducto)
    .gt('precio_unitario', 0)
    .order('precio_unitario', { ascending: false })
    .limit(1)

  if (error) manejarError('obtenerMaxPrecioProveedorEnPedidos', error)
  return data[0]?.precio_unitario ?? 0
}