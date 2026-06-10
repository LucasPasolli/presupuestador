// src/pages/Historial.jsx
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Presupuestador from './Presupuestador'
import { generarPDFPresupuesto } from '../lib/pdfPresupuesto'
import { Card, PageHeader, Button, Badge, Modal } from '../components/ui'
import {
  Search, ChevronDown, ChevronUp, ArrowLeft, FileText,
  Clock, CheckCircle2, XCircle, ThumbsUp, AlertCircle, Trash2, Download, Pencil, X, Wallet, Tag
} from 'lucide-react'
import {
  obtenerPresupuestos,
  obtenerPresupuestoPorId,
  obtenerDetallesDePresupuesto,
  actualizarEstadoPresupuesto,
  eliminarPresupuesto,
} from '../services/presupuestosService'
import { obtenerClientePorId } from '../services/clientesService'
import {
  crearSaldo,
  obtenerSaldoPorPresupuesto,
  eliminarSaldoPorPresupuesto,
} from '../services/saldosService'
import { descontarStock } from '../services/productosService'
import { useDebounce } from '../hooks/useDebounce'

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

// Cuántos registros pedir al servidor por página.
// Supabase resuelve el LIMIT/OFFSET; el browser solo renderiza estos N.
const PAGE_SIZE = 50

const METODOS_FACTOR = {
  efectivo:      0.95,
  transferencia: 0.95,
  cc15:          1.00,
  cc30:          1.105,
}

// ─── Skeleton de fila ──────────────────────────────────────────────────────
// Muestra filas "fantasma" con animate-pulse mientras se carga la data.
// Evita el parpadeo / tabla-vacía que da sensación de lentitud.
function SkeletonRows({ count = 8 }) {
  const widths = ['w-12', 'w-20', 'w-40', 'w-24', 'w-20', 'w-24', 'w-16', 'w-8']
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="border-b border-surface-700/50">
          {widths.map((w, j) => (
            <td key={j} className="py-3 px-4">
              <div className={`h-4 ${w} bg-surface-700 rounded animate-pulse`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

// ─── Vista detalle ─────────────────────────────────────────────────────────

function PresupuestoDetalle({ presupuesto: presInit, onBack, onUpdated, onEditar, onNavigarSaldo }) {
  const [pres,       setPres]       = useState(presInit)
  const [detalles,   setDetalles]   = useState([])
  const [cliente,    setCliente]    = useState(null)
  const [saldo,      setSaldo]      = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [modal,      setModal]      = useState(null)
  const [errorModal, setErrorModal] = useState('')
  const [delConfirm, setDelConfirm] = useState(false)

  // Memoizado para que las sumas de detalles no se recalculen en cada render
  // del detalle (p.ej. al abrir/cerrar modales).
  const totalesDetalle = useMemo(() => {
    const precioLista      = detalles.reduce((acc, d) => acc + (parseFloat(d.precioUnitario) || 0) * (parseFloat(d.cantidad) || 0), 0)
    const subtotalConPromo = detalles.reduce((acc, d) => acc + (parseFloat(d.subtotal) || 0), 0)
    const ahorroPromo      = precioLista - subtotalConPromo
    const ajusteMetodo     = (parseFloat(pres.monto) || 0) - subtotalConPromo
    return { precioLista, subtotalConPromo, ahorroPromo, ajusteMetodo }
  }, [detalles, pres.monto])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [p, rows, sal] = await Promise.all([
        obtenerPresupuestoPorId(pres.idPresupuesto),
        obtenerDetallesDePresupuesto(pres.idPresupuesto),
        obtenerSaldoPorPresupuesto(pres.idPresupuesto),
      ])
      if (p) setPres(p)
      setDetalles(rows)
      setSaldo(sal)

      try {
        const cl = await obtenerClientePorId(pres.idCliente)
        setCliente(cl)
      } catch {
        setCliente(null) // cliente eliminado
      }
    } catch (err) {
      console.error('[PresupuestoDetalle] Error recargando:', err)
    } finally {
      setLoading(false)
    }
  }, [pres.idPresupuesto, pres.idCliente])

  useEffect(() => { reload() }, [reload])

  const esCC        = pres.metodoPago === 'cc15' || pres.metodoPago === 'cc30'
  const esExcepcion = pres.esExcepcion === 1
  const estado      = ESTADOS[pres.estado]  ?? ESTADOS.borrador
  const metodo      = METODOS_PAGO[pres.metodoPago] ?? { label: pres.metodoPago, badge: 'gray' }
  const puedeActuar = pres.estado === 'borrador' || pres.estado === 'aprobado'

  const _subtotalConPromo = detalles.reduce((acc, d) => acc + (parseFloat(d.subtotal) || 0), 0)
  let factorReal
  if (esExcepcion) {
    factorReal = _subtotalConPromo > 0 ? (parseFloat(pres.monto) || 0) / _subtotalConPromo : 1
  } else {
    factorReal = METODOS_FACTOR[pres.metodoPago] ?? 1
  }
  const ajusteLabel = pctLabel(factorReal)

  async function cambiarEstado(nuevoEstado) {
    setErrorModal('')
    try {
      const estadoAnterior = pres.estado

      await actualizarEstadoPresupuesto(pres.idPresupuesto, nuevoEstado)

      const debeDescontar = (nuevoEstado === 'aprobado' || nuevoEstado === 'pagado') &&
                            estadoAnterior !== 'aprobado' && estadoAnterior !== 'pagado'
      if (debeDescontar) {
        for (const d of detalles) {
          try {
            await descontarStock(d.idProducto, d.cantidad, d.medida ?? null)
          } catch {
            // producto eliminado → ignorar
          }
        }
      }

      if (nuevoEstado === 'aprobado' && esCC) {
        const yaExiste = await obtenerSaldoPorPresupuesto(pres.idPresupuesto)
        if (!yaExiste) {
          const diasCC   = pres.metodoPago === 'cc15' ? 15 : 30
          const fechaFin = new Date(pres.fecha)
          fechaFin.setDate(fechaFin.getDate() + diasCC)
          await crearSaldo({
            idPresupuesto: pres.idPresupuesto,
            idCliente:     pres.idCliente,
            fechaInicio:   pres.fecha,
            fechaVto:      fechaFin.toISOString().slice(0, 10),
            monto:         pres.monto,
            estado:        'pendiente',
          })
        }
      }

      if (nuevoEstado === 'rechazado') {
        await eliminarSaldoPorPresupuesto(pres.idPresupuesto)
      }

      setModal(null)
      await reload()
      onUpdated()
    } catch (err) {
      setErrorModal(err.message)
    }
  }

  async function eliminar() {
    try {
      await eliminarPresupuesto(pres.idPresupuesto)
      setDelConfirm(false)
      onUpdated()
      onBack()
    } catch (err) {
      console.error('[PresupuestoDetalle] Error eliminando:', err)
    }
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
        <div className="flex items-center gap-2">
          {pres.estado === 'borrador' && (
            <Button size="sm" variant="secondary" icon={Pencil} onClick={() => onEditar(pres.idPresupuesto)}>
              Editar
            </Button>
          )}
          <Button size="sm" variant="secondary" icon={Download}
            onClick={() => generarPDFPresupuesto(pres.idPresupuesto)}>
            Descargar PDF
          </Button>
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
            {saldo && <Badge color={saldo.estado === 'pagado' ? 'green' : 'yellow'}>Saldo {saldo.estado}</Badge>}
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
              ? <>
                  <p className="text-white text-sm font-body font-medium">{cliente.nombre} {cliente.apellido}</p>
                  <p className="text-surface-400 text-xs font-mono mt-0.5">
                    ID #{cliente.idCliente}{cliente.telefono ? ` · ${cliente.telefono}` : ''}
                  </p>
                </>
              : <>
                  <p className="text-white text-sm font-body font-medium">
                    {pres.nombreCliente ? `${pres.nombreCliente} ${pres.apellidoCliente ?? ''}`.trim() : `ID #${pres.idCliente}`}
                  </p>
                  <p className="text-surface-500 text-xs font-mono mt-0.5">Cliente eliminado · ID #{pres.idCliente}</p>
                </>
            }
          </div>
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Método</p>
            <p className="text-white text-sm font-body">
              {esExcepcion ? `Excepción (${metodo.label})` : metodo.label}
            </p>
            <p className={`text-xs font-mono mt-0.5 ${factorReal < 1 ? 'text-emerald-400' : factorReal > 1 ? 'text-red-400' : 'text-surface-500'}`}>
              {ajusteLabel}
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
                        <td className="py-3 px-4">
                          {d.precioConPromo != null ? (
                            <div className="space-y-0.5">
                              <div className="text-surface-500 text-xs font-mono line-through">{fmt(d.precioUnitario)}</div>
                              <div className="text-emerald-400 text-sm font-mono font-semibold">{fmt(d.precioConPromo)}</div>
                              <div className="flex items-center gap-1 mt-0.5">
                                <Tag size={10} className="text-emerald-500 flex-shrink-0" />
                                <span className="text-emerald-500 text-[10px] font-body">
                                  −{Math.round((1 - d.precioConPromo / d.precioUnitario) * 100)}%
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-surface-200 font-mono">{fmt(d.precioUnitario)}</span>
                          )}
                        </td>
                        <td className={`py-3 px-4 font-mono font-medium ${d.precioConPromo != null ? 'text-emerald-300' : 'text-surface-200'}`}>{fmt(d.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
        }
      </Card>

      {/* Totales — ahora usa totalesDetalle memoizado */}
      <Card className="p-6">
        <div className="ml-auto w-fit min-w-[280px] space-y-2 text-sm font-body">
          <div className="flex justify-between gap-8">
            <span className="text-surface-400 shrink-0">Subtotal (lista):</span>
            <span className="text-surface-200 font-mono text-right">{fmt(totalesDetalle.precioLista)}</span>
          </div>
          {totalesDetalle.ahorroPromo > 0.01 && (
            <>
              <div className="flex justify-between gap-8 items-center">
                <span className="flex items-center gap-1.5 text-emerald-400 shrink-0">
                  <Tag size={11} />Ahorro por promociones:
                </span>
                <span className="text-emerald-400 font-mono font-medium text-right">− {fmt(totalesDetalle.ahorroPromo)}</span>
              </div>
              <div className="flex justify-between gap-8">
                <span className="text-surface-400 shrink-0">Subtotal con promos:</span>
                <span className="text-surface-200 font-mono text-right">{fmt(totalesDetalle.subtotalConPromo)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between gap-8">
            <span className="text-surface-400 shrink-0">
              Ajuste por método de pago
              {esExcepcion && totalesDetalle.ajusteMetodo !== 0 && (
                <span className="ml-1 text-xs text-violet-400 font-body">[Excepción]</span>
              )}:
            </span>
            <span className={`font-mono font-medium text-right ${
              Math.abs(totalesDetalle.ajusteMetodo) < 0.01 ? 'text-surface-400'
              : totalesDetalle.ajusteMetodo < 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {Math.abs(totalesDetalle.ajusteMetodo) < 0.01 ? '—'
                : totalesDetalle.ajusteMetodo < 0 ? `- ${fmt(Math.abs(totalesDetalle.ajusteMetodo))}` : `+ ${fmt(totalesDetalle.ajusteMetodo)}`}
            </span>
          </div>
          <div className="border-t border-surface-700 pt-2 flex justify-between gap-8">
            <span className="text-white font-semibold shrink-0">Total:</span>
            <span className="text-brand-400 font-mono font-bold text-lg text-right">{fmt(pres.monto)}</span>
          </div>
        </div>
      </Card>

      {saldo && (
        <div className="cursor-pointer group" onClick={() => onNavigarSaldo && onNavigarSaldo(saldo)}>
          <Card className="p-5 group-hover:border-brand-500/40 group-hover:bg-surface-700/20 transition-all">
            <div className="flex items-center justify-between mb-4">
              <p className="text-surface-400 text-xs uppercase tracking-widest font-body flex items-center gap-1.5">
                <Wallet size={11} />Saldo asociado
              </p>
              <span className="text-brand-400 text-xs font-body flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                Ver en Saldos →
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-surface-700 rounded-xl p-3">
                <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Saldo</p>
                <p className="text-white font-mono text-sm font-bold">#{saldo.idSaldo}</p>
              </div>
              <div className="bg-surface-700 rounded-xl p-3">
                <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Vence</p>
                <p className="text-white text-sm font-mono">{fmtFecha(saldo.fechaVto)}</p>
              </div>
              <div className="bg-surface-700 rounded-xl p-3">
                <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Estado</p>
                <Badge color={saldo.estado === 'pagado' ? 'green' : 'yellow'}>
                  {saldo.estado === 'pagado' ? 'Cobrado' : 'Pendiente'}
                </Badge>
              </div>
              <div className="bg-surface-700 rounded-xl p-3">
                <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Monto</p>
                <p className="text-brand-400 font-mono font-bold">{fmt(saldo.monto)}</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Modales estado */}
      {[
        { key:'aprobar',  title:'Aprobar presupuesto',  body:`Presupuesto #${pres.idPresupuesto} → Aprobado. Se descuenta stock y se genera saldo pendiente de cobro.`, action:()=>cambiarEstado('aprobado'),   label:'Aprobar',        icon:ThumbsUp },
        { key:'pagar',    title:'Registrar pago',        body:`Presupuesto #${pres.idPresupuesto} → Pagado. El ingreso de ${fmt(pres.monto)} se reflejará en estadísticas y el stock será modificado.`, action:()=>cambiarEstado('pagado'),     label:'Confirmar pago', icon:CheckCircle2 },
        { key:'rechazar', title:'Rechazar presupuesto',  body:`Presupuesto #${pres.idPresupuesto} → Rechazado. No afecta stock.`, action:()=>cambiarEstado('rechazado'), label:'Rechazar',       icon:XCircle, danger:true },
      ].map(m => (
        <Modal key={m.key} open={modal===m.key} onClose={()=>{setModal(null);setErrorModal('')}} title={m.title} width="max-w-sm">
          <p className="text-surface-300 text-sm font-body mb-4">{m.body}</p>
          {errorModal && (
            <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 mb-4">
              <AlertCircle size={13}/>{errorModal}
            </div>
          )}
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
  const navigate = useNavigate()
  const location = useLocation()

  // ── Filtros ──────────────────────────────────────────────────────────────
  const [search,        setSearch]        = useState('')
  const [filterMetodo,  setFilterMetodo]  = useState('all')
  const [filterEstado,  setFilterEstado]  = useState('all')
  const [soloExcepcion, setSoloExcepcion] = useState(false)
  const [filterFechaD,  setFilterFechaD]  = useState('')
  const [filterFechaH,  setFilterFechaH]  = useState('')
  const [sortDir,       setSortDir]       = useState('desc')
  const [sortKey,       setSortKey]       = useState('id')

  // ── Paginación server-side ────────────────────────────────────────────────
  // `page` controla el offset que se envía a Supabase.
  // `totalCount` viene del count:'exact' de la query — nunca descargamos todas las filas.
  const [page,       setPage]       = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  // ── Data y estado de carga ────────────────────────────────────────────────
  const [presupuestos, setPresupuestos] = useState([])
  const [loading,      setLoading]      = useState(true)

  // ── Vista activa ──────────────────────────────────────────────────────────
  const [selected, setSelected] = useState(null)
  const [editando, setEditando] = useState(null)

  // ── Debounce del buscador ─────────────────────────────────────────────────
  // El input actualiza `search` en cada keystroke (fluido para el usuario),
  // pero `debouncedSearch` solo cambia 400ms después de que el usuario para de escribir.
  // Esto evita disparar una query a Supabase por cada letra ingresada.
  const debouncedSearch = useDebounce(search, 400)

  // ── Fetch principal ───────────────────────────────────────────────────────
  // IMPORTANTE: `debouncedSearch` está en el array de dependencias, no `search`.
  // `page` también es dependencia: cambiar de página re-fetcha con el nuevo offset.
  // Cuando cambia un filtro, reseteamos a página 1 (ver useEffect más abajo).
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, count } = await obtenerPresupuestos({
        estado:      filterEstado !== 'all' ? filterEstado : null,
        metodoPago:  filterMetodo !== 'all' ? filterMetodo : null,
        esExcepcion: soloExcepcion || null,
        fechaDesde:  filterFechaD || null,
        fechaHasta:  filterFechaH || null,
        sortKey,
        orden:       sortDir,
        search:      debouncedSearch.trim() || null,
        limite:      PAGE_SIZE,
        offset:      (page - 1) * PAGE_SIZE,
      })
      setPresupuestos(data)
      setTotalCount(count)
    } catch (err) {
      console.error('[Historial] Error cargando:', err)
    } finally {
      setLoading(false)
    }
  }, [page, filterMetodo, filterEstado, soloExcepcion,
      filterFechaD, filterFechaH, sortDir, sortKey, debouncedSearch])

  useEffect(() => { load() }, [load])

  // Resetear a página 1 cuando cambia cualquier filtro (no la página en sí).
  // Sin esto, al filtrar desde la página 3 no volvería a la 1.
  useEffect(() => {
    setPage(1)
  }, [filterMetodo, filterEstado, soloExcepcion,
      filterFechaD, filterFechaH, sortDir, sortKey, debouncedSearch])

  // Si venimos del Presupuestador con state.verPresupuesto, abrir el detalle directamente
  useEffect(() => {
    const id = location.state?.verPresupuesto
    if (!id) return
    obtenerPresupuestoPorId(id).then(p => { if (p) setSelected(p) }).catch(() => {})
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.state?.verPresupuesto])

  // ── Derivados memoizados ──────────────────────────────────────────────────
  // Se recalculan solo cuando `presupuestos` cambia, no en cada re-render
  // causado por aperturas de modal, hover, etc.
  const { totalMonto, pendCobro, totalPages } = useMemo(() => ({
    totalMonto: presupuestos
      .filter(p => p.estado === 'pagado' || p.saldoEstado === 'pagado')
      .reduce((a, p) => a + (p.monto ?? 0), 0),
    pendCobro:  presupuestos.filter(p => p.saldoEstado === 'pendiente').length,
    totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
  }), [presupuestos, totalCount])

  const hasAnyFilter = search || filterMetodo !== 'all' || filterEstado !== 'all'
    || filterFechaD || filterFechaH || soloExcepcion

  // ── Helpers de UI ─────────────────────────────────────────────────────────
  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function SortIcon({ col }) {
    if (sortKey !== col) return <span className="text-surface-600 ml-1">↕</span>
    return sortDir === 'asc'
      ? <ChevronUp size={13} className="inline ml-1" />
      : <ChevronDown size={13} className="inline ml-1" />
  }

  async function irADetalle(id) {
    setEditando(null)
    try {
      const p = await obtenerPresupuestoPorId(id)
      if (p) setSelected(p)
      load()
    } catch (err) { console.error('[Historial] irADetalle:', err) }
  }

  // ── Renders condicionales ─────────────────────────────────────────────────
  if (editando) return (
    <Presupuestador
      presupuestoEditar={editando}
      onEditarVolver={irADetalle}
      onVerHistorial={irADetalle}
    />
  )

  if (selected) return (
    <PresupuestoDetalle
      presupuesto={selected}
      onBack={() => { setSelected(null); load() }}
      onUpdated={load}
      onEditar={(id) => { setEditando(id); setSelected(null) }}
      onNavigarSaldo={(saldo) => {
        setSelected(null)
        navigate('/saldos', { state: { saldoInicial: saldo } })
      }}
    />
  )

  // ── Render principal ──────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <PageHeader title="Historial" subtitle="Presupuestos emitidos" />

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
            {/* Input controlado por `search` (fluido), query usa `debouncedSearch` (optimizado) */}
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por ID o cliente..."
              className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2 text-white
                         text-sm font-body placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all" />
          </div>

          {(() => {
            const metodosFiltrados = Object.entries(METODOS_PAGO).filter(([v]) => {
              const esCC = v === 'cc15' || v === 'cc30'
              if (filterEstado === 'pagado'   && esCC)  return false
              if (filterEstado === 'aprobado' && !esCC) return false
              return true
            })
            return (
              <select value={filterMetodo} onChange={e => {
                const nuevoMetodo = e.target.value
                setFilterMetodo(nuevoMetodo)
                const nuevoEsCC          = nuevoMetodo === 'cc15' || nuevoMetodo === 'cc30'
                const nuevoEsEfectTransf = nuevoMetodo === 'efectivo' || nuevoMetodo === 'transferencia'
                if (nuevoEsCC          && filterEstado === 'pagado')   setFilterEstado('all')
                if (nuevoEsEfectTransf && filterEstado === 'aprobado') setFilterEstado('all')
              }}
                className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm font-body focus:outline-none focus:border-brand-500 cursor-pointer">
                <option value="all">Todos los métodos</option>
                {metodosFiltrados.map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
              </select>
            )
          })()}

          {(() => {
            const esCC          = filterMetodo === 'cc15' || filterMetodo === 'cc30'
            const esEfectTransf = filterMetodo === 'efectivo' || filterMetodo === 'transferencia'
            const estadosFiltrados = Object.entries(ESTADOS).filter(([v]) => {
              if (v === 'pagado'   && esCC)          return false
              if (v === 'aprobado' && esEfectTransf) return false
              return true
            })
            return (
              <select value={filterEstado} onChange={e => {
                const nuevoEstado = e.target.value
                setFilterEstado(nuevoEstado)
                const metodoEsCC          = filterMetodo === 'cc15' || filterMetodo === 'cc30'
                const metodoEsEfectTransf = filterMetodo === 'efectivo' || filterMetodo === 'transferencia'
                if (nuevoEstado === 'pagado'   && metodoEsCC)          setFilterMetodo('all')
                if (nuevoEstado === 'aprobado' && metodoEsEfectTransf) setFilterMetodo('all')
              }}
                className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm font-body focus:outline-none focus:border-brand-500 cursor-pointer">
                <option value="all">Todos los estados</option>
                {estadosFiltrados.map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            )
          })()}

          <label className="flex items-center gap-2 cursor-pointer select-none bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 transition-all hover:border-surface-500">
            <input type="checkbox" checked={soloExcepcion} onChange={e => setSoloExcepcion(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-brand-500 cursor-pointer" />
            <span className="text-surface-300 text-sm font-body">Solo excepciones</span>
          </label>

          <div className="flex flex-col gap-1">
            <label className="text-surface-400 text-xs uppercase tracking-widest font-body">Desde</label>
            <input type="date" value={filterFechaD} onChange={e => setFilterFechaD(e.target.value)}
              className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm font-body focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-surface-400 text-xs uppercase tracking-widest font-body">Hasta</label>
            <input type="date" value={filterFechaH} onChange={e => setFilterFechaH(e.target.value)}
              className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm font-body focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
          </div>

          {hasAnyFilter && (
            <button
              onClick={() => {
                setSearch(''); setFilterMetodo('all'); setFilterEstado('all')
                setSoloExcepcion(false); setFilterFechaD(''); setFilterFechaH('')
              }}
              className="flex items-center gap-2 bg-surface-700 border border-surface-600 rounded-xl px-3 py-2
                         text-surface-300 text-sm font-body hover:border-red-500/50 hover:text-red-400
                         hover:bg-red-500/10 transition-all cursor-pointer whitespace-nowrap">
              <X size={13} />Limpiar filtros
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
                <th className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body cursor-pointer hover:text-white transition-colors"
                  onClick={() => toggleSort('id')}>
                  <div className="flex items-center gap-1">ID <SortIcon col="id" /></div>
                </th>
                <th className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body cursor-pointer hover:text-white transition-colors"
                  onClick={() => toggleSort('fecha')}>
                  <div className="flex items-center gap-1">Fecha <SortIcon col="fecha" /></div>
                </th>
                {['Cliente','Método','Estado','Total','Saldo',''].map(h => (
                  <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Skeleton mientras carga — reemplaza el "tabla vacía" anterior */}
              {loading
                ? <SkeletonRows count={PAGE_SIZE > 8 ? 8 : PAGE_SIZE} />
                : presupuestos.map(p => {
                    const m = METODOS_PAGO[p.metodoPago] ?? { label: p.metodoPago, badge: 'gray' }
                    const e = ESTADOS[p.estado] ?? ESTADOS.borrador
                    return (
                      <tr key={p.idPresupuesto} onClick={() => setSelected(p)}
                        className="border-b border-surface-700/50 hover:bg-surface-700/40 cursor-pointer transition-colors">
                        <td className="py-3 px-4 text-brand-400 font-mono text-sm font-bold">#{p.idPresupuesto}</td>
                        <td className="py-3 px-4 text-surface-300 font-mono text-xs">{fmtFecha(p.fecha)}</td>
                        <td className="py-3 px-4 text-white font-body">
                          {p.nombreCliente
                            ? `${p.nombreCliente} ${p.apellidoCliente ?? ''}`
                            : <span className="text-surface-500 font-mono text-xs">#{p.idCliente}</span>}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <Badge color={BADGE[m.badge]}>{m.label}</Badge>
                            {p.esExcepcion === 1 && <Badge color="violet">Exc.</Badge>}
                          </div>
                        </td>
                        <td className="py-3 px-4"><Badge color={BADGE[e.color]}>{e.label}</Badge></td>
                        <td className="py-3 px-4 text-white font-mono font-medium">{fmt(p.monto)}</td>
                        <td className="py-3 px-4">
                          {p.saldoEstado === 'pendiente' && <Badge color="yellow">Pendiente</Badge>}
                          {p.saldoEstado === 'pagado'    && <Badge color="green">Cobrado</Badge>}
                          {!p.saldoEstado                && <span className="text-surface-600 text-xs">—</span>}
                        </td>
                        <td className="py-3 px-4 text-surface-500"><FileText size={15}/></td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>

        {!loading && presupuestos.length === 0 && (
          <div className="flex flex-col items-center py-16 gap-3 text-surface-500">
            <Clock size={32} className="opacity-30"/>
            <p className="font-body text-sm">No hay presupuestos que coincidan.</p>
          </div>
        )}

        {/* Paginación — ahora muestra totalCount real del servidor */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-surface-700">
            <p className="text-surface-400 text-xs font-body">
              {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, totalCount)} de {totalCount}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary"
                onClick={() => setPage(p => Math.max(1, p-1))}
                disabled={page === 1 || loading}>← Anterior</Button>
              <Button size="sm" variant="secondary"
                onClick={() => setPage(p => Math.min(totalPages, p+1))}
                disabled={page === totalPages || loading}>Siguiente →</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
