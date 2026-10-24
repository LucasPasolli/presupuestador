// src/lib/borradorPresupuesto.js
/**
 * Persistencia del borrador del Presupuestador.
 *
 * Capa pura (sin React): lectura/escritura en `localStorage`, validación del
 * JSON leído y reconciliación contra el catálogo vigente.
 *
 * Decisiones de diseño
 * ────────────────────
 * · `localStorage` (no `sessionStorage`): el escenario 3 exige sobrevivir a
 *   recarga y a cierre/reapertura del navegador.
 * · Clave por usuario (`scope`): en un equipo compartido, el borrador de un
 *   usuario nunca se le muestra a otro.
 * · Minimización de datos: del cliente solo se guardan los campos que la UI
 *   necesita (id, nombre, apellido, mail, teléfono). Nunca CUIT ni domicilio.
 * · Se guarda un *snapshot de precios*, pero NO se confía en él: al restaurar,
 *   `reconciliarConCatalogo` lo contrasta con el catálogo (escenario 7).
 * · Todo lo leído se trata como no confiable (el usuario puede editar el
 *   storage; otra versión de la app pudo escribir otro formato): se valida y
 *   normaliza campo por campo, y ante la duda se descarta.
 *
 * @module lib/borradorPresupuesto
 */

export const VERSION_ESQUEMA = 1
const PREFIJO = 'presupuestador:borrador'
/** Pasado este tiempo, un borrador se considera abandonado y se descarta. */
export const TTL_MS = 14 * 24 * 60 * 60 * 1000
const MAX_ITEMS = 200
const MAX_TEXTO = 200
const METODOS = ['efectivo', 'transferencia', 'cc15', 'cc30', 'excepcion']
const METODOS_BASE = ['efectivo', 'transferencia', 'cc15', 'cc30']

/**
 * @typedef {object} ClienteBorrador
 * @property {number}      idCliente
 * @property {string}      nombre
 * @property {string}      apellido
 * @property {string|null} mail
 * @property {string|null} telefono
 */

/**
 * @typedef {object} ItemBorrador
 * @property {string}      idProducto
 * @property {string}      nombreProducto
 * @property {string}      cantidad
 * @property {number}      precioUnitario   Snapshot; se reconcilia al restaurar.
 * @property {number|null} idCategoria
 * @property {string|null} medida
 */

/**
 * @typedef {object} PayloadBorrador
 * @property {ClienteBorrador|null} cliente
 * @property {string}               metodoPago
 * @property {string}               excepcionSubMetodo
 * @property {string}               pct          % de excepción tal como lo tipeó el usuario.
 * @property {ItemBorrador[]}       items
 * @property {number|null}          totalFinal   Total al momento de guardar (para avisar si cambió).
 */

/** @typedef {PayloadBorrador & { v: number, savedAt: number }} Borrador */

// ─── Storage seguro ─────────────────────────────────────────────────────────

/** @returns {Storage|null} `null` si el storage está bloqueado (modo privado, políticas, SSR). */
function getStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** @param {string} scope */
export function claveBorrador(scope) {
  return `${PREFIJO}:v${VERSION_ESQUEMA}:${encodeURIComponent(scope || 'local')}`
}

// ─── Validación (todo lo leído es no confiable) ─────────────────────────────

const esObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const texto = (v, max = MAX_TEXTO) => (typeof v === 'string' ? v.slice(0, max) : '')
const textoONull = (v) => (typeof v === 'string' && v ? v.slice(0, MAX_TEXTO) : null)
const numeroNoNegativo = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}
const enteroPositivo = (v) => (Number.isInteger(v) && v > 0 ? v : null)

/** @returns {ClienteBorrador|null} */
function sanearCliente(raw) {
  if (!esObjeto(raw)) return null
  const idCliente = enteroPositivo(raw.idCliente)
  if (!idCliente) return null
  return {
    idCliente,
    nombre: texto(raw.nombre),
    apellido: texto(raw.apellido),
    mail: textoONull(raw.mail),
    telefono: textoONull(raw.telefono),
  }
}

/** @returns {ItemBorrador|null} */
function sanearItem(raw) {
  if (!esObjeto(raw)) return null
  const idProducto = String(raw.idProducto ?? '')
  if (!/^\d{1,10}$/.test(idProducto)) return null // fila incompleta → se descarta

  const cantidadNum = parseInt(raw.cantidad, 10)
  const cantidad = Number.isFinite(cantidadNum) && cantidadNum > 0 ? String(Math.min(cantidadNum, 1_000_000)) : '1'
  const medida = typeof raw.medida === 'string' && /^(standard|\d\.\d{2})$/.test(raw.medida) ? raw.medida : null

  return {
    idProducto,
    nombreProducto: texto(raw.nombreProducto),
    cantidad,
    precioUnitario: numeroNoNegativo(raw.precioUnitario) ?? 0,
    idCategoria: enteroPositivo(raw.idCategoria),
    medida,
  }
}

/**
 * Valida y normaliza un objeto arbitrario como borrador.
 * @param {unknown} raw
 * @param {number} [ahora]
 * @returns {Borrador|null} `null` si el formato no es reconocible o está vencido.
 */
export function sanearBorrador(raw, ahora = Date.now()) {
  if (!esObjeto(raw) || raw.v !== VERSION_ESQUEMA) return null

  const savedAt = numeroNoNegativo(raw.savedAt)
  if (savedAt == null || ahora - savedAt > TTL_MS) return null

  const items = (Array.isArray(raw.items) ? raw.items : [])
    .slice(0, MAX_ITEMS)
    .map(sanearItem)
    .filter(Boolean)

  const pct = typeof raw.pct === 'string' && raw.pct.length <= 12 && /^-?\d*\.?\d*$/.test(raw.pct) ? raw.pct : ''

  return {
    v: VERSION_ESQUEMA,
    savedAt,
    cliente: sanearCliente(raw.cliente),
    metodoPago: METODOS.includes(raw.metodoPago) ? raw.metodoPago : 'efectivo',
    excepcionSubMetodo: METODOS_BASE.includes(raw.excepcionSubMetodo) ? raw.excepcionSubMetodo : 'efectivo',
    pct,
    items,
    totalFinal: numeroNoNegativo(raw.totalFinal),
  }
}

/**
 * Un formulario "de fábrica" no merece borrador: evita dejar basura y que un
 * formulario nuevo muestre el aviso de "recuperamos tu borrador" sin motivo.
 * @param {PayloadBorrador} p
 */
export function esBorradorVacio(p) {
  return !p.cliente && p.items.length === 0 && p.metodoPago === 'efectivo'
}

// ─── API pública de storage ─────────────────────────────────────────────────

/**
 * @param {string} scope
 * @returns {Borrador|null} Borrador válido o `null`. Un borrador corrupto o
 *   vencido se elimina del storage como efecto secundario.
 */
export function leerBorrador(scope) {
  const storage = getStorage()
  if (!storage) return null
  const clave = claveBorrador(scope)
  try {
    const crudo = storage.getItem(clave)
    if (!crudo) return null
    const borrador = sanearBorrador(JSON.parse(crudo))
    if (!borrador || esBorradorVacio(borrador)) {
      storage.removeItem(clave)
      return null
    }
    return borrador
  } catch {
    try { storage.removeItem(clave) } catch { /* nada más que hacer */ }
    return null
  }
}

/**
 * @param {string} scope
 * @param {PayloadBorrador} payload
 * @returns {{ ok: boolean, savedAt: number|null }} `savedAt` es `null` si no
 *   había nada que guardar (formulario vacío → se borra el borrador previo).
 */
export function guardarBorrador(scope, payload) {
  const storage = getStorage()
  if (!storage) return { ok: false, savedAt: null }
  const clave = claveBorrador(scope)
  try {
    if (esBorradorVacio(payload)) {
      storage.removeItem(clave)
      return { ok: true, savedAt: null }
    }
    const savedAt = Date.now()
    // Se normaliza TAMBIÉN al escribir (no solo al leer): garantiza que jamás
    // llegue al storage un campo fuera del esquema (p. ej. CUIT o domicilio).
    const normalizado = sanearBorrador({ ...payload, v: VERSION_ESQUEMA, savedAt }, savedAt)
    if (!normalizado) return { ok: false, savedAt: null }
    storage.setItem(clave, JSON.stringify(normalizado))
    return { ok: true, savedAt }
  } catch {
    // QuotaExceededError, SecurityError, etc. El formulario sigue funcionando.
    return { ok: false, savedAt: null }
  }
}

/** @param {string} scope */
export function eliminarBorrador(scope) {
  try { getStorage()?.removeItem(claveBorrador(scope)) } catch { /* ignorar */ }
}

/**
 * Borra los borradores de TODOS los usuarios de este navegador.
 * Llamar al cerrar sesión: los borradores contienen datos de clientes.
 */
export function eliminarTodosLosBorradores() {
  const storage = getStorage()
  if (!storage) return
  try {
    const claves = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k && k.startsWith(`${PREFIJO}:`)) claves.push(k)
    }
    claves.forEach((k) => storage.removeItem(k))
  } catch { /* ignorar */ }
}

// ─── Reconciliación con el catálogo (escenario 7) ───────────────────────────

/**
 * @typedef {object} CambioPrecio
 * @property {'precio'} tipo
 * @property {string} nombre
 * @property {number} anterior
 * @property {number} actual
 *
 * @typedef {object} CambioNoDisponible
 * @property {'no_disponible'} tipo
 * @property {string} nombre
 *
 * @typedef {object} CambioCliente
 * @property {'cliente_no_disponible'} tipo
 * @property {string} nombre
 *
 * @typedef {CambioPrecio|CambioNoDisponible|CambioCliente} CambioBorrador
 */

/**
 * Contrasta un borrador restaurado con el catálogo vigente.
 *
 * Resiliente: si una consulta falla (sin conexión), ese ítem queda intacto y
 * se cuenta en `noVerificados` — nunca se inventa un cambio ni se bloquea la
 * restauración por un problema de red.
 *
 * @param {object} entrada
 * @param {Array<{ _uid: string, idProducto: string, nombreProducto: string, precioUnitario: number|string }>} entrada.items
 * @param {ClienteBorrador|null} entrada.cliente
 * @param {object} fuentes Inyectadas para poder testear sin red.
 * @param {(idProducto: number) => Promise<{ producto: any } | null>} fuentes.obtenerProducto
 * @param {(idCliente: number) => Promise<any|null>} fuentes.obtenerCliente
 * @returns {Promise<{
 *   parches: Map<string, { idProducto: string, patch: object }>,
 *   cliente: { idCliente: number, valor: any|null } | null,
 *   cambios: CambioBorrador[],
 *   noVerificados: number,
 * }>}
 */
export async function reconciliarConCatalogo({ items, cliente }, { obtenerProducto, obtenerCliente }) {
  /** Una consulta por producto, aunque varias filas lo repitan. */
  const consultas = new Map()
  const consultar = (id) => {
    if (!consultas.has(id)) {
      consultas.set(
        id,
        Promise.resolve()
          .then(() => obtenerProducto(id))
          .then((r) => ({ ok: true, producto: r?.producto ?? null }))
          .catch(() => ({ ok: false, producto: null })),
      )
    }
    return consultas.get(id)
  }

  const [resultados, clienteRes] = await Promise.all([
    Promise.all(items.map((it) => consultar(parseInt(it.idProducto, 10)))),
    cliente
      ? Promise.resolve()
          .then(() => obtenerCliente(cliente.idCliente))
          .then((c) => ({ ok: true, cliente: c ?? null }))
          .catch(() => ({ ok: false, cliente: null }))
      : Promise.resolve(null),
  ])

  const parches = new Map()
  const cambios = []
  let noVerificados = 0

  items.forEach((it, i) => {
    const { ok, producto } = resultados[i]
    const nombre = it.nombreProducto || `Producto #${it.idProducto}`

    if (!ok) { noVerificados += 1; return }

    if (!producto || producto.activo === false) {
      parches.set(it._uid, { idProducto: it.idProducto, patch: { noDisponible: true } })
      cambios.push({ tipo: 'no_disponible', nombre })
      return
    }

    const anterior = Number(it.precioUnitario) || 0
    const actual = Number(producto.precioUnitario) || 0
    if (Math.abs(actual - anterior) >= 0.005) {
      parches.set(it._uid, {
        idProducto: it.idProducto,
        patch: { precioUnitario: actual, precioAnterior: anterior },
      })
      cambios.push({ tipo: 'precio', nombre: producto.nombre || nombre, anterior, actual })
    }
  })

  let clienteResultado = null
  if (cliente && clienteRes?.ok) {
    const c = clienteRes.cliente
    if (!c || c.activo === false) {
      clienteResultado = { idCliente: cliente.idCliente, valor: null }
      cambios.push({ tipo: 'cliente_no_disponible', nombre: `${cliente.nombre} ${cliente.apellido}`.trim() })
    } else {
      clienteResultado = { idCliente: cliente.idCliente, valor: c } // datos frescos
    }
  } else if (cliente && clienteRes && !clienteRes.ok) {
    noVerificados += 1
  }

  return { parches, cliente: clienteResultado, cambios, noVerificados }
}

// ─── Presentación ───────────────────────────────────────────────────────────

/**
 * @param {number} ts   Epoch ms.
 * @param {number} [ahora]
 * @returns {string} p. ej. "hace 5 min", "hace 2 días".
 */
export function formatearAntiguedad(ts, ahora = Date.now()) {
  const min = Math.floor((ahora - ts) / 60000)
  if (min < 1) return 'hace instantes'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`
}
