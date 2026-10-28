// src/hooks/useBreakpoint.js
// Fuente ÚNICA de verdad de los breakpoints del módulo de pedidos.
//
//   mobile  : ancho  < 768 px
//   tablet  : 768 px ≤ ancho ≤ 1024 px   (el 1024 exacto cuenta como tablet:
//                                          iPad horizontal + sidebar = poco lugar)
//   desktop : ancho  > 1024 px
//
// Decisiones de diseño
// ────────────────────
// • useSyncExternalStore (no useState + useEffect): el valor es correcto en el
//   PRIMER render (sin "flash" de layout de escritorio en el celular) y es
//   seguro con StrictMode / concurrent rendering.
// • Se escucha `matchMedia` (no `resize`): el navegador sólo avisa cuando se
//   CRUZA un umbral, así que rotar el equipo o redimensionar la ventana no
//   provoca re-renders intermedios.
// • Cruzar un umbral sólo cambia el valor devuelto; quien consume NO debe
//   desmontar su estado (filtros, borrador del formulario, etc.). Todo ese
//   estado vive en el padre y por eso sobrevive a la rotación.

import { useMemo, useSyncExternalStore } from 'react'

export const BREAKPOINTS = Object.freeze({ tablet: 768, desktop: 1025 })

const QUERY_TABLET  = `(min-width: ${BREAKPOINTS.tablet}px)`
const QUERY_DESKTOP = `(min-width: ${BREAKPOINTS.desktop}px)`

const hayMatchMedia = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'

/** @returns {'mobile'|'tablet'|'desktop'} */
export function leerBreakpoint() {
  // Sin matchMedia (SSR, tests sin mock): se asume escritorio, el layout "completo".
  if (!hayMatchMedia()) return 'desktop'
  if (window.matchMedia(QUERY_DESKTOP).matches) return 'desktop'
  if (window.matchMedia(QUERY_TABLET).matches)  return 'tablet'
  return 'mobile'
}

function subscribe(onChange) {
  if (!hayMatchMedia()) return () => {}
  const listas = [window.matchMedia(QUERY_TABLET), window.matchMedia(QUERY_DESKTOP)]
  listas.forEach((mql) => {
    // Safari < 14 sólo implementa addListener/removeListener.
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange)
    else mql.addListener?.(onChange)
  })
  return () => listas.forEach((mql) => {
    if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange)
    else mql.removeListener?.(onChange)
  })
}

/**
 * @returns {{
 *   breakpoint: 'mobile'|'tablet'|'desktop',
 *   isMobile: boolean,
 *   isTablet: boolean,
 *   isDesktop: boolean,
 *   isCompact: boolean   // mobile o tablet: layouts táctiles
 * }}
 */
export function useBreakpoint() {
  const breakpoint = useSyncExternalStore(subscribe, leerBreakpoint, () => 'desktop')
  return useMemo(() => ({
    breakpoint,
    isMobile:  breakpoint === 'mobile',
    isTablet:  breakpoint === 'tablet',
    isDesktop: breakpoint === 'desktop',
    isCompact: breakpoint !== 'desktop',
  }), [breakpoint])
}

export default useBreakpoint
