// src/pages/Saldos.jsx
import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { usePaginatedList } from '../hooks/usePaginatedList'
import {
  obtenerSaldos,
  obtenerKPIsSaldos,
  marcarSaldoPagado,
} from '../services/saldosService'
import { obtenerClientePorId }                    from '../services/clientesService'
import { obtenerPresupuestoPorId }                from '../services/presupuestosService'
import { obtenerDetallesConNombreDePresupuesto }   from '../services/presupuestosService'
import {
  buscarClientesConDeuda,
  obtenerSaldosImputablesDeCliente,
  previsualizarImputacion,
  registrarPagoParcial,
  obtenerAplicacionesDeSaldo,
} from '../services/pagosService'
import { Card, PageHeader, Button, Badge, Modal } from '../components/ui'
import {
  ArrowLeft, Wallet, Clock, CheckCircle2, AlertTriangle,
  CalendarClock, User, FileText, BadgeCheck, Search, ChevronDown, ChevronUp,
  Coins, Loader2, X, History,
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

// CORRECCIÓN #8: helper centralizado de estado → label/color de Badge,
// para que 'parcial' se vea consistente en toda la vista (lista + detalle).
function estadoInfo(estado) {
  switch (estado) {
    case 'pagado':  return { label: 'Cobrado',      color: 'green'  }
    case 'parcial': return { label: 'Pago Parcial', color: 'blue'   }
    default:        return { label: 'Pendiente',    color: 'yellow' }
  }
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

// ─── Modal: Registrar Pago Parcial ──────────────────────────────────────────
//
// Flujo en dos pasos:
//   1) Buscar y seleccionar el cliente (solo aparecen clientes con deuda).
//   2) Ingresar monto/método/fecha, ver la previsualización de imputación
//      cronológica y confirmar. El cálculo real y persistido lo hace el
//      servidor (fn_aplicar_pago_cliente); esta preview es solo UX.

function PagoParcialModal({ open, onClose, onSuccess }) {
  const [query, setQuery]                   = useState('')
  const [buscando, setBuscando]              = useState(false)
  const [resultados, setResultados]          = useState([])
  const [cliente, setCliente]                = useState(null)
  const [saldosCliente, setSaldosCliente]    = useState([])
  const [cargandoSaldos, setCargandoSaldos]  = useState(false)
  const [monto, setMonto]                    = useState('')
  const [metodoPago, setMetodoPago]          = useState('efectivo')
  const [fecha, setFecha]                    = useState(today())
  const [descripcion, setDescripcion]        = useState('')
  const [enviando, setEnviando]              = useState(false)
  const [error, setError]                    = useState('')
  const [resultado, setResultado]            = useState(null)

  // Reset total al cerrar el modal
  useEffect(() => {
    if (!open) {
      setQuery(''); setResultados([]); setCliente(null); setSaldosCliente([])
      setMonto(''); setMetodoPago('efectivo'); setFecha(today()); setDescripcion('')
      setEnviando(false); setError(''); setResultado(null)
    }
  }, [open])

  // Búsqueda de clientes con deuda, con debounce de 300ms
  useEffect(() => {
    if (!open || cliente) return
    setBuscando(true)
    const t = setTimeout(async () => {
      try {
        const r = await buscarClientesConDeuda(query)
        setResultados(r)
      } catch (e) {
        console.error(e)
      } finally {
        setBuscando(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query, open, cliente])

  async function seleccionarCliente(c) {
    setCliente(c)
    setCargandoSaldos(true)
    setError('')
    try {
      const saldos = await obtenerSaldosImputablesDeCliente(c.idCliente)
      setSaldosCliente(saldos)
    } catch (e) {
      setError('No se pudieron cargar los saldos del cliente.')
    } finally {
      setCargandoSaldos(false)
    }
  }

  function cambiarCliente() {
    setCliente(null); setSaldosCliente([]); setResultado(null); setError('')
  }

  const montoNum = Number(String(monto).replace(',', '.'))
  const preview  = (cliente && montoNum > 0 && saldosCliente.length > 0)
    ? previsualizarImputacion(saldosCliente, montoNum)
    : null

  async function confirmar() {
    setError('')
    if (!cliente) { setError('Seleccioná un cliente.'); return }
    if (!Number.isFinite(montoNum) || montoNum <= 0) { setError('Ingresá un monto válido.'); return }

    setEnviando(true)
    try {
      const r = await registrarPagoParcial({
        idCliente: cliente.idCliente,
        monto: montoNum,
        metodoPago,
        fecha,
        descripcion,
      })
      setResultado(r)
    } catch (e) {
      setError(e.message || 'Ocurrió un error al registrar el pago.')
    } finally {
      setEnviando(false)
    }
  }

  function finalizar() {
    onSuccess(`Pago de ${fmt(montoNum)} aplicado a ${cliente.nombre} ${cliente.apellido}`)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Registrar pago parcial" width="max-w-lg">
      {resultado ? (
        // ── Resultado exitoso ──────────────────────────────────────────
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
            <CheckCircle2 size={20} className="text-emerald-400 flex-shrink-0" />
            <div>
              <p className="text-emerald-300 font-body font-semibold text-sm">Pago aplicado correctamente</p>
              <p className="text-surface-400 text-xs font-body">
                {fmt(resultado.montoAplicado)} imputado sobre {resultado.saldosAfectados.length} saldo{resultado.saldosAfectados.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {resultado.saldosAfectados.map(s => (
              <div key={s.idSaldo} className="flex items-center justify-between gap-2 bg-surface-700 rounded-lg px-3 py-2 text-sm font-body">
                <span className="text-surface-300 font-mono text-xs">Saldo #{s.idSaldo}</span>
                <span className="text-white font-mono">{fmt(s.montoAplicado)}</span>
                <Badge color={s.estadoResultante === 'pagado' ? 'green' : 'blue'}>
                  {s.estadoResultante === 'pagado' ? 'Cancelado' : 'Parcial'}
                </Badge>
              </div>
            ))}
            {resultado.saldosAfectados.length === 0 && (
              <p className="text-surface-500 text-xs font-body text-center py-4">
                El cliente no tenía saldos pendientes para imputar.
              </p>
            )}
          </div>

          {resultado.montoSobrante > 0 && (
            <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3">
              <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <p className="text-yellow-300 text-xs font-body">
                El cliente no tenía más deuda pendiente para cubrir todo el monto. Sobraron{' '}
                <span className="font-bold">{fmt(resultado.montoSobrante)}</span> sin imputar — revisá el
                monto ingresado o registrá el excedente por otra vía.
              </p>
            </div>
          )}

          <Button className="w-full" onClick={finalizar}>Listo</Button>
        </div>
      ) : !cliente ? (
        // ── Paso 1: selección de cliente ───────────────────────────────
        <div className="space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar cliente por nombre o ID..."
              className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2.5 text-white
                         text-sm font-body placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all"
            />
          </div>

          <div className="max-h-64 overflow-y-auto space-y-1.5">
            {buscando && (
              <div className="flex items-center justify-center py-6 text-surface-500 text-sm gap-2">
                <Loader2 size={16} className="animate-spin" />Buscando...
              </div>
            )}
            {!buscando && resultados.length === 0 && (
              <p className="text-center text-surface-500 text-sm font-body py-6">
                Sin clientes con deuda pendiente que coincidan.
              </p>
            )}
            {!buscando && resultados.map(c => (
              <button key={c.idCliente} onClick={() => seleccionarCliente(c)}
                className="w-full flex items-center justify-between bg-surface-700 hover:bg-surface-600
                           border border-surface-600 rounded-xl px-4 py-3 text-left transition-colors">
                <div>
                  <p className="text-white text-sm font-body font-medium">{c.nombre} {c.apellido}</p>
                  <p className="text-surface-400 text-xs font-mono">
                    ID #{c.idCliente} · {c.cantSaldos} saldo{c.cantSaldos !== 1 ? 's' : ''} pendiente{c.cantSaldos !== 1 ? 's' : ''}
                  </p>
                </div>
                <span className="text-yellow-400 font-mono font-bold text-sm flex-shrink-0">{fmt(c.deudaTotal)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        // ── Paso 2: monto + preview + confirmación ─────────────────────
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-surface-700 border border-surface-600 rounded-xl px-4 py-3">
            <div>
              <p className="text-white text-sm font-body font-medium">{cliente.nombre} {cliente.apellido}</p>
              <p className="text-surface-400 text-xs font-mono">
                Deuda total: <span className="text-yellow-400 font-bold">{fmt(cliente.deudaTotal)}</span>
              </p>
            </div>
            <button onClick={cambiarCliente} className="text-surface-400 hover:text-white p-1 transition-colors" aria-label="Cambiar cliente">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1 block">Monto</label>
              <input
                type="number" min="0" step="0.01" autoFocus
                value={monto} onChange={e => setMonto(e.target.value)}
                placeholder="0.00"
                className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-white
                           text-sm font-mono focus:outline-none focus:border-brand-500 transition-all"
              />
            </div>
            <div>
              <label className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1 block">Método</label>
              <select value={metodoPago} onChange={e => setMetodoPago(e.target.value)}
                className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-white
                           text-sm font-body focus:outline-none focus:border-brand-500 transition-all">
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="cheque">Cheque</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1 block">Fecha</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-white
                         text-sm font-mono focus:outline-none focus:border-brand-500 transition-all" />
          </div>

          {cargandoSaldos ? (
            <div className="flex items-center justify-center py-6 text-surface-500 text-sm gap-2">
              <Loader2 size={16} className="animate-spin" />Cargando saldos...
            </div>
          ) : preview && (
            <div className="space-y-1.5">
              <p className="text-surface-400 text-xs uppercase tracking-widest font-body">
                Imputación estimada (saldo más antiguo primero)
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {preview.detalle.filter(s => s.montoAplicado > 0).map(s => (
                  <div key={s.idSaldo} className="flex items-center justify-between gap-2 bg-surface-700/60 rounded-lg px-3 py-2 text-xs font-body">
                    <span className="text-surface-300 font-mono">#{s.idSaldo} · vto {fmtFecha(s.fechaVto)}</span>
                    <span className="text-white font-mono">{fmt(s.montoAplicado)}</span>
                    <Badge color={s.estadoResultante === 'pagado' ? 'green' : 'blue'}>
                      {s.estadoResultante === 'pagado' ? 'Cancela' : 'Parcial'}
                    </Badge>
                  </div>
                ))}
              </div>
              {preview.sobrante > 0 && (
                <p className="text-yellow-400 text-xs font-body pt-1">
                  Sobrante sin imputar: {fmt(preview.sobrante)}
                </p>
              )}
            </div>
          )}

          {error && <p className="text-red-400 text-xs font-body">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={onClose} disabled={enviando}>Cancelar</Button>
            <Button className="flex-1" icon={Coins} onClick={confirmar} disabled={enviando}>
              {enviando ? 'Aplicando...' : 'Confirmar pago'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── Vista detalle de saldo ─────────────────────────────────────────────────

function SaldoDetalle({ saldo, onBack, onUpdated }) {
  const [presupuesto, setPresupuesto]   = useState(null)
  const [cliente,     setCliente]       = useState(null)
  const [detalles,    setDetalles]      = useState([])
  const [aplicaciones, setAplicaciones] = useState([])
  const [confirmPago, setConfirmPago]   = useState(false)
  // CORRECCIÓN (cierre de remanente): método usado para el cobro final,
  // solo relevante cuando esParcial — se persiste en el ledger de pagos.
  const [metodoCierre, setMetodoCierre] = useState('efectivo')

  useEffect(() => {
    async function cargar() {
      // Los cuatro fetches en paralelo para minimizar latencia
      const [pres, cli, dets, aplic] = await Promise.all([
        obtenerPresupuestoPorId(saldo.idPresupuesto),
        obtenerClientePorId(saldo.idCliente),
        obtenerDetallesConNombreDePresupuesto(saldo.idPresupuesto),
        obtenerAplicacionesDeSaldo(saldo.idSaldo),
      ])
      setPresupuesto(pres)
      setCliente(cli)
      setDetalles(dets)
      setAplicaciones(aplic)
    }
    cargar()
  }, [saldo.idPresupuesto, saldo.idCliente, saldo.idSaldo])

  async function marcarPagado() {
    // Cancela el remanente completo (sirve tanto para un saldo pendiente
    // como para saldar de una vez lo que quedaba de un pago parcial)
    const hoy = new Date().toISOString().slice(0, 10)
    await marcarSaldoPagado(saldo.idSaldo, saldo.idPresupuesto, hoy, metodoCierre)
    setConfirmPago(false)
    onUpdated('Saldo marcado como pagado')
    onBack()
  }

  // CORRECCIÓN #1: usar fechaVto en lugar de fechaFin
  const dias         = diasRestantes(saldo.fechaVto)
  const colores      = colorDias(dias)
  const estaSaldado  = saldo.estado === 'pagado'
  const esParcial    = saldo.estado === 'parcial'
  const info         = estadoInfo(saldo.estado)
  const yaCobrado    = saldo.monto - saldo.montoPendiente
  const metodoLabel  = { efectivo: 'Efectivo', transferencia: 'Transferencia', cc15: 'CC 15 días', cc30: 'CC 30 días' }

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
            <Badge color={info.color}>{info.label}</Badge>
            {!estaSaldado && (
              <Button icon={BadgeCheck} onClick={() => setConfirmPago(true)}>
                {esParcial ? 'Cancelar remanente' : 'Marcar como pagado'}
              </Button>
            )}
          </div>
        </div>

        {/* Días restantes — banner prominente, visible mientras haya deuda activa */}
        {!estaSaldado && (
          <div className={`flex items-center gap-3 rounded-xl px-5 py-3 border mb-6 ${colores.bg}`}>
            <CalendarClock size={18} className={colores.text + ' flex-shrink-0'} />
            <div>
              <p className={`font-body font-semibold text-sm ${colores.text}`}>{labelDias(dias)}</p>
              <p className="text-surface-400 text-xs font-body">
                Fecha de vencimiento: {fmtFecha(saldo.fechaVto)}
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
          {/* CORRECCIÓN #7: usar campos extra del cliente disponibles en el service */}
          <div className={`bg-surface-700 rounded-xl p-4 ${!estaSaldado ? 'col-span-2' : ''}`}>
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
                  {cliente.mail     ? ` · ${cliente.mail}`     : ''}
                </p>
              </>
            ) : (
              <p className="text-surface-400 text-sm font-mono">ID #{saldo.idCliente}</p>
            )}
          </div>

          {/* Fecha de pago — solo visible cuando el saldo ya se saldó por completo */}
          {estaSaldado && (
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
                  {['#', 'Producto', 'Medida', 'Cant.', 'Precio Unit.', 'Subtotal'].map(h => (
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

      {/* Historial de pagos aplicados — CORRECCIÓN #8: solo aparece si hubo imputaciones */}
      {aplicaciones.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-surface-700 flex items-center gap-2">
            <History size={14} className="text-surface-400" />
            <h3 className="font-body font-semibold text-white text-sm">Historial de pagos aplicados</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="border-b border-surface-700">
                  {['Fecha', 'Método', 'Aplicado', 'Remanente anterior', 'Remanente resultante'].map(h => (
                    <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {aplicaciones.map(a => (
                  <tr key={a.idAplicacion} className="border-b border-surface-700/50">
                    <td className="py-3 px-4 text-surface-300 font-mono text-xs">{fmtFecha(a.fecha)}</td>
                    <td className="py-3 px-4 text-surface-300 font-body text-xs capitalize">{a.metodoPago ?? '—'}</td>
                    <td className="py-3 px-4 text-emerald-400 font-mono font-medium">{fmt(a.montoAplicado)}</td>
                    <td className="py-3 px-4 text-surface-400 font-mono text-xs">{fmt(a.saldoAnterior)}</td>
                    <td className="py-3 px-4 text-white font-mono text-xs">{fmt(a.saldoResultante)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

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
            <div className="flex justify-between gap-16">
              <span className="text-surface-400">Monto total del saldo:</span>
              <span className="text-surface-300 font-mono">{fmt(saldo.monto)}</span>
            </div>
            {yaCobrado > 0 && (
              <div className="flex justify-between gap-16">
                <span className="text-emerald-400">Ya cobrado:</span>
                <span className="text-emerald-400 font-mono">{fmt(yaCobrado)}</span>
              </div>
            )}
            <div className="border-t border-surface-700 pt-2 flex justify-between gap-16">
              <span className="text-white font-semibold">
                {estaSaldado ? 'Monto cobrado:' : 'Remanente a cobrar:'}
              </span>
              <span className="text-brand-400 font-mono font-bold text-xl">
                {fmt(estaSaldado ? saldo.monto : saldo.montoPendiente)}
              </span>
            </div>
          </div>

          {estaSaldado && (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30
                            rounded-xl px-4 py-2.5">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span className="text-emerald-300 text-sm font-body">Ingreso registrado</span>
            </div>
          )}
        </div>
      </Card>

      {/* Modal confirmar cobro del remanente completo */}
      <Modal open={confirmPago} onClose={() => setConfirmPago(false)} title="Confirmar cobro" width="max-w-sm">
        <p className="text-surface-300 text-sm font-body mb-2">
          ¿Marcar el saldo <span className="text-white font-mono">#{saldo.idSaldo}</span> como cobrado en su totalidad?
        </p>
        <p className="text-surface-500 text-xs font-body mb-4">
          Se registrará el ingreso del remanente de{' '}
          <span className="text-brand-400 font-mono font-bold">{fmt(saldo.montoPendiente)}</span>{' '}
          en el sistema de estadísticas. Esta acción no se puede deshacer.
        </p>

        {/* CORRECCIÓN (cierre de remanente): solo tiene sentido pedir método
            de pago cuando efectivamente se va a dejar un registro en el
            ledger — o sea, cuando había un pago parcial en curso. */}
        {esParcial && (
          <div className="mb-6">
            <label className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1 block">
              Método de cobro del remanente
            </label>
            <select value={metodoCierre} onChange={e => setMetodoCierre(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-white
                         text-sm font-body focus:outline-none focus:border-brand-500 transition-all">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="otro">Otro</option>
            </select>
          </div>
        )}

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
  const location = useLocation()
  const [selected,     setSelected]     = useState(null)
  const [filterEst,    setFilterEst]    = useState('pendiente')
  const [search,       setSearch]       = useState('')
  const [sortDias,     setSortDias]     = useState('asc')
  const [toast,        setToast]        = useState('')
  const [pagoModalOpen, setPagoModalOpen] = useState(false)
  // CORRECCIÓN #3: KPIs en estado propio, calculados por el service
  const [kpis, setKpis] = useState({
    totalPendiente: 0,
    cantPendientes: 0,
    vencidos:       0,
    cantVencidos:   0,
    totalCobrado:   0,
    cantParciales:  0,
    totalEnParcial: 0,
  })

  // Si venimos desde Historial con un saldo pre-seleccionado, abrirlo directo
  useEffect(() => {
    if (location.state?.saldoInicial) {
      setSelected(location.state.saldoInicial)
      window.history.replaceState({}, '')
    }
  }, [location.state])

  // CORRECCIÓN #3: cargar KPIs independientemente de los filtros de la tabla
  useEffect(() => {
    obtenerKPIsSaldos().then(setKpis)
  }, [])

  // ── Datos + paginación ────────────────────────────────────────────────
  // Filtro, búsqueda y orden se delegan al service (CORRECCIONES #5 y #6),
  // así que van como `serverFilters`: cambiar cualquiera refetchea y
  // resetea la página. `reload()` (usado en handleUpdated/onBack tras
  // marcar un pago) nunca resetea la página.
  const {
    pageItems: paginated,
    items:     saldos,
    page, setPage, totalPages,
    reload: load,
  } = usePaginatedList({
    fetcher: (f) => obtenerSaldos({
      estado: f.filterEst !== 'all' ? f.filterEst : null,
      orden:  f.sortDias,
      search: f.search,
    }),
    serverFilters: { filterEst, search, sortDias },
    pageSize: PAGE_SIZE,
  })

  function handleUpdated(msg) {
    setToast(msg)
    // Refrescar también los KPIs después de marcar/imputar un pago
    obtenerKPIsSaldos().then(setKpis)
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

      <PagoParcialModal
        open={pagoModalOpen}
        onClose={() => setPagoModalOpen(false)}
        onSuccess={handleUpdated}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="Saldos" subtitle="Cobros por cuenta corriente" />
        <Button icon={Coins} onClick={() => setPagoModalOpen(true)}>
          Registrar Pago Parcial
        </Button>
      </div>

      {/* KPIs globales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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

        <div className="bg-blue-500/8 border border-blue-500/25 rounded-xl p-5">
          <p className="text-blue-400 text-xs uppercase tracking-widest font-body">Pagos parciales pendientes</p>
          <p className="font-display text-3xl text-blue-400 tracking-widest mt-1">
            {new Intl.NumberFormat('es-AR', { notation: 'compact', style: 'currency', currency: 'ARS' }).format(kpis.totalEnParcial)}
          </p>
          <p className="text-surface-500 text-xs font-body mt-1">
            {kpis.cantParciales} saldo{kpis.cantParciales !== 1 ? 's' : ''} con abono
          </p>
        </div>

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
            { value: 'parcial',   label: 'Parciales'  },
            { value: 'pagado',    label: 'Cobrados'   },
            { value: 'all',       label: 'Todos'      },
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
          {filterEst !== 'pagado' && (
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
                {['Saldo', 'Presupuesto', 'Cliente', 'Emisión', 'Vencimiento', 'Días', 'Monto', 'Estado', ''].map(h => (
                  <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-3 font-body">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map(s => {
                // CORRECCIÓN #1: usar fechaVto en lugar de fechaFin
                const dias        = diasRestantes(s.fechaVto)
                const cols        = colorDias(dias)
                const estaSaldado = s.estado === 'pagado'
                const info        = estadoInfo(s.estado)
                return (
                  <tr key={s.idSaldo} onClick={() => setSelected(s)}
                    className="border-b border-surface-700/50 hover:bg-surface-700/40 cursor-pointer transition-colors">
                    <td className="py-3 px-3 text-brand-400 font-mono text-sm font-bold">#{s.idSaldo}</td>
                    <td className="py-3 px-3 text-surface-400 font-mono text-xs">#{s.idPresupuesto}</td>
                    <td className="py-3 px-3">
                      {/* CORRECCIÓN #2: usar clienteNombre / clienteApellido */}
                      <p className="text-white text-sm font-body leading-tight">
                        {s.clienteNombre} {s.clienteApellido}
                      </p>
                    </td>
                    <td className="py-3 px-3 text-surface-400 font-mono text-xs">{fmtFecha(s.fechaInicio)}</td>
                    {/* CORRECCIÓN #1: usar fechaVto */}
                    <td className="py-3 px-3 text-surface-300 font-mono text-xs">{fmtFecha(s.fechaVto)}</td>
                    <td className="py-3 px-3">
                      {!estaSaldado ? (
                        <span className={`text-xs font-mono font-bold ${cols.text}`}>
                          {dias < 0 ? `−${Math.abs(dias)}` : dias}d
                        </span>
                      ) : (
                        <span className="text-surface-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      {/* CORRECCIÓN #8: si hay pago parcial, mostrar el remanente y el total original debajo */}
                      <p className="text-white font-mono font-medium">
                        {fmt(estaSaldado ? s.monto : s.montoPendiente)}
                      </p>
                      {s.estado === 'parcial' && (
                        <p className="text-surface-500 text-xs font-mono">de {fmt(s.monto)}</p>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <Badge color={info.color}>
                        {info.color === 'green'
                          ? <CheckCircle2 size={10} className="inline mr-1" />
                          : <Clock size={10} className="inline mr-1" />}
                        {info.label}
                      </Badge>
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
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, saldos.length)} de {saldos.length}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Ant.</Button>
              <Button size="sm" variant="secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Sig. →</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
