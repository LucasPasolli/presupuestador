// src/lib/inventarioUtils.js
//
// Lógica pura del módulo Inventario, separada del componente por dos motivos:
//
//  1. DRY — la regla "¿está bajo stock?" estaba repetida en el resaltado de
//     filas, el color del stock, el filtro y el contador del resumen. Ahora la
//     tabla (desktop) y las tarjetas (mobile/tablet) consumen la MISMA función,
//     lo que garantiza el Escenario 6 (mismo resultado en cualquier dispositivo).
//  2. Testabilidad — son funciones sin React ni red: se prueban en milisegundos.

/** @typedef {{ stockTotal: number, puntoReposicion?: number }} ProductoStock */

/**
 * `true` si el producto tiene punto de reposición configurado y el stock
 * llegó o cayó por debajo de él. Un punto de reposición de 0 significa
 * "sin alerta configurada".
 * @param {ProductoStock} p
 */
export function esBajoStock(p) {
  return (p.puntoReposicion ?? 0) > 0 && p.stockTotal <= (p.puntoReposicion ?? 0)
}

/**
 * Estado visual del stock. "sin" tiene prioridad sobre "bajo" (igual que el
 * color rojo tenía prioridad sobre el amarillo en la tabla original).
 * @param {ProductoStock} p
 * @returns {'sin' | 'bajo' | 'ok'}
 */
export function estadoStock(p) {
  if (p.stockTotal === 0) return 'sin'
  if (esBajoStock(p)) return 'bajo'
  return 'ok'
}

/**
 * Texto que acompaña al número de stock. El color por sí solo no es un canal
 * de información suficiente (WCAG 1.4.1 — Uso del color).
 * @param {'sin' | 'bajo' | 'ok'} estado
 */
export function etiquetaEstadoStock(estado) {
  return { sin: 'Sin stock', bajo: 'Reponer', ok: 'En stock' }[estado]
}

// ─── Orden ────────────────────────────────────────────────────────────────
// En desktop se ordena haciendo clic en los encabezados de la tabla. En
// mobile/tablet no hay encabezados, así que se ofrece un <select> equivalente.
// Ambos escriben en el MISMO estado (sortKey / sortDir).

export const SORT_KEYS = /** @type {const} */ (['nombre', 'precio', 'stock'])
export const SORT_DIRS = /** @type {const} */ (['asc', 'desc'])

export const SORT_OPCIONES = [
  { value: 'nombre:asc',  label: 'Nombre (A → Z)' },
  { value: 'nombre:desc', label: 'Nombre (Z → A)' },
  { value: 'precio:asc',  label: 'Precio: menor a mayor' },
  { value: 'precio:desc', label: 'Precio: mayor a menor' },
  { value: 'stock:asc',   label: 'Stock: menor a mayor' },
  { value: 'stock:desc',  label: 'Stock: mayor a menor' },
]

/** @param {string} key @param {string} dir */
export function valorOrden(key, dir) {
  return `${key}:${dir}`
}

/**
 * Parsea el valor del <select> de orden. Valida contra listas cerradas: un
 * valor inesperado (DOM manipulado, etc.) cae al orden por defecto en lugar de
 * contaminar el estado con claves arbitrarias.
 * @param {string} value
 * @returns {{ sortKey: 'nombre' | 'precio' | 'stock', sortDir: 'asc' | 'desc' }}
 */
export function parseOrden(value) {
  const [key, dir] = String(value ?? '').split(':')
  const sortKey = SORT_KEYS.includes(/** @type {any} */ (key)) ? key : 'nombre'
  const sortDir = SORT_DIRS.includes(/** @type {any} */ (dir)) ? dir : 'asc'
  return { sortKey: /** @type {any} */ (sortKey), sortDir: /** @type {any} */ (sortDir) }
}

// ─── Filtros ──────────────────────────────────────────────────────────────

/**
 * @typedef {object} EstadoFiltros
 * @property {string} searchNombre
 * @property {string} searchId
 * @property {string} filterCat
 * @property {string} filterProveedor
 * @property {string} filterStock
 * @property {boolean} filterBajoStock
 */

/**
 * Cantidad de filtros "avanzados" activos (los que en mobile quedan dentro del
 * panel colapsable). Alimenta el contador del botón "Más filtros" para que el
 * usuario sepa que hay filtros aplicados aunque el panel esté cerrado.
 * @param {EstadoFiltros} f
 */
export function contarFiltrosAvanzados(f) {
  return [
    f.filterCat !== 'all',
    f.filterProveedor !== 'all',
    f.filterStock !== 'all',
    f.filterBajoStock,
  ].filter(Boolean).length
}

/**
 * `true` si hay cualquier filtro o búsqueda activa.
 * @param {EstadoFiltros} f
 */
export function hayFiltrosActivos(f) {
  return Boolean(f.searchNombre || f.searchId) || contarFiltrosAvanzados(f) > 0
}
