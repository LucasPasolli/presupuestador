// src/pages/Historial.jsx
import { useState, useEffect, useCallback } from 'react'
import { query, run } from '../lib/database'
import { Card, PageHeader, Button, Badge, Modal } from '../components/ui'
import {
  Search, ChevronDown, ChevronUp, ArrowLeft, FileText,
  Clock, CheckCircle2, XCircle, ThumbsUp, AlertCircle, Trash2
} from 'lucide-react'

// ─── Helpers ───────────────────────────────────────────────────────────────

const METODOS_PAGO = {
  efectivo:      { label: 'Efectivo',         badge: 'green'  },
  transferencia: { label: 'Transferencia',     badge: 'blue'   },
  cc15:          { label: 'Cta. Cte. 15 días', badge: 'yellow' },
  cc30:          { label: 'Cta. Cte. 30 días', badge: 'orange' },
}
const ESTADOS = {
  borrador:  { label: 'Borrador',  color: 'gray'  },
  aprobado:  { label: 'Aprobado',  color: 'blue'  },
  pagado:    { label: 'Pagado',    color: 'green' },
  rechazado: { label: 'Rechazado', color: 'red'   },
}
const BADGE = { green:'green', blue:'blue', yellow:'yellow', orange:'orange', gray:'gray', red:'red' }

function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)
}
function fmtFecha(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
function pctLabel(factor) {
  const diff = (factor - 1) * 100
  if (Math.abs(diff) < 0.001) return 'Precio de lista'
  if (diff < 0) return `${Math.abs(diff).toFixed(2)}% descuento`
  return `+${diff.toFixed(2)}% recargo`
}

const PAGE_SIZE = 30

// ─── Descuento de stock ─────────────────────────────────────────────────────

function descontarStock(idPresupuesto) {
  const detalles = query(
    `SELECT idProducto, medida, cantidad FROM DetallePresupuesto WHERE idPresupuesto = ?`,
    [idPresupuesto]
  )
  for (const d of detalles) {
    const prod = query('SELECT tieneMedidas FROM Producto WHERE idProducto = ?', [d.idProducto])[0]
    if (!prod) continue
    if (prod.tieneMedidas && d.medida) {
      run(`UPDATE ProductoMedida SET cantidad = MAX(0, cantidad - ?) WHERE idProducto = ? AND medida = ?`,
        [d.cantidad, d.idProducto, d.medida])
    } else {
      run(`UPDATE Producto SET cantidad = MAX(0, cantidad - ?) WHERE idProducto = ?`,
        [d.cantidad, d.idProducto])
    }
  }
}

// ─── Vista detalle ─────────────────────────────────────────────────────────

function PresupuestoDetalle({ presupuesto: presInit, onBack, onUpdated }) {
  const [pres,       setPres]       = useState(presInit)
  const [detalles,   setDetalles]   = useState([])
  const [cliente,    setCliente]    = useState(null)
  const [saldo,      setSaldo]      = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [modal,      setModal]      = useState(null)
  const [errorModal, setErrorModal] = useState('')
  const [delConfirm, setDelConfirm] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    const p = query('SELECT * FROM Presupuesto WHERE idPresupuesto = ?', [pres.idPresupuesto])[0]
    if (p) setPres(p)
    const rows = query(`
      SELECT dp.*, pr.nombre AS nombreProducto
      FROM DetallePresupuesto dp
      LEFT JOIN Producto pr ON pr.idProducto = dp.idProducto
      WHERE dp.idPresupuesto = ? ORDER BY dp.idDetalle
    `, [pres.idPresupuesto])
    setDetalles(rows)
    const cl  = query('SELECT * FROM Cliente WHERE idCliente = ?', [pres.idCliente])[0]
    setCliente(cl ?? null)
    const sal = query('SELECT * FROM Saldo WHERE idPresupuesto = ?', [pres.idPresupuesto])[0]
    setSaldo(sal ?? null)
    setLoading(false)
  }, [pres.idPresupuesto, pres.idCliente])

  useEffect(() => { reload() }, [reload])

  const esCC        = pres.metodoPago === 'cc15' || pres.metodoPago === 'cc30'
  const esExcepcion = pres.esExcepcion === 1
  const estado      = ESTADOS[pres.estado] ?? ESTADOS.borrador
  const metodo      = METODOS_PAGO[pres.metodoPago] ?? { label: pres.metodoPago, badge: 'gray' }
  const ajuste      = pres.monto - pres.montoOriginal
  const puedeActuar = pres.estado === 'borrador' || pres.estado === 'aprobado'


  // Factor real para mostrar:
  // - Excepción: usa factorAplicado guardado; si es 1 (default antiguo) lo recalcula de monto/montoOriginal
  // - Normal: usa el factor fijo del método
  const factorMostrado = (() => {
    if (esExcepcion) {
      const guardado = pres.factorAplicado ?? 1
      // Si factorAplicado es exactamente 1 pero hay una diferencia real de montos, recalcular
      if (guardado === 1 && pres.montoOriginal > 0 && Math.abs(pres.monto - pres.montoOriginal) > 0.01) {
        return pres.monto / pres.montoOriginal
      }
      return guardado
    }
    return { efectivo:0.95, transferencia:0.95, cc15:1.00, cc30:1.105 }[pres.metodoPago] ?? 1
  })()

  function cambiarEstado(nuevoEstado) {
    setErrorModal('')
    const estadoAnterior = pres.estado
    run(`UPDATE Presupuesto SET estado = ? WHERE idPresupuesto = ?`, [nuevoEstado, pres.idPresupuesto])
    const debeDescontar = (nuevoEstado === 'aprobado' || nuevoEstado === 'pagado') &&
                          estadoAnterior !== 'aprobado' && estadoAnterior !== 'pagado'
    if (debeDescontar) descontarStock(pres.idPresupuesto)
    if (nuevoEstado === 'aprobado' && esCC) {
      const yaExiste = query('SELECT idSaldo FROM Saldo WHERE idPresupuesto = ?', [pres.idPresupuesto])[0]
      if (!yaExiste) {
        const diasCC   = pres.metodoPago === 'cc15' ? 15 : 30
        const fechaFin = new Date(pres.fecha)
        fechaFin.setDate(fechaFin.getDate() + diasCC)
        run(`INSERT INTO Saldo (idPresupuesto, idCliente, fechaInicio, fechaFin, monto, estado) VALUES (?,?,?,?,?,'pendiente')`,
          [pres.idPresupuesto, pres.idCliente, pres.fecha, fechaFin.toISOString().slice(0,10), pres.monto])
      }
    }
    if (nuevoEstado === 'rechazado') {
      run(`DELETE FROM Saldo WHERE idPresupuesto = ?`, [pres.idPresupuesto])
    }
    setModal(null)
    reload()
    onUpdated()
  }

  function eliminar() {
    run(`DELETE FROM Presupuesto WHERE idPresupuesto = ?`, [pres.idPresupuesto])
    setDelConfirm(false)
    onUpdated()
    onBack()
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack}
            className="flex items-center gap-2 text-surface-400 hover:text-white text-sm font-body transition-colors">
            <ArrowLeft size={16} />Volver al historial
          </button>
          <span className="text-surface-600">/</span>
          <span className="text-surface-300 text-sm font-body">
            Presupuesto <span className="text-brand-400 font-mono">#{pres.idPresupuesto}</span>
          </span>
        </div>

      </div>

      {/* Cabecera */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-surface-400 text-xs tracking-widest uppercase font-body mb-1">Presupuesto</p>
            <h2 className="font-display text-4xl text-white tracking-widest">#{pres.idPresupuesto}</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge color={BADGE[estado.color]}>{estado.label}</Badge>
            <Badge color={BADGE[metodo.badge]}>{metodo.label}</Badge>
            {esExcepcion && <Badge color="violet">Excepción</Badge>}
            {saldo && <Badge color={saldo.estado==='pagado'?'green':'yellow'}>Saldo {saldo.estado}</Badge>}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Fecha</p>
            <p className="text-white text-sm font-mono">{fmtFecha(pres.fecha)}</p>
          </div>
          <div className="bg-surface-700 rounded-xl p-4 col-span-2">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Cliente</p>
            {cliente
              ? <><p className="text-white text-sm font-body font-medium">{cliente.nombre} {cliente.apellido}</p>
                  <p className="text-surface-400 text-xs font-mono mt-0.5">ID #{cliente.idCliente}{cliente.telefono?` · ${cliente.telefono}`:''}</p></>
              : <p className="text-surface-400 text-sm font-mono">ID #{pres.idCliente}</p>}
          </div>
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Método</p>
            <p className="text-white text-sm font-body">
              {esExcepcion ? `Excepción (base: ${metodo.label})` : metodo.label}
            </p>
            <p className="text-surface-500 text-xs font-mono mt-0.5">
              {esExcepcion ? pctLabel(pres.factorAplicado ?? (pres.montoOriginal > 0 ? pres.monto / pres.montoOriginal : 1)) : pctLabel(factorMostrado)}
            </p>
          </div>
        </div>

        {/* Acciones */}
        {puedeActuar && (
          <div className="mt-6 pt-5 border-t border-surface-700">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-3">Cambiar estado</p>
            <div className="flex flex-wrap gap-2">
              {pres.estado === 'borrador' && esCC && (
                <>
                  <Button size="sm" icon={ThumbsUp} onClick={() => setModal('aprobar')}>Marcar como Aprobado</Button>
                  <Button size="sm" variant="secondary" icon={XCircle}
                    className="hover:bg-red-500/15 hover:border-red-500/40 hover:text-red-400"
                    onClick={() => setModal('rechazar')}>Rechazar</Button>
                </>
              )}
              {pres.estado === 'borrador' && !esCC && (
                <>
                  <Button size="sm" icon={CheckCircle2} onClick={() => setModal('pagar')}>Marcar como Pagado</Button>
                  <Button size="sm" variant="secondary" icon={XCircle}
                    className="hover:bg-red-500/15 hover:border-red-500/40 hover:text-red-400"
                    onClick={() => setModal('rechazar')}>Rechazar</Button>
                </>
              )}
              {pres.estado === 'aprobado' && !esCC && (
                <Button size="sm" icon={CheckCircle2} onClick={() => setModal('pagar')}>Marcar como Pagado</Button>
              )}
              {pres.estado === 'aprobado' && esCC && (
                <div className="flex items-center gap-2 text-surface-400 text-xs font-body bg-surface-700 rounded-xl px-4 py-2.5">
                  <Clock size={13} />El cobro se gestiona desde <span className="text-white font-medium ml-1">Saldos</span>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Tabla ítems */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-700 flex items-center justify-between">
          <h3 className="font-body font-semibold text-white text-sm">Productos</h3>
          {!loading && <span className="text-surface-400 text-xs font-mono">{detalles.length} ítems</span>}
        </div>
        {loading
          ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
          : detalles.length === 0
            ? <p className="text-center py-10 text-surface-500 text-sm font-body">Sin ítems registrados.</p>
            : <div className="overflow-x-auto">
                <table className="w-full text-sm font-body">
                  <thead><tr className="border-b border-surface-700">
                    {['#','ID','Producto','Medida','Cant.','Precio Unit.','Subtotal'].map(h => (
                      <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {detalles.map((d, i) => (
                      <tr key={d.idDetalle} className="border-b border-surface-700/50">
                        <td className="py-3 px-4 text-surface-500 text-xs font-mono">{i+1}</td>
                        <td className="py-3 px-4 text-surface-400 font-mono text-xs">#{d.idProducto}</td>
                        <td className="py-3 px-4 text-white font-body">{d.nombreProducto ?? `#${d.idProducto}`}</td>
                        <td className="py-3 px-4">{d.medida ? <Badge color="blue">{d.medida}</Badge> : <span className="text-surface-500 text-xs">—</span>}</td>
                        <td className="py-3 px-4 text-surface-200 font-mono text-center">{d.cantidad}</td>
                        <td className="py-3 px-4 text-surface-200 font-mono">{fmt(d.precioUnitario)}</td>
                        <td className="py-3 px-4 text-surface-200 font-mono font-medium">{fmt(d.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
        }
      </Card>

      {/* Totales */}
      <Card className="p-6">
        <div className="max-w-xs ml-auto space-y-2 text-sm font-body">
          <div className="flex justify-between gap-12">
            <span className="text-surface-400">Subtotal (lista):</span>
            <span className="text-surface-200 font-mono">{fmt(pres.montoOriginal)}</span>
          </div>
          <div className="flex justify-between gap-12">
            <span className="text-surface-400">
              {esExcepcion ? `Ajuste excepción (${pctLabel(factorMostrado)})` : 'Ajuste:'}
            </span>
            <span className={`font-mono font-medium ${ajuste<0?'text-emerald-400':ajuste>0?'text-red-400':'text-surface-400'}`}>
              {ajuste===0?'—':ajuste<0?`- ${fmt(Math.abs(ajuste))}`:`+ ${fmt(ajuste)}`}
            </span>
          </div>
          <div className="border-t border-surface-700 pt-2 flex justify-between gap-12">
            <span className="text-white font-semibold">Total:</span>
            <span className="text-brand-400 font-mono font-bold text-lg">{fmt(pres.monto)}</span>
          </div>
        </div>
      </Card>

      {saldo && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-6">
            <div><p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Saldo</p><p className="text-white font-mono text-sm">#{saldo.idSaldo}</p></div>
            <div><p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Vence</p><p className="text-white text-sm">{fmtFecha(saldo.fechaFin)}</p></div>
            <div><p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Estado</p><Badge color={saldo.estado==='pagado'?'green':'yellow'}>{saldo.estado==='pagado'?'Cobrado':'Pendiente'}</Badge></div>
            <div><p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Monto</p><p className="text-brand-400 font-mono font-bold">{fmt(saldo.monto)}</p></div>
          </div>
        </Card>
      )}

      {/* Modales estado */}
      {[
        { key:'aprobar',  title:'Aprobar presupuesto', body:`Presupuesto #${pres.idPresupuesto} → Aprobado. Se descuenta stock y se genera saldo pendiente de cobro.`, action:()=>cambiarEstado('aprobado'), label:'Aprobar', icon:ThumbsUp },
        { key:'pagar',    title:'Registrar pago',      body:`Presupuesto #${pres.idPresupuesto} → Pagado. El ingreso de ${fmt(pres.monto)} se reflejará en estadísticas.`, action:()=>cambiarEstado('pagado'),   label:'Confirmar pago', icon:CheckCircle2 },
        { key:'rechazar', title:'Rechazar presupuesto',body:`Presupuesto #${pres.idPresupuesto} → Rechazado. No afecta stock.`, action:()=>cambiarEstado('rechazado'), label:'Rechazar', icon:XCircle, danger:true },
      ].map(m => (
        <Modal key={m.key} open={modal===m.key} onClose={()=>{setModal(null);setErrorModal('')}} title={m.title} width="max-w-sm">
          <p className="text-surface-300 text-sm font-body mb-4">{m.body}</p>
          {errorModal && <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 mb-4"><AlertCircle size={13}/>{errorModal}</div>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={()=>{setModal(null);setErrorModal('')}}>Cancelar</Button>
            <Button variant={m.danger?'danger':'primary'} className="flex-1" icon={m.icon} onClick={m.action}>{m.label}</Button>
          </div>
        </Modal>
      ))}

      {/* Modal eliminar */}
      <Modal open={delConfirm} onClose={()=>setDelConfirm(false)} title="Eliminar presupuesto" width="max-w-sm">
        <p className="text-surface-300 text-sm font-body mb-6">
          ¿Eliminar permanentemente el presupuesto <span className="text-white font-mono">#{pres.idPresupuesto}</span>? Esta acción no se puede deshacer.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={()=>setDelConfirm(false)}>Cancelar</Button>
          <Button variant="danger" className="flex-1" icon={Trash2} onClick={eliminar}>Eliminar</Button>
        </div>
      </Modal>

    </div>
  )
}

// ─── Lista ─────────────────────────────────────────────────────────────────

export default function Historial() {
  const [presupuestos, setPresupuestos] = useState([])
  const [search,       setSearch]       = useState('')
  const [filterMetodo, setFilterMetodo] = useState('all')
  const [filterEstado, setFilterEstado] = useState('all')
  const [soloExcepcion,setSoloExcepcion]= useState(false)
  const [filterFechaD, setFilterFechaD] = useState('')
  const [filterFechaH, setFilterFechaH] = useState('')
  const [sortDir,      setSortDir]      = useState('desc')
  const [page,         setPage]         = useState(1)
  const [selected,     setSelected]     = useState(null)

  const load = useCallback(() => {
    let sql = `
      SELECT p.*, c.nombre AS clienteNombre, c.apellido AS clienteApellido, s.estado AS saldoEstado
      FROM Presupuesto p
      LEFT JOIN Cliente c ON c.idCliente = p.idCliente
      LEFT JOIN Saldo   s ON s.idPresupuesto = p.idPresupuesto
      WHERE 1=1`
    const params = []
    if (search.trim()) {
      sql += ` AND (p.idPresupuesto=? OR c.nombre LIKE ? OR c.apellido LIKE ?)`
      params.push(parseInt(search)||-1, `%${search.trim()}%`, `%${search.trim()}%`)
    }
    if (filterMetodo !== 'all') { sql += ` AND p.metodoPago=?`; params.push(filterMetodo) }
    if (filterEstado !== 'all') { sql += ` AND p.estado=?`;     params.push(filterEstado) }
    if (soloExcepcion)          { sql += ` AND p.esExcepcion=1` }
    if (filterFechaD)           { sql += ` AND p.fecha>=?`; params.push(filterFechaD) }
    if (filterFechaH)           { sql += ` AND p.fecha<=?`; params.push(filterFechaH) }
    sql += ` ORDER BY p.idPresupuesto ${sortDir.toUpperCase()}`
    setPresupuestos(query(sql, params))
    setPage(1)
  }, [search, filterMetodo, filterEstado, soloExcepcion, filterFechaD, filterFechaH, sortDir])

  useEffect(() => { load() }, [load])

  const paginated  = presupuestos.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(presupuestos.length/PAGE_SIZE))
  const totalMonto = presupuestos.filter(p => p.estado === 'pagado' || (p.saldoEstado === 'pagado')).reduce((a,p) => a+p.monto, 0)
  const pendCobro  = presupuestos.filter(p => p.saldoEstado === 'pendiente').length
  const hasFilters = search || filterMetodo!=='all' || filterEstado!=='all' || soloExcepcion || filterFechaD || filterFechaH

  if (selected) return (
    <PresupuestoDetalle
      presupuesto={selected}
      onBack={()=>{ setSelected(null); load() }}
      onUpdated={load}
    />
  )

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <PageHeader title="Historial" subtitle="Presupuestos emitidos" />

      {/* Resumen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label:'Total',             value: presupuestos.length },
          { label:'Facturado',         value: fmt(totalMonto) },
          { label:'Saldos pendientes', value: pendCobro },
          { label:'Aprobados',         value: presupuestos.filter(p=>p.estado==='aprobado').length },
        ].map(({label,value}) => (
          <div key={label} className="bg-surface-800 border border-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body">{label}</p>
            <p className="font-display text-2xl text-white tracking-widest mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por ID o cliente..."
              className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2 text-white
                         text-sm font-body placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all" />
          </div>

          <select value={filterEstado} onChange={e=>setFilterEstado(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm font-body focus:outline-none focus:border-brand-500 cursor-pointer">
            <option value="all">Todos los estados</option>
            {Object.entries(ESTADOS).map(([v,s]) => <option key={v} value={v}>{s.label}</option>)}
          </select>

          <select value={filterMetodo} onChange={e=>setFilterMetodo(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm font-body focus:outline-none focus:border-brand-500 cursor-pointer">
            <option value="all">Todos los métodos</option>
            {Object.entries(METODOS_PAGO).map(([v,m]) => <option key={v} value={v}>{m.label}</option>)}
          </select>

          {/* Checkbox excepción */}
          <label className="flex items-center gap-2 cursor-pointer select-none bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 transition-all hover:border-surface-500">
            <input type="checkbox" checked={soloExcepcion} onChange={e=>setSoloExcepcion(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-brand-500 cursor-pointer" />
            <span className="text-surface-300 text-sm font-body">Solo excepciones</span>
          </label>

          <div className="flex flex-col gap-1">
            <label className="text-surface-400 text-xs uppercase tracking-widest font-body">Desde</label>
            <input type="date" value={filterFechaD} onChange={e=>setFilterFechaD(e.target.value)}
              className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm font-body focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-surface-400 text-xs uppercase tracking-widest font-body">Hasta</label>
            <input type="date" value={filterFechaH} onChange={e=>setFilterFechaH(e.target.value)}
              className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm font-body focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
          </div>

          <button onClick={()=>setSortDir(d=>d==='desc'?'asc':'desc')}
            className="flex items-center gap-2 bg-surface-700 border border-surface-600 hover:border-surface-500 rounded-xl px-3 py-2 text-white text-sm font-body transition-all">
            {sortDir==='desc'?<><ChevronDown size={15}/>Más recientes</>:<><ChevronUp size={15}/>Más antiguos</>}
          </button>

          {hasFilters && (
            <button onClick={()=>{setSearch('');setFilterMetodo('all');setFilterEstado('all');setSoloExcepcion(false);setFilterFechaD('');setFilterFechaH('')}}
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
                {['ID','Fecha','Cliente','Método','Estado','Total','Saldo',''].map(h => (
                  <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map(p => {
                const m  = METODOS_PAGO[p.metodoPago] ?? { label:p.metodoPago, badge:'gray' }
                const e  = ESTADOS[p.estado] ?? ESTADOS.borrador
                return (
                  <tr key={p.idPresupuesto} onClick={()=>setSelected(p)}
                    className="border-b border-surface-700/50 hover:bg-surface-700/40 cursor-pointer transition-colors">
                    <td className="py-3 px-4 text-brand-400 font-mono text-sm font-bold">#{p.idPresupuesto}</td>
                    <td className="py-3 px-4 text-surface-300 font-mono text-xs">{fmtFecha(p.fecha)}</td>
                    <td className="py-3 px-4 text-white font-body">
                      {p.clienteNombre ? `${p.clienteNombre} ${p.clienteApellido}` : <span className="text-surface-500 font-mono text-xs">#{p.idCliente}</span>}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        <Badge color={BADGE[m.badge]}>{m.label}</Badge>
                        {p.esExcepcion===1 && <Badge color="violet">Exc.</Badge>}
                      </div>
                    </td>
                    <td className="py-3 px-4"><Badge color={BADGE[e.color]}>{e.label}</Badge></td>
                    <td className="py-3 px-4 text-white font-mono font-medium">{fmt(p.monto)}</td>
                    <td className="py-3 px-4">
                      {p.saldoEstado==='pendiente' && <Badge color="yellow">Pendiente</Badge>}
                      {p.saldoEstado==='pagado'    && <Badge color="green">Cobrado</Badge>}
                      {!p.saldoEstado              && <span className="text-surface-600 text-xs">—</span>}
                    </td>
                    <td className="py-3 px-4 text-surface-500"><FileText size={15}/></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {presupuestos.length === 0 && (
          <div className="flex flex-col items-center py-16 gap-3 text-surface-500">
            <Clock size={32} className="opacity-30"/>
            <p className="font-body text-sm">No hay presupuestos que coincidan.</p>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-surface-700">
            <p className="text-surface-400 text-xs font-body">
              {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE,presupuestos.length)} de {presupuestos.length}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}>← Ant.</Button>
              <Button size="sm" variant="secondary" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}>Sig. →</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
