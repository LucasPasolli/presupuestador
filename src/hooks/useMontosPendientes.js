// src/hooks/useMontosPendientes.js
// Listado Debe/Haber = usePaginatedList (mode 'server') + useDebounce del proyecto.
// usePaginatedList ya garantiza: reload() sin resetear la página, reset a página 1
// al cambiar filtros y ajuste de página fuera de rango.

import { useCallback, useEffect, useState } from 'react'
import { usePaginatedList } from './usePaginatedList'
import { useDebounce } from './useDebounce'
import { listarMontosPendientes, PAGE_SIZE_DEFAULT } from '../services/clienteMontosService'

// Adaptador: el servicio devuelve { rows, total }; usePaginatedList espera { data, count }.
const fetcher = async ({ page, pageSize, estado, tipo, orden, busqueda }) => {
  const { rows, total } = await listarMontosPendientes({ page, pageSize, estado, tipo, orden, busqueda })
  return { data: rows, count: total }
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export function useMontosPendientes({ pageSize = PAGE_SIZE_DEFAULT } = {}) {
  const [estado, setEstado] = useState('pendiente') // 'pendiente' | 'confirmado' | '' (todos)
  const [tipo, setTipo] = useState('')
  const [orden, setOrden] = useState('desc')
  const [busqueda, setBusqueda] = useState('')     // lo que se ve en el input (sin lag)
  const busquedaDebounced = useDebounce(busqueda, 400)

  const list = usePaginatedList({
    fetcher,
    serverFilters: { estado, tipo, orden, busqueda: busquedaDebounced },
    pageSize,
    mode: 'server',
  })

  const limpiarFiltros = useCallback(() => { setEstado('pendiente'); setTipo(''); setBusqueda('') }, [])

  return {
    rows: list.pageItems,
    total: list.totalCount,
    page: list.page,
    pageSize: list.pageSize,
    loading: list.loading,
    error: list.error ? list.error.message : '',
    estado, tipo, orden, busqueda,
    hayFiltros: estado !== 'pendiente' || tipo !== '' || busquedaDebounced.trim() !== '',
    setPage: list.setPage, setEstado, setTipo, setOrden, setBusqueda, limpiarFiltros,
    refetch: list.reload,
  }
}
