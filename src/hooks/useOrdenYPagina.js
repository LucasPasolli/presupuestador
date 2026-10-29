// src/hooks/useOrdenYPagina.js
// Orden por columna + paginación en memoria, para listados ya cargados
// (los modales de Estadísticas). Puro y sin efectos: el estado derivado se
// calcula con useMemo; la página se "clampa" en vez de corregirse con un efecto.

import { useCallback, useMemo, useState } from 'react'

function comparar(a, b) {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === 'string' || typeof b === 'string') {
    return String(a).localeCompare(String(b), 'es', { sensitivity: 'base' })
  }
  return a - b
}

/**
 * @template T
 * @param {T[]} items  Debe ser una referencia ESTABLE (no crear `[]` en cada render).
 * @param {object} [opts]
 * @param {number} [opts.pageSize=30]
 * @param {string|null} [opts.sortKey=null]  Sin clave → se respeta el orden original.
 * @param {'asc'|'desc'} [opts.sortDir='desc']
 */
export function useOrdenYPagina(items, { pageSize = 30, sortKey: keyInicial = null, sortDir: dirInicial = 'desc' } = {}) {
  const [pagina, setPagina] = useState(1)
  const [sortKey, setSortKey] = useState(keyInicial)
  const [sortDir, setSortDir] = useState(dirInicial)

  const ordenados = useMemo(() => {
    if (!sortKey) return items
    const signo = sortDir === 'asc' ? 1 : -1
    return [...items].sort((a, b) => signo * comparar(a[sortKey], b[sortKey]))
  }, [items, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(ordenados.length / pageSize))
  const page = Math.min(pagina, totalPages)
  const offset = (page - 1) * pageSize
  const pageItems = useMemo(() => ordenados.slice(offset, offset + pageSize), [ordenados, offset, pageSize])

  const toggleSort = useCallback((key) => {
    setPagina(1)
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      // Texto: A→Z primero; numéricos: el mayor primero.
      setSortDir(key === 'nombre' ? 'asc' : 'desc')
    }
  }, [sortKey])

  return {
    pageItems, items: ordenados, total: ordenados.length,
    page, setPage: setPagina, totalPages, pageSize, offset,
    sortKey, sortDir, toggleSort,
  }
}

export default useOrdenYPagina
