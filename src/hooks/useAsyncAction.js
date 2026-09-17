// src/hooks/useAsyncAction.js
/**
 * useAsyncAction — Latch de concurrencia para acciones asíncronas.
 *
 * PROBLEMA QUE RESUELVE
 * ---------------------
 * El patrón habitual en React es:
 *
 *   const [loading, setLoading] = useState(false)
 *   async function guardar() { setLoading(true); await crear(); setLoading(false) }
 *   <Button onClick={guardar} disabled={loading} />
 *
 * Esto NO es seguro. `setLoading(true)` es asíncrono: React agenda el
 * re-render, pero el atributo `disabled` del DOM recién se actualiza en el
 * siguiente commit. Un doble clic rápido (o un `Enter` mantenido, que dispara
 * `keydown` repetido) puede ejecutar el handler dos veces ANTES de que el
 * botón llegue a deshabilitarse → dos INSERT en el backend.
 *
 * SOLUCIÓN
 * --------
 * Un `useRef` actúa como mutex/latch: se escribe de forma SÍNCRONA en el mismo
 * tick del evento, por lo que la segunda invocación ve `true` inmediatamente y
 * retorna sin efectos. El `useState` queda solo para lo visual.
 *
 * Patrones aplicados:
 *  - Guard Clause + Latch (concurrencia): corta la re-entrada en O(1).
 *  - Decorator: `run` envuelve la función de negocio sin conocer su contenido.
 *  - Template Method: `onSuccess` / `onError` como hooks de extensión.
 *
 * @module hooks/useAsyncAction
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from '../lib/logger'

/** Duración mínima del estado "pendiente" (ms). Evita el parpadeo del spinner
 *  en respuestas muy rápidas (<100 ms), que se percibe como un glitch. */
export const MIN_PENDING_MS = 250

/** Timeout por defecto de una acción (ms). Si el backend nunca responde, el
 *  latch se libera igual para no dejar la UI trabada de forma permanente. */
export const DEFAULT_TIMEOUT_MS = 30_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** @param {unknown} v @returns {v is Promise<unknown>} */
export function esPromesa(v) {
  return !!v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function'
}

/**
 * @template {(...args: any[]) => any} F
 * @param {F} accion Función (sync o async) a proteger.
 * @param {object} [opciones]
 * @param {number} [opciones.minPendingMs=250]
 * @param {number} [opciones.timeoutMs=30000]
 * @param {(resultado: any) => void} [opciones.onSuccess]
 * @param {(error: unknown) => void} [opciones.onError]
 * @param {string} [opciones.nombre] Identificador para logging estructurado.
 * @returns {{
 *   run: (...args: Parameters<F>) => Promise<any>,
 *   pending: boolean,
 *   error: unknown,
 *   reset: () => void,
 *   isLocked: () => boolean
 * }}
 */
export function useAsyncAction(accion, opciones = {}) {
  const {
    minPendingMs = MIN_PENDING_MS,
    timeoutMs    = DEFAULT_TIMEOUT_MS,
    onSuccess,
    onError,
    nombre       = accion?.name || 'accion_anonima',
  } = opciones

  const [pending, setPending] = useState(false)
  const [error,   setError]   = useState(/** @type {unknown} */ (null))

  // Latch síncrono. Fuente de verdad para el control de concurrencia.
  const enVueloRef = useRef(false)
  const montadoRef = useRef(true)

  // Refs "latest" para que `run` sea estable (referencia constante) y no
  // invalide memoizaciones aguas abajo en cada render.
  const accionRef = useRef(accion)
  const cbRef     = useRef({ onSuccess, onError })
  accionRef.current = accion
  cbRef.current     = { onSuccess, onError }

  useEffect(() => {
    montadoRef.current = true
    return () => { montadoRef.current = false }
  }, [])

  /** setState seguro: evita actualizar un componente ya desmontado
   *  (caso típico: el modal se cierra en el `onSuccess`). */
  const setSeguro = useCallback((setter, valor) => {
    if (montadoRef.current) setter(valor)
  }, [])

  const isLocked = useCallback(() => enVueloRef.current, [])

  const reset = useCallback(() => {
    enVueloRef.current = false
    setSeguro(setPending, false)
    setSeguro(setError, null)
  }, [setSeguro])

  const run = useCallback(async (...args) => {
    // ── Escenario 2: la solicitud ya está en curso → ignorar el evento.
    if (enVueloRef.current) {
      logger.debug('accion.duplicada_ignorada', { accion: nombre })
      return undefined
    }
    enVueloRef.current = true

    const iniciadoEn = Date.now()
    let resultado
    let huboError = false

    try {
      setSeguro(setError, null)

      const salida = accionRef.current?.(...args)

      // Acción síncrona: no hay nada que esperar, se libera de inmediato.
      if (!esPromesa(salida)) {
        resultado = salida
        cbRef.current.onSuccess?.(resultado)
        return resultado
      }

      setSeguro(setPending, true)

      // Watchdog: el latch nunca queda tomado para siempre.
      resultado = await Promise.race([
        salida,
        sleep(timeoutMs).then(() => {
          throw Object.assign(new Error('TIEMPO_AGOTADO'), { codigo: 'TIMEOUT' })
        }),
      ])

      cbRef.current.onSuccess?.(resultado)
      return resultado
    } catch (err) {
      huboError = true
      // Log estructurado: nunca se muestra crudo al usuario (ver mapearErrorSeguro).
      logger.error('accion.error', { accion: nombre, error: err })
      setSeguro(setError, err)
      cbRef.current.onError?.(err)
      return undefined
    } finally {
      const transcurrido = Date.now() - iniciadoEn
      const restante     = minPendingMs - transcurrido
      // Anti-parpadeo: mantiene el spinner un mínimo perceptible. Mantener el
      // latch durante esa ventana es deseable (amortigua el doble clic humano,
      // que ocurre típicamente dentro de los 250 ms).
      if (restante > 0 && !huboError) await sleep(restante)

      enVueloRef.current = false
      setSeguro(setPending, false)

      logger.debug('accion.finalizada', { accion: nombre, ms: Date.now() - iniciadoEn, ok: !huboError })
    }
  }, [minPendingMs, timeoutMs, nombre, setSeguro])

  return { run, pending, error, reset, isLocked }
}

export default useAsyncAction
