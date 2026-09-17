// src/lib/logger.js
/**
 * Logger estructurado mínimo (sin dependencias).
 *
 * Objetivos DevSecOps:
 *  1. Salida en JSON → parseable por cualquier colector (Sentry, Datadog, Loki).
 *  2. Redacción automática de claves sensibles (OWASP A09: Security Logging
 *     Failures). Nunca se escribe una contraseña ni un token en consola.
 *  3. Nivel configurable por entorno: en producción no se emite `debug`.
 *  4. El objeto Error se serializa (name/message/code), nunca el stack completo
 *     hacia un destino remoto no confiable.
 *
 * @module lib/logger
 */

const NIVELES = /** @type {const} */ ({ debug: 10, info: 20, warn: 30, error: 40 })

/** Claves cuyo valor nunca debe persistirse en un log. */
const CLAVES_SENSIBLES = /pass|password|contrase|token|secret|apikey|api_key|authorization|cookie|jwt|refresh/i

const esProd = typeof import.meta !== 'undefined' && import.meta.env
  ? import.meta.env.PROD
  : process.env.NODE_ENV === 'production'

const esTest = typeof import.meta !== 'undefined' && import.meta.env
  ? import.meta.env.MODE === 'test'
  : process.env.NODE_ENV === 'test'

// En test se silencia el ruido de `debug`/`info`: un log verboso en CI esconde
// las fallas reales. Los errores se siguen emitiendo.
const NIVEL_MINIMO = esTest ? NIVELES.error : esProd ? NIVELES.info : NIVELES.debug

/**
 * Serializa de forma segura, cortando ciclos y redactando secretos.
 * @param {unknown} valor
 * @param {WeakSet<object>} [vistos]
 * @returns {unknown}
 */
function sanear(valor, vistos = new WeakSet()) {
  if (valor instanceof Error) {
    return {
      name:   valor.name,
      // `message` puede venir del backend: se trunca para evitar volcar
      // respuestas HTML completas o stack traces de infraestructura.
      message: String(valor.message ?? '').slice(0, 300),
      code:    /** @type {any} */ (valor).code ?? /** @type {any} */ (valor).codigo ?? undefined,
    }
  }
  if (valor === null || typeof valor !== 'object') return valor
  if (vistos.has(valor)) return '[circular]'
  vistos.add(valor)

  if (Array.isArray(valor)) return valor.slice(0, 50).map((v) => sanear(v, vistos))

  /** @type {Record<string, unknown>} */
  const salida = {}
  for (const [k, v] of Object.entries(valor)) {
    salida[k] = CLAVES_SENSIBLES.test(k) ? '[REDACTADO]' : sanear(v, vistos)
  }
  return salida
}

/**
 * @param {keyof typeof NIVELES} nivel
 * @param {string} evento Nombre en snake_case con namespace: `accion.error`.
 * @param {Record<string, unknown>} [contexto]
 */
function emitir(nivel, evento, contexto = {}) {
  if (NIVELES[nivel] < NIVEL_MINIMO) return

  const registro = {
    ts:     new Date().toISOString(),
    nivel,
    evento,
    ...(/** @type {Record<string, unknown>} */ (sanear(contexto))),
  }

  const salida = nivel === 'error' ? console.error : nivel === 'warn' ? console.warn : console.log
  salida(JSON.stringify(registro))
}

export const logger = {
  /** @param {string} e @param {Record<string, unknown>} [c] */ debug: (e, c) => emitir('debug', e, c),
  /** @param {string} e @param {Record<string, unknown>} [c] */ info:  (e, c) => emitir('info',  e, c),
  /** @param {string} e @param {Record<string, unknown>} [c] */ warn:  (e, c) => emitir('warn',  e, c),
  /** @param {string} e @param {Record<string, unknown>} [c] */ error: (e, c) => emitir('error', e, c),
}

export default logger
