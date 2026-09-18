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
    // Baja lógica: por defecto true para no romper filas legacy sin la columna poblada.
    activo:          row.activo ?? true,
    // si viene con JOIN de categoria
    categoria:       row.categoria ?? null,
    // Proveedores asociados (relación N:M vía producto_proveedor). Solo viene
    // poblado si el SELECT pidió el JOIN anidado; si no, queda en [] para que
    // el resto del código no tenga que hacer chequeos de undefined.
    proveedores: mapProveedoresAsociados(row.producto_proveedor),
  }
}

/**
 * Traduce las filas de la relación N:M producto_proveedor (con su JOIN a
 * proveedor) al shape que consume la UI. Tolera tanto el array vacío/ausente
 * como filas donde el proveedor fue borrado y el JOIN vino null.
 */
function mapProveedoresAsociados(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .filter(r => r.proveedor) // descarta huérfanos si el proveedor fue eliminado
    .map(r => ({
      idProveedor:     r.id_proveedor,
      nombreFiscal:    r.proveedor.nombre_fiscal,
      nombreComercial: r.proveedor.nombre_comercial,
    }))
}

// Fragmento de SELECT reutilizado en toda query que necesite traer los
// proveedores asociados a un producto junto con el resto de sus columnas.
const SELECT_PRODUCTO_CON_PROVEEDORES = `
      *,
      categoria ( nombre ),
      producto_proveedor (
        id_proveedor,
        proveedor ( nombre_fiscal, nombre_comercial )
      )
    `

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
 *
 * Por defecto trae también los productos dados de baja lógicamente
 * (incluirInactivos = true) porque esta es la vista de administración del
 * catálogo: el admin necesita verlos para poder reactivarlos. Los
 * buscadores de selección (ver `buscarProductos`) sí los excluyen por defecto.
 */
export async function obtenerProductos({ incluirInactivos = true } = {}) {
  let q = supabase
    .from('producto')
    .select(SELECT_PRODUCTO_CON_PROVEEDORES)
    .order('nombre')

  if (!incluirInactivos) q = q.eq('activo', true)

  const { data, error } = await q
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
 *
 * `soloActivos` (default true): excluye productos dados de baja lógica del
 * resultado. Los buscadores de selección de producto (p. ej. el picker del
 * Presupuestador) dependen de este default para no ofrecer productos
 * discontinuados en presupuestos nuevos. Pasar `soloActivos: false`
 * explícitamente solo desde pantallas de administración que necesiten verlos.
 */
export async function buscarProductos({ texto = '', idCategoria = null, idProveedor = null, soloStockCritico = false, soloActivos = true } = {}) {
  // Cuando se filtra por proveedor, el JOIN a producto_proveedor debe ser
  // `!inner` para que PostgREST filtre las filas de PRODUCTO (no solo el
  // array anidado) por ese proveedor. Sin `!inner`, .eq() sobre una relación
  // embebida por defecto ("left join") filtra el contenido anidado pero
  // sigue devolviendo todos los productos.
  const selectConFiltroProveedor = `
      *,
      categoria ( nombre ),
      producto_proveedor!inner (
        id_proveedor,
        proveedor ( nombre_fiscal, nombre_comercial )
      )
    `

  let q = supabase
    .from('producto')
    .select(idProveedor ? selectConFiltroProveedor : SELECT_PRODUCTO_CON_PROVEEDORES)
    .order('nombre')

  if (texto.trim()) {
    q = q.ilike('nombre', `%${texto.trim()}%`)
  }

  if (idCategoria) {
    q = q.eq('id_categoria', idCategoria)
  }

  if (idProveedor) {
    // Filtra productos que tengan asociado este proveedor específico.
    // Usado por la futura pantalla de compras por proveedor.
    q = q.eq('producto_proveedor.id_proveedor', idProveedor)
  }

  if (soloActivos) {
    q = q.eq('activo', true)
  }

  if (soloStockCritico) {
    // productos donde cantidad <= punto_reposicion
    // Supabase no soporta filtros entre columnas directamente,
    // usamos RPC para este caso específico:
    const { data, error } = await supabase.rpc('productos_stock_critico')
    if (error) manejarError('buscarProductos(stockCritico)', error)
    // Defensa en profundidad: la función productos_stock_critico() ya filtra
    // `activo = true` en el origen (ver 002_baja_logica_productos.sql), pero
    // se repite acá por si la función se recrea en el futuro sin ese filtro.
    const filtrado = soloActivos ? data.filter((row) => row.activo !== false) : data
    return filtrado.map(row => ({ ...mapProducto(row), categoria: row.categoria_nombre ?? null }))
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
    .select(SELECT_PRODUCTO_CON_PROVEEDORES)
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

/**
 * Devuelve los proveedores asociados a un producto.
 * Equivale a: SELECT p.* FROM producto_proveedor pp
 *             JOIN proveedor p ON p.idProveedor = pp.idProveedor
 *             WHERE pp.idProducto = ?
 *
 * `obtenerProductos`, `buscarProductos` y `obtenerProductoPorId` ya traen
 * esta info embebida (`producto.proveedores`); usar esta función solo cuando
 * se necesite la lista de proveedores de un producto puntual sin traer el
 * resto de sus columnas.
 */
export async function obtenerProveedoresDeProducto(idProducto) {
  const { data, error } = await supabase
    .from('producto_proveedor')
    .select('id_proveedor, proveedor ( nombre_fiscal, nombre_comercial )')
    .eq('id_producto', idProducto)

  if (error) manejarError('obtenerProveedoresDeProducto', error)
  return mapProveedoresAsociados(data)
}

// ─── Mutaciones de Producto ───────────────────────────────────────────────────

/**
 * Serializa un producto del shape de la UI (camelCase) al jsonb que esperan
 * los RPC `crear_producto_con_proveedores` / `actualizar_producto_con_proveedores`.
 */
function serializarProductoParaRpc(producto) {
  return {
    id_categoria:     producto.idCategoria,
    nombre:           producto.nombre,
    precio_proveedor: producto.precioProveedor ?? 0,
    precio_unitario:  producto.precioUnitario  ?? 0,
    cantidad:         producto.cantidad        ?? 0,
    tiene_medidas:    Boolean(producto.tieneMedidas),
    punto_reposicion: producto.puntoReposicion ?? 0,
  }
}

/**
 * Crea un nuevo producto y, opcionalmente, lo asocia a uno o más proveedores.
 * Equivale a:
 *   INSERT INTO Producto (...) VALUES (...)
 *   INSERT INTO producto_proveedor (id_producto, id_proveedor) VALUES (...) × N
 *
 * Ambas operaciones corren atómicamente del lado del servidor (función
 * `crear_producto_con_proveedores`, ver 004_producto_proveedor.sql) para que
 * nunca quede un producto creado sin sus proveedores por una falla de red
 * entre el insert de cabecera y el de asociaciones.
 *
 * Protección de idempotencia (alta crítica de catálogo, puede duplicarse por
 * doble click, doble pestaña o reintento automático del cliente):
 *   1) UI: el botón de guardar se deshabilita mientras `loading` es true.
 *   2) Se genera una clave de idempotencia por intento de guardado y viaja
 *      al servidor en cada llamada.
 *   3) La tabla `idempotency_key` (UNIQUE en `key`) es la red de seguridad
 *      final: si la misma clave llega dos veces, el servidor devuelve la
 *      respuesta ya persistida en vez de crear un segundo producto.
 *
 * @param {object} producto
 * @param {number[]} [idsProveedores] IDs de proveedor a asociar. Puede ir
 *        vacío o ausente: un producto sin proveedor asignado es un estado
 *        válido (ver Escenario 3 de la historia de asociación proveedor-producto).
 * @param {string} [idempotencyKey] Clave de idempotencia explícita. Si se
 *        omite, se genera una nueva — pasarla explícitamente permite que la
 *        UI reintente la MISMA operación tras un error de red sin riesgo de
 *        duplicar el producto.
 */
export async function crearProducto(producto, idsProveedores = [], idempotencyKey = crypto.randomUUID()) {
  const { data, error } = await supabase.rpc('crear_producto_con_proveedores', {
    p_producto:          serializarProductoParaRpc(producto),
    p_ids_proveedores:   idsProveedores,
    p_idempotency_key:   idempotencyKey,
  })

  if (error) manejarError('crearProducto', error)
  return mapProducto(data)
}

/**
 * Actualiza los datos de un producto existente y reemplaza por completo el
 * conjunto de proveedores asociados (no afecta ningún otro atributo del
 * producto — ver Escenario 2 de la historia de asociación proveedor-producto).
 * Equivale a:
 *   UPDATE Producto SET ... WHERE idProducto = ?
 *   DELETE FROM producto_proveedor WHERE idProducto = ?
 *   INSERT INTO producto_proveedor (...) × N
 *
 * Corre en una única transacción del lado del servidor (función
 * `actualizar_producto_con_proveedores`) para evitar que el producto quede
 * con la cabecera actualizada pero los proveedores a medio sincronizar si
 * la conexión se corta entre el DELETE y el INSERT.
 *
 * No requiere clave de idempotencia: a diferencia de un alta, reemplazar el
 * conjunto completo de proveedores es una operación naturalmente idempotente
 * (ejecutarla N veces con el mismo array deja el mismo estado final), así
 * que el bloqueo de UI (botón deshabilitado durante `loading`) alcanza como
 * única capa de protección contra doble envío.
 *
 * @param {number[]} [idsProveedores]
 */
export async function actualizarProducto(idProducto, producto, idsProveedores = []) {
  const { data, error } = await supabase.rpc('actualizar_producto_con_proveedores', {
    p_id_producto:      idProducto,
    p_producto:         serializarProductoParaRpc(producto),
    p_ids_proveedores:  idsProveedores,
  })

  if (error) manejarError('actualizarProducto', error)

  if (data === 'no_encontrado') {
    throw new Error('El producto no existe o fue eliminado por otro usuario.')
  }
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
 * Elimina un producto de forma segura.
 *
 * Delega en la función de base de datos `eliminar_producto_seguro`, que
 * dentro de una única transacción intenta la eliminación física y, si el
 * producto está referenciado en detalle_presupuesto (u otra tabla con FK),
 * captura la violación de integridad y realiza una baja lógica
 * (producto.activo = false) en su lugar. Resolver esto en el servidor evita
 * condiciones de carrera (dos usuarios operando sobre el mismo producto a
 * la vez) y evita filtrar errores de base de datos (código, constraint,
 * nombre de tabla) hacia la interfaz — ver ficha SQL 002_baja_logica_productos.sql.
 *
 * @returns {'eliminado' | 'baja_logica'} resultado de la operación, para que
 *          la UI pueda informar al usuario qué ocurrió realmente.
 * @throws  Error de dominio si el producto no existe.
 */
export async function eliminarProducto(idProducto) {
  const { data, error } = await supabase
    .rpc('eliminar_producto_seguro', { p_id_producto: idProducto })

  if (error) manejarError('eliminarProducto', error)

  if (data === 'no_encontrado') {
    throw new Error('El producto no existe o ya fue eliminado.')
  }

  return data // 'eliminado' | 'baja_logica'
}

/**
 * Reactiva un producto dado de baja lógicamente, volviendo a hacerlo
 * disponible en los buscadores de selección de producto.
 * Equivale a: UPDATE Producto SET activo = true WHERE idProducto = ?
 */
export async function reactivarProducto(idProducto) {
  const { error } = await supabase
    .rpc('reactivar_producto', { p_id_producto: idProducto })

  if (error) manejarError('reactivarProducto', error)
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