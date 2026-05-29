// src/pages/Estadisticas.jsx
import { useState, useEffect, useCallback } from 'react'
import { query } from '../lib/database'
import { Card, PageHeader, Button } from '../components/ui'
import {
  TrendingUp, TrendingDown, Wallet, Clock, Users, Package,
  BarChart2, CreditCard, Tag, AlertTriangle, RefreshCw
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

function mesLabel(yyyy_mm) {
  const [y, m] = yyyy_mm.split('-')
  const nombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  return `${nombres[parseInt(m) - 1]} ${y.slice(2)}`
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

// ─── Gráfico de barras verticales mensual (SVG) ────────────────────────────

function GraficoMensual({ datos }) {
  if (!datos.length) return (
    <div className="flex items-center justify-center h-48 text-surface-500 text-sm font-body">
      Sin datos suficientes para el gráfico.
    </div>
  )

  const maxVal   = Math.max(...datos.flatMap(d => [d.cobrado, d.egreso]),1)
  const W        = 100 / datos.length   // ancho porcentual por barra
  const H        = 180
  const PAD      = 4

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${datos.length * 60} ${H + 30}`} className="w-full" style={{ height: 220 }}>
        {datos.map((d, i) => {
          const cobradoH = Math.max(4, (d.cobrado / maxVal) * (H - 20))
          const egresoH  = Math.max(4, (d.egreso  / maxVal) * (H - 20))

          const x = i * 60 + PAD

          return (
            <g key={d.mes}>

              {/* Cobrado */}
              <rect
                x={x}
                y={H - cobradoH}
                width={24}
                height={cobradoH}
                rx="4"
                fill="#10b981"
                fillOpacity="0.9"
              />

              {/* Egreso */}
              <rect
                x={x + 28}
                y={H - egresoH}
                width={24}
                height={egresoH}
                rx="4"
                fill="#ef4444"
                fillOpacity="0.9"
              />
              {/* Label mes */}
              <text x={x + 26} y={H + 16} textAnchor="middle"
                fontSize="9" fill="#737373" fontFamily="DM Sans, sans-serif">
                {mesLabel(d.mes)}
              </text>
              {/* Valor encima */}
              {cobradoH  > 16 && (
                <text x={x + 26} y={H - cobradoH - 4} textAnchor="middle"
                  fontSize="8" fill="#e2e2e2" fontFamily="JetBrains Mono, monospace">
                  {fmtCompacto(d.cobrado)}
                </text>
              )}
            </g>
          )
        })}
        {/* Línea base */}
        <line x1="0" y1={H} x2={datos.length * 60} y2={H} stroke="#3a3a3a" strokeWidth="1" />
      </svg>
      <div className="flex items-center gap-4 mt-1 text-xs font-body text-surface-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm inline-block" style={{ background: '#297a03' }} />
          Cobrado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm inline-block" style={{ background: '#ef4444' }} />
          Egresos
        </span>
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

// ─── Carga de todas las métricas ───────────────────────────────────────────

function calcularMetricas(desde, hasta) {
  const m = {}

  // ── 1. Ingresos totales del período ──────────────────────────────────────
  const presupuestosPeriodo = query(`
    SELECT p.idPresupuesto, p.monto, p.montoOriginal, p.metodoPago, p.fecha, p.idCliente, p.estado
    FROM Presupuesto p
    WHERE p.fecha >= ? AND p.fecha <= ?
      AND p.estado IN ('aprobado','pagado')
  `, [desde, hasta])

  m.facturadoTotal  = presupuestosPeriodo.reduce((a, p) => a + p.monto, 0)
  m.totalPresupuestos = presupuestosPeriodo.length
  m.ticketPromedio  = m.totalPresupuestos ? m.facturadoTotal / m.totalPresupuestos : 0

  // Descuentos otorgados = diferencia entre precio lista y precio final para efectivo/transf
  m.descuentosOtorgados = presupuestosPeriodo.reduce((a, p) => {
    const diff = p.montoOriginal - p.monto
    return a + (diff > 0 ? diff : 0)
  }, 0)
  // Recargos cobrados (CC30)
  m.recargosCC = presupuestosPeriodo.reduce((a, p) => {
    const diff = p.monto - p.montoOriginal
    return a + (diff > 0 ? diff : 0)
  }, 0)

  // ── 2. Cobrado real vs. pendiente ─────────────────────────────────────────
  // Cobrado = efectivo + transferencia + saldos CC ya pagados
  const saldosDelPeriodo = query(`
    SELECT s.monto, s.estado, s.idPresupuesto
    FROM Saldo s
    JOIN Presupuesto p ON p.idPresupuesto = s.idPresupuesto
    WHERE p.fecha >= ? AND p.fecha <= ?
  `, [desde, hasta])

  const montosCC = presupuestosPeriodo
    .filter(p => p.metodoPago === 'cc15' || p.metodoPago === 'cc30')
    .map(p => p.monto)

  const montoCCTotal     = montosCC.reduce((a, v) => a + v, 0)
  const montoCCPagado    = saldosDelPeriodo.filter(s => s.estado === 'pagado').reduce((a, s) => a + s.monto, 0)
  const montoCCPendiente = saldosDelPeriodo.filter(s => s.estado === 'pendiente').reduce((a, s) => a + s.monto, 0)

  const montoContado = presupuestosPeriodo
    .filter(p => (p.metodoPago === 'efectivo' || p.metodoPago === 'transferencia') && p.estado === 'pagado')
    .reduce((a, p) => a + p.monto, 0)

  m.cobradoReal      = montoContado + montoCCPagado
  m.pendienteCC      = montoCCPendiente

  // ── 3. Saldos por vencer (todos los pendientes, no solo el período) ───────
  const hoy = today()
  const en15 = new Date(); en15.setDate(en15.getDate() + 15)
  const en30 = new Date(); en30.setDate(en30.getDate() + 30)

  const saldosPendientesGlobal = query(`
    SELECT s.monto, s.fechaFin, c.nombre, c.apellido
    FROM Saldo s
    JOIN Cliente c ON c.idCliente = s.idCliente
    WHERE s.estado = 'pendiente'
    ORDER BY s.fechaFin ASC
  `)

  m.saldosPorVencer15 = saldosPendientesGlobal
    .filter(s => s.fechaFin <= en15.toISOString().slice(0,10))
    .reduce((a, s) => a + s.monto, 0)
  m.saldosPorVencer30 = saldosPendientesGlobal
    .filter(s => s.fechaFin <= en30.toISOString().slice(0,10))
    .reduce((a, s) => a + s.monto, 0)
  m.saldosVencidos = saldosPendientesGlobal
    .filter(s => s.fechaFin < hoy)
    .reduce((a, s) => a + s.monto, 0)
  m.proxSaldos = saldosPendientesGlobal.slice(0, 5)

  // ── 4. Mix de métodos de pago ─────────────────────────────────────────────
  const metodoLabels = { efectivo:'Efectivo', transferencia:'Transferencia', cc15:'CC 15d', cc30:'CC 30d' }
  const porMetodo    = {}
  for (const p of presupuestosPeriodo) {
    if (!porMetodo[p.metodoPago]) porMetodo[p.metodoPago] = 0
    porMetodo[p.metodoPago] += p.monto
  }
  m.mixMetodos = Object.entries(porMetodo)
    .map(([k, v]) => ({ value: k, label: metodoLabels[k] ?? k, monto: v }))
    .sort((a, b) => b.monto - a.monto)

  // ── 5. Evolución mensual (últimos N meses) ────────────────────────────────
  const mesesData = query(`
    SELECT strftime('%Y-%m', fecha) AS mes,
           SUM(monto) AS monto,
           COUNT(*) AS cantidad
    FROM Presupuesto
    WHERE fecha >= ? AND fecha <= ?
    GROUP BY mes
    ORDER BY mes
  `, [desde, hasta])

  // Agregar "cobrado" por mes (efectivo+transf inmediato + CC pagado en ese mes)
  m.evolucionMensual = mesesData.map(row => {

    const cobradoMes = query(`
      SELECT COALESCE(SUM(p.monto),0) as v
      FROM Presupuesto p
      WHERE strftime('%Y-%m', p.fecha) = ?
        AND (
          p.metodoPago IN ('efectivo','transferencia')
          OR p.idPresupuesto IN (
            SELECT idPresupuesto
            FROM Saldo
            WHERE estado = 'pagado'
              AND strftime('%Y-%m', fechaFin) = ?
          )
        )
    `, [row.mes, row.mes])[0]?.v ?? 0

    const egresoMes = query(`
      SELECT COALESCE(SUM(monto),0) as v
      FROM PedidoCompra
      WHERE estado = 'pagado'
        AND strftime('%Y-%m', fecha) = ?
    `, [row.mes])[0]?.v ?? 0

    return {
      ...row,
      cobrado: cobradoMes,
      egreso: egresoMes
    }
  })

  // ── 6. Top 10 productos más vendidos ─────────────────────────────────────
  m.topProductos = query(`
    SELECT pr.nombre, SUM(dp.cantidad) AS unidades, SUM(dp.subtotal) AS monto
    FROM DetallePresupuesto dp
    JOIN Presupuesto p  ON p.idPresupuesto = dp.idPresupuesto
    JOIN Producto   pr ON pr.idProducto    = dp.idProducto
    WHERE p.fecha >= ? AND p.fecha <= ?
    GROUP BY dp.idProducto
    ORDER BY unidades DESC
    LIMIT 10
  `, [desde, hasta])

  // ── 7. Top 10 clientes ───────────────────────────────────────────────────
  m.topClientes = query(`
    SELECT c.nombre || ' ' || c.apellido AS nombre,
           COUNT(DISTINCT p.idPresupuesto) AS presupuestos,
           SUM(p.monto) AS monto
    FROM Presupuesto p
    JOIN Cliente c ON c.idCliente = p.idCliente
    WHERE p.fecha >= ? AND p.fecha <= ?
    GROUP BY p.idCliente
    ORDER BY monto DESC
    LIMIT 10
  `, [desde, hasta])

  // ── 8. Clientes únicos del período ───────────────────────────────────────
  m.clientesUnicos = query(`
    SELECT COUNT(DISTINCT idCliente) as c FROM Presupuesto
    WHERE fecha >= ? AND fecha <= ?
      AND estado IN ('pagado','aprobado')
  `, [desde, hasta])[0]?.c ?? 0

  // ── 9. Egresos (pedidos de compra del período) ───────────────────────────
  // Egresos: solo pedidos efectivamente pagados
  m.egresosPedidos = query(`
    SELECT COALESCE(SUM(monto),0) as v FROM PedidoCompra
    WHERE fecha >= ? AND fecha <= ? AND estado = 'pagado'
  `, [desde, hasta])[0]?.v ?? 0

  // Pedidos pendientes de pago (deuda con proveedores)
  m.pedidosPendientes = query(`
    SELECT COALESCE(SUM(monto),0) as v FROM PedidoCompra
    WHERE fecha >= ? AND fecha <= ? AND estado = 'pendiente'
  `, [desde, hasta])[0]?.v ?? 0

  // ── 10. Resultado operativo estimado ─────────────────────────────────────
  m.resultadoEstimado = m.cobradoReal - m.egresosPedidos

  return m
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
  const [rangoIdx,  setRangoIdx]  = useState(1)
  const [desdeCustom, setDesdeCustom] = useState('')
  const [hastaCustom, setHastaCustom] = useState(today())
  const [metricas,  setMetricas]  = useState(null)

  const desde = rangoIdx < 4 ? RANGOS[rangoIdx].desde() : desdeCustom
  const hasta = rangoIdx < 4 ? RANGOS[rangoIdx].hasta() : hastaCustom

  const cargar = useCallback(() => {
    if (!desde || !hasta) return
    try {
      setMetricas(calcularMetricas(desde, hasta))
    } catch(e) {
      console.error('Error calculando métricas:', e)
    }
  }, [desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  if (!metricas) return (
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
        <KpiCard icon={Clock}       label="Pendiente CC"    value={formatoMonto(m.pendienteCC)}       color="yellow"
          sub="Saldos sin cobrar" />
        <KpiCard icon={BarChart2}   label="Ticket promedio" value={formatoMonto(m.ticketPromedio)}    color="blue"
          sub="por presupuesto" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon={Users}       label="Clientes únicos"  value={m.clientesUnicos}               color="blue"
          sub="en el período" />
        <KpiCard icon={Tag}         label="Descuentos dados" value={formatoMonto(m.descuentosOtorgados)} color="yellow"
          sub={`${pct(m.descuentosOtorgados, m.facturadoTotal)} del facturado`} />
        <KpiCard icon={TrendingDown} label="Egresos pagados" value={formatoMonto(m.egresosPedidos)} color="red"
          sub="pedidos de compra" />
        <KpiCard icon={m.resultadoEstimado >= 0 ? TrendingUp : TrendingDown}
          label="Resultado operativo" value={formatoMonto(m.resultadoEstimado)}
          color={m.resultadoEstimado >= 0 ? 'green' : 'red'}
          sub="cobrado − egresos" />
      </div>

      {/* ── Deuda con proveedores ── */}
      {m.pedidosPendientes > 0 && (
        <div className="bg-yellow-500/8 border border-yellow-500/25 rounded-2xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} className="text-yellow-400 flex-shrink-0" />
            <div>
              <p className="text-yellow-300 text-sm font-body font-medium">Pedidos pendientes de pago</p>
              <p className="text-surface-400 text-xs font-body">Deuda con proveedores en el período seleccionado</p>
            </div>
          </div>
          <p className="text-yellow-400 font-mono font-bold text-xl">{fmtCompacto(m.pedidosPendientes)}</p>
        </div>
      )}

      {/* ── Evolución mensual ── */}
      <Card className="p-6">
        <h3 className="font-body font-semibold text-white text-sm mb-4 flex items-center gap-2">
          <BarChart2 size={15} className="text-brand-500" />
          Evolución mensual — Cobrado vs. Egresos
        </h3>
        {m.evolucionMensual.length === 0 ? (
          <p className="text-surface-500 text-sm font-body py-8 text-center">Sin datos en el período.</p>
        ) : (
          <GraficoMensual datos={m.evolucionMensual} />
        )}
      </Card>

      {/* ── Dos columnas: mix de pago + saldos por vencer ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6">
          <h3 className="font-body font-semibold text-white text-sm mb-5 flex items-center gap-2">
            <CreditCard size={15} className="text-brand-500" />
            Mix de métodos de pago
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
            <AlertTriangle size={15} className="text-yellow-500" />
            Saldos pendientes globales
          </h3>
          <div className="space-y-3">
            {[
              { label: 'Vencidos',           value: m.saldosVencidos,    color: 'text-red-400' },
              { label: 'Vencen en 15 días',  value: m.saldosPorVencer15, color: 'text-yellow-400' },
              { label: 'Vencen en 30 días',  value: m.saldosPorVencer30, color: 'text-brand-400' },
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
      </div>

      {/* ── Top productos y clientes ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6">
          <h3 className="font-body font-semibold text-white text-sm mb-5 flex items-center gap-2">
            <Package size={15} className="text-brand-500" />
            Top 10 productos más vendidos
          </h3>
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

      {/* ── Resumen de descuentos y recargos ── */}
      <Card className="p-6">
        <h3 className="font-body font-semibold text-white text-sm mb-4 flex items-center gap-2">
          <Tag size={15} className="text-brand-500" />
          Impacto de descuentos y recargos
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-surface-700/40 rounded-xl p-4 text-center">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Precio de lista total</p>
            <p className="font-mono font-bold text-white text-xl">
              {fmt(m.facturadoTotal - m.recargosCC + m.descuentosOtorgados)}
            </p>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center">
            <p className="text-emerald-400 text-xs uppercase tracking-widest font-body mb-1">Descuentos otorgados</p>
            <p className="font-mono font-bold text-emerald-400 text-xl">- {fmt(m.descuentosOtorgados)}</p>
            <p className="text-surface-500 text-xs mt-1 font-body">Efectivo + Transferencia</p>
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
