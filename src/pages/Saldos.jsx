// src/pages/Saldos.jsx
import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { usePaginatedList } from '../hooks/usePaginatedList'
import { useScrollAnchor } from '../hooks/useScrollToTopOnChange'
import { useDebounce } from '../hooks/useDebounce'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
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
  Coins, Loader2, X, History, Eye, SlidersHorizontal, WifiOff,
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
    <div role="status" aria-live="polite"
         className="fixed inset-x-4 top-[max(1rem,env(safe-area-inset-top))] sm:inset-x-auto sm:right-5 sm:top-5 z-[9999] pointer-events-none">
      <div className="flex items-center gap-3 bg-emerald-900/95 border border-emerald-500/50
                      rounded-2xl px-4 sm:px-5 py-3 shadow-2xl animate-slide-up">
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

          <Button className="w-full min-h-[44px]" onClick={finalizar}>Listo</Button>
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
              className="w-full min-h-[44px] bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2.5 text-white
                         text-base sm:text-sm font-body placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all"
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
                className="w-full min-h-[44px] flex items-center justify-between gap-3 bg-surface-700 hover:bg-surface-600
                           border border-surface-600 rounded-xl px-4 py-3 text-left transition-colors">
                <div className="min-w-0">
                  <p className="text-white text-sm font-body font-medium break-words">{c.nombre} {c.apellido}</p>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1 block">Monto</label>
              <input
                type="number" inputMode="decimal" min="0" step="0.01" autoFocus
                value={monto} onChange={e => setMonto(e.target.value)}
                placeholder="0.00"
                className="w-full min-h-[44px] bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-white
                           text-base sm:text-sm font-mono focus:outline-none focus:border-brand-500 transition-all"
              />
            </div>
            <div>
              <label className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1 block">Método</label>
              <select value={metodoPago} onChange={e => setMetodoPago(e.target.value)}
                className="w-full min-h-[44px] bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-white
                           text-base sm:text-sm font-body focus:outline-none focus:border-brand-500 transition-all">
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
              className="w-full min-w-0 min-h-[44px] bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-white
                         text-base sm:text-sm font-mono text-left [color-scheme:dark] [&::-webkit-date-and-time-value]:text-left
                         focus:outline-none focus:border-brand-500 transition-all" />
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
            <Button variant="secondary" className="flex-1 min-h-[44px]" onClick={onClose} disabled={enviando}>Cancelar</Button>
            <Button className="flex-1 min-h-[44px]" icon={Coins} onClick={confirmar} disabled={enviando}>
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
    <div className="w-full min-w-0 max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-slide-up">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="flex items-center gap-2 min-h-[44px] pr-2 text-surface-400 hover:text-white text-sm font-body transition-colors">
          <ArrowLeft size={16} />Volver a saldos
        </button>
        <span className="text-surface-600">/</span>
        <span className="text-surface-300 text-sm font-body">
          Saldo <span className="text-brand-400 font-mono">#{saldo.idSaldo}</span>
        </span>
      </div>

      {/* Cabecera */}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-surface-400 text-xs tracking-widest uppercase font-body mb-1">Saldo</p>
            <h2 className="font-display text-4xl text-white tracking-widest">#{saldo.idSaldo}</h2>
          </div>
          <div className="flex items-center gap-3 flex-wrap w-full sm:w-auto">
            <Badge color={info.color}>{info.label}</Badge>
            {!estaSaldado && (
              <Button icon={BadgeCheck} className="w-full sm:w-auto min-h-[44px]" onClick={() => setConfirmPago(true)}>
                {esParcial ? 'Cancelar remanente' : 'Marcar como pagado'}
              </Button>
            )}
          </div>
        </div>

        {/* Días restantes — banner prominente, visible mientras haya deuda activa */}
        {!estaSaldado && (
          <div className={`flex items-center gap-3 rounded-xl px-4 sm:px-5 py-3 border mb-6 ${colores.bg}`}>
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
          <div className={`bg-surface-700 rounded-xl p-4 min-w-0 ${!estaSaldado ? 'col-span-2' : ''}`}>
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1 flex items-center gap-1">
              <User size={11} />Cliente
            </p>
            {cliente ? (
              <>
                <p className="text-white text-sm font-body font-medium">
                  {cliente.nombre} {cliente.apellido}
                </p>
                <p className="text-surface-400 text-xs font-mono mt-0.5 break-all">
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
        <div className="px-4 sm:px-6 py-4 border-b border-surface-700 flex items-center justify-between gap-3">
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
                  {[
                    { h: '#',           cls: 'hidden sm:table-cell' },
                    { h: 'Producto' },
                    { h: 'Medida' },
                    { h: 'Cant.' },
                    { h: 'Precio Unit.', cls: 'hidden sm:table-cell' },
                    { h: 'Subtotal' },
                  ].map(({ h, cls = '' }) => (
                    <th key={h} scope="col" className={`text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-3 sm:px-4 font-body ${cls}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detalles.map((d, idx) => (
                  <tr key={d.idDetalle} className="border-b border-surface-700/50">
                    <td className="hidden sm:table-cell py-3 px-4 text-surface-500 font-mono text-xs">{idx + 1}</td>
                    <td className="py-3 px-3 sm:px-4 text-white font-body">{d.nombreProducto ?? `#${d.idProducto}`}</td>
                    <td className="py-3 px-3 sm:px-4">
                      {d.medida
                        ? <Badge color="blue">{d.medida}</Badge>
                        : <span className="text-surface-500 text-xs">—</span>}
                    </td>
                    <td className="py-3 px-3 sm:px-4 text-surface-200 font-mono text-center">{d.cantidad}</td>
                    <td className="hidden sm:table-cell py-3 px-4 text-surface-200 font-mono">{fmt(d.precioUnitario)}</td>
                    <td className="py-3 px-3 sm:px-4 text-surface-200 font-mono font-medium">{fmt(d.subtotal)}</td>
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
          <div className="px-4 sm:px-6 py-4 border-b border-surface-700 flex items-center gap-2">
            <History size={14} className="text-surface-400" />
            <h3 className="font-body font-semibold text-white text-sm">Historial de pagos aplicados</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="border-b border-surface-700">
                  {[
                    { h: 'Fecha' },
                    { h: 'Método' },
                    { h: 'Aplicado' },
                    { h: 'Remanente anterior', cls: 'hidden sm:table-cell' },
                    { h: 'Remanente resultante' },
                  ].map(({ h, cls = '' }) => (
                    <th key={h} scope="col" className={`text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-3 sm:px-4 font-body ${cls}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {aplicaciones.map(a => (
                  <tr key={a.idAplicacion} className="border-b border-surface-700/50">
                    <td className="py-3 px-3 sm:px-4 text-surface-300 font-mono text-xs">{fmtFecha(a.fecha)}</td>
                    <td className="py-3 px-3 sm:px-4 text-surface-300 font-body text-xs capitalize">{a.metodoPago ?? '—'}</td>
                    <td className="py-3 px-3 sm:px-4 text-emerald-400 font-mono font-medium">{fmt(a.montoAplicado)}</td>
                    <td className="hidden sm:table-cell py-3 px-4 text-surface-400 font-mono text-xs">{fmt(a.saldoAnterior)}</td>
                    <td className="py-3 px-3 sm:px-4 text-white font-mono text-xs">{fmt(a.saldoResultante)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Monto final */}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 text-sm font-body w-full sm:w-auto">
            <div className="flex justify-between gap-4 sm:gap-16">
              <span className="text-surface-400">Monto original (lista):</span>
              <span className="text-surface-300 font-mono">
                {presupuesto ? fmt(presupuesto.montoOriginal) : '—'}
              </span>
            </div>
            <div className="flex justify-between gap-4 sm:gap-16">
              <span className="text-surface-400">Monto total del saldo:</span>
              <span className="text-surface-300 font-mono">{fmt(saldo.monto)}</span>
            </div>
            {yaCobrado > 0 && (
              <div className="flex justify-between gap-4 sm:gap-16">
                <span className="text-emerald-400">Ya cobrado:</span>
                <span className="text-emerald-400 font-mono">{fmt(yaCobrado)}</span>
              </div>
            )}
            <div className="border-t border-surface-700 pt-2 flex justify-between items-baseline gap-4 sm:gap-16">
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
              className="w-full min-h-[44px] bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-white
                         text-base sm:text-sm font-body focus:outline-none focus:border-brand-500 transition-all">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="otro">Otro</option>
            </select>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1 min-h-[44px]" onClick={() => setConfirmPago(false)}>Cancelar</Button>
          <Button className="flex-1 min-h-[44px]" icon={BadgeCheck} onClick={marcarPagado}>Confirmar cobro</Button>
        </div>
      </Modal>
    </div>
  )
}

// ─── Lista de saldos ────────────────────────────────────────────────────────
//
// Arquitectura de la vista (mobile-first):
//
//   Saldos (contenedor: estado de filtros, datos, paginación)
//    ├─ KpiCard ×4
//    ├─ SaldosFilters      1 columna en <640px · wrap fluido en ≥640px
//    └─ Card
//        ├─ SaldosCardList  (<768px)  una tarjeta por saldo
//        └─ SaldosTable     (≥768px)  en tablet se colapsan columnas secundarias
//
// Ambos layouts consumen el MISMO array `paginated` y el MISMO `onOpen`, y el
// filtrado ocurre en el fetcher (una sola vez, antes de paginar). Por eso el
// comportamiento y los resultados son idénticos en cualquier dispositivo
// (Escenario 6). Breakpoints Tailwind: sm 640 · md 768 · lg 1024.

const ESTADOS = [
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'parcial',   label: 'Parciales'  },
  { value: 'pagado',    label: 'Cobrados'   },
  { value: 'all',       label: 'Todos'      },
]

const ESTADO_DEFAULT = 'pendiente'

const FILTROS_INICIALES = Object.freeze({
  search:     '',
  estado:     ESTADO_DEFAULT,
  sortDias:   'asc',
})

/** Cantidad de filtros distintos del valor por defecto (alimenta el badge de «Filtros» en mobile). */
function contarFiltrosActivos({ search, estado }) {
  return (search.trim() ? 1 : 0) + (estado !== ESTADO_DEFAULT ? 1 : 0)
}

// Controles táctiles: alto mínimo 44px (WCAG 2.5.5 / HIG) y 16px de fuente en
// mobile para que iOS Safari no haga zoom automático al enfocar el campo.
const FIELD_CLASS =
  'w-full min-w-0 min-h-[44px] bg-surface-700 border border-surface-600 rounded-xl px-3 text-white ' +
  'text-base sm:text-sm font-body placeholder-surface-500 focus:outline-none focus:border-brand-500 ' +
  'focus-visible:ring-2 focus-visible:ring-brand-500/40 transition-all'

const LABEL_CLASS = 'text-surface-400 text-xs uppercase tracking-widest font-body mb-1 block'

/** Deriva todo lo que la fila y la tarjeta necesitan, en un solo lugar (DRY). */
function derivarSaldo(s) {
  const dias        = diasRestantes(s.fechaVto)
  const estaSaldado = s.estado === 'pagado'
  const nombre      = `${s.clienteNombre ?? ''} ${s.clienteApellido ?? ''}`.trim()
  return {
    dias,
    cols:         colorDias(dias),
    estaSaldado,
    esParcial:    s.estado === 'parcial',
    info:         estadoInfo(s.estado),
    montoVisible: estaSaldado ? s.monto : s.montoPendiente,
    nombre:       nombre || `Cliente #${s.idCliente}`,
  }
}

// ── KPIs ────────────────────────────────────────────────────────────────────

const KPI_SURFACE = {
  neutral: { box: 'bg-surface-800 border-surface-700', label: 'text-surface-400' },
  red:     { box: 'bg-red-500/8 border-red-500/25',    label: 'text-red-400'     },
  blue:    { box: 'bg-blue-500/8 border-blue-500/25',  label: 'text-blue-400'    },
}

function KpiCard({ label, value, hint, surface = 'neutral', valueClass, icon: Icon }) {
  const s = KPI_SURFACE[surface]
  return (
    <div className={`${s.box} border rounded-xl p-3 sm:p-5 min-w-0`}>
      <p className={`${s.label} text-xs uppercase tracking-widest font-body flex items-center gap-1`}>
        {Icon && <Icon size={11} aria-hidden="true" />}{label}
      </p>
      <p className={`font-display text-2xl sm:text-3xl tracking-widest mt-1 truncate ${valueClass}`} title={value}>
        {value}
      </p>
      <p className="text-surface-500 text-xs font-body mt-1">{hint}</p>
    </div>
  )
}

// ── Estados transversales ───────────────────────────────────────────────────

function OfflineBanner() {
  return (
    <div role="status"
      className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3">
      <WifiOff size={16} className="text-yellow-400 flex-shrink-0" aria-hidden="true" />
      <p className="text-yellow-300 text-xs font-body">
        Sin conexión. Los saldos que ves pueden estar desactualizados.
      </p>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div role="status" className="p-3 grid gap-3 sm:grid-cols-2 md:grid-cols-1">
      <span className="sr-only">Cargando saldos…</span>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} aria-hidden="true" className="h-28 md:h-14 rounded-xl bg-surface-700/50 animate-pulse" />
      ))}
    </div>
  )
}

function ListError({ onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center py-12 px-4 gap-3 text-center">
      <AlertTriangle size={28} className="text-red-400" aria-hidden="true" />
      <p className="text-surface-300 text-sm font-body">No pudimos cargar los saldos. Revisá tu conexión e intentá de nuevo.</p>
      <Button variant="secondary" className="min-h-[44px]" onClick={onRetry}>Reintentar</Button>
    </div>
  )
}

function EmptyState({ estado, hayFiltros, onClear }) {
  return (
    <div className="flex flex-col items-center py-16 px-4 gap-3 text-surface-500 text-center">
      <Wallet size={32} className="opacity-30" aria-hidden="true" />
      <p className="font-body text-sm">
        {!hayFiltros && estado === 'pendiente' ? 'No hay saldos pendientes.' : 'Sin saldos que coincidan.'}
      </p>
      {hayFiltros && (
        <Button variant="secondary" className="min-h-[44px]" onClick={onClear}>Limpiar filtros</Button>
      )}
    </div>
  )
}

// ── Filtros ─────────────────────────────────────────────────────────────────
//
// Mobile (<640px): una sola columna; el panel se puede plegar con «Filtros»
// (queda abierto por defecto para que nada esté oculto). ≥768px siempre visible.
// ≥640px: flex-wrap, así los campos se acomodan solos aunque el contenedor sea
// más angosto que el viewport (p. ej. por un sidebar).

function SaldosFilters({ filters, onChange, onClear, filtrosActivos, total }) {
  const [abierto, setAbierto] = useState(true)
  const { search, estado, sortDias } = filters

  // En ≥768px todo vive en UNA sola fila: buscador (flexible) + estados + orden.
  // En mobile se mantiene el layout apilado con el panel plegable.
  const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40'

  return (
    <Card className="p-3 sm:p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-2.5">

        {/* Buscador (+ botón «Filtros» solo en mobile) */}
        <div className="flex gap-2 min-w-0 md:flex-1">
          <div className="relative flex-1 min-w-0">
            <Search size={14} aria-hidden="true"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
            <input
              type="search" inputMode="search" enterKeyHint="search" autoComplete="off"
              aria-label="Buscar por cliente o ID"
              value={search} onChange={e => onChange('search', e.target.value)}
              placeholder="Buscar por cliente o ID..."
              className={`${FIELD_CLASS} md:min-h-[38px] pl-9 pr-3`} />
          </div>

          <button type="button" onClick={() => setAbierto(a => !a)}
            aria-expanded={abierto} aria-controls="saldos-filtros"
            className={`md:hidden flex items-center gap-2 min-h-[44px] px-3 rounded-xl border border-surface-600
                       bg-surface-700 text-white text-sm font-body active:bg-surface-600 transition-colors ${FOCUS}`}>
            <SlidersHorizontal size={16} aria-hidden="true" />
            Filtros
            {filtrosActivos > 0 && (
              <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-brand-500 text-white text-xs
                               font-mono flex items-center justify-center"
                aria-label={`${filtrosActivos} filtro${filtrosActivos !== 1 ? 's' : ''} activo${filtrosActivos !== 1 ? 's' : ''}`}>
                {filtrosActivos}
              </span>
            )}
          </button>
        </div>

        {/* Estados + orden (misma fila que el buscador en desktop) */}
        <div id="saldos-filtros"
          className={`${abierto ? 'flex' : 'hidden'} md:flex flex-col gap-3 md:flex-row md:items-center md:gap-2.5 md:flex-shrink-0`}>

          <div>
            <span id="saldos-estado-label" className={`${LABEL_CLASS} md:sr-only`}>Estado</span>
            <div role="group" aria-labelledby="saldos-estado-label"
              className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:flex md:flex-nowrap md:gap-2.5">
              {ESTADOS.map(({ value, label }) => {
                const activo = estado === value
                return (
                  <button key={value} type="button" aria-pressed={activo} onClick={() => onChange('estado', value)}
                    className={`min-h-[44px] md:min-h-[38px] px-4 rounded-xl text-sm font-body border transition-all whitespace-nowrap ${FOCUS}
                      ${activo
                        ? 'bg-brand-500/15 border-brand-500/50 text-white'
                        : 'bg-surface-700/60 border-surface-600/70 text-surface-500 hover:border-surface-500 active:bg-surface-600'}`}>
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-2.5">
            {estado !== 'pagado' && (
              <button type="button" onClick={() => onChange('sortDias', sortDias === 'asc' ? 'desc' : 'asc')}
                className={`flex items-center justify-center gap-2 min-h-[44px] md:min-h-[38px] px-4 bg-surface-700/60 border border-surface-600/70
                           hover:border-surface-500 active:bg-surface-600 rounded-xl text-white text-sm font-body
                           transition-all whitespace-nowrap ${FOCUS}`}>
                {sortDias === 'asc'
                  ? <><ChevronUp size={14} aria-hidden="true" />Más urgentes</>
                  : <><ChevronDown size={14} aria-hidden="true" />Menos urgentes</>}
              </button>
            )}

            {/* Solo aparece cuando hay filtros distintos al valor por defecto */}
            {filtrosActivos > 0 && (
              <button type="button" onClick={onClear}
                className={`flex items-center justify-center gap-2 min-h-[44px] md:min-h-[38px] px-4 rounded-xl border border-surface-600
                           text-surface-300 hover:text-white text-sm font-body transition-all whitespace-nowrap ${FOCUS}`}>
                <X size={14} aria-hidden="true" />Limpiar
              </button>
            )}

            {/* El contador se mantiene para lectores de pantalla; en desktop no se muestra */}
            <p role="status" aria-live="polite"
              className="text-surface-400 text-xs font-body text-center md:sr-only">
              {total} resultado{total !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ── Piezas de listado ───────────────────────────────────────────────────────

function EstadoBadge({ info }) {
  return (
    <Badge color={info.color}>
      {info.color === 'green'
        ? <CheckCircle2 size={10} className="inline mr-1" aria-hidden="true" />
        : <Clock size={10} className="inline mr-1" aria-hidden="true" />}
      {info.label}
    </Badge>
  )
}

/** Vista de tarjeta (<768px): toda la información clave + acción explícita. */
function SaldoCard({ saldo, onOpen }) {
  const v = derivarSaldo(saldo)
  return (
    <article onClick={() => onOpen(saldo)}
      className="h-full flex flex-col gap-3 bg-surface-700/40 border border-surface-700 rounded-xl p-4
                 cursor-pointer active:bg-surface-700/70 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-white text-sm font-body font-medium leading-tight break-words">{v.nombre}</p>
          <p className="text-surface-400 text-xs font-mono mt-1">
            <span className="text-brand-400 font-bold">#{saldo.idSaldo}</span> · Presupuesto #{saldo.idPresupuesto}
          </p>
        </div>
        <div className="flex-shrink-0"><EstadoBadge info={v.info} /></div>
      </div>

      <div>
        <p className="text-white font-mono font-medium text-xl">{fmt(v.montoVisible)}</p>
        {v.esParcial && <p className="text-surface-500 text-xs font-mono">de {fmt(saldo.monto)}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-xs font-body">
        <div>
          <dt className="text-surface-500">Emisión</dt>
          <dd className="text-surface-300 font-mono mt-0.5">{fmtFecha(saldo.fechaInicio)}</dd>
        </div>
        <div>
          <dt className="text-surface-500">Vencimiento</dt>
          <dd className="text-surface-300 font-mono mt-0.5">{fmtFecha(saldo.fechaVto)}</dd>
        </div>
      </dl>

      {!v.estaSaldado && (
        <p className={`self-start inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-body ${v.cols.bg} ${v.cols.text}`}>
          <CalendarClock size={12} aria-hidden="true" />{labelDias(v.dias)}
        </p>
      )}

      <Button variant="secondary" icon={Eye} className="w-full min-h-[44px] mt-auto"
        onClick={(e) => { e.stopPropagation(); onOpen(saldo) }}>
        Ver detalle
      </Button>
    </article>
  )
}

function SaldosCardList({ items, onOpen }) {
  return (
    <ul className="md:hidden grid grid-cols-1 sm:grid-cols-2 gap-3 p-3">
      {items.map(s => (
        <li key={s.idSaldo}><SaldoCard saldo={s} onOpen={onOpen} /></li>
      ))}
    </ul>
  )
}

// Columnas de la tabla. En tablet (768–1023px) se colapsan las secundarias
// (`hidden lg:table-cell`); su información se reubica bajo otra celda.
const COLUMNAS = [
  { key: 'saldo',       label: 'Saldo' },
  { key: 'presupuesto', label: 'Presupuesto', cls: 'hidden lg:table-cell' },
  { key: 'cliente',     label: 'Cliente' },
  { key: 'emision',     label: 'Emisión',     cls: 'hidden lg:table-cell' },
  { key: 'vencimiento', label: 'Vencimiento' },
  { key: 'dias',        label: 'Días',        cls: 'hidden lg:table-cell' },
  { key: 'monto',       label: 'Monto' },
  { key: 'estado',      label: 'Estado' },
  { key: 'accion',      label: '', sr: 'Acciones' },
]

function SaldoRow({ saldo, onOpen }) {
  const v = derivarSaldo(saldo)
  const diasTxt = v.dias < 0 ? `−${Math.abs(v.dias)}` : v.dias
  return (
    <tr onClick={() => onOpen(saldo)}
      className="border-b border-surface-700/50 hover:bg-surface-700/40 active:bg-surface-700/60 cursor-pointer transition-colors">
      <td className="py-1 px-3">
        {/* Botón real: da acceso por teclado y lectores de pantalla (la fila sola no lo tiene) */}
        <button type="button" aria-label={`Ver detalle del saldo #${saldo.idSaldo}`}
          onClick={(e) => { e.stopPropagation(); onOpen(saldo) }}
          className="min-h-[44px] min-w-[44px] text-left text-brand-400 font-mono text-sm font-bold rounded
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60">
          #{saldo.idSaldo}
        </button>
        <span className="block lg:hidden text-surface-500 text-xs font-mono">Pres. #{saldo.idPresupuesto}</span>
      </td>
      <td className="hidden lg:table-cell py-3 px-3 text-surface-400 font-mono text-xs">#{saldo.idPresupuesto}</td>
      <td className="py-3 px-3">
        <p className="text-white text-sm font-body leading-tight">{v.nombre}</p>
      </td>
      <td className="hidden lg:table-cell py-3 px-3 text-surface-400 font-mono text-xs">{fmtFecha(saldo.fechaInicio)}</td>
      <td className="py-3 px-3 text-surface-300 font-mono text-xs">
        {fmtFecha(saldo.fechaVto)}
        {/* En tablet los «Días» viajan bajo el vencimiento */}
        {!v.estaSaldado && (
          <span className={`block lg:hidden font-bold mt-0.5 ${v.cols.text}`}>{diasTxt}d</span>
        )}
      </td>
      <td className="hidden lg:table-cell py-3 px-3">
        {!v.estaSaldado
          ? <span className={`text-xs font-mono font-bold ${v.cols.text}`}>{diasTxt}d</span>
          : <span className="text-surface-600 text-xs">—</span>}
      </td>
      <td className="py-3 px-3">
        <p className="text-white font-mono font-medium">{fmt(v.montoVisible)}</p>
        {v.esParcial && <p className="text-surface-500 text-xs font-mono">de {fmt(saldo.monto)}</p>}
      </td>
      <td className="py-3 px-3"><EstadoBadge info={v.info} /></td>
      <td className="py-3 px-3 text-surface-500"><Wallet size={14} aria-hidden="true" /></td>
    </tr>
  )
}

function SaldosTable({ items, onOpen }) {
  return (
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-sm font-body">
        <caption className="sr-only">Listado de saldos</caption>
        <thead>
          <tr className="border-b border-surface-700">
            {COLUMNAS.map(c => (
              <th key={c.key} scope="col"
                className={`text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-3 font-body ${c.cls ?? ''}`}>
                {c.label}{c.sr && <span className="sr-only">{c.sr}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(s => <SaldoRow key={s.idSaldo} saldo={s} onOpen={onOpen} />)}
        </tbody>
      </table>
    </div>
  )
}

function Pagination({ page, totalPages, total, onPrev, onNext }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-surface-700">
      <p className="text-surface-400 text-xs font-body">
        {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" className="min-h-[44px]" onClick={onPrev} disabled={page === 1}>← Ant.</Button>
        <Button size="sm" variant="secondary" className="min-h-[44px]" onClick={onNext} disabled={page === totalPages}>Sig. →</Button>
      </div>
    </div>
  )
}

// ─── Contenedor ─────────────────────────────────────────────────────────────

export default function Saldos() {
  const location = useLocation()
  const online   = useOnlineStatus()
  const [selected,      setSelected]      = useState(null)
  const [filters,       setFilters]       = useState(FILTROS_INICIALES)
  const [toast,         setToast]         = useState('')
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

  const setFilter = useCallback(
    (campo, valor) => setFilters(f => ({ ...f, [campo]: valor })),
    [],
  )
  // «Limpiar» conserva el orden elegido: es una preferencia, no un filtro.
  const clearFilters = useCallback(
    () => setFilters(f => ({ ...FILTROS_INICIALES, sortDias: f.sortDias })),
    [],
  )

  const cargarKpis = useCallback(() => {
    obtenerKPIsSaldos().then(setKpis).catch(e => console.error('[Saldos] No se pudieron cargar los KPIs', e))
  }, [])

  // Si venimos desde Historial con un saldo pre-seleccionado, abrirlo directo
  useEffect(() => {
    if (location.state?.saldoInicial) {
      setSelected(location.state.saldoInicial)
      window.history.replaceState({}, '')
    }
  }, [location.state])

  // CORRECCIÓN #3: cargar KPIs independientemente de los filtros de la tabla
  useEffect(() => { cargarKpis() }, [cargarKpis])

  // ── Filtros derivados ─────────────────────────────────────────────────
  const searchDebounced = useDebounce(filters.search)
  const filtrosActivos  = contarFiltrosActivos(filters)

  // ── Datos + paginación ────────────────────────────────────────────────
  // Estado, búsqueda y orden los resuelve el service (serverFilters): cambiar
  // cualquiera refetchea y resetea la página. Desktop y mobile paginan el
  // mismo conjunto porque ambos layouts leen el mismo `paginated`.
  // `reload()` nunca resetea la página (se usa tras marcar/imputar un pago).
  const {
    pageItems: paginated,
    items:     saldos,
    page, setPage, totalPages,
    loading:   isLoading,
    error,
    reload:    load,
  } = usePaginatedList({
    fetcher: (f) => obtenerSaldos({
      estado: f.filterEst !== 'all' ? f.filterEst : null,
      orden:  f.sortDias,
      search: f.search,
    }),
    serverFilters: { filterEst: filters.estado, search: searchDebounced, sortDias: filters.sortDias },
    pageSize: PAGE_SIZE,
  })
  const hasError = Boolean(error)

  const { anchorRef: tableAnchorRef, scrollToStart } = useScrollAnchor()

  function handleUpdated(msg) {
    setToast(msg)
    // Refrescar también los KPIs después de marcar/imputar un pago
    cargarKpis()
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

  const fmtCompactoARS = (n) =>
    new Intl.NumberFormat('es-AR', { notation: 'compact', style: 'currency', currency: 'ARS' }).format(n ?? 0)
  const plural = (n, uno, varios) => (n !== 1 ? varios : uno)

  return (
    <div className="w-full min-w-0 max-w-5xl mx-auto space-y-4 sm:space-y-6">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      {!online && <OfflineBanner />}

      <PagoParcialModal
        open={pagoModalOpen}
        onClose={() => setPagoModalOpen(false)}
        onSuccess={handleUpdated}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <PageHeader title="Saldos" subtitle="Cobros por cuenta corriente" />
        <Button icon={Coins} className="w-full sm:w-auto min-h-[44px]" onClick={() => setPagoModalOpen(true)}>
          Registrar Pago Parcial
        </Button>
      </div>

      {/* KPIs globales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard label="Pendiente de cobro" value={fmtCompactoARS(kpis.totalPendiente)}
          valueClass="text-yellow-400"
          hint={`${kpis.cantPendientes} ${plural(kpis.cantPendientes, 'saldo', 'saldos')}`} />

        {kpis.cantVencidos > 0 ? (
          <KpiCard label="Vencidos" icon={AlertTriangle} surface="red" value={fmtCompactoARS(kpis.vencidos)}
            valueClass="text-red-400"
            hint={`${kpis.cantVencidos} ${plural(kpis.cantVencidos, 'saldo vencido', 'saldos vencidos')}`} />
        ) : (
          <KpiCard label="Vencidos" value="$0" valueClass="text-emerald-400" hint="Sin saldos vencidos" />
        )}

        <KpiCard label="Pagos parciales pendientes" surface="blue" value={fmtCompactoARS(kpis.totalEnParcial)}
          valueClass="text-blue-400"
          hint={`${kpis.cantParciales} ${plural(kpis.cantParciales, 'saldo con abono', 'saldos con abono')}`} />

        <KpiCard label="Total cobrado" value={fmtCompactoARS(kpis.totalCobrado)}
          valueClass="text-emerald-400" hint="ingresado al sistema" />
      </div>

      <SaldosFilters
        filters={filters}
        onChange={setFilter}
        onClear={clearFilters}
        filtrosActivos={filtrosActivos}
        total={saldos.length}
      />

      {/* Listado: tarjetas en mobile, tabla desde tablet */}
      <div ref={tableAnchorRef}>
        <Card className="overflow-hidden">
          {hasError ? (
            <ListError onRetry={load} />
          ) : isLoading && saldos.length === 0 ? (
            <ListSkeleton />
          ) : saldos.length === 0 ? (
            <EmptyState estado={filters.estado} hayFiltros={filtrosActivos > 0} onClear={clearFilters} />
          ) : (
            <>
              <SaldosCardList items={paginated} onOpen={setSelected} />
              <SaldosTable items={paginated} onOpen={setSelected} />
            </>
          )}

          {totalPages > 1 && !hasError && (
            <Pagination
              page={page} totalPages={totalPages} total={saldos.length}
              onPrev={() => { setPage(p => Math.max(1, p - 1)); scrollToStart() }}
              onNext={() => { setPage(p => Math.min(totalPages, p + 1)); scrollToStart() }}
            />
          )}
        </Card>
      </div>
    </div>
  )
}
