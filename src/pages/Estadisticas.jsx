// src/pages/Estadisticas.jsx
import { useState, useEffect, useCallback } from 'react'
import { obtenerMetricas } from '../services/estadisticasService'
import { Card, PageHeader, Button } from '../components/ui'
import {
  TrendingUp, TrendingDown, Wallet, Clock, Users, Package,
  BarChart2, CreditCard, Tag, AlertTriangle, RefreshCw,
  ShoppingCart, Layers, Repeat, Truck, PieChart, CheckCircle, PiggyBank
} from 'lucide-react'

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)
}

function fmtCompacto(n) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`
  return fmt(n)
}

function pct(a, b) {
  if (!b) return '—'
  return `${((a / b) * 100).toFixed(1)}%`
}

function today() { return new Date().toISOString().slice(0, 10) }

function nMesesAtras(n) {
  const d = new Date()
  d.setMonth(d.getMonth() - n + 1)
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

// ─── KPI Card ──────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color = 'brand', trend }) {
  const colors = {
    brand:   'text-brand-400  bg-brand-500/10  border-brand-500/20',
    green:   'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    yellow:  'text-yellow-400  bg-yellow-500/10  border-yellow-500/20',
    red:     'text-red-400     bg-red-500/10     border-red-500/20',
    blue:    'text-blue-400    bg-blue-500/10    border-blue-500/20',
    violet:  'text-violet-400  bg-violet-500/10  border-violet-500/20',
  }
  return (
    <div className={`
      rounded-2xl p-5 flex flex-col gap-3 border transition-all
      ${label === 'Resultado operativo'
        ? value.includes('-')
          ? 'bg-red-500/10 border-red-500/40 shadow-[0_0_25px_rgba(239,68,68,0.15)]'
          : 'bg-emerald-500/10 border-emerald-500/40 shadow-[0_0_25px_rgba(16,185,129,0.18)]'
        : 'bg-surface-800 border-surface-700'
      }
    `}>
      <div className="flex items-center justify-between">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${colors[color]}`}>
          <Icon size={17} />
        </div>
        {trend !== undefined && (
          <span className={`text-xs font-mono ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <div>
        <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">{label}</p>
        <p className={`font-display text-3xl tracking-widest ${colors[color].split(' ')[0]}`}>{value}</p>
        {sub && <p className="text-surface-500 text-xs font-body mt-1">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Barra horizontal simple (sin librería) ────────────────────────────────

function BarraH({ label, value, max, fmtFn = fmt, color = '#f97316', sublabel }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs font-body">
        <span className="text-surface-200 truncate max-w-[55%]" title={label}>{label}</span>
        <div className="text-right">
          <span className="text-white font-mono">{fmtFn(value)}</span>
          {sublabel && <span className="text-surface-500 ml-2">{sublabel}</span>}
        </div>
      </div>
      <div className="h-2 bg-surface-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

// ─── Modal: lista completa de artículos más vendidos ──────────────────────

const PAGE_SIZE = 30

function ModalTopProductos({ open, onClose, productos, desde, hasta }) {
  const [pagina, setPagina] = useState(1)

  // Reset page when modal opens
  useEffect(() => { if (open) setPagina(1) }, [open])

  if (!open) return null

  const MAX_PRODUCTOS = 180
  const productosMostrados = productos.slice(0, MAX_PRODUCTOS)
  const hayMas = productos.length > MAX_PRODUCTOS

  const totalPaginas = Math.ceil(productosMostrados.length / PAGE_SIZE)
  const inicio       = (pagina - 1) * PAGE_SIZE
  const pagItems     = productosMostrados.slice(inicio, inicio + PAGE_SIZE)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75" onClick={onClose} />
      <div className="relative bg-surface-800 border border-surface-700 rounded-2xl shadow-2xl
                      w-full max-w-3xl animate-slide-up flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-surface-700 flex-shrink-0">
          <div>
            <h2 className="font-body font-semibold text-white flex items-center gap-2">
              <Package size={16} className="text-brand-500" />
              Artículos más vendidos
            </h2>
            <p className="text-surface-500 text-xs font-body mt-0.5">
              {desde} → {hasta} · {hayMas ? `Mostrando los 180 más vendidos de ${productos.length}` : `${productos.length} productos`}
            </p>
          </div>
          <button onClick={onClose}
            className="text-surface-400 hover:text-white transition-colors text-2xl leading-none w-8 h-8
                       flex items-center justify-center rounded-lg hover:bg-surface-700">
            ×
          </button>
        </div>

        {/* Tabla */}
        <div className="overflow-y-auto flex-1">
          {productos.length === 0 ? (
            <div className="text-center py-16 text-surface-500 font-body text-sm">
              Sin ventas en el período seleccionado.
            </div>
          ) : (
            <table className="w-full text-sm font-body">
              <thead className="sticky top-0 bg-surface-800 z-10">
                <tr className="border-b border-surface-700">
                  <th className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 w-10">#</th>
                  <th className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 w-20">ID</th>
                  <th className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4">Producto</th>
                  <th className="text-right text-surface-400 text-xs tracking-widest uppercase py-3 px-4 w-28">Unidades</th>
                  <th className="text-right text-surface-400 text-xs tracking-widest uppercase py-3 px-4 w-36">Monto acumulado</th>
                </tr>
              </thead>
              <tbody>
                {pagItems.map((p, i) => {
                  const rank = inicio + i + 1
                  const esTop3 = rank <= 3
                  return (
                    <tr key={i}
                      className="border-b border-surface-700/40 last:border-0 hover:bg-surface-700/30 transition-colors">
                      <td className="py-3 px-4">
                        <span className={`font-mono text-xs font-bold
                          ${rank === 1 ? 'text-yellow-400' :
                            rank === 2 ? 'text-surface-300' :
                            rank === 3 ? 'text-brand-400' : 'text-surface-600'}`}>
                          {rank}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-surface-500 font-mono text-xs">
                          {p.idProducto ?? '—'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`${esTop3 ? 'text-white font-medium' : 'text-surface-200'} truncate block max-w-xs`}
                          title={p.nombre}>
                          {p.nombre}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className={`font-mono font-bold ${esTop3 ? 'text-brand-400' : 'text-surface-200'}`}>
                          {p.unidades} u.
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="font-mono text-surface-200">{fmt(p.monto)}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Paginación */}
        {totalPaginas > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-surface-700 flex-shrink-0">
            <span className="text-surface-500 text-xs font-body">
              Página {pagina} de {totalPaginas} · {productosMostrados.length} artículos
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPagina(1)} disabled={pagina === 1}
                className="px-2.5 py-1.5 rounded-lg text-xs font-body text-surface-400
                           hover:bg-surface-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                «
              </button>
              <button onClick={() => setPagina(v => Math.max(1, v - 1))} disabled={pagina === 1}
                className="px-3 py-1.5 rounded-lg text-xs font-body text-surface-400
                           hover:bg-surface-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                ‹ Ant.
              </button>

              {/* Páginas cercanas */}
              {Array.from({ length: totalPaginas }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPaginas || Math.abs(p - pagina) <= 2)
                .reduce((acc, p, idx, arr) => {
                  if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…')
                  acc.push(p)
                  return acc
                }, [])
                .map((item, idx) =>
                  item === '…' ? (
                    <span key={`sep-${idx}`} className="px-2 text-surface-600 text-xs">…</span>
                  ) : (
                    <button key={item} onClick={() => setPagina(item)}
                      className={`w-8 h-8 rounded-lg text-xs font-body font-medium transition-all
                        ${item === pagina
                          ? 'bg-brand-500 text-white'
                          : 'text-surface-400 hover:bg-surface-700 hover:text-white'}`}>
                      {item}
                    </button>
                  )
                )}

              <button onClick={() => setPagina(v => Math.min(totalPaginas, v + 1))} disabled={pagina === totalPaginas}
                className="px-3 py-1.5 rounded-lg text-xs font-body text-surface-400
                           hover:bg-surface-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                Sig. ›
              </button>
              <button onClick={() => setPagina(totalPaginas)} disabled={pagina === totalPaginas}
                className="px-2.5 py-1.5 rounded-lg text-xs font-body text-surface-400
                           hover:bg-surface-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                »
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Gráfico de dona genérico (reemplaza GraficoMensual) ──────────────────

function GraficoDonaGenerico({ datos, colores }) {
  const COLORS = colores ?? ['#f97316','#3b82f6','#eab308','#10b981','#8b5cf6','#ec4899','#14b8a6','#f43f5e']
  if (!datos.length || datos.every(d => d.valor === 0)) return (
    <div className="flex items-center justify-center h-32 text-surface-500 text-sm font-body">Sin datos.</div>
  )
  const total = datos.reduce((a, d) => a + d.valor, 0)
  const R = 50, CX = 65, CY = 65
  let angle = -Math.PI / 2
  const slices = datos.map((d, i) => {
    const frac = d.valor / total
    const start = angle
    angle += frac * 2 * Math.PI
    const end = angle
    const x1 = CX + R * Math.cos(start), y1 = CY + R * Math.sin(start)
    const x2 = CX + R * Math.cos(end),   y2 = CY + R * Math.sin(end)
    const large = frac > 0.5 ? 1 : 0
    return { ...d, path: `M${CX},${CY} L${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} Z`,
             color: COLORS[i % COLORS.length], frac }
  })
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 130 130" className="w-32 h-32 flex-shrink-0">
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} fillOpacity="0.9" stroke="#1a1a1a" strokeWidth="1.5" />
        ))}
        <circle cx={CX} cy={CY} r={R * 0.55} fill="#1a1a1a" />
        <text x={CX} y={CY + 4} textAnchor="middle" fontSize="9" fill="#a3a3a3" fontFamily="DM Sans">
          {datos.length} items
        </text>
      </svg>
      <div className="space-y-1.5 flex-1">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-xs font-body">
            <span className="flex items-center gap-2 text-surface-300 truncate max-w-[55%]">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="text-white font-mono">{(s.frac * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Dona de métodos de pago (SVG) ─────────────────────────────────────────

function GraficoDona({ datos }) {
  if (!datos.length || datos.every(d => d.monto === 0)) return (
    <div className="flex items-center justify-center h-32 text-surface-500 text-sm font-body">
      Sin datos.
    </div>
  )

  const total  = datos.reduce((a, d) => a + d.monto, 0)
  const COLORS = ['#f97316','#3b82f6','#eab308','#10b981','#8b5cf6']
  const R      = 50
  const CX     = 65
  const CY     = 65

  let angle = -Math.PI / 2
  const slices = datos.map((d, i) => {
    const frac  = d.monto / total
    const start = angle
    angle += frac * 2 * Math.PI
    const end   = angle
    const x1    = CX + R * Math.cos(start)
    const y1    = CY + R * Math.sin(start)
    const x2    = CX + R * Math.cos(end)
    const y2    = CY + R * Math.sin(end)
    const large = frac > 0.5 ? 1 : 0
    return { ...d, path: `M${CX},${CY} L${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} Z`,
             color: COLORS[i % COLORS.length], frac }
  })

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 130 130" className="w-32 h-32 flex-shrink-0">
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} fillOpacity="0.9" stroke="#1a1a1a" strokeWidth="1.5" />
        ))}
        <circle cx={CX} cy={CY} r={R * 0.55} fill="#1a1a1a" />
        <text x={CX} y={CY + 4} textAnchor="middle" fontSize="9" fill="#a3a3a3" fontFamily="DM Sans">
          {datos.length} métodos
        </text>
      </svg>
      <div className="space-y-2 flex-1">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-xs font-body">
            <span className="flex items-center gap-2 text-surface-300">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="text-white font-mono">{(s.frac * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}


// ─── Componente principal ──────────────────────────────────────────────────

const RANGOS = [
  { label: 'Este mes',       desde: () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01` }, hasta: today },
  { label: 'Últ. 3 meses',  desde: () => nMesesAtras(3),  hasta: today },
  { label: 'Últ. 6 meses',  desde: () => nMesesAtras(6),  hasta: today },
  { label: 'Últ. 12 meses', desde: () => nMesesAtras(12), hasta: today },
  { label: 'Personalizado',  desde: null, hasta: null },
]

export default function Estadisticas() {
  const [mostrarExacto, setMostrarExacto] = useState(false)
  const [rangoIdx,  setRangoIdx]  = useState(0)
  const [desdeCustom, setDesdeCustom] = useState('')
  const [hastaCustom, setHastaCustom] = useState(today())
  const [metricas,       setMetricas]       = useState(null)
  const [cargando,       setCargando]       = useState(false)
  const [modalProductos, setModalProductos] = useState(false)

  const desde = rangoIdx < 4 ? RANGOS[rangoIdx].desde() : desdeCustom
  const hasta = rangoIdx < 4 ? RANGOS[rangoIdx].hasta() : hastaCustom

  const cargar = useCallback(async () => {
    if (!desde || !hasta) return
    setCargando(true)
    try {
      const resultado = await obtenerMetricas(desde, hasta)
      setMetricas(resultado)
    } catch(e) {
      console.error('Error calculando métricas:', e)
    } finally {
      setCargando(false)
    }
  }, [desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  if (!metricas || cargando) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const m = metricas
  const formatoMonto = mostrarExacto ? fmt : fmtCompacto
  const maxProducto = m.topProductos[0]?.unidades ?? 1
  const maxCliente  = m.topClientes[0]?.monto ?? 1

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader title="Estadísticas" subtitle="Panel de métricas"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setMostrarExacto(v => !v)}
            >
              {mostrarExacto ? 'Ver montos resumidos' : 'Ver montos exactos'}
            </Button>
          </div>
        }
      />

      {/* Selector de rango */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-2 items-center">
          {RANGOS.map((r, i) => (
            <button key={i} onClick={() => setRangoIdx(i)}
              className={`px-4 py-2 rounded-xl text-sm font-body transition-all border
                ${rangoIdx === i
                  ? 'bg-brand-500/15 border-brand-500/40 text-white'
                  : 'bg-surface-700 border-surface-600 text-surface-400 hover:border-surface-500'}`}>
              {r.label}
            </button>
          ))}

          {rangoIdx === 4 && (
            <div className="flex items-center gap-2 ml-2">
              <input type="date" value={desdeCustom} onChange={e => setDesdeCustom(e.target.value)}
                className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                           font-body focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
              <span className="text-surface-500 text-sm">→</span>
              <input type="date" value={hastaCustom} onChange={e => setHastaCustom(e.target.value)}
                className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                           font-body focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
              <button
                onClick={() => { setRangoIdx(0); setDesdeCustom(''); setHastaCustom(today()) }}
                className="px-3 py-2 rounded-xl text-sm font-body border bg-surface-700 border-surface-600
                           text-surface-400 hover:border-red-500/50 hover:text-red-400 transition-all"
              >
                Limpiar Filtros
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* ── KPIs principales ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon={TrendingUp}  label="Presupuestado"       value={formatoMonto(m.facturadoTotal)}   color="brand"
          sub={`${m.totalPresupuestos} presupuesto${m.totalPresupuestos!==1?'s':''}`} />
        <KpiCard icon={Wallet}      label="Cobrado real"    value={formatoMonto(m.cobradoReal)}       color="green"
          sub={`${pct(m.cobradoReal, m.facturadoTotal)} del total`} />
        <KpiCard icon={TrendingDown} label="Egresos pagados" value={formatoMonto(m.egresosTotal)} color="red"
          sub={`pedidos ${formatoMonto(m.egresosPedidos)} · extra ${formatoMonto(m.egresosExtra)}`} />
        <KpiCard icon={m.resultadoEstimado >= 0 ? TrendingUp : TrendingDown}
          label="Resultado operativo" value={formatoMonto(m.resultadoEstimado)}
          color={m.resultadoEstimado >= 0 ? 'green' : 'red'}
          sub="ventas + ingresos − egresos" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon={Clock} label="Pedidos pendientes" color="yellow"
          value={formatoMonto(m.pedidosPendientes)}
          sub="deuda con proveedores" />
        <KpiCard icon={Clock}       label="Saldos Pendientes CC"    value={formatoMonto(m.pendienteCC)}       color="yellow"
          sub="Saldos sin cobrar" />
        <KpiCard icon={Tag}         label="Descuentos dados" value={formatoMonto(m.descuentosOtorgados)} color="yellow"
          sub={`${pct(m.descuentosOtorgados, m.facturadoTotal + m.descuentosOtorgados - m.recargosCC)} del precio de lista`} />
        <KpiCard icon={AlertTriangle} label="Stock crítico" color="yellow"
          value={m.cantidadStockCritico}
          sub="productos bajo punto de repo." />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon={PiggyBank}   label="Dinero invertido"  value={formatoMonto(m.dineroInvertido)} color="violet"
          sub="neto activo (global)" />
        <KpiCard icon={TrendingUp}  label="Ingresos extra"    value={formatoMonto(m.ingresosExtra)}  color="green"
          sub="FCI, plazo fijo, etc." />
        <KpiCard icon={BarChart2}   label="Ticket promedio" value={formatoMonto(m.ticketPromedio)}    color="blue"
          sub="por presupuesto" />
        <KpiCard icon={Users}       label="Clientes únicos"  value={m.clientesUnicos}               color="blue"
          sub="en el período" />
      </div>

      {/* ── 1. Métodos de Pago + Egresos por categoría ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6">
          <h3 className="font-body font-semibold text-white text-sm mb-5 flex items-center gap-2">
            <CreditCard size={15} className="text-brand-500" />
            Métodos de Pago
          </h3>
          <GraficoDona datos={m.mixMetodos} />
          <div className="mt-4 space-y-2">
            {m.mixMetodos.map(mp => (
              <div key={mp.value} className="flex justify-between text-xs font-body">
                <span className="text-surface-400">{mp.label}</span>
                <span className="text-white font-mono">{fmt(mp.monto)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-body font-semibold text-white text-sm mb-5 flex items-center gap-2">
            <PieChart size={15} className="text-brand-500" />
            Egresos por categoría
          </h3>
          {m.egresosPorCategoria.length === 0 ? (
            <p className="text-surface-500 text-sm font-body">Sin egresos en el período.</p>
          ) : (
            <>
              <GraficoDonaGenerico
                datos={m.egresosPorCategoria.map(e => ({ label: e.label, valor: e.monto }))}
              />
              <div className="mt-4 space-y-1.5">
                {m.egresosPorCategoria.slice(0, 5).map((e, i) => (
                  <div key={i} className="flex justify-between text-xs font-body">
                    <span className="text-surface-400 truncate">{e.label}</span>
                    <span className="text-white font-mono">{formatoMonto(e.monto)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── Modal top artículos ── */}
      <ModalTopProductos
        open={modalProductos}
        onClose={() => setModalProductos(false)}
        productos={m.todosProductosVendidos ?? []}
        desde={desde}
        hasta={hasta}
      />

      {/* ── 2. Top artículos más vendidos + Top clientes ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6 overflow-hidden">
          <div
            className="cursor-pointer -m-6 p-6 hover:bg-brand-500/5 transition-all duration-200 group"
            onClick={() => setModalProductos(true)}
          >
          <h3 className="font-body font-semibold text-white text-sm mb-1 flex items-center gap-2">
            <Package size={15} className="text-brand-500" />
            Top artículos más vendidos
            <span className="ml-auto text-brand-500/70 text-xs font-body font-normal
                             group-hover:text-brand-400 transition-colors flex items-center gap-1">
              Ver todos →
            </span>
          </h3>
          <p className="text-surface-500 text-xs font-body mb-4">
            Top 10 · cliqueá para ver la lista completa ({m.todosProductosVendidos?.length ?? 0} artículos)
          </p>
          {m.topProductos.length === 0 ? (
            <p className="text-surface-500 text-sm font-body">Sin ventas en el período.</p>
          ) : (
            <div className="space-y-3">
              {m.topProductos.map((p, i) => (
                <BarraH key={i}
                  label={`${i+1}. ${p.nombre}`}
                  value={p.unidades}
                  max={maxProducto}
                  fmtFn={v => `${v} u.`}
                  sublabel={fmt(p.monto)}
                  color={i === 0 ? '#f97316' : i < 3 ? '#fb923c' : '#6b7280'}
                />
              ))}
            </div>
          )}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-body font-semibold text-white text-sm mb-5 flex items-center gap-2">
            <Users size={15} className="text-brand-500" />
            Top 10 clientes por volumen
          </h3>
          {m.topClientes.length === 0 ? (
            <p className="text-surface-500 text-sm font-body">Sin datos en el período.</p>
          ) : (
            <div className="space-y-3">
              {m.topClientes.map((c, i) => (
                <BarraH key={i}
                  label={`${i+1}. ${c.nombre}`}
                  value={c.monto}
                  max={maxCliente}
                  sublabel={`${c.presupuestos} pres.`}
                  color={i === 0 ? '#f97316' : i < 3 ? '#fb923c' : '#6b7280'}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── 3. Saldos pendientes globales + Clientes recurrentes vs. nuevos ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6">
          <h3 className="font-body font-semibold text-white text-sm mb-5 flex items-center gap-2">
            <AlertTriangle size={15} className="text-yellow-500" />
            Saldos pendientes globales
          </h3>
          <div className="space-y-3">
            {[
              { label: 'Vencidos',              value: m.saldosVencidos,    color: 'text-red-400' },
              { label: 'Vencen en 1–15 días',  value: m.saldosPorVencer15, color: 'text-yellow-400' },
              { label: 'Vencen en 16–30 días', value: m.saldosPorVencer30, color: 'text-brand-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex justify-between items-center py-2 border-b border-surface-700/50 last:border-0">
                <span className="text-surface-300 text-sm font-body">{label}</span>
                <span className={`font-mono font-bold text-sm ${color}`}>{fmt(value)}</span>
              </div>
            ))}
          </div>

          {m.proxSaldos.length > 0 && (
            <div className="mt-4">
              <p className="text-surface-500 text-xs uppercase tracking-widest font-body mb-2">Próximos vencimientos</p>
              <div className="space-y-1">
                {m.proxSaldos.map((s, i) => (
                  <div key={i} className="flex justify-between text-xs font-body">
                    <span className="text-surface-400 truncate">{s.nombre} {s.apellido}</span>
                    <span className="text-white font-mono ml-2">{fmt(s.monto)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="font-body font-semibold text-white text-sm mb-5 flex items-center gap-2">
            <Repeat size={15} className="text-brand-500" />
            Clientes recurrentes vs. nuevos
          </h3>
          {m.clientesUnicos === 0 ? (
            <p className="text-surface-500 text-sm font-body">Sin datos en el período.</p>
          ) : (
            <>
              <GraficoDonaGenerico
                datos={[
                  { label: 'Recurrentes', valor: m.clientesRecurrentes },
                  { label: 'Nuevos',      valor: m.clientesNuevos },
                ]}
                colores={['#10b981','#3b82f6']}
              />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
                  <p className="text-emerald-400 font-mono font-bold text-2xl">{m.clientesRecurrentes}</p>
                  <p className="text-surface-400 text-xs font-body mt-1">Recurrentes</p>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-center">
                  <p className="text-blue-400 font-mono font-bold text-2xl">{m.clientesNuevos}</p>
                  <p className="text-surface-400 text-xs font-body mt-1">Nuevos</p>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── 4. Ventas por categoría de producto + Top proveedores ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6">
          <h3 className="font-body font-semibold text-white text-sm mb-5 flex items-center gap-2">
            <Layers size={15} className="text-brand-500" />
            Ventas por categoría de producto
          </h3>
          {m.topCategorias.length === 0 ? (
            <p className="text-surface-500 text-sm font-body">Sin ventas en el período.</p>
          ) : (
            <div className="space-y-3">
              {m.topCategorias.map((cat, i) => (
                <BarraH key={i}
                  label={`${i+1}. ${cat.nombre}`}
                  value={cat.monto}
                  max={m.topCategorias[0]?.monto ?? 1}
                  sublabel={`${cat.unidades} u.`}
                  color={i === 0 ? '#8b5cf6' : i < 3 ? '#a78bfa' : '#6b7280'}
                />
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="font-body font-semibold text-white text-sm mb-5 flex items-center gap-2">
            <Truck size={15} className="text-brand-500" />
            Top proveedores por compras
          </h3>
          {m.topProveedores.length === 0 ? (
            <p className="text-surface-500 text-sm font-body">Sin pedidos en el período.</p>
          ) : (
            <div className="space-y-3">
              {m.topProveedores.map((prov, i) => (
                <BarraH key={i}
                  label={`${i+1}. ${prov.nombre}`}
                  value={prov.monto}
                  max={m.topProveedores[0]?.monto ?? 1}
                  sublabel={`${prov.pedidos} ped.`}
                  color={i === 0 ? '#ec4899' : i < 3 ? '#f472b6' : '#6b7280'}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── 5. Impacto de descuentos y recargos (full width) ── */}
      <Card className="p-6">
        <h3 className="font-body font-semibold text-white text-sm mb-4 flex items-center gap-2">
          <Tag size={15} className="text-brand-500" />
          Impacto de descuentos y recargos
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-surface-700/40 rounded-xl p-4 text-center">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Precio de lista total</p>
            <p className="font-mono font-bold text-white text-xl">
              {fmt(m.facturadoTotal + m.descuentosOtorgados - m.recargosCC)}
            </p>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center">
            <p className="text-emerald-400 text-xs uppercase tracking-widest font-body mb-1">Desc. por promociones</p>
            <p className="font-mono font-bold text-emerald-400 text-xl">- {fmt(m.descuentosPromos)}</p>
            <p className="text-surface-500 text-xs mt-1 font-body">Promos de producto</p>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center">
            <p className="text-emerald-400 text-xs uppercase tracking-widest font-body mb-1">Desc. por método de pago</p>
            <p className="font-mono font-bold text-emerald-400 text-xl">- {fmt(m.descuentosMetodoPago)}</p>
            <p className="text-surface-500 text-xs mt-1 font-body">Efectivo · Transferencia</p>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
            <p className="text-red-400 text-xs uppercase tracking-widest font-body mb-1">Recargos CC cobrados</p>
            <p className="font-mono font-bold text-red-400 text-xl">+ {fmt(m.recargosCC)}</p>
            <p className="text-surface-500 text-xs mt-1 font-body">Cuenta corriente 30d</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
