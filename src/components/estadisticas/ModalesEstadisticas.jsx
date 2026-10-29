// src/components/estadisticas/ModalesEstadisticas.jsx
// Los cuatro listados de detalle de Estadísticas, ahora sobre piezas compartidas:
//   ResponsiveDialog (pantalla completa en táctil / modal en escritorio)
//   + TablaResponsive (tabla con scroll contenido o tarjetas expandibles)
//   + PaginadorTabla  (el mismo pie de paginación que usa Inventario)
//   + useOrdenYPagina (orden y página en memoria)
//
// Antes: 4 copias de la tabla, 4 de la paginación numerada y 4 de la cabecera.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BarChart2, Clock, Package } from 'lucide-react'
import ResponsiveDialog from '../ui/ResponsiveDialog'
import PaginadorTabla from '../ui/PaginadorTabla'
import TablaResponsive from './TablaResponsive'
import { useOrdenYPagina } from '../../hooks/useOrdenYPagina'
import { useResetScrollAnchor } from '../../hooks/useScrollToTopOnChange'
import { useDebounce } from '../../hooks/useDebounce'
import { obtenerTicketPromedioPorCliente } from '../../services/estadisticasService'
import { logger } from '../../lib/logger'
import { colorDemora, fmt, fmtDemora, fmtFecha } from './formatters'

const PAGE_SIZE = 30
const MAX_PRODUCTOS = 180
/** Referencia estable para los `?? []` (un array nuevo por render reiniciaría la página). */
const VACIO = Object.freeze([])

const Vacio = ({ children }) => (
  <div className="text-center py-16 px-6 text-surface-500 font-body text-sm">{children}</div>
)

function Rank({ n }) {
  const color = n === 1 ? 'text-yellow-400' : n === 2 ? 'text-surface-300' : n === 3 ? 'text-brand-400' : 'text-surface-600'
  return <span className={`font-mono text-xs font-bold ${color}`}>{n}</span>
}

/** Pie con paginador + reseteo de scroll del cuerpo del diálogo al cambiar de página. */
function usePaginadorDialogo(tabla, bodyRef) {
  const resetScroll = useResetScrollAnchor(bodyRef)
  return (
    <PaginadorTabla
      page={tabla.page} totalPages={tabla.totalPages} pageSize={tabla.pageSize} total={tabla.total}
      onChange={(p) => { tabla.setPage(p); resetScroll() }}
    />
  )
}

// ─── Artículos más vendidos ────────────────────────────────────────────────

export function ModalTopProductos({ open, onClose, productos = VACIO, desde, hasta }) {
  const bodyRef = useRef(null)
  const recortados = useMemo(() => productos.slice(0, MAX_PRODUCTOS), [productos])
  const tabla = useOrdenYPagina(recortados, { pageSize: PAGE_SIZE })
  useEffect(() => { if (open) tabla.setPage(1) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const footer = usePaginadorDialogo(tabla, bodyRef)

  const columnas = useMemo(() => [
    { key: 'rank', label: '#', rol: 'rank', render: (_, { rank }) => <Rank n={rank} /> },
    { key: 'idProducto', label: 'ID', rol: 'detalle',
      render: (p) => <span className="text-surface-500 font-mono text-xs">{p.idProducto ?? '—'}</span> },
    { key: 'nombre', label: 'Producto', rol: 'titulo',
      render: (p, { rank }) => (
        <span className={`${rank <= 3 ? 'text-white font-medium' : 'text-surface-200'} break-words`}>{p.nombre}</span>
      ) },
    { key: 'unidades', label: 'Unidades', align: 'right', rol: 'clave',
      render: (p, { rank }) => (
        <span className={`font-mono font-bold ${rank <= 3 ? 'text-brand-400' : 'text-surface-200'}`}>{p.unidades} u.</span>
      ) },
    { key: 'monto', label: 'Monto acumulado', align: 'right', rol: 'clave',
      render: (p) => <span className="font-mono text-surface-200">{fmt(p.monto)}</span> },
  ], [])

  const hayMas = productos.length > MAX_PRODUCTOS
  return (
    <ResponsiveDialog open={open} onClose={onClose} icon={Package} title="Artículos más vendidos"
      subtitle={`${fmtFecha(desde)} → ${fmtFecha(hasta)} · ${hayMas ? `Mostrando los ${MAX_PRODUCTOS} más vendidos de ${productos.length}` : `${productos.length} productos`}`}
      bodyRef={bodyRef} footer={footer}>
      {productos.length === 0
        ? <Vacio>Sin ventas en el período seleccionado.</Vacio>
        : <TablaResponsive caption="Artículos más vendidos" columnas={columnas} filas={tabla.pageItems}
            offset={tabla.offset} getKey={(p, i) => `${p.idProducto ?? p.nombre}-${tabla.offset + i}`} />}
    </ResponsiveDialog>
  )
}

// ─── Productos con datos incompletos ───────────────────────────────────────

const Pastilla = ({ clase, children }) => (
  <span className={`text-[11px] font-body px-2 py-0.5 rounded-full border ${clase}`}>{children}</span>
)

export function ModalProductosIncompletos({ open, onClose, productos = VACIO }) {
  const bodyRef = useRef(null)
  const tabla = useOrdenYPagina(productos, { pageSize: PAGE_SIZE })
  useEffect(() => { if (open) tabla.setPage(1) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const footer = usePaginadorDialogo(tabla, bodyRef)

  const columnas = useMemo(() => [
    { key: 'nombre', label: 'Producto', rol: 'titulo',
      render: (p) => <span className="text-surface-200 break-words">{p.nombre}</span> },
    { key: 'cantidad', label: 'Stock', align: 'right', rol: 'clave',
      render: (p) => <span className="font-mono text-surface-300">{p.cantidad}</span> },
    { key: 'falta', label: 'Falta precio de', align: 'center', rol: 'clave',
      render: (p) => (
        <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
          {p.sinPrecioProveedor && <Pastilla clase="bg-red-500/10 border-red-500/30 text-red-400">Proveedor</Pastilla>}
          {p.sinPrecioVenta && <Pastilla clase="bg-yellow-500/10 border-yellow-500/30 text-yellow-400">Venta</Pastilla>}
        </span>
      ) },
  ], [])

  const n = productos.length
  return (
    <ResponsiveDialog open={open} onClose={onClose} icon={AlertTriangle} iconClassName="text-yellow-500"
      title="Productos con datos incompletos"
      subtitle={`${n} producto${n !== 1 ? 's' : ''} con stock activo y precio de proveedor y/o venta sin cargar — se contaron como $0 en esa valorización`}
      bodyRef={bodyRef} footer={footer}>
      {n === 0
        ? <Vacio>Todos los productos activos tienen ambos precios cargados.</Vacio>
        : <TablaResponsive caption="Productos con datos incompletos" columnas={columnas} filas={tabla.pageItems}
            offset={tabla.offset} getKey={(p, i) => `${p.idProducto ?? p.nombre}-${tabla.offset + i}`} />}
    </ResponsiveDialog>
  )
}

// ─── Demora de pago por cliente ────────────────────────────────────────────

const nombreCliente = (c) => `${c.nombre}${c.apodo ? ` (${c.apodo})` : ''}`

export function ModalDemoraClientes({ open, onClose, clientes = VACIO }) {
  const bodyRef = useRef(null)
  const tabla = useOrdenYPagina(clientes, { pageSize: PAGE_SIZE, sortKey: 'demoraPromedioDias', sortDir: 'desc' })
  useEffect(() => { if (open) tabla.setPage(1) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const footer = usePaginadorDialogo(tabla, bodyRef)

  const columnas = useMemo(() => [
    { key: 'rank', label: '#', rol: 'rank', render: (_, { rank }) => <Rank n={rank} /> },
    { key: 'nombre', label: 'Cliente', rol: 'titulo', sortable: true,
      render: (c) => <span className="text-surface-200 break-words">{nombreCliente(c)}</span> },
    { key: 'cantPagos', label: 'Pagos CC', align: 'right', rol: 'detalle', sortable: true,
      render: (c) => <span className="text-surface-300 font-mono">{c.cantPagos}</span> },
    { key: 'demoraPromedioDias', label: 'Demora prom.', align: 'right', rol: 'clave', sortable: true,
      render: (c) => (
        <span className={`font-mono font-bold px-2 py-0.5 rounded-lg border text-xs whitespace-nowrap ${colorDemora(c.demoraPromedioDias)}`}>
          {fmtDemora(c.demoraPromedioDias)}
        </span>
      ) },
    { key: 'demoraMaximaDias', label: 'Demora máx.', align: 'right', rol: 'detalle', sortable: true,
      render: (c) => <span className="text-surface-400 font-mono text-xs">{fmtDemora(c.demoraMaximaDias)}</span> },
  ], [])

  const n = clientes.length
  return (
    <ResponsiveDialog open={open} onClose={onClose} icon={Clock} iconClassName="text-yellow-500"
      title="Demora de pago por cliente"
      subtitle={`${n} cliente${n !== 1 ? 's' : ''} con Cuenta Corriente cobrada · histórico completo · tocá una columna para ordenar`}
      bodyRef={bodyRef} footer={footer}>
      {n === 0
        ? <Vacio>Todavía no hay saldos de Cuenta Corriente cobrados con fecha de vencimiento registrada — la demora de pago se calcula solo sobre deuda ya saldada.</Vacio>
        : <TablaResponsive caption="Demora de pago por cliente" columnas={columnas} filas={tabla.pageItems}
            offset={tabla.offset} getKey={(c) => c.idCliente} sortKey={tabla.sortKey} sortDir={tabla.sortDir}
            onSort={tabla.toggleSort} />}
    </ResponsiveDialog>
  )
}

// ─── Ticket promedio por cliente (carga bajo demanda) ──────────────────────
// El padre le pasa una `key` nueva en cada apertura: React monta una instancia
// limpia (búsqueda vacía, debounce sin arrastrar el término anterior).

export function ModalTicketPromedioClientes({ open, onClose, desde, hasta, formatoMonto }) {
  const bodyRef = useRef(null)
  const [datos, setDatos] = useState(VACIO)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const busquedaEfectiva = useDebounce(busqueda.trim(), 400)
  const reqRef = useRef(0)

  const tabla = useOrdenYPagina(datos, { pageSize: PAGE_SIZE, sortKey: 'ticketPromedio', sortDir: 'desc' })
  const footer = usePaginadorDialogo(tabla, bodyRef)

  const cargarDatos = useCallback((termino) => {
    if (!desde || !hasta) return
    const id = ++reqRef.current // descarta respuestas de búsquedas anteriores
    setCargando(true)
    setError(null)
    obtenerTicketPromedioPorCliente(desde, hasta, termino)
      .then((r) => { if (id === reqRef.current) setDatos(r) })
      .catch((e) => {
        if (id !== reqRef.current) return
        logger.error('estadisticas.ticket_promedio_error', { error: e })
        setError('No se pudo cargar el detalle por cliente. Intentá de nuevo.')
      })
      .finally(() => { if (id === reqRef.current) setCargando(false) })
  }, [desde, hasta])

  useEffect(() => {
    if (!open) return
    tabla.setPage(1)
    cargarDatos(busquedaEfectiva)
  }, [open, desde, hasta, busquedaEfectiva, cargarDatos]) // eslint-disable-line react-hooks/exhaustive-deps

  const columnas = useMemo(() => [
    { key: 'rank', label: '#', rol: 'rank', render: (_, { rank }) => <Rank n={rank} /> },
    { key: 'nombre', label: 'Cliente', rol: 'titulo', sortable: true,
      render: (c) => <span className="text-surface-200 break-words">{nombreCliente(c)}</span> },
    { key: 'presupuestos', label: 'Tickets', align: 'right', rol: 'clave', sortable: true,
      render: (c) => <span className="text-surface-300 font-mono">{c.presupuestos}</span> },
    { key: 'ticketPromedio', label: 'Ticket promedio', align: 'right', rol: 'clave', sortable: true,
      render: (c) => (
        <span className={`font-mono font-bold ${c.presupuestos === 0 ? 'text-surface-500' : 'text-blue-400'}`}>
          {formatoMonto(c.ticketPromedio)}
        </span>
      ) },
  ], [formatoMonto])

  const cargandoInicial = cargando && datos.length === 0
  const n = tabla.total

  const toolbar = (
    <>
      <label htmlFor="buscar-cliente-ticket" className="sr-only">Buscar cliente por nombre</label>
      <input id="buscar-cliente-ticket" type="search" inputMode="search" enterKeyHint="search"
        value={busqueda} onChange={(e) => setBusqueda(e.target.value)} autoComplete="off"
        placeholder="Buscar cliente por nombre o apodo…"
        className="w-full min-h-[44px] min-[1025px]:min-h-0 bg-surface-700 border border-surface-600 rounded-xl px-3 py-2
                   text-white text-base min-[1025px]:text-sm font-body focus:outline-none focus:border-brand-500
                   placeholder:text-surface-500" />
    </>
  )

  return (
    <ResponsiveDialog open={open} onClose={onClose} icon={BarChart2} iconClassName="text-blue-400"
      title="Ticket promedio por cliente" bodyRef={bodyRef} toolbar={toolbar} busy={cargando}
      subtitle={cargandoInicial ? 'Calculando…'
        : `${n} cliente${n !== 1 ? 's' : ''}${busquedaEfectiva ? ` · filtrado por "${busquedaEfectiva}"` : ''}${cargando ? ' · Buscando…' : ''}`}
      footer={!cargandoInicial && !error ? footer : null}>
      {cargandoInicial ? (
        <div className="flex items-center justify-center py-16" role="status">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <span className="sr-only">Cargando ticket promedio por cliente…</span>
        </div>
      ) : error ? (
        <div className="text-center py-16 px-6" role="alert">
          <p className="text-red-400 font-body text-sm mb-3">{error}</p>
          <button type="button" onClick={() => cargarDatos(busquedaEfectiva)}
            className="min-h-[44px] px-4 rounded-xl text-sm font-body border border-surface-600 text-surface-200
                       hover:border-brand-500/50 hover:text-white transition-all">
            Reintentar
          </button>
        </div>
      ) : n === 0 ? (
        <Vacio>{busquedaEfectiva ? `Sin resultados para "${busquedaEfectiva}".` : 'No hay clientes activos para mostrar.'}</Vacio>
      ) : (
        <div className={`transition-opacity ${cargando ? 'opacity-50 pointer-events-none' : ''}`}>
          <TablaResponsive caption="Ticket promedio por cliente" columnas={columnas} filas={tabla.pageItems}
            offset={tabla.offset} getKey={(c, i) => c.idCliente ?? `sin-cliente-${tabla.offset + i}`}
            sortKey={tabla.sortKey} sortDir={tabla.sortDir} onSort={tabla.toggleSort} />
        </div>
      )}
    </ResponsiveDialog>
  )
}
