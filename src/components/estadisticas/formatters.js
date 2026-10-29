// src/components/estadisticas/formatters.js
// Formateo y fechas del módulo de estadísticas. Funciones PURAS (sin React),
// fáciles de testear. Fuente única: móvil, tablet y escritorio formatean igual
// (Escenario 7 – consistencia de datos).

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })

/** Monto exacto en pesos argentinos. */
export const fmt = (n) => ARS.format(n ?? 0)

/** Monto resumido ($1.2M / $350.0K). Por debajo de 1.000 usa el formato exacto. */
export function fmtCompacto(n) {
  const v = n ?? 0
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`
  return fmt(v)
}

export function pct(a, b) {
  if (!b) return '—'
  return `${((a / b) * 100).toFixed(1)}%`
}

// ─── Fechas ────────────────────────────────────────────────────────────────
// IMPORTANTE: se usa la fecha LOCAL del dispositivo. `toISOString()` devuelve
// UTC: en Argentina (UTC-3), a partir de las 21:00 "hoy" pasaba a ser mañana y
// el rango cambiaba según la hora/zona del dispositivo.

const pad = (n) => String(n).padStart(2, '0')

/** Date → 'YYYY-MM-DD' en hora local. */
export function fechaLocalISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const hoyISO = () => fechaLocalISO(new Date())

/** Primer día del mes actual. */
export const inicioDeMes = (base = new Date()) =>
  fechaLocalISO(new Date(base.getFullYear(), base.getMonth(), 1))

/**
 * Primer día del mes de hace `n - 1` meses (n=3 → mes actual + 2 previos).
 * Se construye con `new Date(y, m, 1)`: la versión anterior (`setMonth` +
 * `setDate(1)`) desbordaba al mes siguiente cuando hoy era día 31 y el mes
 * destino tenía menos días (p. ej. 31/01 − 2 meses → 1/12 en vez de 1/11).
 */
export function nMesesAtras(n, base = new Date()) {
  return fechaLocalISO(new Date(base.getFullYear(), base.getMonth() - n + 1, 1))
}

const RE_ISO = /^\d{4}-\d{2}-\d{2}$/

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (sin pasar por Date: sin corrimientos de zona). */
export function fmtFecha(iso) {
  if (!iso || !RE_ISO.test(iso)) return iso ?? ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/**
 * Valida un rango. Devuelve `null` si es válido o el mensaje de error.
 * @param {{desde?: string, hasta?: string}} rango
 * @returns {string|null}
 */
export function validarRango({ desde, hasta } = {}) {
  if (!desde || !hasta) return 'Completá las fechas "Desde" y "Hasta".'
  if (!RE_ISO.test(desde) || !RE_ISO.test(hasta)) return 'Fecha inválida.'
  if (desde > hasta) return 'La fecha "Desde" no puede ser posterior a "Hasta".'
  return null
}

// ─── Demora de pago ────────────────────────────────────────────────────────

export function colorDemora(dias) {
  if (dias > 15) return 'text-red-400 bg-red-500/10 border-red-500/30'
  if (dias > 0)  return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
  return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
}

export const fmtDemora = (dias) => `${dias > 0 ? '+' : ''}${dias} d`
