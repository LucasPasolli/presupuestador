// src/pages/Saldos.jsx
import { useState, useEffect, useCallback } from 'react'
import { query, run } from '../lib/database'
import { Card, PageHeader, Button, Badge, Modal } from '../components/ui'
import {
  ArrowLeft, Wallet, Clock, CheckCircle2, AlertTriangle,
  CalendarClock, User, FileText, BadgeCheck, Search, ChevronDown, ChevronUp
} from 'lucide-react'

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)
}

function fmtFecha(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function today() { return new Date().toISOString().slice(0, 10) }

function diasRestantes(fechaFin) {
  const hoy  = new Date(today())
  const fin  = new Date(fechaFin)
  const diff = Math.round((fin - hoy) / (1000 * 60 * 60 * 24))
  return diff
}

function colorDias(dias) {
  if (dias < 0)  return { text: 'text-red-400',    bg: 'bg-red-500/10    border-red-500/30' }
  if (dias <= 5) return { text: 'text-yellow-400',  bg: 'bg-yellow-500/10 border-yellow-500/30' }
  return              { text: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' }
}

function labelDias(dias) {
  if (dias < 0)  return `Vencido hace ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''}`
  if (dias === 0) return 'Vence hoy'
  return `${dias} día${dias !== 1 ? 's' : ''} restante${dias !== 1 ? 's' : ''}`
}

const PAGE_SIZE = 25

// ─── Toast ─────────────────────────────────────────────────────────────────

function Toast({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className="fixed top-5 right-5 z-[9999] pointer-events-none">
      <div className="flex items-center gap-3 bg-emerald-900/95 border border-emerald-500/50
                      rounded-2xl px-5 py-3 shadow-2xl animate-slide-up">
        <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
        <span className="text-emerald-100 text-sm font-body">{message}</span>
      </div>
    </div>
  )
}

// ─── Vista detalle de saldo ─────────────────────────────────────────────────

function SaldoDetalle({ saldo, onBack, onUpdated }) {
  const [presupuesto, setPresupuesto] = useState(null)
  const [cliente,     setCliente]     = useState(null)
  const [detalles,    setDetalles]    = useState([])
  const [confirmPago, setConfirmPago] = useState(false)

  useEffect(() => {
    const p = query(`SELECT * FROM Presupuesto WHERE idPresupuesto = ?`, [saldo.idPresupuesto])[0]
    setPresupuesto(p ?? null)

    const c = query(`SELECT * FROM Cliente WHERE idCliente = ?`, [saldo.idCliente])[0]
    setCliente(c ?? null)

    const d = query(`
      SELECT dp.*, pr.nombre AS nombreProducto
      FROM DetallePresupuesto dp
      LEFT JOIN Producto pr ON pr.idProducto = dp.idProducto
      WHERE dp.idPresupuesto = ?
      ORDER BY dp.idDetalle
    `, [saldo.idPresupuesto])
    setDetalles(d)
  }, [saldo.idPresupuesto, saldo.idCliente])

  function marcarPagado() {
    const hoy = new Date().toISOString().slice(0, 10)
    run(`UPDATE Saldo SET estado = 'pagado', fechaPago = ? WHERE idSaldo = ?`, [hoy, saldo.idSaldo])
    run(`UPDATE Presupuesto SET estado = 'pagado' WHERE idPresupuesto = ?`, [saldo.idPresupuesto])
    setConfirmPago(false)
    onUpdated('Saldo marcado como pagado ✓ — ingreso registrado')
    onBack()
  }

  const dias      = diasRestantes(saldo.fechaFin)
  const colores   = colorDias(dias)
  const esPendiente = saldo.estado === 'pendiente'
  const metodoLabel = { efectivo:'Efectivo', transferencia:'Transferencia', cc15:'CC 15 días', cc30:'CC 30 días' }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="flex items-center gap-2 text-surface-400 hover:text-white text-sm font-body transition-colors">
          <ArrowLeft size={16} />Volver a saldos
        </button>
        <span className="text-surface-600">/</span>
        <span className="text-surface-300 text-sm font-body">
          Saldo <span className="text-brand-400 font-mono">#{saldo.idSaldo}</span>
        </span>
      </div>

      {/* Cabecera */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-surface-400 text-xs tracking-widest uppercase font-body mb-1">Saldo</p>
            <h2 className="font-display text-4xl text-white tracking-widest">#{saldo.idSaldo}</h2>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Badge color={esPendiente ? 'yellow' : 'green'}>
              {esPendiente ? 'Pendiente' : 'Pagado'}
            </Badge>
            {esPendiente && (
              <Button icon={BadgeCheck} onClick={() => setConfirmPago(true)}>
                Marcar como pagado
              </Button>
            )}
          </div>
        </div>

        {/* Días restantes — banner prominente */}
        {esPendiente && (
          <div className={`flex items-center gap-3 rounded-xl px-5 py-3 border mb-6 ${colores.bg}`}>
            <CalendarClock size={18} className={colores.text + ' flex-shrink-0'} />
            <div>
              <p className={`font-body font-semibold text-sm ${colores.text}`}>{labelDias(dias)}</p>
              <p className="text-surface-400 text-xs font-body">
                Fecha de vencimiento: {fmtFecha(saldo.fechaFin)}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className={`font-display text-3xl tracking-widest ${colores.text}`}>
                {dias < 0 ? Math.abs(dias) : dias}
              </p>
              <p className="text-surface-500 text-xs font-body">días</p>
            </div>
          </div>
        )}

        {/* Grid de datos */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Presupuesto */}
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1 flex items-center gap-1">
              <FileText size={11} />Presupuesto
            </p>
            <p className="text-brand-400 font-mono font-bold">#{saldo.idPresupuesto}</p>
            {presupuesto && (
              <p className="text-surface-400 text-xs font-body mt-0.5">
                {metodoLabel[presupuesto.metodoPago] ?? presupuesto.metodoPago}
              </p>
            )}
          </div>

          {/* Fecha del presupuesto */}
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1 flex items-center gap-1">
              <Clock size={11} />Fecha emisión
            </p>
            <p className="text-white text-sm font-mono">{fmtFecha(saldo.fechaInicio)}</p>
          </div>

          {/* Cliente */}
          <div className={`bg-surface-700 rounded-xl p-4 ${esPendiente ? 'col-span-2' : ''}`}>
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1 flex items-center gap-1">
              <User size={11} />Cliente
            </p>
            {cliente ? (
              <>
                <p className="text-white text-sm font-body font-medium">
                  {cliente.nombre} {cliente.apellido}
                </p>
                <p className="text-surface-400 text-xs font-mono mt-0.5">
                  ID #{cliente.idCliente}
                  {cliente.telefono ? ` · ${cliente.telefono}` : ''}
                  {cliente.mail ? ` · ${cliente.mail}` : ''}
                </p>
              </>
            ) : (
              <p className="text-surface-400 text-sm font-mono">ID #{saldo.idCliente}</p>
            )}
          </div>

          {/* Fecha de pago — solo visible cuando el saldo está pagado */}
          {!esPendiente && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
              <p className="text-emerald-400 text-xs uppercase tracking-widest font-body mb-1 flex items-center gap-1">
                <CheckCircle2 size={11} />Fecha de pago
              </p>
              <p className="text-emerald-300 text-sm font-mono font-semibold">
                {fmtFecha(saldo.fechaPago)}
              </p>
              <p className="text-emerald-600 text-xs font-body mt-0.5">Cobro efectivizado</p>
            </div>
          )}
        </div>
      </Card>

      {/* Detalle de productos del presupuesto */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-700 flex items-center justify-between">
          <h3 className="font-body font-semibold text-white text-sm">
            Productos del presupuesto #{saldo.idPresupuesto}
          </h3>
          <span className="text-surface-400 text-xs font-mono">
            {detalles.length} ítem{detalles.length !== 1 ? 's' : ''}
          </span>
        </div>

        {detalles.length === 0 ? (
          <p className="text-center py-10 text-surface-500 text-sm font-body">Sin ítems registrados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="border-b border-surface-700">
                  {['#','Producto','Medida','Cant.','Precio Unit.','Subtotal'].map(h => (
                    <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detalles.map((d, idx) => (
                  <tr key={d.idDetalle} className="border-b border-surface-700/50">
                    <td className="py-3 px-4 text-surface-500 font-mono text-xs">{idx + 1}</td>
                    <td className="py-3 px-4 text-white font-body">{d.nombreProducto ?? `#${d.idProducto}`}</td>
                    <td className="py-3 px-4">
                      {d.medida
                        ? <Badge color="blue">{d.medida}</Badge>
                        : <span className="text-surface-500 text-xs">—</span>}
                    </td>
                    <td className="py-3 px-4 text-surface-200 font-mono text-center">{d.cantidad}</td>
                    <td className="py-3 px-4 text-surface-200 font-mono">{fmt(d.precioUnitario)}</td>
                    <td className="py-3 px-4 text-surface-200 font-mono font-medium">{fmt(d.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Monto final */}
      <Card className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 text-sm font-body">
            <div className="flex justify-between gap-16">
              <span className="text-surface-400">Monto original (lista):</span>
              <span className="text-surface-300 font-mono">
                {presupuesto ? fmt(presupuesto.montoOriginal) : '—'}
              </span>
            </div>
            <div className="border-t border-surface-700 pt-2 flex justify-between gap-16">
              <span className="text-white font-semibold">Monto a cobrar:</span>
              <span className="text-brand-400 font-mono font-bold text-xl">{fmt(saldo.monto)}</span>
            </div>
          </div>

          {!esPendiente && (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30
                            rounded-xl px-4 py-2.5">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span className="text-emerald-300 text-sm font-body">Ingreso registrado</span>
            </div>
          )}
        </div>
      </Card>

      {/* Modal confirmar cobro */}
      <Modal open={confirmPago} onClose={() => setConfirmPago(false)} title="Confirmar cobro" width="max-w-sm">
        <p className="text-surface-300 text-sm font-body mb-2">
          ¿Marcar el saldo <span className="text-white font-mono">#{saldo.idSaldo}</span> como cobrado?
        </p>
        <p className="text-surface-500 text-xs font-body mb-6">
          Se registrará el ingreso de{' '}
          <span className="text-brand-400 font-mono font-bold">{fmt(saldo.monto)}</span>{' '}
          en el sistema de estadísticas. Esta acción no se puede deshacer.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmPago(false)}>Cancelar</Button>
          <Button className="flex-1" icon={BadgeCheck} onClick={marcarPagado}>Confirmar cobro</Button>
        </div>
      </Modal>
    </div>
  )
}

// ─── Lista de saldos ────────────────────────────────────────────────────────

export default function Saldos() {
  const [saldos,     setSaldos]     = useState([])
  const [selected,   setSelected]   = useState(null)
  const [filterEst,  setFilterEst]  = useState('pendiente')   // por defecto solo pendientes
  const [search,     setSearch]     = useState('')
  const [sortDias,   setSortDias]   = useState('asc')         // ordenar por urgencia
  const [page,       setPage]       = useState(1)
  const [toast,      setToast]      = useState('')

  const load = useCallback(() => {
    let sql = `
      SELECT s.*,
             c.nombre   AS clienteNombre,
             c.apellido AS clienteApellido
      FROM Saldo s
      JOIN Cliente c ON c.idCliente = s.idCliente
      WHERE 1=1`
    const params = []

    if (filterEst !== 'all') { sql += ` AND s.estado = ?`; params.push(filterEst) }

    if (search.trim()) {
      sql += ` AND (c.nombre LIKE ? OR c.apellido LIKE ? OR (c.nombre || ' ' || c.apellido) LIKE ? OR CAST(s.idPresupuesto AS TEXT) = ? OR CAST(s.idSaldo AS TEXT) = ?)`
      const s = search.trim()
      params.push(`%${s}%`, `%${s}%`, `%${s}%`, s, s)
    }

    // Orden: pendientes por urgencia (días restantes ASC = más urgente primero), pagados por fecha DESC
    if (filterEst === 'pendiente' || filterEst === 'all') {
      sql += ` ORDER BY s.fechaFin ${sortDias === 'asc' ? 'ASC' : 'DESC'}`
    } else {
      sql += ` ORDER BY s.idSaldo DESC`
    }

    setSaldos(query(sql, params))
    setPage(1)
  }, [filterEst, search, sortDias])

  useEffect(() => { load() }, [load])

  // KPIs globales siempre (independientes del filtro)
  const kpis = (() => {
    const todos = query(`
      SELECT s.monto, s.estado, s.fechaFin
      FROM Saldo s
    `)
    const hoy = today()
    const pendientes = todos.filter(s => s.estado === 'pendiente')
    const vencidos   = pendientes.filter(s => s.fechaFin < hoy)
    return {
      totalPendiente: pendientes.reduce((a, s) => a + s.monto, 0),
      cantPendientes: pendientes.length,
      vencidos:       vencidos.reduce((a, s) => a + s.monto, 0),
      cantVencidos:   vencidos.length,
      totalCobrado:   todos.filter(s => s.estado === 'pagado').reduce((a, s) => a + s.monto, 0),
    }
  })()

  const paginated  = saldos.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(saldos.length / PAGE_SIZE))

  function handleUpdated(msg) {
    setToast(msg)
    load()
  }

  if (selected) {
    return (
      <SaldoDetalle
        saldo={selected}
        onBack={() => { setSelected(null); load() }}
        onUpdated={handleUpdated}
      />
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}

      <PageHeader title="Saldos" subtitle="Cobros por cuenta corriente" />

      {/* KPIs globales */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
          <p className="text-surface-400 text-xs uppercase tracking-widest font-body">Pendiente de cobro</p>
          <p className="font-display text-3xl text-yellow-400 tracking-widest mt-1">
            {new Intl.NumberFormat('es-AR', { notation: 'compact', style: 'currency', currency: 'ARS' }).format(kpis.totalPendiente)}
          </p>
          <p className="text-surface-500 text-xs font-body mt-1">{kpis.cantPendientes} saldo{kpis.cantPendientes !== 1 ? 's' : ''}</p>
        </div>

        {kpis.cantVencidos > 0 ? (
          <div className="bg-red-500/8 border border-red-500/25 rounded-xl p-5">
            <p className="text-red-400 text-xs uppercase tracking-widest font-body flex items-center gap-1">
              <AlertTriangle size={11} />Vencidos
            </p>
            <p className="font-display text-3xl text-red-400 tracking-widest mt-1">
              {new Intl.NumberFormat('es-AR', { notation: 'compact', style: 'currency', currency: 'ARS' }).format(kpis.vencidos)}
            </p>
            <p className="text-surface-500 text-xs font-body mt-1">{kpis.cantVencidos} saldo{kpis.cantVencidos !== 1 ? 's' : ''} vencido{kpis.cantVencidos !== 1 ? 's' : ''}</p>
          </div>
        ) : (
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body">Vencidos</p>
            <p className="font-display text-3xl text-emerald-400 tracking-widest mt-1">$0</p>
            <p className="text-surface-500 text-xs font-body mt-1">Sin saldos vencidos</p>
          </div>
        )}

        <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
          <p className="text-surface-400 text-xs uppercase tracking-widest font-body">Total cobrado</p>
          <p className="font-display text-3xl text-emerald-400 tracking-widest mt-1">
            {new Intl.NumberFormat('es-AR', { notation: 'compact', style: 'currency', currency: 'ARS' }).format(kpis.totalCobrado)}
          </p>
          <p className="text-surface-500 text-xs font-body mt-1">ingresado al sistema</p>
        </div>
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Búsqueda */}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por cliente o ID..."
              className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2 text-white
                         text-sm font-body placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all" />
          </div>

          {/* Estado */}
          {[
            { value: 'pendiente', label: 'Pendientes' },
            { value: 'pagado',    label: 'Cobrados' },
            { value: 'all',       label: 'Todos' },
          ].map(({ value, label }) => (
            <button key={value} onClick={() => setFilterEst(value)}
              className={`px-4 py-2 rounded-xl text-sm font-body border transition-all
                ${filterEst === value
                  ? 'bg-brand-500/15 border-brand-500/40 text-white'
                  : 'bg-surface-700 border-surface-600 text-surface-400 hover:border-surface-500'}`}>
              {label}
            </button>
          ))}

          {/* Ordenar por urgencia */}
          {(filterEst === 'pendiente' || filterEst === 'all') && (
            <button onClick={() => setSortDias(d => d === 'asc' ? 'desc' : 'asc')}
              className="flex items-center gap-2 bg-surface-700 border border-surface-600 hover:border-surface-500
                         rounded-xl px-3 py-2 text-white text-sm font-body transition-all">
              {sortDias === 'asc'
                ? <><ChevronUp size={14} />Más urgentes</>
                : <><ChevronDown size={14} />Menos urgentes</>}
            </button>
          )}
        </div>
      </Card>

      {/* Tabla */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="border-b border-surface-700">
                {['Saldo','Presupuesto','Cliente','Emisión','Vencimiento','Días','Monto','Estado',''].map(h => (
                  <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-3 font-body">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map(s => {
                const dias    = diasRestantes(s.fechaFin)
                const cols    = colorDias(dias)
                const esPend  = s.estado === 'pendiente'
                return (
                  <tr key={s.idSaldo} onClick={() => setSelected(s)}
                    className="border-b border-surface-700/50 hover:bg-surface-700/40 cursor-pointer transition-colors">
                    <td className="py-3 px-3 text-brand-400 font-mono text-sm font-bold">#{s.idSaldo}</td>
                    <td className="py-3 px-3 text-surface-400 font-mono text-xs">#{s.idPresupuesto}</td>
                    <td className="py-3 px-3">
                      <p className="text-white text-sm font-body leading-tight">
                        {s.clienteNombre} {s.clienteApellido}
                      </p>
                    </td>
                    <td className="py-3 px-3 text-surface-400 font-mono text-xs">{fmtFecha(s.fechaInicio)}</td>
                    <td className="py-3 px-3 text-surface-300 font-mono text-xs">{fmtFecha(s.fechaFin)}</td>
                    <td className="py-3 px-3">
                      {esPend ? (
                        <span className={`text-xs font-mono font-bold ${cols.text}`}>
                          {dias < 0 ? `−${Math.abs(dias)}` : dias}d
                        </span>
                      ) : (
                        <span className="text-surface-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-white font-mono font-medium">{fmt(s.monto)}</td>
                    <td className="py-3 px-3">
                      {esPend
                        ? <Badge color="yellow"><Clock size={10} className="inline mr-1" />Pendiente</Badge>
                        : <Badge color="green"><CheckCircle2 size={10} className="inline mr-1" />Cobrado</Badge>}
                    </td>
                    <td className="py-3 px-3 text-surface-500">
                      <Wallet size={14} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {saldos.length === 0 && (
          <div className="flex flex-col items-center py-16 gap-3 text-surface-500">
            <Wallet size={32} className="opacity-30" />
            <p className="font-body text-sm">
              {filterEst === 'pendiente' ? 'No hay saldos pendientes.' : 'Sin saldos que coincidan.'}
            </p>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-surface-700">
            <p className="text-surface-400 text-xs font-body">
              {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, saldos.length)} de {saldos.length}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}>← Ant.</Button>
              <Button size="sm" variant="secondary" onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages}>Sig. →</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
