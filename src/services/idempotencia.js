// src/services/idempotencia.js
/**
 * Ejecutor de operaciones idempotentes contra Supabase (PostgREST RPC).
 *
 * PATRONES
 * --------
 *  - Decorator: `ejecutarIdempotente` envuelve cualquier RPC sin conocerla.
 *  - Idempotent Receiver (Enterprise Integration Patterns): la deduplicación
 *    real vive en el servidor; el cliente solo aporta la clave.
 *  - Circuit-breaker liviano: reintentos acotados con backoff exponencial y
 *    jitter, únicamente sobre fallos de transporte. Un fallo de negocio
 *    (validación, permisos) nunca se reintenta.
 *
 * REGLA DE ORO DEL REINTENTO
 * --------------------------
 * Reintentar solo es seguro porque la clave de idempotencia viaja en el
 * payload: el servidor reconoce el segundo intento como el mismo y devuelve
 * la respuesta cacheada. Sin esa clave, un reintento automático es
 * precisamente el generador de duplicados que queremos eliminar.
 *
 * @module services/idempotencia
 */
import { supabase } from '../lib/supabase'
import { huellaPayload } from '../lib/idempotency'
import { logger } from '../lib/logger'

/** Códigos SQLSTATE que el backend usa para comunicar semántica de negocio. */
export const CODIGOS = /** @type {const} */ ({
  DUPLICADO_UNICO:    '23505', // unique_violation
  FK_INVALIDA:        '23503', // foreign_key_violation
  CHECK_INVALIDO:     '23514',
  CLAVE_REUTILIZADA:  'P0IDK', // definido por nosotros en el SQL
  OPERACION_EN_CURSO: 'P0IDP',
  SIN_PERMISO:        '42501',
  // AGREGADO (feature: reintegro de stock al eliminar presupuesto pagado):
  // código genérico para "el recurso ya no existe" — cubre la carrera donde
  // dos requests apuntan al mismo id y una ya lo borró cuando llega la otra.
  // Nombre y código intencionalmente genéricos para que cualquier RPC de
  // borrado futura (no solo presupuestos) pueda reusarlo sin inventar el
  // suyo. No reutilizar 'P0002': ese código lo emite el motor de PL/pgSQL
  // internamente (no_data_found de STRICT INTO) y mezclar semántica propia
  // con la del motor genera falsos positivos difíciles de rastrear.
  RECURSO_NO_ENCONTRADO: 'P0NFD',
})

const REINTENTOS_MAX   = 2
const BASE_BACKOFF_MS  = 300
const TIMEOUT_RPC_MS   = 20_000

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * ¿El fallo es transitorio (red, 5xx, timeout) y por lo tanto reintentable?
 * @param {any} error
 * @returns {boolean}
 */
function esTransitorio(error) {
  if (!error) return false
  if (error.name === 'AbortError' || error.codigo === 'TIMEOUT') return true
  if (error instanceof TypeError) return true               // fetch caído / offline
  const status = Number(error.status ?? error.statusCode)
  return status === 429 || (status >= 500 && status <= 599)
}

/**
 * Traduce un error del backend a un mensaje apto para el usuario.
 *
 * OWASP A05 (Security Misconfiguration) / CWE-209: jamás se devuelve
 * `error.message` crudo. Un mensaje de Postgres puede filtrar nombres de
 * tablas, columnas, constraints o fragmentos del SQL, que es reconocimiento
 * gratuito para un atacante. El detalle técnico va al log, no a la pantalla.
 *
 * @param {any} error
 * @returns {{ mensaje: string, codigo: string, reintentable: boolean }}
 */
export function mapearErrorSeguro(error) {
  const codigo = String(error?.code ?? error?.codigo ?? 'DESCONOCIDO')

  switch (codigo) {
    case CODIGOS.DUPLICADO_UNICO:
      return { mensaje: 'Ese registro ya fue creado. Actualizá la pantalla para verlo.', codigo, reintentable: false }
    case CODIGOS.OPERACION_EN_CURSO:
      return { mensaje: 'La operación anterior todavía se está procesando. Esperá unos segundos.', codigo, reintentable: false }
    case CODIGOS.CLAVE_REUTILIZADA:
      return { mensaje: 'Los datos cambiaron durante el envío. Revisá el formulario y volvé a intentar.', codigo, reintentable: false }
    case CODIGOS.FK_INVALIDA:
      return { mensaje: 'Alguno de los datos relacionados ya no existe. Actualizá la pantalla.', codigo, reintentable: false }
    case CODIGOS.CHECK_INVALIDO:
      return { mensaje: 'Los datos ingresados no cumplen las reglas de validación.', codigo, reintentable: false }
    case CODIGOS.SIN_PERMISO:
      return { mensaje: 'No tenés permisos para realizar esta acción.', codigo, reintentable: false }
    case CODIGOS.RECURSO_NO_ENCONTRADO:
      return { mensaje: 'Este registro ya no existe. Es posible que se haya eliminado desde otra pestaña o dispositivo — actualizá la pantalla.', codigo, reintentable: false }
    case 'TIMEOUT':
      return { mensaje: 'El servidor tardó demasiado en responder. Verificá si la operación se completó antes de reintentar.', codigo, reintentable: true }
    default:
      if (esTransitorio(error)) {
        return { mensaje: 'No se pudo conectar con el servidor. Intentá nuevamente en unos segundos.', codigo, reintentable: true }
      }
      return { mensaje: 'No se pudo completar la operación. Intentá nuevamente.', codigo, reintentable: false }
  }
}

/** Error de aplicación ya saneado, listo para mostrarse en la UI. */
export class ErrorOperacion extends Error {
  /** @param {{ mensaje: string, codigo: string, reintentable: boolean }} info */
  constructor({ mensaje, codigo, reintentable }) {
    super(mensaje)
    this.name         = 'ErrorOperacion'
    this.codigo       = codigo
    this.reintentable = reintentable
  }
}

/**
 * Invoca una función RPC de Postgres de forma idempotente.
 *
 * @template T
 * @param {string} nombreRpc Nombre de la función, p. ej. `crear_presupuesto_idempotente`.
 * @param {Record<string, unknown>} parametros Parámetros de negocio (sin la clave).
 * @param {object} opciones
 * @param {string} opciones.clave UUID de idempotencia (ver `useClaveIdempotencia`).
 * @param {number} [opciones.timeoutMs]
 * @param {number} [opciones.reintentos]
 * @returns {Promise<T>}
 * @throws {ErrorOperacion} Siempre un error saneado; nunca el error crudo del driver.
 */
export async function ejecutarIdempotente(nombreRpc, parametros, opciones) {
  const { clave, timeoutMs = TIMEOUT_RPC_MS, reintentos = REINTENTOS_MAX } = opciones

  if (!clave) throw new ErrorOperacion({ mensaje: 'Operación mal formada.', codigo: 'SIN_CLAVE', reintentable: false })

  // La huella viaja junto a la clave: ata la clave a ESTE contenido exacto.
  const huella = await huellaPayload(parametros)

  let ultimoError = null

  for (let intento = 0; intento <= reintentos; intento++) {
    const controlador = new AbortController()
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs)

    try {
      const { data, error } = await supabase
        .rpc(nombreRpc, { p_clave: clave, p_huella: huella, ...parametros })
        .abortSignal(controlador.signal)

      if (error) throw error

      logger.info('rpc.ok', { rpc: nombreRpc, intento, clave })
      return /** @type {T} */ (data)
    } catch (err) {
      ultimoError = err
      const info = mapearErrorSeguro(err)

      logger.warn('rpc.fallo', { rpc: nombreRpc, intento, clave, codigo: info.codigo, error: err })

      if (!info.reintentable || intento === reintentos) {
        throw new ErrorOperacion(info)
      }

      // Backoff exponencial con jitter completo: evita que N clientes que
      // fallaron a la vez vuelvan sincronizados y provoquen un thundering herd.
      const espera = Math.random() * BASE_BACKOFF_MS * 2 ** intento
      await dormir(espera)
    } finally {
      clearTimeout(temporizador)
    }
  }

  throw new ErrorOperacion(mapearErrorSeguro(ultimoError))
}

export default ejecutarIdempotente
