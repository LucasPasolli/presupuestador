// src/services/clienteMontosValidation.js
// Validación y normalización PURAS (sin red ni supabase) del alta de Debe/Haber.
// Se mantienen aparte del servicio para poder testearlas sin mocks.

/** @typedef {'debe'|'haber'} TipoMonto */
/** @typedef {{ valid: true, value: number, redondeado: boolean } | { valid: false, error: string }} ResultadoMonto */

export const TIPOS_MONTO = Object.freeze({ DEBE: 'debe', HABER: 'haber' })
export const MONTO_MAX = 9_999_999_999.99 // numeric(12,2) con margen: < 10^10

// "1.234,56" (es-AR: puntos de miles + coma decimal). Primer grupo sin cero inicial
// para que "0.125" se interprete como decimal y no como 125.
const RE_MILES_ES = /^([1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d+))?$/
// "1234", "1234,5", "1234.5"
const RE_SIMPLE = /^(\d+)(?:[.,](\d+))?$/

/**
 * Interpreta el monto tecleado y lo redondea a 2 decimales (half-up sobre el
 * texto, sin pasar por float -> sin errores tipo 1.005 -> 1.00; coincide con el
 * round() de numeric en PostgreSQL).
 * @param {unknown} raw
 * @returns {ResultadoMonto}
 */
export function validarMonto(raw) {
  const txt = String(raw ?? '').replace(/\s+/g, '')
  if (txt === '') return { valid: false, error: 'Ingresá un monto.' }

  if (txt.startsWith('-')) {
    return /^-[\d.,]+$/.test(txt)
      ? { valid: false, error: 'El monto debe ser mayor a 0.' }
      : { valid: false, error: 'Ingresá un valor numérico válido (ej. 1500,50).' }
  }

  let entero
  let fraccion = ''
  const miles = RE_MILES_ES.exec(txt)
  if (miles) {
    entero = miles[1].replace(/\./g, '')
    fraccion = miles[2] ?? ''
  } else {
    const simple = RE_SIMPLE.exec(txt)
    if (!simple) return { valid: false, error: 'Ingresá un valor numérico válido (ej. 1500,50).' }
    entero = simple[1]
    fraccion = simple[2] ?? ''
  }

  entero = entero.replace(/^0+(?=\d)/, '')
  if (entero.length > 10) return { valid: false, error: 'El monto es demasiado grande.' }

  const dec = fraccion + '00'
  let centavos = BigInt(entero + dec.slice(0, 2))
  const redondeado = fraccion.length > 2 && /[1-9]/.test(fraccion.slice(2))
  if (fraccion.length > 2 && dec[2] >= '5') centavos += 1n

  if (centavos <= 0n) return { valid: false, error: 'El monto debe ser mayor a 0.' }
  const value = Number(centavos) / 100
  if (value > MONTO_MAX) return { valid: false, error: 'El monto es demasiado grande.' }
  return { valid: true, value, redondeado }
}

/** @param {unknown} tipo */
export function validarTipo(tipo) {
  return tipo === TIPOS_MONTO.DEBE || tipo === TIPOS_MONTO.HABER
    ? { valid: true }
    : { valid: false, error: 'El tipo es obligatorio: elegí Debe o Haber.' }
}

/**
 * @param {{ monto: unknown, tipo: unknown }} form
 * @returns {{ valid: true, value: number } | { valid: false, errors: { monto?: string, tipo?: string } }}
 */
export function validarFormularioMonto({ monto, tipo }) {
  const m = validarMonto(monto)
  const t = validarTipo(tipo)
  if (m.valid && t.valid) return { valid: true, value: m.value }
  const errors = {}
  if (!m.valid) errors.monto = m.error
  if (!t.valid) errors.tipo = t.error
  return { valid: false, errors }
}

/** UUID v4 para la clave de idempotencia (con fallback si no hay randomUUID). */
export function nuevaClaveIdempotencia() {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
