// src/hooks/useScrollToTopOnChange.js
import { useCallback, useRef } from 'react'

/**
 * ────────────────────────────────────────────────────────────────────────
 * NOTA DE DISEÑO (v2)
 * ────────────────────────────────────────────────────────────────────────
 * La primera versión de este hook reposicionaba el scroll reactivamente,
 * dentro de un `useEffect` que escuchaba cambios en el número de página, y
 * usaba una bandera `isFirstRender` para no ejecutarse en el montaje.
 *
 * Ese enfoque es FRÁGIL:
 *  - Bajo `React.StrictMode` (activo por defecto en desarrollo con Vite/CRA),
 *    React invoca cada efecto DOS VECES al montar. La bandera "primer
 *    render" ya queda en `false` tras la primera invocación, así que la
 *    segunda dispara el scroll igual, aunque no hubo ninguna acción real
 *    del usuario.
 *  - Cualquier cosa que remonte el componente (por ejemplo, revelar la
 *    pantalla recién después de validar una contraseña) o que cambie la
 *    dependencia por una razón AJENA a la paginación (ej: `productos`
 *    cambia de referencia cuando termina de cargar la data) puede disparar
 *    el efecto sin que el usuario haya tocado "Siguiente"/"Anterior".
 *
 * SOLUCIÓN (v2): scroll 100% IMPERATIVO, atado al evento del usuario.
 * En lugar de "reaccionar" a que cambió `page`, el hook expone una función
 * `scrollToStart()` que cada botón de paginación llama explícitamente en su
 * propio `onClick`, junto con el cambio de página. Así el reposicionamiento
 * sólo puede ocurrir como consecuencia directa de un clic real, nunca por
 * el ciclo de vida de React (montaje, remontaje, StrictMode, carga de
 * datos, cambio de filtros, etc.).
 */

/**
 * useScrollAnchor
 * ────────────────────────────────────────────────────────────────────────
 * Para tablas que viven en el flujo normal de la página (no dentro de un
 * modal). Devuelve:
 *  - `anchorRef`: ref a poner en un <div> que envuelve la tabla/Card.
 *  - `scrollToStart()`: función a invocar en el onClick de "Siguiente" /
 *    "Anterior" / ir a página N. Usa `scrollIntoView`, que sólo desplaza el
 *    contenedor con scroll MÁS CERCANO (el <main> de la página), sin tocar
 *    encabezados, filtros ni sidebar.
 */
export function useScrollAnchor() {
  const anchorRef = useRef(null)

  const scrollToStart = useCallback(() => {
    const node = anchorRef.current
    if (!node) return

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    node.scrollIntoView({
      block: 'start',
      inline: 'nearest',
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    })
  }, [])

  return { anchorRef, scrollToStart }
}

/**
 * useResetScrollAnchor
 * ────────────────────────────────────────────────────────────────────────
 * Para listados paginados que YA viven dentro de su propio contenedor con
 * scroll interno (ej: el body de un modal con `overflow-y-auto`). Recibe el
 * `ref` ya existente de ese contenedor (no crea uno nuevo) y devuelve una
 * función `resetScroll()` que resetea su `scrollTop` a 0. Se invoca desde
 * el mismo `onClick` que cambia de página, nunca desde un `useEffect`.
 *
 * @param {React.RefObject} scrollableRef - ref del contenedor overflow-y-auto.
 */
export function useResetScrollAnchor(scrollableRef) {
  const resetScroll = useCallback(() => {
    const node = scrollableRef?.current
    if (!node) return

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (typeof node.scrollTo === 'function') {
      node.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
    } else {
      node.scrollTop = 0
    }
  }, [scrollableRef])

  return resetScroll
}
