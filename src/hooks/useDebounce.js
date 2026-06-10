// src/hooks/useDebounce.js
import { useState, useEffect } from 'react'

/**
 * Retrasa la actualización de un valor hasta que el usuario deje de modificarlo.
 * Úsalo para inputs de búsqueda: evita disparar queries en cada keystroke.
 *
 * @param {*}      value  Valor a debouncear (string, number, etc.)
 * @param {number} delay  Milisegundos de espera (default: 400ms)
 * @returns El valor debounceado
 *
 * @example
 * const [search, setSearch] = useState('')
 * const debouncedSearch = useDebounce(search, 400)
 * // Usar debouncedSearch como dependencia de useCallback/useEffect,
 * // y search para el value del input.
 */
export function useDebounce(value, delay = 400) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
