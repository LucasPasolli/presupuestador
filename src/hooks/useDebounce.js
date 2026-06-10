// src/hooks/useDebounce.js
import { useState, useEffect } from 'react'

/**
 * Retrasa la actualización de un valor hasta que el usuario deje de modificarlo.
 * Úsalo para inputs de búsqueda: evita disparar queries en cada keystroke.
 *
 * Patrón de uso correcto — mantener SIEMPRE dos estados separados:
 *   1. El estado del input (actualiza instantáneo, sin lag visual)
 *   2. El valor debounceado (dispara efectos/fetches)
 *
 * @example
 * const [search, setSearch] = useState('')
 * const debouncedSearch = useDebounce(search, 400)
 *
 * // El input usa `search` → sin lag
 * <input value={search} onChange={e => setSearch(e.target.value)} />
 *
 * // El fetch usa `debouncedSearch` → no se dispara en cada keystroke
 * useEffect(() => {
 *   if (!debouncedSearch) return
 *   fetchResults(debouncedSearch)
 * }, [debouncedSearch])
 *
 * @param {*}      value  Valor a debouncear (string, number, objeto, etc.)
 * @param {number} delay  Milisegundos de espera tras el último cambio (default: 400ms)
 * @returns El valor debounceado — solo se actualiza cuando `value` deja de
 *          cambiar durante `delay` ms consecutivos.
 */
export function useDebounce(value, delay = 400) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    // Cleanup: cancela el timer si `value` cambia antes de que expire.
    // Esto es lo que garantiza que solo se actualice cuando el usuario "pausa".
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
