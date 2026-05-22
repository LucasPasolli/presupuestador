// src/pages/Historial.jsx
import { useState, useEffect, useCallback } from 'react'
import { query } from '../lib/database'
import { Card, PageHeader, Button, Badge } from '../components/ui'
import { Search, ChevronDown, ChevronUp, ArrowLeft, FileText, Clock } from 'lucide-react'

// ─── Helpers ───────────────────────────────────────────────────────────────

const METODOS_PAGO = {
  efectivo:      { label: 'Efectivo',          badge: 'green',  texto: '5% desc.' },
  transferencia: { label: 'Transferencia',      badge: 'blue',   texto: '5% desc.' },
  cc15:          { label: 'Cta. Cte. 15 días',  badge: 'yellow', texto: 'Lista' },
  cc30:          { label: 'Cta. Cte. 30 días',  badge: 'orange', texto: '+10.5%' },
}

function getMétodo(value) {
  return METODOS_PAGO[value] ?? { label: value, badge: 'gray', texto: '' }
}

function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)
}

function fmtFecha(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const PAGE_SIZE = 30

// ─── Vista detalle ─────────────────────────────────────────────────────────

function PresupuestoDetalle({ presupuesto, onBack }) {
  const [detalles, setDetalles] = useState([])
  const [cliente,  setCliente]  = useState(null)
  const [saldo,    setSaldo]    = useState(null)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    setLoading(true)

    // Detalle con nombre de producto — usa LEFT JOIN para no perder filas huérfanas
    const rows = query(`
      SELECT dp.idDetalle,
             dp.idPresupuesto,
             dp.idProducto,
             dp.medida,
             dp.cantidad,
             dp.precioUnitario,
             dp.subtotal,
             p.nombre AS nombreProducto
      FROM DetallePresupuesto dp
      LEFT JOIN Producto p ON p.idProducto = dp.idProducto
      WHERE dp.idPresupuesto = ?
      ORDER BY dp.idDetalle
    `, [presupuesto.idPresupuesto])

    setDetalles(rows)

    const cl = query('SELECT * FROM Cliente WHERE idCliente = ?', [presupuesto.idCliente])
    setCliente(cl[0] ?? null)

    const sal = query('SELECT * FROM Saldo WHERE idPresupuesto = ?', [presupuesto.idPresupuesto])
    setSaldo(sal[0] ?? null)

    setLoading(false)
  }, [presupuesto.idPresupuesto])

  const metodo = getMétodo(presupuesto.metodoPago)
  const ajuste = presupuesto.monto - presupuesto.montoOriginal

  const BADGE = { green:'green', blue:'blue', yellow:'yellow', orange:'orange', gray:'gray' }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="flex items-center gap-2 text-surface-400 hover:text-white text-sm font-body transition-colors">
          <ArrowLeft size={16} />Volver al historial
        </button>
        <span className="text-surface-600">/</span>
        <span className="text-surface-300 text-sm font-body">
          Presupuesto <span className="text-brand-400 font-mono">#{presupuesto.idPresupuesto}</span>
        </span>
      </div>

      {/* Cabecera */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-surface-400 text-xs tracking-widest uppercase font-body mb-1">Presupuesto</p>
            <h2 className="font-display text-4xl text-white tracking-widest">#{presupuesto.idPresupuesto}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Badge color={BADGE[metodo.badge] ?? 'gray'}>{metodo.label}</Badge>
            {saldo && <Badge color={saldo.estado === 'pagado' ? 'green' : 'yellow'}>Saldo {saldo.estado}</Badge>}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Fecha</p>
            <p className="text-white text-sm font-mono">{fmtFecha(presupuesto.fecha)}</p>
          </div>
          <div className="bg-surface-700 rounded-xl p-4 col-span-2">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Cliente</p>
            {cliente ? (
              <>
                <p className="text-white text-sm font-body font-medium">{cliente.nombre} {cliente.apellido}</p>
                <p className="text-surface-400 text-xs font-mono mt-0.5">
                  ID #{cliente.idCliente}{cliente.telefono ? ` · ${cliente.telefono}` : ''}{cliente.mail ? ` · ${cliente.mail}` : ''}
                </p>
              </>
            ) : (
              <p className="text-surface-400 text-sm">ID #{presupuesto.idCliente}</p>
            )}
          </div>
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Método</p>
            <p className="text-white text-sm font-body">{metodo.label}</p>
            <p className="text-surface-500 text-xs font-mono">{metodo.texto}</p>
          </div>
        </div>
      </Card>

      {/* Tabla de ítems */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-700 flex items-center justify-between">
          <h3 className="font-body font-semibold text-white text-sm">Productos</h3>
          {!loading && (
            <span className="text-surface-400 text-xs font-mono">{detalles.length} ítem{detalles.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : detalles.length === 0 ? (
          <div className="text-center py-10 text-surface-500 font-body text-sm">
            No se encontraron ítems para este presupuesto.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="border-b border-surface-700">
                  {['#','ID Prod.','Producto','Medida','Cant.','Precio Unit.','Subtotal'].map((h) => (
                    <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detalles.map((d, idx) => (
                  <tr key={d.idDetalle} className="border-b border-surface-700/50">
                    <td className="py-3 px-4 text-surface-500 text-xs font-mono">{idx + 1}</td>
                    <td className="py-3 px-4 text-surface-400 font-mono text-xs">#{d.idProducto}</td>
                    <td className="py-3 px-4 text-white font-body">{d.nombreProducto ?? `Producto #${d.idProducto}`}</td>
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

      {/* Totales */}
      <Card className="p-6">
        <div className="max-w-xs ml-auto space-y-2 text-sm font-body">
          <div className="flex justify-between gap-12">
            <span className="text-surface-400">Subtotal (lista):</span>
            <span className="text-surface-200 font-mono">{fmt(presupuesto.montoOriginal)}</span>
          </div>
          <div className="flex justify-between gap-12">
            <span className="text-surface-400">Ajuste:</span>
            <span className={`font-mono font-medium ${ajuste < 0 ? 'text-emerald-400' : ajuste > 0 ? 'text-red-400' : 'text-surface-400'}`}>
              {ajuste === 0 ? '—' : ajuste < 0 ? `- ${fmt(Math.abs(ajuste))}` : `+ ${fmt(ajuste)}`}
            </span>
          </div>
          <div className="border-t border-surface-700 pt-2 flex justify-between gap-12">
            <span className="text-white font-semibold">Total:</span>
            <span className="text-brand-400 font-mono font-bold text-lg">{fmt(presupuesto.monto)}</span>
          </div>
        </div>
      </Card>

      {/* Saldo */}
      {saldo && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Saldo</p>
              <p className="text-white font-mono text-sm">#{saldo.idSaldo}</p>
            </div>
            <div>
              <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Vence</p>
              <p className="text-white font-body text-sm">{fmtFecha(saldo.fechaFin)}</p>
            </div>
            <div>
              <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Estado</p>
              <Badge color={saldo.estado === 'pagado' ? 'green' : 'yellow'}>
                {saldo.estado === 'pagado' ? 'Pagado' : 'Pendiente'}
              </Badge>
            </div>
            <div>
              <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Monto</p>
              <p className="text-brand-400 font-mono font-bold">{fmt(saldo.monto)}</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Vista lista ────────────────────────────────────────────────────────────

export default function Historial() {
  const [presupuestos, setPresupuestos] = useState([])
  const [search,       setSearch]       = useState('')
  const [filterMetodo, setFilterMetodo] = useState('all')
  const [filterFechaD, setFilterFechaD] = useState('')
  const [filterFechaH, setFilterFechaH] = useState('')
  const [sortDir,      setSortDir]      = useState('desc')
  const [page,         setPage]         = useState(1)
  const [selected,     setSelected]     = useState(null)

  const load = useCallback(() => {
    let sql = `
      SELECT p.*,
             c.nombre   AS clienteNombre,
             c.apellido AS clienteApellido,
             s.estado   AS saldoEstado
      FROM Presupuesto p
      LEFT JOIN Cliente c ON c.idCliente = p.idCliente
      LEFT JOIN Saldo   s ON s.idPresupuesto = p.idPresupuesto
      WHERE 1=1`
    const params = []

    if (search.trim()) {
      sql += ` AND (p.idPresupuesto = ? OR c.nombre LIKE ? OR c.apellido LIKE ?)`
      const s = search.trim()
      params.push(parseInt(s) || -1, `%${s}%`, `%${s}%`)
    }
    if (filterMetodo !== 'all') {
      sql += ` AND p.metodoPago = ?`
      params.push(filterMetodo)
    }
    if (filterFechaD) { sql += ` AND p.fecha >= ?`; params.push(filterFechaD) }
    if (filterFechaH) { sql += ` AND p.fecha <= ?`; params.push(filterFechaH) }

    sql += ` ORDER BY p.idPresupuesto ${sortDir.toUpperCase()}`

    setPresupuestos(query(sql, params))
    setPage(1)
  }, [search, filterMetodo, filterFechaD, filterFechaH, sortDir])

  useEffect(() => { load() }, [load])

  const paginated  = presupuestos.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(presupuestos.length / PAGE_SIZE))

  // Conteo correcto de saldos pendientes: busca directamente en tabla Saldo
  const saldosPendientes = presupuestos.filter((p) => p.saldoEstado === 'pendiente').length
  const totalMonto       = presupuestos.reduce((acc, p) => acc + (p.monto ?? 0), 0)

  if (selected) return <PresupuestoDetalle presupuesto={selected} onBack={() => setSelected(null)} />

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <PageHeader title="Historial" subtitle="Presupuestos emitidos" />

      {/* Resumen */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
          <p className="text-surface-400 text-xs uppercase tracking-widest font-body">Presupuestos</p>
          <p className="font-display text-3xl text-white tracking-widest mt-0.5">{presupuestos.length}</p>
        </div>
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
          <p className="text-surface-400 text-xs uppercase tracking-widest font-body">Total facturado</p>
          <p className="font-display text-2xl text-brand-400 tracking-widest mt-0.5">{fmt(totalMonto)}</p>
        </div>
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
          <p className="text-surface-400 text-xs uppercase tracking-widest font-body">Saldos pendientes</p>
          <p className="font-display text-3xl text-white tracking-widest mt-0.5">{saldosPendientes}</p>
        </div>
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por ID o cliente..."
              className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2 text-white
                         text-sm font-body placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all" />
          </div>

          <select value={filterMetodo} onChange={(e) => setFilterMetodo(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                       font-body focus:outline-none focus:border-brand-500 transition-all cursor-pointer">
            <option value="all">Todos los métodos</option>
            {Object.entries(METODOS_PAGO).map(([v, m]) => (
              <option key={v} value={v}>{m.label}</option>
            ))}
          </select>

          <div className="flex flex-col gap-1">
            <label className="text-surface-400 text-xs uppercase tracking-widest font-body">Desde</label>
            <input type="date" value={filterFechaD} onChange={(e) => setFilterFechaD(e.target.value)}
              className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                         font-body focus:outline-none focus:border-brand-500 transition-all [color-scheme:dark]" />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-surface-400 text-xs uppercase tracking-widest font-body">Hasta</label>
            <input type="date" value={filterFechaH} onChange={(e) => setFilterFechaH(e.target.value)}
              className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                         font-body focus:outline-none focus:border-brand-500 transition-all [color-scheme:dark]" />
          </div>

          <button onClick={() => setSortDir((d) => d === 'desc' ? 'asc' : 'desc')}
            className="flex items-center gap-2 bg-surface-700 border border-surface-600 hover:border-surface-500
                       rounded-xl px-3 py-2 text-white text-sm font-body transition-all">
            {sortDir === 'desc' ? <><ChevronDown size={15} />Más recientes</> : <><ChevronUp size={15} />Más antiguos</>}
          </button>

          {(search || filterMetodo !== 'all' || filterFechaD || filterFechaH) && (
            <button onClick={() => { setSearch(''); setFilterMetodo('all'); setFilterFechaD(''); setFilterFechaH('') }}
              className="text-surface-400 hover:text-red-400 text-xs font-body transition-colors">
              × Limpiar
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
                {['ID','Fecha','Cliente','Método','Total lista','Total final','Saldo',''].map((h) => (
                  <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((p) => {
                const m = getMétodo(p.metodoPago)
                const BADGE = { green:'green', blue:'blue', yellow:'yellow', orange:'orange', gray:'gray' }
                return (
                  <tr key={p.idPresupuesto} onClick={() => setSelected(p)}
                    className="border-b border-surface-700/50 hover:bg-surface-700/40 cursor-pointer transition-colors">
                    <td className="py-3 px-4 text-brand-400 font-mono text-sm">#{p.idPresupuesto}</td>
                    <td className="py-3 px-4 text-surface-300 font-mono text-xs">{fmtFecha(p.fecha)}</td>
                    <td className="py-3 px-4">
                      {p.clienteNombre
                        ? <span className="text-white">{p.clienteNombre} {p.clienteApellido}</span>
                        : <span className="text-surface-500 font-mono text-xs">ID #{p.idCliente}</span>}
                    </td>
                    <td className="py-3 px-4"><Badge color={BADGE[m.badge] ?? 'gray'}>{m.label}</Badge></td>
                    <td className="py-3 px-4 text-surface-400 font-mono text-xs">{fmt(p.montoOriginal)}</td>
                    <td className="py-3 px-4 text-white font-mono font-medium">{fmt(p.monto)}</td>
                    <td className="py-3 px-4">
                      {p.saldoEstado === 'pendiente' && <Badge color="yellow">Pendiente</Badge>}
                      {p.saldoEstado === 'pagado'    && <Badge color="green">Pagado</Badge>}
                      {!p.saldoEstado               && <span className="text-surface-600 text-xs">—</span>}
                    </td>
                    <td className="py-3 px-4 text-surface-500"><FileText size={15} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {presupuestos.length === 0 && (
          <div className="flex flex-col items-center py-16 gap-3 text-surface-500">
            <Clock size={32} className="opacity-30" />
            <p className="font-body text-sm">No hay presupuestos que coincidan.</p>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-surface-700">
            <p className="text-surface-400 text-xs font-body">
              {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, presupuestos.length)} de {presupuestos.length}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.max(1,p-1))} disabled={page===1}>← Anterior</Button>
              <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.min(totalPages,p+1))} disabled={page===totalPages}>Siguiente →</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
