// src/pages/Facturas.jsx
// Orquestador de la pantalla. Toda la lógica de dominio vive en lib/facturas.js
// y lib/facturasPdf.js; el layout responsive en components/facturas/*.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { obtenerFacturasConDetalles } from '../services/presupuestosService'
import { Card, PageHeader, Button, Spinner } from '../components/ui'
import { FileText, Download, WifiOff } from 'lucide-react'
import { logger } from '../lib/logger'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useEntregaPdf } from '../hooks/useEntregaPdf'
import {
  FILTROS_VACIOS, METODOS_EFECTIVO, METODOS_NO_EFECTIVO, agruparPresupuestos, contarFiltros,
  filtrarGrupos, firstOfMonth, today, validarPeriodo,
} from '../lib/facturas'
import PanelFiltros from '../components/facturas/PanelFiltros'
import ResumenPeriodo from '../components/facturas/ResumenPeriodo'
import ListadoFacturas from '../components/facturas/ListadoFacturas'
import { TOQUE } from '../components/facturas/estilos'

const TITULOS = {
  noEfectivo: { pantalla: 'Transferencia y Cuenta Corriente', pdf: 'Factura — Transferencia y Cuenta Corriente' },
  efectivo:   { pantalla: 'Efectivo',                         pdf: 'Factura — Efectivo' },
}

const COLOR_AVISO = {
  ok:    'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  error: 'text-red-400 bg-red-500/10 border-red-500/20',
}

export default function Facturas() {
  const online = useOnlineStatus()
  const [periodo,   setPeriodo]   = useState(() => ({ desde: firstOfMonth(), hasta: today() }))
  const [filtros,   setFiltros]   = useState(FILTROS_VACIOS)
  const [datos,     setDatos]     = useState(null)
  const [activeTab, setActiveTab] = useState('noEfectivo')   // 'noEfectivo' | 'efectivo'
  const [cargando,  setCargando]  = useState(false)
  const [error,     setError]     = useState('')
  const reqRef = useRef(0)   // descarta respuestas de consultas anteriores (red móvil: llegan desordenadas)

  const { descargar, generando, aviso } = useEntregaPdf()

  const buscar = useCallback(async (d, h) => {
    const msg = validarPeriodo(d, h)
    if (msg) { setError(msg); return false }

    setError('')
    const reqId = ++reqRef.current
    setCargando(true)
    try {
      const presupuestos = await obtenerFacturasConDetalles(d, h)
      if (reqId !== reqRef.current) return false
      setDatos({
        periodo:    { desde: d, hasta: h },
        noEfectivo: agruparPresupuestos(presupuestos, METODOS_NO_EFECTIVO),
        efectivo:   agruparPresupuestos(presupuestos, METODOS_EFECTIVO),
      })
      setPeriodo({ desde: d, hasta: h })   // sólo se compromete si la consulta salió bien
      return true
    } catch (e) {
      if (reqId !== reqRef.current) return false
      logger.error('facturas.carga_error', { error: e, desde: d, hasta: h })   // detalle técnico: sólo al log
      setError(typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'Sin conexión. Revisá tu internet e intentá de nuevo.'
        : 'No se pudieron cargar los datos. Reintentá en unos segundos.')
      return false
    } finally {
      if (reqId === reqRef.current) setCargando(false)
    }
  }, [])

  // Carga inicial con el período por defecto (mes actual).
  useEffect(() => { buscar(periodo.desde, periodo.hasta) }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const aplicar = useCallback(async ({ desde, hasta, filtros: f }) => {
    const msg = validarPeriodo(desde, hasta)
    if (msg) { setError(msg); return false }
    setFiltros(f)
    return buscar(desde, hasta)
  }, [buscar])

  const actualizar = useCallback(() => buscar(periodo.desde, periodo.hasta), [buscar, periodo])
  const limpiarFiltros = useCallback(() => setFiltros(FILTROS_VACIOS), [])

  // Lo que se ve es lo que se descarga: los filtros aplican a pantalla, resúmenes y PDF.
  const vista = useMemo(() => datos && ({
    noEfectivo: filtrarGrupos(datos.noEfectivo, filtros),
    efectivo:   filtrarGrupos(datos.efectivo,   filtros),
  }), [datos, filtros])

  const hayFiltros = contarFiltros(filtros) > 0

  const payload = (tipo) => ({
    grupos: vista[tipo],
    titulo: TITULOS[tipo].pdf,
    desde:  datos.periodo.desde,   // período REALMENTE consultado, no el que está tipeado
    hasta:  datos.periodo.hasta,
  })

  const tabActiva = vista ? vista[activeTab] : []

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6 min-w-0">
      <PageHeader title="Facturas" subtitle="Generar documento" />

      {!online && (
        <div role="status" className="flex items-start gap-2 text-yellow-400 text-base sm:text-sm bg-yellow-500/10
                                       border border-yellow-500/20 rounded-xl px-4 py-2.5 font-body">
          <WifiOff size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
          Sin conexión. Los datos mostrados pueden estar desactualizados.
        </div>
      )}

      <PanelFiltros desde={periodo.desde} hasta={periodo.hasta} filtros={filtros}
        cargando={cargando} error={error} onAplicar={aplicar} onActualizar={actualizar} />

      {!datos && cargando && (
        <div className="flex justify-center py-10"><Spinner label="Cargando comprobantes" /></div>
      )}

      {vista && (
        <div aria-busy={cargando} className="space-y-4 sm:space-y-6">
          <ResumenPeriodo datos={vista} activo={activeTab} onSeleccionar={setActiveTab}
            onDescargar={(tipo) => descargar(payload(tipo))} generando={generando} filtrado={hayFiltros} />

          <Card className="overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-surface-700 flex flex-col gap-3
                            min-[1025px]:flex-row min-[1025px]:items-center min-[1025px]:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <FileText size={16} className="text-brand-500 flex-shrink-0" aria-hidden="true" />
                <h3 className="font-body font-semibold text-white text-base min-[1025px]:text-sm break-words">
                  Vista previa — {TITULOS[activeTab].pantalla}
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:flex">
                <Button size="sm" icon={Download} className={TOQUE} loading={generando}
                  disabled={tabActiva.length === 0}
                  onClick={() => descargar(payload(activeTab))}>
                  {generando ? 'Generando…' : 'Descargar PDF'}
                </Button>
              </div>
            </div>

            {/* Región viva siempre montada: los lectores de pantalla anuncian los cambios. */}
            <div role="status" aria-live="polite">
              {aviso && (
                <p className={`mx-4 sm:mx-6 mt-4 px-4 py-2.5 rounded-xl border text-base sm:text-sm font-body ${COLOR_AVISO[aviso.tipo]}`}>
                  {aviso.texto}
                </p>
              )}
            </div>
            {hayFiltros && tabActiva.length > 0 && (
              <p className="mx-4 sm:mx-6 mt-4 text-surface-400 text-sm font-body">
                Hay filtros activos: el PDF incluye sólo lo que ves en pantalla.
              </p>
            )}

            <div className="p-3 sm:p-6">
              <ListadoFacturas grupos={tabActiva} titulo={TITULOS[activeTab].pantalla}
                hayFiltros={hayFiltros} onLimpiarFiltros={limpiarFiltros} />
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
