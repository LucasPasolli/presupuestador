// src/hooks/useSeleccionItems.js
// Estado de selección múltiple de ítems (casillas + "Seleccionar todos").
// Genérico y sin dependencias de UI: sirve para cualquier lista con id estable.

import { useCallback, useEffect, useMemo, useState } from 'react'

const idPorDefecto = (item) => item.idDetallePedido

/**
 * @template T
 * @param {T[]} items                 Lista completa (p. ej. detalles del pedido).
 * @param {(item:T)=>string|number} [getId]  Debe ser estable (definirla fuera del render).
 */
export function useSeleccionItems(items, getId = idPorDefecto) {
  const [seleccion, setSeleccion] = useState(() => new Set())

  // Ids vigentes, en el orden original de la lista.
  const ids = useMemo(() => items.map(getId), [items, getId])

  // Si la lista se recarga (p. ej. se editó el pedido), descartar ids que ya no existen.
  useEffect(() => {
    setSeleccion(prev => {
      if (prev.size === 0) return prev
      const vivos = new Set(ids)
      const next = new Set([...prev].filter(id => vivos.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [ids])

  const toggle = useCallback((id) => {
    setSeleccion(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const cantidad = seleccion.size
  const todos = ids.length > 0 && cantidad === ids.length

  const toggleTodos = useCallback(() => {
    setSeleccion(todos ? new Set() : new Set(ids))
  }, [todos, ids])

  return {
    seleccion,
    cantidad,
    total: ids.length,
    todos,
    /** Selección parcial (algunos, pero no todos). */
    parcial: cantidad > 0 && !todos,
    estaSeleccionado: (id) => seleccion.has(id),
    toggle,
    toggleTodos,
    /** Ids seleccionados en el orden original de la lista (no el de clic). */
    idsSeleccionados: ids.filter(id => seleccion.has(id)),
  }
}
