// src/hooks/useFiltrosEstadisticas.js
// Estado de los filtros de período de Estadísticas.
//
// Vive en el PADRE de toda la pantalla y nunca depende del breakpoint: rotar el
// dispositivo (o cruzar un umbral de ancho) re-renderiza pero no desmonta ni
// reinicia este estado → los filtros sobreviven (Escenario 6).

import { useCallback, useState } from 'react'
import { hoyISO, inicioDeMes, nMesesAtras, validarRango } from '../components/estadisticas/formatters'

/** `resolver` se evalúa en cada render: "hoy" nunca queda viejo si la pestaña queda abierta. */
export const RANGOS = Object.freeze([
  { id: 'mes', label: 'Este mes',      resolver: () => ({ desde: inicioDeMes(),   hasta: hoyISO() }) },
  { id: '3m',  label: 'Últ. 3 meses',  resolver: () => ({ desde: nMesesAtras(3),  hasta: hoyISO() }) },
  { id: '6m',  label: 'Últ. 6 meses',  resolver: () => ({ desde: nMesesAtras(6),  hasta: hoyISO() }) },
  { id: '12m', label: 'Últ. 12 meses', resolver: () => ({ desde: nMesesAtras(12), hasta: hoyISO() }) },
  { id: 'custom', label: 'Personalizado', resolver: null },
])

export const IDX_PERSONALIZADO = RANGOS.length - 1

/** @returns {{rangoIdx:number, desdeCustom:string, hastaCustom:string}} */
export const filtrosIniciales = () => ({ rangoIdx: 0, desdeCustom: '', hastaCustom: hoyISO() })

/** Convierte los filtros en un rango concreto { desde, hasta }. */
export function resolverRango(filtros) {
  if (filtros.rangoIdx !== IDX_PERSONALIZADO) return RANGOS[filtros.rangoIdx].resolver()
  return { desde: filtros.desdeCustom, hasta: filtros.hastaCustom }
}

/** Error de validación de un borrador de filtros (null si es válido). */
export function errorDeFiltros(filtros) {
  return filtros.rangoIdx === IDX_PERSONALIZADO ? validarRango(resolverRango(filtros)) : null
}

export function useFiltrosEstadisticas() {
  const [filtros, setFiltros] = useState(filtrosIniciales)
  const { desde, hasta } = resolverRango(filtros)

  const aplicar = useCallback((siguiente) => {
    // Un rango inválido nunca llega a consultarse.
    if (errorDeFiltros(siguiente)) return false
    setFiltros(siguiente)
    return true
  }, [])

  const limpiar = useCallback(() => setFiltros(filtrosIniciales()), [])

  return { filtros, desde, hasta, aplicar, limpiar }
}
