// src/hooks/useMetricasEstadisticas.js
// Carga de métricas con:
//  • stale-while-revalidate: al cambiar de filtro se MANTIENEN los datos previos
//    (atenuados) en vez de desmontar la pantalla → no se pierden filtros ni
//    modales abiertos.
//  • descarte de respuestas obsoletas (reqId): si el usuario cambia de período
//    dos veces rápido, solo la última respuesta se aplica. Sin esto, una
//    respuesta lenta del período anterior pisaba a la nueva (Escenario 7).
//  • mensaje de error genérico para el usuario; el detalle va al logger.

import { useCallback, useEffect, useRef, useState } from 'react'
import { obtenerMetricas } from '../services/estadisticasService'
import { logger } from '../lib/logger'

const MENSAJE_ERROR = 'No se pudieron cargar las métricas. Revisá tu conexión e intentá de nuevo.'

/**
 * @param {string} desde  'YYYY-MM-DD'
 * @param {string} hasta  'YYYY-MM-DD'
 */
export function useMetricasEstadisticas(desde, hasta) {
  const [estado, setEstado] = useState({ metricas: null, periodo: null, cargando: true, error: null })
  const reqRef = useRef(0)

  const cargar = useCallback(async () => {
    const id = ++reqRef.current
    setEstado((s) => ({ ...s, cargando: true, error: null }))
    try {
      const metricas = await obtenerMetricas(desde, hasta)
      if (id !== reqRef.current) return
      setEstado({ metricas, periodo: { desde, hasta }, cargando: false, error: null })
    } catch (err) {
      if (id !== reqRef.current) return
      logger.error('estadisticas.metricas_error', { error: err, desde, hasta })
      setEstado((s) => ({ ...s, cargando: false, error: MENSAJE_ERROR }))
    }
  }, [desde, hasta])

  useEffect(() => {
    cargar()
    return () => { reqRef.current += 1 } // invalida la respuesta en vuelo al cambiar/desmontar
  }, [cargar])

  return { ...estado, recargar: cargar }
}
