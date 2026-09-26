// src/services/presupuestosService.js
// Todas las operaciones de Presupuesto y DetallePresupuesto pasan por aquí.

import { supabase } from '../lib/supabase'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function manejarError(operacion, error) {
  console.error(`[presupuestosService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

function mapPresupuesto(row) {
  if (!row) return null
  return {
    idPresupuesto:   row.id_presupuesto,
    idCliente:       row.id_cliente,
    fecha:           row.fecha,
    // CORRECCIÓN (desacople fecha de pago): `fechaPago` es el Día Y real en
    // que se efectivizó el cobro para ventas Efectivo/Transferencia SIN
    // financiamiento (sin fila en `saldo`). Es NULL hasta que el presupuesto
    // pasa a estado 'pagado'. Para Cuenta Corriente (cc15/cc30) la fecha de
    // cobro real vive en `saldo.fecha_pago`, no acá — no confundir ambas.
    fechaPago:       row.fecha_pago ?? null,
    metodoPago:      row.metodo_pago,
    montoOriginal:   Number(row.monto_original),
    monto:           Number(row.monto),
    nombreCliente:   row.nombre_cliente,
    apellidoCliente: row.apellido_cliente,
    estado:          row.estado,
    esExcepcion:     row.es_excepcion ? 1 : 0,
  }
}

function mapDetalle(row) {
  if (!row) return null

  // Trazabilidad de productos que ya no están en el catálogo activo: puede
  // ser porque el producto fue dado de baja lógica (tiene historial y no se
  // pudo borrar físicamente) o, en datos muy antiguos, porque la fila de
  // producto ya no existe. Solo se puede determinar cuando la consulta
  // incluyó el JOIN a `producto` (columna presente en `row`, aunque sea
  // null); si no lo incluyó, queda en false por defecto — no afecta nada
  // porque nombreProducto/precioUnitario ya están a salvo como snapshot.
  const tieneJoinProducto = Object.prototype.hasOwnProperty.call(row, 'producto')
  const productoEliminado = tieneJoinProducto && row.id_producto != null && (
    row.producto === null ||        // la fila de producto ya no existe físicamente
    row.producto.activo === false   // o fue dada de baja lógica
  )

  return {
    idDetalle:       row.id_detalle,
    idPresupuesto:   row.id_presupuesto,
    idProducto:      row.id_producto,
    nombreProducto:  row.nombre_producto,
    medida:          row.medida,
    cantidad:        row.cantidad,
    precioUnitario:  Number(row.precio_unitario),
    precioConPromo:  row.precio_con_promo != null ? Number(row.precio_con_promo) : null,
    idPromocion:     row.id_promocion,
    subtotal:        Number(row.subtotal),
    productoEliminado,
  }
}

// ─── Búsqueda de cliente: normalización multi-palabra e insensible a tildes ───
//
// BUG ORIGINAL: la búsqueda hacía
//   `nombre_cliente.ilike.%${search}%,apellido_cliente.ilike.%${search}%`
// es decir, buscaba el STRING COMPLETO ingresado como substring de UNA sola
// columna. Con una sola palabra funcionaba de casualidad (coincidía con
// nombre_cliente O apellido_cliente). Con 2+ palabras ("Juan Perez") no
// existe ninguna columna que contenga el string completo "Juan Perez" (el
// nombre y el apellido viven en columnas separadas), así que la búsqueda no
// devolvía NADA a partir de la segunda palabra — el bug reportado.
//
// FIX: se separa el término en palabras, se normalizan (sin tildes,
// minúsculas) y se exige que TODAS aparezcan — sin importar el orden —
// dentro de `busqueda_cliente`, una columna GENERATED en Postgres que
// concatena y normaliza nombre + apellido (ver migración
// `supabase/migrations/*_busqueda_cliente_multiword.sql`).
//
// Cada palabra se agrega como una llamada `.ilike()` INDEPENDIENTE (no
// `.or()`): PostgREST combina con AND los filtros que llegan como query
// params separados, incluso si apuntan a la misma columna. `.or()` en
// cambio arma un único OR dentro de una misma condición — es la pieza que
// estaba mal en el código original y la razón por la que dos palabras
// nunca podían matchear juntas.
//
// IMPORTANTE: esta normalización debe producir el MISMO resultado que la
// función `f_unaccent_lower()` usada en la columna generada de Postgres
// (NFD + strip de marcas diacríticas ≈ unaccent() para los acentos del
// español: á,é,í,ó,ú,ñ,ü). Si se cambia una, hay que cambiar la otra.

const MAX_PALABRAS_BUSQUEDA = 8 // evita queries pathológicas (ej. cientos de espacios)

export function normalizarTexto(texto) {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes/diéresis/virgulilla
    .toLowerCase()
    .trim()
}

// Escapa los caracteres especiales de LIKE/ILIKE (%, _ y el propio escape \)
// para que un término de búsqueda que los contenga se interprete como texto
// literal y no como wildcard de Postgres (por ejemplo, para que buscar
// "50%" o "a_b" no dispare un patrón no intencional).
export function escaparComodinesLike(texto) {
  return texto.replace(/[\\%_]/g, '\\$&')
}

// Divide el término de búsqueda en palabras normalizadas, filtra vacíos y
// limita la cantidad para acotar el costo de la query.
export function dividirEnPalabrasDeBusqueda(texto) {
  return normalizarTexto(texto)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_PALABRAS_BUSQUEDA)
}

// ─── Constantes ───────────────────────────────────────────────────────────────

// Campos mínimos para la tabla del Historial.
// Omite monto_original y es_excepcion que no se muestran en la lista.
// IMPORTANTE: si agregás columnas al listado, añadirlas aquí también.
// (No hace falta incluir `busqueda_cliente`: PostgREST permite filtrar por
// columnas que no están en el `select`, ya que el filtro se resuelve contra
// la tabla, no contra la proyección devuelta al cliente.)
const CAMPOS_LISTA = `
  id_presupuesto,
  id_cliente,
  fecha,
  fecha_pago,
  metodo_pago,
  monto,
  nombre_cliente,
  apellido_cliente,
  estado,
  es_excepcion,
  saldo ( estado, fecha_vto, fecha_pago )
`

// Campos completos para la vista detalle de un presupuesto.
const CAMPOS_DETALLE = `
  id_presupuesto,
  id_cliente,
  fecha,
  fecha_pago,
  metodo_pago,
  monto_original,
  monto,
  nombre_cliente,
  apellido_cliente,
  estado,
  es_excepcion
`

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Devuelve presupuestos paginados con saldoEstado incluido via JOIN server-side.
 *
 * CAMBIOS RESPECTO A LA VERSIÓN ANTERIOR:
 *   - JOIN con `saldo` resuelto en Postgres (no en el cliente).
 *   - Selección selectiva de campos (CAMPOS_LISTA), no SELECT *.
 *   - Paginación real con .range() en lugar de .limit(2000).
 *   - count:'exact' devuelve el total sin traer todas las filas.
 *   - Búsqueda textual con ilike/eq en Supabase, no en Array.filter().
 *   - Ordenación por sortKey pasado como parámetro.
 *   - Búsqueda por nombre/apellido: multi-palabra (cualquier orden) e
 *     insensible a tildes, contra la columna generada `busqueda_cliente`.
 *
 * @returns {{ data: Presupuesto[], count: number }}
 */
export async function obtenerPresupuestos({
  estado        = null,
  idCliente     = null,
  fechaDesde    = null,
  fechaHasta    = null,
  metodoPago    = null,
  esExcepcion   = null,
  search        = null,   // string — busca por ID numérico o nombre/apellido
  sortKey       = 'id',   // 'id' | 'fecha'
  orden         = 'desc',
  limite        = 50,
  offset        = 0,
} = {}) {
  const ascending = orden === 'asc'

  // JOIN declarativo: Supabase resuelve el LEFT JOIN con saldo en el servidor.
  // Requiere que exista la FK saldo.id_presupuesto → presupuesto.id_presupuesto.
  let q = supabase
    .from('presupuesto')
    .select(CAMPOS_LISTA, { count: 'exact' })
    .order(sortKey === 'fecha' ? 'fecha' : 'id_presupuesto', { ascending })
    .range(offset, offset + limite - 1)

  if (estado)      q = q.eq('estado', estado)
  if (idCliente)   q = q.eq('id_cliente', idCliente)
  if (fechaDesde)  q = q.gte('fecha', fechaDesde)
  if (fechaHasta)  q = q.lte('fecha', fechaHasta)
  if (metodoPago)  q = q.eq('metodo_pago', metodoPago)
  if (esExcepcion !== null) q = q.eq('es_excepcion', esExcepcion)

  // Búsqueda: si es número busca por ID exacto; si es texto busca nombre+apellido
  // exigiendo que TODAS las palabras ingresadas matcheen (ver helpers arriba).
  if (search) {
    const s = search.trim()
    if (/^\d+$/.test(s)) {
      q = q.eq('id_presupuesto', parseInt(s, 10))
    } else {
      const palabras = dividirEnPalabrasDeBusqueda(s)
      for (const palabra of palabras) {
        q = q.ilike('busqueda_cliente', `%${escaparComodinesLike(palabra)}%`)
      }
    }
  }

  const { data, error, count } = await q
  if (error) manejarError('obtenerPresupuestos', error)

  // Aplanar el JOIN: como saldo tiene UNIQUE constraint sobre id_presupuesto,
  // PostgREST devuelve el objeto directamente (no como array).
  // Soportamos ambas formas por compatibilidad: objeto singular o array[0].
  const mapped = (data ?? []).map(row => {
    const sal = Array.isArray(row.saldo) ? row.saldo[0] : row.saldo
    return {
      ...mapPresupuesto(row),
      saldoEstado:    sal?.estado     ?? null,
      saldoFechaVto:  sal?.fecha_vto  ?? null,
      saldoFechaPago: sal?.fecha_pago ?? null,
    }
  })

  return { data: mapped, count: count ?? 0 }
}

/**
 * Devuelve un presupuesto por su ID con campos completos.
 * Usado en la vista detalle, no en el listado.
 */
export async function obtenerPresupuestoPorId(idPresupuesto) {
  const { data, error } = await supabase
    .from('presupuesto')
    .select(CAMPOS_DETALLE)
    .eq('id_presupuesto', idPresupuesto)
    .single()

  if (error) manejarError('obtenerPresupuestoPorId', error)
  return mapPresupuesto(data)
}

/**
 * Devuelve los detalles (ítems) de un presupuesto.
 * Incluye el JOIN a `producto (activo)` -liviano, solo un booleano- para que
 * el consumidor pueda marcar en la UI los ítems cuyo producto ya no está en
 * el catálogo (fue eliminado o dado de baja lógica). Ver `mapDetalle` /
 * `productoEliminado`. El nombre y precio históricos no dependen de este
 * JOIN: siguen viniendo del snapshot en nombre_producto/precio_unitario.
 */
export async function obtenerDetallesDePresupuesto(idPresupuesto) {
  const { data, error } = await supabase
    .from('detalle_presupuesto')
    .select(`
      id_detalle,
      id_presupuesto,
      id_producto,
      nombre_producto,
      medida,
      cantidad,
      precio_unitario,
      precio_con_promo,
      id_promocion,
      subtotal,
      producto ( activo )
    `)
    .eq('id_presupuesto', idPresupuesto)
    .order('id_detalle', { ascending: true })

  if (error) manejarError('obtenerDetallesDePresupuesto', error)
  return data.map(mapDetalle)
}

/**
 * Devuelve los detalles de un presupuesto con fallback de nombre de producto.
 * Si `nombre_producto` fue guardado como snapshot lo usa directamente.
 * Si es null (dato antiguo), intenta traer el nombre actual del producto vía JOIN.
 * Si el producto ya no existe, usa '(producto eliminado #ID)'.
 * Usado exclusivamente por pdfPresupuesto.js.
 */
export async function obtenerDetallesConNombreDePresupuesto(idPresupuesto) {
  const { data, error } = await supabase
    .from('detalle_presupuesto')
    .select(`
      id_detalle,
      id_presupuesto,
      id_producto,
      nombre_producto,
      medida,
      cantidad,
      precio_unitario,
      precio_con_promo,
      id_promocion,
      subtotal,
      producto ( nombre, activo )
    `)
    .eq('id_presupuesto', idPresupuesto)
    .order('id_detalle', { ascending: true })

  if (error) manejarError('obtenerDetallesConNombreDePresupuesto', error)

  return data.map(row => {
    const base = mapDetalle(row)
    base.nombreProducto =
      row.nombre_producto
      ?? row.producto?.nombre
      ?? `(producto eliminado #${row.id_producto})`
    return base
  })
}

/**
 * Devuelve presupuestos junto con sus detalles en una sola llamada.
 * Usado en Facturas.jsx para mostrar el listado completo con ítems.
 *
 * CAMBIO: paginación server-side con offset/limite en lugar de .limit(200).
 */
export async function obtenerPresupuestosConDetalles({
  estado     = null,
  fechaDesde = null,
  fechaHasta = null,
  limite     = 50,
  offset     = 0,
} = {}) {
  let q = supabase
    .from('presupuesto')
    .select(`
      id_presupuesto,
      id_cliente,
      fecha,
      metodo_pago,
      monto_original,
      monto,
      nombre_cliente,
      apellido_cliente,
      estado,
      es_excepcion,
      detalle_presupuesto (
        id_detalle,
        id_producto,
        nombre_producto,
        medida,
        cantidad,
        precio_unitario,
        precio_con_promo,
        id_promocion,
        subtotal,
        producto ( activo )
      )
    `, { count: 'exact' })
    .order('fecha', { ascending: false })
    .order('id_presupuesto', { ascending: false })
    .range(offset, offset + limite - 1)

  if (estado)     q = q.eq('estado', estado)
  if (fechaDesde) q = q.gte('fecha', fechaDesde)
  if (fechaHasta) q = q.lte('fecha', fechaHasta)

  const { data, error, count } = await q
  if (error) manejarError('obtenerPresupuestosConDetalles', error)

  return {
    data: (data ?? []).map(row => ({
      ...mapPresupuesto(row),
      detalles: (row.detalle_presupuesto ?? []).map(mapDetalle),
    })),
    count: count ?? 0,
  }
}

/**
 * Aplicaciones de Pago Parcial (`pago_aplicacion`) cuyo pago cayó dentro del
 * período — con los datos de cliente/presupuesto ya resueltos para poder:
 *   1. Listarlas como líneas individuales en el reporte de Facturas
 *      (monto aplicado + fecha de ESE pago puntual).
 *   2. Identificar qué presupuestos hay que excluir del listado "normal"
 *      (ver obtenerFacturasConDetalles) para no duplicar el monto.
 *
 * Se resuelve acá con supabase directo (no vía pagosService) para evitar un
 * ciclo de imports: pagosService → saldosService → presupuestosService.
 *
 * Nota: se filtra por `pago.fecha` (fecha de negocio del cobro, editable),
 * no por `created_at`, para ser consistente con el resto de los reportes
 * de este archivo que rangean por columnas `fecha`.
 */
async function _obtenerPagosParcialesFacturables(desde, hasta) {
  // 1. Pagos cuya fecha cae en el período
  const { data: pagos, error: e1 } = await supabase
    .from('pago')
    .select('id_pago, fecha')
    .gte('fecha', desde)
    .lte('fecha', hasta)

  if (e1) manejarError('_obtenerPagosParcialesFacturables(pagos)', e1)
  if (!pagos?.length) return []

  const idsPago      = pagos.map(p => p.id_pago)
  const fechaPorPago = new Map(pagos.map(p => [p.id_pago, p.fecha]))

  // 2. Aplicaciones de esos pagos, con el saldo → presupuesto/cliente asociado
  const { data: aplicaciones, error: e2 } = await supabase
    .from('pago_aplicacion')
    .select(`
      id_aplicacion,
      id_pago,
      id_saldo,
      monto_aplicado,
      saldo (
        id_presupuesto,
        id_cliente,
        presupuesto ( metodo_pago, nombre_cliente, apellido_cliente ),
        cliente ( nombre, apellido, cuit )
      )
    `)
    .in('id_pago', idsPago)

  if (e2) manejarError('_obtenerPagosParcialesFacturables(aplicaciones)', e2)

  return (aplicaciones ?? [])
    .filter(a => a.saldo?.id_presupuesto != null)
    .map(a => {
      const sal  = a.saldo
      const pres = sal.presupuesto
      const cli  = sal.cliente
      return {
        idAplicacion:    a.id_aplicacion,
        idSaldo:         a.id_saldo,
        idPresupuesto:   sal.id_presupuesto,
        idCliente:       sal.id_cliente,
        montoAplicado:   Number(a.monto_aplicado),
        fecha:           fechaPorPago.get(a.id_pago) ?? null,
        metodoPago:      pres?.metodo_pago         ?? null,
        nombreCliente:   pres?.nombre_cliente       ?? cli?.nombre   ?? null,
        apellidoCliente: pres?.apellido_cliente     ?? cli?.apellido ?? null,
        cuit:            cli?.cuit ?? null,
      }
    })
}

/**
 * Devuelve los presupuestos facturables en un rango de fechas, con detalles incluidos.
 *
 * CORRECCIÓN (Pago Parcial): la RPC `obtener_presupuestos_facturables` decide
 * qué presupuestos entran al reporte, y para Cuenta Corriente eso depende de
 * que el saldo llegue a estado 'pagado' — por eso un saldo que se viene
 * cobrando de a partes (vía `fn_aplicar_pago_cliente` / pagosService) quedaba
 * afuera del reporte hasta liquidarse al 100%, y el dinero ya cobrado no se
 * veía reflejado en ningún lado.
 *
 * Ahora:
 *   1. Cada pago parcial (fila de `pago_aplicacion`) se lista como línea
 *      individual, con su propio monto y fecha — se vea o no todavía
 *      liquidado el saldo al 100%.
 *   2. Todo presupuesto cuyo saldo tenga AL MENOS una aplicación de pago
 *      parcial se EXCLUYE del listado normal que devuelve la RPC, para que
 *      no aparezca duplicado (una vez como línea de venta completa y otra
 *      vez como línea(s) de pago parcial).
 *   3. Un saldo saldado de una sola vez (`marcarSaldoPagado`, que no genera
 *      filas en `pago_aplicacion`) no se ve afectado por este cambio: sigue
 *      apareciendo como línea normal, igual que antes.
 *
 * Cada línea devuelta trae `tipo: 'venta' | 'pago_parcial'` para que el
 * consumidor (Facturas.jsx) sepa cómo renderizarla.
 */
export async function obtenerFacturasConDetalles(desde, hasta) {
  const [rpcResult, pagosParciales] = await Promise.all([
    supabase.rpc('obtener_presupuestos_facturables', {
      fecha_desde: desde,
      fecha_hasta: hasta,
    }),
    _obtenerPagosParcialesFacturables(desde, hasta),
  ])

  const { data: presupuestos, error: e1 } = rpcResult
  if (e1) manejarError('obtenerFacturasConDetalles(rpc)', e1)

  const idsConPagoParcial = new Set(pagosParciales.map(pp => pp.idPresupuesto))
  const presupuestosFiltrados = (presupuestos ?? [])
    .filter(p => !idsConPagoParcial.has(p.id_presupuesto))

  if (!presupuestosFiltrados.length && !pagosParciales.length) return []

  let detallesPor = {}
  if (presupuestosFiltrados.length) {
    const ids = presupuestosFiltrados.map(p => p.id_presupuesto)

    const { data: detallesRaw, error: e2 } = await supabase
      .from('detalle_presupuesto')
      .select(`
        id_detalle,
        id_presupuesto,
        id_producto,
        nombre_producto,
        medida,
        cantidad,
        precio_unitario,
        precio_con_promo,
        id_promocion,
        subtotal,
        producto ( nombre, activo )
      `)
      .in('id_presupuesto', ids)
      .order('id_detalle', { ascending: true })

    if (e2) manejarError('obtenerFacturasConDetalles(detalles)', e2)

    for (const row of detallesRaw ?? []) {
      const id = row.id_presupuesto
      if (!detallesPor[id]) detallesPor[id] = []
      const det = mapDetalle(row)
      det.nombreProducto =
        row.nombre_producto
        ?? row.producto?.nombre
        ?? `(producto eliminado #${row.id_producto})`
      detallesPor[id].push(det)
    }
  }

  const lineasVenta = presupuestosFiltrados.map(p => ({
    tipo:             'venta',
    idPresupuesto:    p.id_presupuesto,
    idCliente:        p.id_cliente,
    fecha:            p.fecha,
    metodoPago:       p.metodo_pago,
    monto:            Number(p.monto),
    montoOriginal:    Number(p.monto_original),
    nombreCliente:    p.nombre_cliente,
    apellidoCliente:  p.apellido_cliente,
    cuit:             p.cuit,
    fechaPagoSaldo:   p.fecha_pago_saldo,
    // Día Y real para Efectivo/Transferencia. `fechaFacturacion` ya viene
    // resuelta por la RPC (COALESCE fecha_pago_saldo → fecha_pago → fecha),
    // así que en la práctica Facturas.jsx solo necesita usar esa; se expone
    // igual por transparencia/depuración.
    fechaFacturacion: p.fecha_facturacion,
    detalles:         detallesPor[p.id_presupuesto] ?? [],
  }))

  // Orden cronológico: dentro de un mismo cliente/presupuesto, que los pagos
  // parciales se lean en el orden real en que se cobraron.
  const lineasPagoParcial = pagosParciales
    .slice()
    .sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''))
    .map(pp => ({
      tipo:            'pago_parcial',
      idPresupuesto:   pp.idPresupuesto,
      idAplicacion:    pp.idAplicacion,
      idCliente:       pp.idCliente,
      fecha:           pp.fecha,
      metodoPago:      pp.metodoPago,
      monto:           pp.montoAplicado,
      nombreCliente:   pp.nombreCliente,
      apellidoCliente: pp.apellidoCliente,
      cuit:            pp.cuit,
      detalles:        [],
    }))

  return [...lineasVenta, ...lineasPagoParcial]
}

// ─── Mutaciones ───────────────────────────────────────────────────────────────
// Sin cambios — las mutaciones ya eran correctas y eficientes.

export async function crearPresupuesto(presupuesto, detalles) {
  const { data: pres, error: e1 } = await supabase
    .from('presupuesto')
    .insert({
      id_cliente:       presupuesto.idCliente,
      fecha:            presupuesto.fecha,
      metodo_pago:      presupuesto.metodoPago,
      monto_original:   presupuesto.montoOriginal ?? presupuesto.monto,
      monto:            presupuesto.monto,
      nombre_cliente:   presupuesto.nombreCliente   ?? null,
      apellido_cliente: presupuesto.apellidoCliente ?? null,
      estado:           presupuesto.estado          ?? 'borrador',
      es_excepcion:     Boolean(presupuesto.esExcepcion),
    })
    .select()
    .single()

  if (e1) manejarError('crearPresupuesto(cabecera)', e1)

  if (detalles.length > 0) {
    const rows = detalles.map(d => ({
      id_presupuesto:   pres.id_presupuesto,
      id_producto:      d.idProducto,
      nombre_producto:  d.nombreProducto ?? null,
      medida:           d.medida         ?? null,
      cantidad:         d.cantidad,
      precio_unitario:  d.precioUnitario,
      precio_con_promo: d.precioConPromo ?? null,
      id_promocion:     d.idPromocion    ?? null,
      subtotal:         d.subtotal,
    }))

    const { error: e2 } = await supabase
      .from('detalle_presupuesto')
      .insert(rows)

    if (e2) manejarError('crearPresupuesto(detalles)', e2)
  }

  return mapPresupuesto(pres)
}

export async function actualizarPresupuesto(idPresupuesto, presupuesto, detalles) {
  const { error: e1 } = await supabase
    .from('presupuesto')
    .update({
      id_cliente:       presupuesto.idCliente,
      fecha:            presupuesto.fecha,
      metodo_pago:      presupuesto.metodoPago,
      monto_original:   presupuesto.montoOriginal ?? presupuesto.monto,
      monto:            presupuesto.monto,
      nombre_cliente:   presupuesto.nombreCliente   ?? null,
      apellido_cliente: presupuesto.apellidoCliente ?? null,
      estado:           presupuesto.estado,
      es_excepcion:     Boolean(presupuesto.esExcepcion),
    })
    .eq('id_presupuesto', idPresupuesto)

  if (e1) manejarError('actualizarPresupuesto(cabecera)', e1)

  const { error: e2 } = await supabase
    .from('detalle_presupuesto')
    .delete()
    .eq('id_presupuesto', idPresupuesto)

  if (e2) manejarError('actualizarPresupuesto(delete detalles)', e2)

  if (detalles.length > 0) {
    const rows = detalles.map(d => ({
      id_presupuesto:   idPresupuesto,
      id_producto:      d.idProducto,
      nombre_producto:  d.nombreProducto ?? null,
      medida:           d.medida         ?? null,
      cantidad:         d.cantidad,
      precio_unitario:  d.precioUnitario,
      precio_con_promo: d.precioConPromo ?? null,
      id_promocion:     d.idPromocion    ?? null,
      subtotal:         d.subtotal,
    }))

    const { error: e3 } = await supabase
      .from('detalle_presupuesto')
      .insert(rows)

    if (e3) manejarError('actualizarPresupuesto(insert detalles)', e3)
  }
}

/**
 * Cambia el estado de un presupuesto.
 *
 * CORRECCIÓN (desacople Día X / Día Y): al pasar a 'pagado' un presupuesto
 * en Efectivo o Transferencia (sin financiamiento, sin fila en `saldo`), la
 * fecha de cobro real (Día Y) debe registrarse explícitamente — ya NO se
 * infiere de `presupuesto.fecha` (Día X, fecha de emisión/aceptación).
 *
 * @param {number} idPresupuesto
 * @param {string} estado
 * @param {{ fechaPago?: string }} [opts]
 *   fechaPago — 'YYYY-MM-DD'. Requerido (a nivel de UI) cuando `estado` es
 *   'pagado' y el método de pago es Efectivo/Transferencia. Se ignora para
 *   Cuenta Corriente: ahí la fecha de cobro se registra en `saldo.fecha_pago`
 *   vía `saldosService.marcarSaldoPagado` / `pagosService`, no acá.
 */
export async function actualizarEstadoPresupuesto(idPresupuesto, estado, { fechaPago = null } = {}) {
  const campos = { estado }
  if (estado === 'pagado' && fechaPago) {
    campos.fecha_pago = fechaPago
  }

  const { error } = await supabase
    .from('presupuesto')
    .update(campos)
    .eq('id_presupuesto', idPresupuesto)

  if (error) manejarError('actualizarEstadoPresupuesto', error)
}

export async function actualizarMetadataPresupuesto(idPresupuesto, { estado, metodoPago, esExcepcion }) {
  const { error } = await supabase
    .from('presupuesto')
    .update({
      estado,
      metodo_pago:  metodoPago,
      es_excepcion: Boolean(esExcepcion),
    })
    .eq('id_presupuesto', idPresupuesto)

  if (error) manejarError('actualizarMetadataPresupuesto', error)
}

export async function eliminarPresupuesto(idPresupuesto) {
  const { error: e1 } = await supabase
    .from('saldo')
    .delete()
    .eq('id_presupuesto', idPresupuesto)

  if (e1) manejarError('eliminarPresupuesto(saldo)', e1)

  const { error: e2 } = await supabase
    .from('presupuesto')
    .delete()
    .eq('id_presupuesto', idPresupuesto)

  if (e2) manejarError('eliminarPresupuesto(presupuesto)', e2)
}
