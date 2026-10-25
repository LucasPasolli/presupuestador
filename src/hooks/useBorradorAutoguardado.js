// src/hooks/useBorradorAutoguardado.js
import { useCallback, useEffect, useRef, useState } from 'react'
import { guardarBorrador, eliminarBorrador } from '../lib/borradorPresupuesto'

/**
 * Autoguarda un snapshot del formulario en `localStorage`.
 *
 * Estrategia de escritura:
 *   · Debounce (por defecto 600 ms) mientras el usuario edita → evita escribir
 *     en cada tecla.
 *   · Flush inmediato al desmontar (navegar a otra pantalla), al ocultar la
 *     pestaña (`visibilitychange`) y en `pagehide` → cubre cierre accidental
 *     y los navegadores móviles que matan la pestaña sin avisar.
 *   · Se omite la escritura si el snapshot no cambió.
 *
 * `habilitado` permite diferir el guardado hasta que el estado sea confiable
 * (p. ej. mientras se reconcilia un borrador restaurado, para no pisar el
 * borrador original con valores intermedios).
 *
 * @param {object} args
 * @param {string}  args.scope       Usuario dueño del borrador.
 * @param {import('../lib/borradorPresupuesto').PayloadBorrador} args.snapshot Debe ser referencialmente estable (useMemo).
 * @param {boolean} args.habilitado
 * @param {number}  [args.debounceMs]
 * @returns {{
 *   ultimoGuardado: number|null,
 *   errorAlmacenamiento: boolean,
 *   descartar: () => void,
 *   reanudar: () => void,
 * }}
 */
export function useBorradorAutoguardado({ scope, snapshot, habilitado, debounceMs = 600 }) {
  const snapshotRef   = useRef(snapshot)
  const habilitadoRef = useRef(habilitado)
  snapshotRef.current   = snapshot
  habilitadoRef.current = habilitado

  const pausadoRef = useRef(false)  // true tras `descartar()` hasta `reanudar()`
  const montadoRef = useRef(true)
  const timerRef   = useRef(null)
  const firmaRef   = useRef(null)   // último snapshot escrito (para omitir duplicados)

  const [ultimoGuardado, setUltimoGuardado]           = useState(null)
  const [errorAlmacenamiento, setErrorAlmacenamiento] = useState(false)

  const persistir = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = null
    if (!habilitadoRef.current || pausadoRef.current) return

    const snap  = snapshotRef.current
    const firma = JSON.stringify(snap)
    if (firma === firmaRef.current) return

    const { ok, savedAt } = guardarBorrador(scope, snap)
    if (ok) firmaRef.current = firma
    if (!montadoRef.current) return
    setErrorAlmacenamiento(!ok)
    if (ok && savedAt) setUltimoGuardado(savedAt)
  }, [scope])

  // Escritura diferida ante cada cambio.
  useEffect(() => {
    if (!habilitado) return undefined
    timerRef.current = setTimeout(persistir, debounceMs)
    return () => clearTimeout(timerRef.current)
  }, [snapshot, habilitado, persistir, debounceMs])

  // Flush al salir de la pantalla / ocultar / cerrar.
  useEffect(() => {
    montadoRef.current = true
    const alCambiarVisibilidad = () => { if (document.visibilityState === 'hidden') persistir() }
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    window.addEventListener('pagehide', persistir)
    return () => {
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
      window.removeEventListener('pagehide', persistir)
      montadoRef.current = false
      persistir()
    }
  }, [persistir])

  /** Elimina el borrador y bloquea nuevas escrituras (p. ej. tras guardar con éxito). */
  const descartar = useCallback(() => {
    pausadoRef.current = true
    clearTimeout(timerRef.current)
    timerRef.current = null
    firmaRef.current = null
    eliminarBorrador(scope)
    setUltimoGuardado(null)
    setErrorAlmacenamiento(false)
  }, [scope])

  /** Reanuda el autoguardado (al empezar un presupuesto nuevo). */
  const reanudar = useCallback(() => { pausadoRef.current = false }, [])

  return { ultimoGuardado, errorAlmacenamiento, descartar, reanudar }
}
