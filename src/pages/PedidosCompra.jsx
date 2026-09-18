// src/pages/PedidosCompra.jsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { usePaginatedList } from '../hooks/usePaginatedList'
import { supabase } from '../lib/supabase'
import { Card, PageHeader, Button, Badge, Modal, Input } from '../components/ui'
import {
  Plus, Trash2, Search, CheckCircle2, AlertCircle,
  ArrowLeft, ShoppingCart, Package, Clock, BadgeCheck,
  Pencil, Truck, RotateCcw, UserPlus, Building2, CalendarCheck,
  Layers, Landmark, Lock, Printer,
} from 'lucide-react'
import {
  obtenerPedidos,
  obtenerPedidoPorId,
  obtenerDetallesDePedido,
  crearPedido,
  actualizarPedido,
  marcarPedidoPagado,
  recibirPedido,
} from '../services/pedidosService'
import {
  calcularPlanCuotas,
  validarPlanCuotas,
  crearPedidoConCuotas,
  obtenerCuotasDePedido,
  obtenerResumenCuotasPorPedidos,
  marcarCuotaPagada,
  actualizarPlanCuotas,
  validarEdicionPlanCuotas,
} from '../services/pedidosCuotasService'
import PlanCuotasCC, { CUOTA_EMPTY } from '../components/pedidos/PlanCuotasCC'
import { generarPDFPedidoCompra } from '../lib/pdfPedidoCompra'

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

// Capitaliza la primera letra de un string (igual que ABMC)
const cap = (s) => s ? s.trim().charAt(0).toUpperCase() + s.trim().slice(1) : ''

// Suma N días corridos a una fecha ISO (o a hoy si no se pasa) y devuelve dd/mm/yyyy
function sumarDiasFmt(fechaIso, dias) {
  const base = fechaIso ? new Date(fechaIso + 'T00:00:00') : new Date()
  base.setDate(base.getDate() + (parseInt(dias, 10) || 0))
  const [y, m, d] = base.toISOString().slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

// Calcula la fecha de vencimiento del echeck: 30 días corridos desde la fecha de emisión
function fechaVencimientoEcheck(fechaIso) {
  return sumarDiasFmt(fechaIso, 30)
}

// Label legible del método de pago. Único punto de verdad para no repetir
// el mismo condicional en el listado y en el detalle — 'cuenta_corriente'
// crudo de la DB nunca se muestra tal cual (quedaría "Cuenta_corriente").
function metodoPagoLabel(pedido) {
  if (pedido.metodoPago === 'echeck') return 'E-Check (CC30)'
  if (pedido.metodoPago === 'cuenta_corriente') return pedido.tieneCuotas ? 'CC Cuotas' : 'CC'
  return pedido.metodoPago ? cap(pedido.metodoPago) : '—'
}

// Estado visual del pedido (logístico)
const ESTADO_CONFIG = {
  encargado: { label: 'Encargado', color: 'blue',   icon: Clock },
  recibido:  { label: 'Recibido',  color: 'purple',  icon: Truck },
}

// ─── Toast ─────────────────────────────────────────────────────────────────

function Toast({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [onDone])
  return createPortal(
    <div className="fixed top-5 right-5 z-[9999] pointer-events-none">
      <div className="flex items-center gap-3 bg-emerald-900/95 border border-emerald-500/50
                      rounded-2xl px-5 py-3 shadow-2xl animate-slide-up">
        <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
        <span className="text-emerald-100 text-sm font-body">{message}</span>
      </div>
    </div>,
    document.body
  )
}

// ─── Modal Nuevo Proveedor ──────────────────────────────────────────────────

function NuevoProveedorModal({ open, onClose, onCreated }) {
  const empty = { nombreFiscal: '', nombreComercial: '', identificacionTributaria: '', telefono: '', email: '' }
  const [form,   setForm]   = useState(empty)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (!open) { setForm(empty); setErrors({}) } }, [open])

  function set(k, v) { setForm(p => ({ ...p, [k]: v })) }
  function setField(k, v) {
    let val = v
    if (k === 'identificacionTributaria') val = v.replace(/[^0-9-]/g, '')
    if (k === 'telefono')                 val = v.replace(/[^0-9]/g, '')
    setForm(p => ({ ...p, [k]: val }))
  }

  async function guardar() {
    const e = {}
    if (!form.nombreFiscal.trim())    e.nombreFiscal    = 'Requerido'
    if (!form.nombreComercial.trim()) e.nombreComercial = 'Requerido'
    setErrors(e)
    if (Object.keys(e).length) return

    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('proveedor')
        .insert({
          nombre_fiscal:              cap(form.nombreFiscal),
          nombre_comercial:           cap(form.nombreComercial),
          identificacion_tributaria:  form.identificacionTributaria.trim(),
          telefono:                   form.telefono.trim(),
          email:                      form.email.trim(),
        })
        .select()
        .single()

      if (error) throw error

      // Normalizar al shape que usa el selector (camelCase)
      const prov = {
        idProveedor:               data.id_proveedor,
        nombreFiscal:              data.nombre_fiscal,
        nombreComercial:           data.nombre_comercial,
        identificacionTributaria:  data.identificacion_tributaria,
        telefono:                  data.telefono,
        email:                     data.email,
      }
      onClose()
      setTimeout(() => onCreated(prov), 0)
    } catch (err) {
      setErrors({ general: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nuevo Proveedor">
      <div className="space-y-4">
        <Input label="Nombre fiscal *" value={form.nombreFiscal}
          onChange={e => set('nombreFiscal', e.target.value)}
          error={errors.nombreFiscal} placeholder="Razón social" />
        <Input label="Nombre comercial *" value={form.nombreComercial}
          onChange={e => set('nombreComercial', e.target.value)}
          error={errors.nombreComercial}
          placeholder="Nombre por el que se lo conoce" />
        <Input label="CUIT / RUT" value={form.identificacionTributaria} type="tel" inputMode="numeric" pattern="[0-9-]*"
          onChange={e => setField('identificacionTributaria', e.target.value)} placeholder="20-12345678-9"  />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Teléfono" value={form.telefono} type="tel" inputMode="numeric" pattern="[0-9+\-() ]*"
            onChange={e => setField('telefono', e.target.value)} placeholder="3510000000"  />
          <Input label="Email" value={form.email}
            onChange={e => set('email', e.target.value)} placeholder="email@ejemplo.com" />
        </div>
        {errors.general && (
          <p className="text-red-400 text-xs font-body">{errors.general}</p>
        )}
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" onClick={guardar} disabled={saving}>
            {saving ? 'Creando...' : 'Crear Proveedor'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Selector de Proveedor ──────────────────────────────────────────────────

function ProveedorSelector({ value, onChange, onToast }) {
  const [search,   setSearch]   = useState('')
  const [results,  setResults]  = useState([])
  const [showDrop, setShowDrop] = useState(false)
  const [showNew,  setShowNew]  = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    const handler = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowDrop(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Populate search text when editing an existing order with a provider
  useEffect(() => {
    if (value && !search) {
      setSearch(value.nombreComercial || value.nombreFiscal)
    }
  }, [value])

  async function buscar(text) {
    setSearch(text)
    if (!text.trim()) { setResults([]); setShowDrop(false); return }

    const { data } = await supabase
      .from('proveedor')
      .select('*')
      .or(`nombre_fiscal.ilike.%${text}%,nombre_comercial.ilike.%${text}%`)
      .limit(8)

    // Also try exact ID match
    const isNumeric = /^\d+$/.test(text.trim())
    let rows = data ?? []
    if (isNumeric) {
      const { data: byId } = await supabase
        .from('proveedor')
        .select('*')
        .eq('id_proveedor', parseInt(text.trim()))
        .limit(1)
      if (byId?.length) {
        const existing = rows.find(r => r.id_proveedor === byId[0].id_proveedor)
        if (!existing) rows = [...byId, ...rows]
      }
    }

    // Normalize to camelCase
    const normalized = rows.map(r => ({
      idProveedor:              r.id_proveedor,
      nombreFiscal:             r.nombre_fiscal,
      nombreComercial:          r.nombre_comercial,
      identificacionTributaria: r.identificacion_tributaria,
      telefono:                 r.telefono,
      email:                    r.email,
    }))
    setResults(normalized)
    setShowDrop(true)
  }

  function seleccionar(p) {
    onChange(p)
    setSearch(p.nombreComercial || p.nombreFiscal)
    setShowDrop(false)
  }

  function limpiar() { onChange(null); setSearch(''); setResults([]) }

  function abrirNuevo() {
    setShowDrop(false)
    setTimeout(() => setShowNew(true), 50)
  }

  function handleCreated(prov) {
    seleccionar(prov)
    onToast('Proveedor creado correctamente ✓')
  }

  return (
    <div ref={wrapRef} className="relative">
      <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1">
        Proveedor
      </label>

      {value ? (
        <div className="flex items-center gap-3 bg-surface-700 border border-brand-500/40 rounded-xl px-4 py-2.5">
          <Building2 size={15} className="text-brand-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-white text-sm font-body">{value.nombreComercial || value.nombreFiscal}</p>
            <p className="text-surface-400 text-xs font-mono">
              #{value.idProveedor} · {value.nombreFiscal}
              {value.identificacionTributaria ? ` · CUIT ${value.identificacionTributaria}` : ''}
            </p>
          </div>
          <button onClick={limpiar} className="text-surface-400 hover:text-red-400 transition-colors text-xl leading-none">×</button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 pointer-events-none" />
              <input value={search} onChange={e => buscar(e.target.value)}
                onFocus={() => search && setShowDrop(true)}
                placeholder="Buscar proveedor..."
                className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2.5 text-white
                           text-sm font-body placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all" />
            </div>
            <Button size="sm" variant="secondary" icon={UserPlus} onClick={abrirNuevo}>Nuevo</Button>
          </div>

          {showDrop && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface-800 border border-surface-600
                            rounded-xl shadow-2xl z-50 overflow-hidden">
              {results.length === 0 ? (
                <div className="px-4 py-3">
                  <p className="text-surface-300 text-xs font-body mb-2">Sin resultados para "{search}"</p>
                  <button onClick={abrirNuevo}
                    className="text-brand-400 text-xs font-body hover:underline flex items-center gap-1">
                    <UserPlus size={12} /> Crear proveedor "{search}"
                  </button>
                </div>
              ) : (
                results.map(p => (
                  <button key={p.idProveedor} onClick={() => seleccionar(p)}
                    className="w-full text-left px-4 py-2.5 hover:bg-surface-700 transition-colors border-b border-surface-700/60 last:border-0">
                    <p className="text-white text-sm font-body">{p.nombreComercial || p.nombreFiscal}</p>
                    <p className="text-surface-400 text-xs font-mono">
                      #{p.idProveedor} · {p.nombreFiscal}
                    </p>
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}

      <NuevoProveedorModal open={showNew} onClose={() => setShowNew(false)} onCreated={handleCreated} />
    </div>
  )
}

// ─── Helpers de normalización ──────────────────────────────────────────────

function norm(s) {
  return (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// ─── Fila de ítem del pedido ────────────────────────────────────────────────

function ItemRow({ item, index, onUpdate, onRemove, disabled = false }) {
  const [nombreSearch,   setNombreSearch]   = useState(item.nombreProducto || '')
  const [nombreResults,  setNombreResults]  = useState([])
  const [showDrop,       setShowDrop]       = useState(false)
  const [dropPos,        setDropPos]        = useState({ top: 0, left: 0, width: 0 })
  const [medidas,        setMedidas]        = useState([])
  const inputRef = useRef(null)
  const wrapRef  = useRef(null)
  const dropRef  = useRef(null)

  useEffect(() => {
    const handler = e => {
      const inWrap = wrapRef.current && wrapRef.current.contains(e.target)
      const inDrop = dropRef.current && dropRef.current.contains(e.target)
      if (!inWrap && !inDrop) setShowDrop(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Recalcula posición del dropdown (scroll-aware)
  useEffect(() => {
    if (!showDrop || !inputRef.current) return
    const update = () => {
      const rect = inputRef.current.getBoundingClientRect()
      setDropPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX, width: Math.max(rect.width, 300) })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update) }
  }, [showDrop])

  // Sync nombre search when item changes externally (edit mode load)
  useEffect(() => {
    if (item.nombreProducto && item.nombreProducto !== nombreSearch) {
      setNombreSearch(item.nombreProducto)
    }
  }, [item.nombreProducto])

  // Cargar medidas si el producto las tiene
  useEffect(() => {
    if (!item.idProducto) { setMedidas([]); return }
    async function fetchMedidas() {
      const { data: prod } = await supabase
        .from('producto')
        .select('tiene_medidas')
        .eq('id_producto', parseInt(item.idProducto))
        .single()
      if (prod?.tiene_medidas) {
        const { data: ms } = await supabase
          .from('producto_medida')
          .select('medida')
          .eq('id_producto', parseInt(item.idProducto))
          .order('medida')
        setMedidas((ms ?? []).map(r => r.medida))
      } else {
        setMedidas([])
        onUpdate(index, 'medida', null)
      }
    }
    fetchMedidas()
  }, [item.idProducto])

  async function buscarPorNombre(text) {
    setNombreSearch(text)
    onUpdate(index, 'nombreProducto', text)
    onUpdate(index, 'idProducto', '')
    onUpdate(index, 'precioUnitario', '')
    if (!text.trim()) { setNombreResults([]); setShowDrop(false); return }

    const normText = norm(text.trim())
    const { data } = await supabase
      .from('producto')
      .select('*')
      .limit(2000)

    const rows = (data ?? [])
      .filter(p => norm(p.nombre).includes(normText))
      .slice(0, 12)
      .map(p => ({
        idProducto:      p.id_producto,
        nombre:          p.nombre,
        precioProveedor: Number(p.precio_proveedor ?? 0),
        tieneMedidas:    p.tiene_medidas,
      }))

    setNombreResults(rows)
    setShowDrop(true)
  }

  function seleccionarProducto(p) {
    setNombreSearch(p.nombre)
    setShowDrop(false)
    onUpdate(index, 'idProducto',     p.idProducto)
    onUpdate(index, 'nombreProducto', p.nombre)
    if (p.precioProveedor > 0) {
      onUpdate(index, 'precioUnitario', p.precioProveedor)
    } else {
      onUpdate(index, 'precioUnitario', '')
    }
    onUpdate(index, 'medida', null)
  }

  async function handleIdChange(val) {
    const clean = val.replace(/\D/g, '')
    onUpdate(index, 'idProducto', clean)
    if (!clean) {
      setNombreSearch('')
      onUpdate(index, 'nombreProducto', '')
      onUpdate(index, 'precioUnitario', '')
      onUpdate(index, 'medida', null)
      return
    }
    const { data: p } = await supabase
      .from('producto')
      .select('*')
      .eq('id_producto', parseInt(clean))
      .single()
    if (p) {
      setNombreSearch(p.nombre)
      onUpdate(index, 'nombreProducto', p.nombre)
      onUpdate(index, 'precioUnitario', (p.precio_proveedor ?? 0) > 0 ? p.precio_proveedor : '')
      onUpdate(index, 'medida', null)
    } else {
      setNombreSearch('')
      onUpdate(index, 'nombreProducto', '')
      onUpdate(index, 'precioUnitario', '')
    }
  }

  const cell = `bg-surface-700 border border-surface-600 rounded-lg px-2 py-1.5 text-white text-sm
                font-mono focus:outline-none focus:border-brand-500 transition-all
                [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`

  const subtotal = (parseInt(item.cantidad) || 0) * (parseFloat(String(item.precioUnitario).replace(',', '.')) || 0)

  return (
    <tr className="border-b border-surface-700/50">
      {/* # */}
      <td className="py-2 px-3 text-surface-500 text-sm font-mono w-8 select-none">{index + 1}</td>

      {/* Cantidad */}
      <td className="py-2 px-2 w-20">
        <input type="text" inputMode="numeric" value={item.cantidad}
          onChange={e => onUpdate(index, 'cantidad', e.target.value.replace(/\D/g, ''))}
          onBlur={e => { if (!e.target.value) onUpdate(index, 'cantidad', '1') }}
          disabled={disabled}
          className={cell + ' w-full text-center disabled:opacity-40 disabled:cursor-not-allowed'} />
      </td>

      {/* Nombre con dropdown */}
      <td className="py-2 px-2 min-w-[200px]" ref={wrapRef}>
        <input ref={inputRef} value={nombreSearch}
          onChange={e => buscarPorNombre(e.target.value)}
          placeholder="Nombre del producto..."
          disabled={disabled}
          className={cell + ' w-full disabled:opacity-40 disabled:cursor-not-allowed'} />
        {showDrop && createPortal(
          <div
            ref={dropRef}
            data-producto-drop
            style={{ position: 'absolute', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
            className="bg-surface-800 border border-surface-600 rounded-xl shadow-2xl max-h-[260px] overflow-y-auto"
          >
            {nombreResults.length === 0 ? (
              <p className="px-4 py-3 text-surface-300 text-xs font-body">Sin resultados para "{nombreSearch}"</p>
            ) : (
              nombreResults.map(p => (
                <button key={p.idProducto}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => seleccionarProducto(p)}
                  className="w-full text-left px-3 py-2.5 hover:bg-surface-700 transition-colors border-b border-surface-700/60 last:border-0">
                  <p className="text-white text-xs font-body leading-tight">{p.nombre}</p>
                  <p className="text-surface-400 text-xs font-mono mt-0.5">
                    #{p.idProducto}{p.tieneMedidas ? ' · Con medidas' : ''}
                    {p.precioProveedor > 0 ? ` · Último precio: ${fmt(p.precioProveedor)}` : ''}
                  </p>
                </button>
              ))
            )}
          </div>,
          document.body
        )}
      </td>

      {/* ID */}
      <td className="py-2 px-2 w-28">
        <input type="text" inputMode="numeric" value={item.idProducto || ''}
          onChange={e => handleIdChange(e.target.value)}
          placeholder="ID"
          disabled={disabled}
          className={cell + ' w-full text-center disabled:opacity-40 disabled:cursor-not-allowed'} />
      </td>

      {/* Medida */}
      <td className="py-2 px-2 w-32">
        {medidas.length > 0 ? (
          <select value={item.medida || ''}
            onChange={e => onUpdate(index, 'medida', e.target.value)}
            disabled={disabled}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-2 py-1.5
                       text-white text-sm font-body focus:outline-none focus:border-brand-500 cursor-pointer
                       disabled:opacity-40 disabled:cursor-not-allowed">
            <option value="">— medida —</option>
            {medidas.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <span className="text-surface-500 text-xs px-2">—</span>
        )}
      </td>

      {/* Precio proveedor */}
      <td className="py-2 px-2 w-36">
        <input
          type="text"
          inputMode="decimal"
          value={item.precioUnitario}
          onChange={e => {
            const v = e.target.value.replace(',', '.')
            if (/^\d*\.?\d*$/.test(v)) onUpdate(index, 'precioUnitario', v)
          }}
          onBlur={e => {
            const parsed = parseFloat(e.target.value) || 0
            onUpdate(index, 'precioUnitario', parsed === 0 ? '' : parsed)
          }}
          placeholder="0.00"
          disabled={disabled}
          className={cell + ' w-full disabled:opacity-40 disabled:cursor-not-allowed'}
        />
      </td>

      {/* Subtotal */}
      <td className="py-2 px-3 text-right w-36">
        <span className="text-surface-200 text-sm font-mono">{fmt(subtotal)}</span>
      </td>

      {/* Borrar */}
      <td className="py-2 px-2 w-10">
        <button onClick={() => onRemove(index)}
          disabled={disabled}
          className="text-surface-500 hover:text-red-400 transition-colors p-1 rounded
                     disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-surface-500">
          <Trash2 size={15} />
        </button>
      </td>
    </tr>
  )
}

// ─── Vista detalle de un pedido ─────────────────────────────────────────────

function PedidoDetalle({ pedido: pedidoInit, onBack, onUpdated, onEditar }) {
  const [pedido,        setPedido]        = useState(pedidoInit)
  const [detalles,      setDetalles]      = useState([])
  const [confirmPagar,  setConfirmPagar]  = useState(false)
  const [confirmEstado, setConfirmEstado] = useState(null) // 'recibido'
  const [proveedor,     setProveedor]     = useState(null)
  const [loading,       setLoading]       = useState(false)
  const [cuotas,        setCuotas]        = useState([])
  const [confirmCuota,  setConfirmCuota]  = useState(null) // idCuota a confirmar pago
  const [loadingCuota,  setLoadingCuota]  = useState(false)
  const [generandoPDF,  setGenerandoPDF]  = useState(false)
  const [pdfError,      setPdfError]      = useState('')

  const reload = useCallback(async () => {
    // Pedido actualizado
    const p = await obtenerPedidoPorId(pedidoInit.idPedido)
    if (p) setPedido(p)

    // Plan de cuotas (sólo si el pedido es CC fraccionada)
    if (p?.tieneCuotas || pedidoInit.tieneCuotas) {
      setCuotas(await obtenerCuotasDePedido(pedidoInit.idPedido))
    }

    // Detalles
    const rows = await obtenerDetallesDePedido(pedidoInit.idPedido)
    setDetalles(rows)

    // Proveedor: intentar desde BD; si fue borrado, usar snapshot
    const idProv       = p?.idProveedor ?? pedidoInit.idProveedor
    const snapshotNombre = p?.nombreProveedor ?? pedidoInit.nombreProveedor
    if (idProv) {
      const { data: prov } = await supabase
        .from('proveedor')
        .select('*')
        .eq('id_proveedor', idProv)
        .single()
      if (prov) {
        setProveedor({
          idProveedor:    prov.id_proveedor,
          nombreFiscal:   prov.nombre_fiscal,
          nombreComercial: prov.nombre_comercial,
        })
      } else if (snapshotNombre) {
        setProveedor({ nombreComercial: snapshotNombre, nombreFiscal: snapshotNombre, idProveedor: null, _deleted: true })
      } else {
        setProveedor(null)
      }
    } else if (snapshotNombre) {
      setProveedor({ nombreComercial: snapshotNombre, nombreFiscal: snapshotNombre, idProveedor: null, _deleted: true })
    } else {
      setProveedor(null)
    }
  }, [pedidoInit.idPedido])

  useEffect(() => { reload() }, [reload])

  async function marcarPagado() {
    setLoading(true)
    try {
      const fechaHoy = today()
      await marcarPedidoPagado(pedido.idPedido, fechaHoy)
      setConfirmPagar(false)
      setPedido(prev => ({ ...prev, estadoPago: 'pagado', fechaPago: fechaHoy }))
      onUpdated()
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function pagarCuota(idCuota) {
    setLoadingCuota(true)
    try {
      await marcarCuotaPagada(idCuota, today())
      setConfirmCuota(null)
      await reload()
      onUpdated()
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingCuota(false)
    }
  }

  async function descargarHojaRecepcion() {
    setPdfError('')
    setGenerandoPDF(true)
    try {
      await generarPDFPedidoCompra(pedido.idPedido)
    } catch (err) {
      console.error(err)
      setPdfError('No se pudo generar el PDF. Intentá nuevamente.')
    } finally {
      setGenerandoPDF(false)
    }
  }

  async function cambiarEstadoLogistico(nuevoEstado) {
    setLoading(true)
    try {
      const fechaRecepcion = nuevoEstado === 'recibido' ? today() : null
      if (nuevoEstado === 'recibido') {
        await recibirPedido(pedido.idPedido, fechaRecepcion)
      }
      setConfirmEstado(null)
      await reload()
      onUpdated()
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const esPendientePago   = pedido.estadoPago === 'pendiente'
  const estadoLog         = pedido.estadoLogistico ?? 'encargado'
  const cfg               = ESTADO_CONFIG[estadoLog] ?? ESTADO_CONFIG.encargado
  const esEcheck          = pedido.metodoPago === 'echeck'
  const dia30             = fechaVencimientoEcheck(pedido.fecha)

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack}
            className="flex items-center gap-2 text-surface-400 hover:text-white text-sm font-body transition-colors">
            <ArrowLeft size={16} />Volver a pedidos
          </button>
          <span className="text-surface-600">/</span>
          <span className="text-surface-300 text-sm font-body">
            Pedido <span className="text-brand-400 font-mono">#{pedido.idPedido}</span>
          </span>
        </div>
        {estadoLog === 'encargado' && (
          <Button size="sm" variant="secondary" icon={Pencil} onClick={onEditar}>
            Editar
          </Button>
        )}
      </div>

      {/* Cabecera */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-surface-400 text-xs tracking-widest uppercase font-body mb-1">Pedido de Compra</p>
            <h2 className="font-display text-4xl text-white tracking-widest">#{pedido.idPedido}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={cfg.color}>
              <cfg.icon size={11} className="inline mr-1" />{cfg.label}
            </Badge>
            <Badge color={esPendientePago ? 'yellow' : 'green'}>
              {esPendientePago ? <Clock size={11} className="inline mr-1" /> : <CheckCircle2 size={11} className="inline mr-1" />}
              {esPendientePago ? 'Pago pendiente' : 'Pagado'}
            </Badge>
          </div>
        </div>
        {/* Aviso echeck */}
        {esEcheck && (
          <div className="mt-4 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
            <CalendarCheck size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-amber-300 text-sm font-body">
              <strong>E-Check (CC30):</strong> Este monto será debitado automáticamente el día <strong>{dia30}</strong>.
            </p>
          </div>
        )}
        {pedido.metodoPago === 'cuenta_corriente' && !pedido.tieneCuotas && pedido.diasVencimientoCC != null && (
          <div className="mt-4 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
            <CalendarCheck size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-amber-300 text-sm font-body">
              <strong>Cuenta Corriente:</strong> Vence el <strong>{sumarDiasFmt(pedido.fecha, pedido.diasVencimientoCC)}</strong>.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Fecha pedido</p>
            <p className="text-white text-sm font-mono">{fmtFecha(pedido.fecha)}</p>
          </div>
          {pedido.fechaRecepcion && (
            <div className="bg-surface-700 rounded-xl p-4">
              <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Fecha recepción</p>
              <p className="text-white text-sm font-mono">{fmtFecha(pedido.fechaRecepcion)}</p>
            </div>
          )}
          {pedido.estadoPago === 'pagado' && (
            <div className="bg-surface-700 rounded-xl p-4">
              <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Fecha de pago</p>
              <p className="text-emerald-400 text-sm font-mono">{fmtFecha(pedido.fechaPago)}</p>
            </div>
          )}
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Método de pago</p>
            <p className="text-white text-sm font-body">
              {metodoPagoLabel(pedido)}
            </p>
          </div>
          {proveedor && (
            <div className="bg-surface-700 rounded-xl p-4">
              <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Proveedor</p>
              <p className="text-white text-sm font-body">{proveedor.nombreComercial || proveedor.nombreFiscal}</p>
            </div>
          )}
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Total</p>
            <p className="text-brand-400 font-mono font-bold text-lg">{fmt(pedido.monto)}</p>
          </div>
        </div>
        {/* Acciones de estado */}
        {(estadoLog === 'encargado' || (esPendientePago && !pedido.tieneCuotas)) && (
          <div className="mt-6 pt-5 border-t border-surface-700">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-3">Cambiar estado</p>
            <div className="flex flex-wrap gap-2">
              {estadoLog === 'encargado' && (
                <Button size="sm" icon={Truck} onClick={() => setConfirmEstado('recibido')}
                  className="bg-brand-600 hover:bg-brand-500 border-brand-500 text-white">
                  Marcar Recibido
                </Button>
              )}
              {esPendientePago && !pedido.tieneCuotas && (
                <Button size="sm" icon={BadgeCheck} onClick={() => setConfirmPagar(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 border-emerald-500 text-white">
                  Marcar Pagado
                </Button>
              )}
            </div>
          </div>
        )}
        {/* CC con cuotas: el pago único no aplica — se paga cuota por cuota más abajo */}
        {esPendientePago && pedido.tieneCuotas && (
          <div className="mt-6 pt-5 border-t border-surface-700">
            <p className="text-surface-500 text-xs font-body flex items-center gap-2">
              <Layers size={13} className="text-brand-400 flex-shrink-0" />
              Este pedido se paga por cuotas: se debe confirmar cada pago individualmente en el plan de cuotas de abajo.
            </p>
          </div>
        )}
      </Card>

      {/* Plan de cuotas (CC fraccionada) */}
      {pedido.tieneCuotas && (
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-surface-700 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-body font-semibold text-white text-sm">
              <Layers size={14} className="text-brand-400" /> Plan de cuotas
            </h3>
            <span className="text-surface-400 text-xs font-mono">
              {cuotas.filter(c => c.estado === 'pagada').length} / {cuotas.length} pagadas
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="border-b border-surface-700">
                  {['Cuota', '%', 'Vencimiento', 'Monto', 'Estado', ''].map(h => (
                    <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cuotas.map(c => (
                  <tr key={c.idCuota} className="border-b border-surface-700/50">
                    <td className="py-3 px-4 text-white font-mono text-sm">#{c.numeroCuota}</td>
                    <td className="py-3 px-4 text-surface-300 font-mono text-xs">{c.porcentaje}%</td>
                    <td className="py-3 px-4 text-surface-300 font-mono text-xs">{fmtFecha(c.fechaVencimiento)}</td>
                    <td className="py-3 px-4 text-surface-200 font-mono font-medium">{fmt(c.monto)}</td>
                    <td className="py-3 px-4">
                      {c.estado === 'pagada'
                        ? <Badge color="green"><CheckCircle2 size={11} className="inline mr-1" />Pagada{c.fechaPago ? ` · ${fmtFecha(c.fechaPago)}` : ''}</Badge>
                        : <Badge color="yellow"><Clock size={11} className="inline mr-1" />Pendiente</Badge>}
                    </td>
                    <td className="py-3 px-4">
                      {c.estado !== 'pagada' && (
                        <Button size="sm" variant="secondary" icon={BadgeCheck} onClick={() => setConfirmCuota(c.idCuota)}>
                          Pagar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Tabla de ítems */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-700 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="font-body font-semibold text-white text-sm">Productos</h3>
            <span className="text-surface-400 text-xs font-mono">{detalles.length} ítem{detalles.length !== 1 ? 's' : ''}</span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={Printer}
            disabled={generandoPDF || detalles.length === 0}
            onClick={descargarHojaRecepcion}
          >
            {generandoPDF ? 'Generando…' : 'Hoja de recepción (PDF)'}
          </Button>
        </div>
        {pdfError && (
          <div className="mx-6 mt-4 flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20
                          rounded-xl px-4 py-2.5 font-body">
            <AlertCircle size={15} className="flex-shrink-0" />{pdfError}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="border-b border-surface-700">
                {['#','ID Prod.','Producto','Medida','Cant.','Precio Proveedor','Subtotal'].map(h => (
                  <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detalles.map((d, idx) => (
                <tr key={d.idDetallePedido} className="border-b border-surface-700/50">
                  <td className="py-3 px-4 text-surface-500 text-xs font-mono">{idx + 1}</td>
                  <td className="py-3 px-4 text-surface-400 font-mono text-xs">#{d.idProducto}</td>
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
        {detalles.length === 0 && (
          <p className="text-center py-10 text-surface-500 text-sm font-body">Sin ítems registrados.</p>
        )}
      </Card>

      {/* Total */}
      <Card className="p-6">
        <div className="flex justify-end">
          <div className="space-y-2 text-sm font-body text-right">
            {pedido.tieneCuotas && (
              <div className="flex justify-between gap-16 text-surface-400">
                <span>Pagado hasta ahora:</span>
                <span className="font-mono text-emerald-400">
                  {fmt(cuotas.reduce((a, c) => a + (c.estado === 'pagada' ? c.monto : 0), 0))}
                </span>
              </div>
            )}
            <div className="border-t border-surface-700 pt-2 flex justify-between gap-16">
              <span className="text-white font-semibold">
                {pedido.tieneCuotas ? 'Saldo pendiente:' : 'Total del pedido:'}
              </span>
              <span className="text-brand-400 font-mono font-bold text-lg">
                {fmt(pedido.tieneCuotas
                  ? cuotas.reduce((a, c) => a + (c.estado !== 'pagada' ? c.monto : 0), 0)
                  : pedido.monto)}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Modal confirmar pago */}
      <Modal open={confirmPagar} onClose={() => setConfirmPagar(false)} title="Confirmar pago" width="max-w-sm">
        <p className="text-surface-300 text-sm font-body mb-2">
          ¿Marcar el pedido <span className="text-white font-mono">#{pedido.idPedido}</span> como pagado?
        </p>
        <p className="text-surface-500 text-xs font-body mb-6">
          Esta acción registrará el egreso de <span className="text-brand-400 font-mono">{fmt(pedido.monto)}</span>.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmPagar(false)}>Cancelar</Button>
          <Button className="flex-1" icon={BadgeCheck} onClick={marcarPagado} disabled={loading}>
            {loading ? 'Guardando...' : 'Confirmar pago'}
          </Button>
        </div>
      </Modal>

      {/* Modal cambio de estado logístico */}
      <Modal open={!!confirmEstado} onClose={() => setConfirmEstado(null)}
        title={confirmEstado === 'recibido' ? 'Confirmar recepción' : 'Marcar para revisión'}
        width="max-w-sm">
        {confirmEstado === 'recibido' ? (
          <>
            <p className="text-surface-300 text-sm font-body mb-2">
              ¿Confirmar que el pedido <span className="text-white font-mono">#{pedido.idPedido}</span> fue recibido correctamente?
            </p>
            <p className="text-emerald-400 text-xs font-body mb-6 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3 py-2">
              El stock de todos los productos de este pedido se sumará al Inventario.
            </p>
          </>
        ) : (
          <>
            <p className="text-surface-300 text-sm font-body mb-2">
              ¿Marcar el pedido <span className="text-white font-mono">#{pedido.idPedido}</span> para revisión?
            </p>
            <p className="text-yellow-400 text-xs font-body mb-6 bg-yellow-500/10 border border-yellow-500/25 rounded-xl px-3 py-2">
              El stock NO se actualizará hasta que el pedido sea marcado como Recibido.
            </p>
          </>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmEstado(null)}>Cancelar</Button>
          <Button className="flex-1"
            icon={confirmEstado === 'recibido' ? CheckCircle2 : AlertCircle}
            onClick={() => cambiarEstadoLogistico(confirmEstado)}
            disabled={loading}>
            {loading ? 'Procesando...' : 'Confirmar'}
          </Button>
        </div>
      </Modal>

      {/* Modal confirmar pago de cuota individual */}
      <Modal open={!!confirmCuota} onClose={() => setConfirmCuota(null)} title="Confirmar pago de cuota" width="max-w-sm">
        {(() => {
          const c = cuotas.find(c => c.idCuota === confirmCuota)
          if (!c) return null
          return (
            <>
              <p className="text-surface-300 text-sm font-body mb-2">
                ¿Marcar la <span className="text-white font-mono">cuota #{c.numeroCuota}</span> como pagada?
              </p>
              <p className="text-surface-500 text-xs font-body mb-6">
                Se registrará el pago de <span className="text-brand-400 font-mono">{fmt(c.monto)}</span>.
                Si es la última cuota pendiente, el pedido completo pasará a estado "Pagado".
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setConfirmCuota(null)}>Cancelar</Button>
                <Button className="flex-1" icon={BadgeCheck} onClick={() => pagarCuota(c.idCuota)} disabled={loadingCuota}>
                  {loadingCuota ? 'Guardando...' : 'Confirmar pago'}
                </Button>
              </div>
            </>
          )
        })()}
      </Modal>
    </div>
  )
}

// ─── Formulario nuevo / editar pedido ──────────────────────────────────────

const ITEM_EMPTY = () => ({ idProducto: '', nombreProducto: '', cantidad: 1, precioUnitario: '', medida: null })

const METODOS_PAGO = [
  { value: 'efectivo',         label: 'Efectivo' },
  { value: 'transferencia',    label: 'Transferencia' },
  { value: 'echeck',           label: 'E-Check (CC30)' },
  { value: 'cuenta_corriente', label: 'Cuenta Corriente' },
]

// Cuenta Corriente simple (sin fraccionar): días de vencimiento por defecto
const DIAS_CC_DEFAULT = 30

function NuevoPedido({ onGuardado, onCancelar, pedidoEditando }) {
  const esEdicion = !!pedidoEditando

  const [items,      setItems]      = useState([ITEM_EMPTY()])
  const [metodoPago, setMetodoPago] = useState(esEdicion ? (pedidoEditando.metodoPago || 'efectivo') : 'efectivo')
  const [proveedor,  setProveedor]  = useState(null)
  const [toast,      setToast]      = useState('')
  const [error,      setError]      = useState('')
  const [saving,     setSaving]     = useState(false)
  const savingRef                   = useRef(false)   // guardia síncrona contra doble-click
  const [loadingInit, setLoadingInit] = useState(esEdicion)

  // ── Cuenta Corriente: fraccionamiento en cuotas ──────────────────────────
  // conFraccion=false  → CC simple, pago único a `diasVencimientoCC` días.
  // conFraccion=true   → se arma un plan de N cuotas (PlanCuotasCC).
  //
  // La MODALIDAD (pago único ⇄ cuotas) es inmutable una vez creado el
  // pedido: no se puede convertir un CC simple en CC fraccionada ni
  // viceversa (cambia la forma en que se registra el pago). Lo que SÍ se
  // puede editar es el PLAN dentro de una modalidad de cuotas ya elegida:
  // las cuotas 'pendiente' son reformulables (%, días, agregar/quitar); las
  // 'pagada' son inmutables porque representan dinero ya entregado — ver
  // cuotasPagadas / hayCuotaPagada más abajo y actualizarPlanCuotas() en
  // guardar().
  const [conFraccion,       setConFraccion]       = useState(
    esEdicion ? !!pedidoEditando.tieneCuotas : false
  )
  const [diasVencimientoCC, setDiasVencimientoCC] = useState(
    esEdicion ? (pedidoEditando.diasVencimientoCC ?? DIAS_CC_DEFAULT) : DIAS_CC_DEFAULT
  )
  const [cuotas,        setCuotas]        = useState([CUOTA_EMPTY(), CUOTA_EMPTY()]) // borrador de PENDIENTES
  const [cuotasPagadas, setCuotasPagadas] = useState([])                             // bloqueadas, sólo lectura

  // Si ya hay al menos una cuota pagada, el monto total del pedido (y por
  // ende los ítems) se congela: permitir cambiarlo rompería la aritmética
  // entre la plata que ya entró y lo que el nuevo total diría que debería
  // haber entrado. Si ninguna cuota fue pagada aún, el total sigue
  // editable libremente, igual que antes.
  const hayCuotaPagada = esEdicion && cuotasPagadas.length > 0

  // En edición: cargar detalles y proveedor desde el service
  useEffect(() => {
    if (!esEdicion) return
    async function init() {
      try {
        // Detalles del pedido
        const detalles = await obtenerDetallesDePedido(pedidoEditando.idPedido)
        if (detalles.length > 0) {
          setItems(detalles.map(d => ({
            idProducto:     d.idProducto,
            nombreProducto: d.nombreProducto || '',
            cantidad:       d.cantidad,
            precioUnitario: d.precioUnitario,
            medida:         d.medida || null,
          })))
        }
        // Proveedor
        if (pedidoEditando.idProveedor) {
          const { data: prov } = await supabase
            .from('proveedor')
            .select('*')
            .eq('id_proveedor', pedidoEditando.idProveedor)
            .single()
          if (prov) {
            setProveedor({
              idProveedor:    prov.id_proveedor,
              nombreFiscal:   prov.nombre_fiscal,
              nombreComercial: prov.nombre_comercial,
            })
          }
        }
        // Plan de cuotas: separar pagadas (bloqueadas, sólo lectura) de
        // pendientes (borrador editable que se manda a actualizarPlanCuotas).
        if (pedidoEditando.tieneCuotas) {
          const todas = await obtenerCuotasDePedido(pedidoEditando.idPedido)
          setCuotasPagadas(todas.filter(c => c.estado === 'pagada'))
          const pendientes = todas.filter(c => c.estado !== 'pagada')
          setCuotas(pendientes.length
            ? pendientes.map(c => ({ porcentaje: String(c.porcentaje), diasVencimiento: String(c.diasVencimiento) }))
            : [CUOTA_EMPTY()])
        }
      } finally {
        setLoadingInit(false)
      }
    }
    init()
  }, [esEdicion])

  const totalItems = items.reduce((acc, it) =>
    acc + (parseInt(it.cantidad) || 0) * (parseFloat(String(it.precioUnitario).replace(',', '.')) || 0), 0)

  // Si ya hay plata cobrada (hayCuotaPagada), los ítems están deshabilitados
  // en la UI y el total NO se recalcula desde ahí — se usa el monto real
  // del pedido, que es la base contra la que el RPC recalcula las cuotas
  // pendientes.
  const total = hayCuotaPagada ? pedidoEditando.monto : totalItems

  const dia30 = fechaVencimientoEcheck()

  function updateItem(idx, key, val) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [key]: val } : it))
  }
  function addItem()       { setItems(prev => [...prev, ITEM_EMPTY()]) }
  function removeItem(idx) { setItems(prev => prev.filter((_, i) => i !== idx)) }

  async function guardar() {
    // Protección síncrona: si ya hay un guardado en curso, ignorar clicks adicionales
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')

    try {
      if (!proveedor) { setError('Seleccioná un proveedor antes de guardar el pedido.'); return }
      const validItems = items.filter(it => it.idProducto && parseInt(it.cantidad) > 0)
      if (!validItems.length) { setError('Agregá al menos un producto con ID válido.'); return }

      // Validación del plan de cuotas: en creación, el borrador completo
      // debe sumar 100%; en edición, sólo las PENDIENTES son editables y
      // deben sumar 100% menos lo ya bloqueado por cuotas pagadas.
      const esCCFraccionada = metodoPago === 'cuenta_corriente' && conFraccion
      if (esCCFraccionada) {
        const cuotasErr = esEdicion
          ? validarEdicionPlanCuotas(cuotasPagadas, cuotas)
          : validarPlanCuotas(cuotas)
        if (cuotasErr) { setError(cuotasErr); return }
      }
      if (metodoPago === 'cuenta_corriente' && !conFraccion && (diasVencimientoCC === '' || Number(diasVencimientoCC) < 0)) {
        setError('Ingresá los días de vencimiento de la Cuenta Corriente.')
        return
      }

      // Validaciones previas: precio, existencia, medida
      for (const it of validItems) {
        const precio = parseFloat(String(it.precioUnitario).replace(',', '.')) || 0
        if (precio <= 0) { setError(`Ingresá el precio del proveedor para "${it.nombreProducto || `ID ${it.idProducto}`}".`); return }

        const { data: existe } = await supabase
          .from('producto')
          .select('id_producto, tiene_medidas')
          .eq('id_producto', parseInt(it.idProducto))
          .single()
        if (!existe) { setError(`El producto ID ${it.idProducto} no existe en el inventario.`); return }
        if (existe.tiene_medidas && !it.medida) { setError(`Seleccioná una medida para el producto ID ${it.idProducto}.`); return }
      }

      const detallesPayload = validItems.map(it => ({
        idProducto:     parseInt(it.idProducto),
        nombreProducto: it.nombreProducto || null,
        medida:         it.medida || null,
        cantidad:       parseInt(it.cantidad),
        precioUnitario: parseFloat(String(it.precioUnitario).replace(',', '.')) || 0,
        subtotal:       (parseInt(it.cantidad)) * (parseFloat(String(it.precioUnitario).replace(',', '.')) || 0),
      }))

      if (esEdicion) {
        // Actualizar — preserva estado logístico y de pago actuales.
        // Si el pedido tiene plan de cuotas, `monto` ya viene congelado en
        // `total` cuando hayCuotaPagada (ver cálculo de `total` más arriba).
        const pedidoPayload = {
          fecha:              pedidoEditando.fecha,
          monto:              total,
          estadoPago:         pedidoEditando.estadoPago,
          estadoLogistico:    pedidoEditando.estadoLogistico,
          fechaRecepcion:     pedidoEditando.fechaRecepcion ?? null,
          fechaPago:          pedidoEditando.fechaPago      ?? null,
          metodoPago:         metodoPago,
          idProveedor:        proveedor?.idProveedor ?? null,
          nombreProveedor:    proveedor?.nombreComercial || proveedor?.nombreFiscal || null,
          diasVencimientoCC:  metodoPago === 'cuenta_corriente' && !pedidoEditando.tieneCuotas
                                 ? (parseInt(diasVencimientoCC, 10) || null)
                                 : pedidoEditando.diasVencimientoCC ?? null,
        }
        await actualizarPedido(pedidoEditando.idPedido, pedidoPayload, detallesPayload)

        // Plan de cuotas: se edita en un paso aparte vía el RPC atómico
        // editar_plan_cuotas_pedido, que revalida Σ% == 100% del lado del
        // servidor y protege las cuotas ya pagadas sin importar lo que
        // haya validado (o no) el cliente. Es idempotente — si falla acá,
        // la cabecera ya quedó guardada y se puede reintentar sólo esta
        // parte sin duplicar nada.
        if (pedidoEditando.tieneCuotas) {
          await actualizarPlanCuotas(pedidoEditando.idPedido, cuotas)
        }

        onGuardado(pedidoEditando.idPedido)
      } else {
        const pedidoPayload = {
          fecha:              today(),
          monto:              total,
          estadoPago:         'pendiente',
          estadoLogistico:    'encargado',
          metodoPago:         metodoPago,
          idProveedor:        proveedor?.idProveedor ?? null,
          nombreProveedor:    proveedor?.nombreComercial || proveedor?.nombreFiscal || null,
          diasVencimientoCC:  metodoPago === 'cuenta_corriente' && !esCCFraccionada
                                 ? (parseInt(diasVencimientoCC, 10) || null)
                                 : null,
        }

        let creado
        if (esCCFraccionada) {
          // Plan de N cuotas → creación atómica vía RPC (pedido + detalle + cuotas)
          const planCuotas = calcularPlanCuotas(
            total,
            cuotas.map(c => ({ porcentaje: Number(c.porcentaje), diasVencimiento: Number(c.diasVencimiento) }))
          )
          creado = await crearPedidoConCuotas(pedidoPayload, detallesPayload, planCuotas)
        } else {
          // Resto de métodos (incluida CC simple) → flujo existente, sin cambios
          creado = await crearPedido(pedidoPayload, detallesPayload)
        }
        onGuardado(creado.idPedido)
      }
    } catch (err) {
      setError(err.message || 'Ocurrió un error al guardar el pedido.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (loadingInit) {
    return (
      <div className="max-w-5xl mx-auto flex items-center justify-center py-24">
        <p className="text-surface-400 text-sm font-body">Cargando pedido...</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-slide-up">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}

      <div className="flex items-center gap-3">
        <button onClick={onCancelar}
          className="flex items-center gap-2 text-surface-400 hover:text-white text-sm font-body transition-colors">
          <ArrowLeft size={16} />Volver a pedidos
        </button>
      </div>

      <PageHeader
        title={esEdicion ? `Editar Pedido #${pedidoEditando.idPedido}` : 'Nuevo Pedido'}
        subtitle="Pedido de compra"
      />

      {/* Info */}
      <div className="bg-blue-500/10 border border-blue-500/25 rounded-xl px-5 py-3 flex items-start gap-3">
        <Package size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
        <p className="text-blue-300 text-sm font-body">
          El precio unitario se autocompleta con el último precio del proveedor registrado en Inventario.
          Si no hay precio previo, el campo quedará vacío para que lo ingreses manualmente.
        </p>
      </div>

      {/* Proveedor + Método de pago */}
      <Card className="p-6 space-y-5">
        <ProveedorSelector value={proveedor} onChange={setProveedor} onToast={setToast} />

        <div>
          <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-2">
            Método de pago
          </label>
          <div className="flex flex-wrap gap-2">
            {METODOS_PAGO.map(m => (
              <button key={m.value} onClick={() => setMetodoPago(m.value)}
                className={`px-4 py-2 rounded-xl text-sm font-body border transition-all
                  ${metodoPago === m.value
                    ? 'bg-brand-500/15 border-brand-500/40 text-white'
                    : 'bg-surface-700 border-surface-600 text-surface-400 hover:border-surface-500'}`}>
                {m.label}
              </button>
            ))}
          </div>

          {metodoPago === 'echeck' && (
            <div className="mt-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
              <CalendarCheck size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-amber-300 text-sm font-body">
                <strong>E-Check (CC30):</strong> El monto será debitado automáticamente el día <strong>{dia30}</strong>.
              </p>
            </div>
          )}

          {metodoPago === 'cuenta_corriente' && (
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-2">Modalidad</p>
                <div className="inline-flex bg-surface-900/50 border border-surface-600 rounded-xl p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => setConFraccion(false)}
                    disabled={esEdicion}
                    aria-pressed={!conFraccion}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-body font-medium
                               transition-all disabled:cursor-not-allowed
                               ${!conFraccion
                                 ? 'bg-brand-600 text-white shadow-md shadow-brand-900/40'
                                 : 'text-surface-400 hover:text-surface-200 disabled:hover:text-surface-400'}`}>
                    <Landmark size={14} /> Pago único
                  </button>
                  <button
                    type="button"
                    onClick={() => setConFraccion(true)}
                    disabled={esEdicion}
                    aria-pressed={conFraccion}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-body font-medium
                               transition-all disabled:cursor-not-allowed
                               ${conFraccion
                                 ? 'bg-brand-600 text-white shadow-md shadow-brand-900/40'
                                 : 'text-surface-400 hover:text-surface-200 disabled:hover:text-surface-400'}`}>
                    <Layers size={14} /> Con fracción / Cuotas
                  </button>
                </div>
              </div>
              {esEdicion && (
                <p className="text-surface-500 text-xs font-body">
                  La modalidad (pago único / cuotas) no puede cambiarse una vez creado el pedido.
                  {pedidoEditando.tieneCuotas && ' Podés editar el % y los días de las cuotas pendientes; las ya pagadas quedan bloqueadas.'}
                </p>
              )}

              {hayCuotaPagada && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
                  <Lock size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-amber-300 text-sm font-body">
                    Este pedido ya tiene cuotas pagadas: el monto total y los ítems quedan
                    congelados para no alterar dinero ya entregado. Sólo se puede ajustar
                    el plan de las cuotas pendientes.
                  </p>
                </div>
              )}

              {!conFraccion ? (
                <div className="max-w-xs">
                  <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1">
                    Días de vencimiento
                  </label>
                  <div className="relative">
                    <Landmark size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 pointer-events-none" />
                    <input
                      type="text" inputMode="numeric"
                      value={diasVencimientoCC}
                      onChange={e => setDiasVencimientoCC(e.target.value.replace(/\D/g, ''))}
                      disabled={esEdicion}
                      placeholder="30"
                      className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2.5 text-white
                                 text-sm font-mono focus:outline-none focus:border-brand-500 transition-all disabled:opacity-40"
                    />
                  </div>
                  <p className="text-surface-500 text-xs font-body mt-1">
                    Vence el {sumarDiasFmt(esEdicion ? pedidoEditando.fecha : today(), diasVencimientoCC)}
                    {' '}({diasVencimientoCC || 0} días desde la fecha del pedido).
                  </p>
                </div>
              ) : (
                <PlanCuotasCC
                  total={total}
                  cuotas={cuotas}
                  onChange={setCuotas}
                  bloqueadas={cuotasPagadas}
                />
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Tabla de productos */}
      <Card className="overflow-visible">
        <div className="px-6 py-4 border-b border-surface-700 flex items-center justify-between">
          <h2 className="font-body font-semibold text-white text-sm">Productos</h2>
          <Button size="sm" icon={Plus} onClick={addItem} disabled={hayCuotaPagada}>Agregar ítem</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700">
                {['#','Cant.','Nombre','ID','Medida','Precio Proveedor','Subtotal',''].map(h => (
                  <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-2 first:px-3 font-body">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <ItemRow key={idx} item={item} index={idx} onUpdate={updateItem} onRemove={removeItem} disabled={hayCuotaPagada} />
              ))}
            </tbody>
          </table>
        </div>
        {items.length > 0 && (
          <div className="px-4 py-3 border-t border-surface-700/50">
            <button
              onClick={addItem}
              disabled={hayCuotaPagada}
              className="flex items-center gap-2 text-brand-400 hover:text-brand-300 text-sm font-body transition-colors
                         disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-brand-400">
              <Plus size={15} />
              Agregar ítem
            </button>
          </div>
        )}
        {items.length === 0 && (
          <div className="text-center py-10 text-surface-500 font-body text-sm">
            Sin ítems. Hacé clic en "Agregar ítem" para empezar.
          </div>
        )}
      </Card>

      {/* Total + guardar */}
      <Card className="p-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="text-sm font-body">
            <div className="border-t border-surface-700 pt-2 flex justify-between gap-16">
              <span className="text-white font-semibold">Total del pedido:</span>
              <span className="text-brand-400 font-mono font-bold text-lg">{fmt(total)}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/30
                              rounded-xl px-3 py-2 max-w-xs text-right">
                <AlertCircle size={14} className="flex-shrink-0" />{error}
              </div>
            )}
            <Button size="lg" icon={esEdicion ? Pencil : ShoppingCart} onClick={guardar} disabled={saving}>
              {saving ? 'Guardando...' : (esEdicion ? 'Guardar cambios' : 'Guardar Pedido')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ─── Lista de pedidos ───────────────────────────────────────────────────────

const PAGE_SIZE = 20

export default function PedidosCompra() {
  const [cuotasResumen, setCuotasResumen] = useState({}) // { [idPedido]: { cuotasPendientes, montoPendiente, ... } }
  const [vista,        setVista]        = useState('lista') // 'lista' | 'nuevo' | 'detalle' | 'editar'
  const [selected,     setSelected]     = useState(null)
  const [filterEst,    setFilterEst]    = useState('all')
  const [filterLog,    setFilterLog]    = useState('all')
  const [filterProv,   setFilterProv]   = useState('')
  const [filterDesde,  setFilterDesde]  = useState('')
  const [filterHasta,  setFilterHasta]  = useState('')
  const [toast,        setToast]        = useState('')

  // ── Datos + paginación ────────────────────────────────────────────────
  // estado/logística/fechas se filtran server-side (serverFilters: cambiar
  // cualquiera refetchea y resetea la página). El proveedor/ID se filtra en
  // memoria sobre lo ya traído (clientFilters: resetea la página pero NO
  // refetchea). `reload()` (alias `load`, usado tras guardar/editar un
  // pedido) nunca resetea la página.
  const {
    pageItems: paginated,
    items:     filteredPedidos,
    rawItems:  pedidos,
    page, setPage, totalPages,
    reload: load,
  } = usePaginatedList({
    fetcher: async (f) => {
      const data = await obtenerPedidos({
        estadoPago:      f.filterEst  !== 'all' ? f.filterEst  : null,
        estadoLogistico: f.filterLog  !== 'all' ? f.filterLog  : null,
        fechaDesde:      f.filterDesde || null,
        fechaHasta:      f.filterHasta || null,
        orden:           'desc',
      })
      // Resumen de cuotas para los pedidos CC fraccionada del listado
      // actual — 1 sola query batched (in()), no una por pedido.
      const idsConCuotas = data.filter(p => p.tieneCuotas).map(p => p.idPedido)
      setCuotasResumen(await obtenerResumenCuotasPorPedidos(idsConCuotas))
      return data
    },
    serverFilters: { filterEst, filterLog, filterDesde, filterHasta },
    clientFilters: { filterProv },
    clientFilter: (p, cf) => {
      if (!cf.filterProv.trim()) return true
      const term      = norm(cf.filterProv.trim())
      const isNumeric = /^\d+$/.test(cf.filterProv.trim())
      return (
        (isNumeric ? String(p.idPedido) === cf.filterProv.trim() : false) ||
        (p.nombreProveedor && norm(p.nombreProveedor).includes(term))
      )
    },
    pageSize: PAGE_SIZE,
  })

  // Deuda pendiente real: para pedidos CC fraccionada, sólo lo que falta
  // cobrar (sum de cuotas no pagadas) — no el monto total del pedido, que
  // no se mueve aunque ya se haya pagado una cuota. Para el resto de los
  // métodos, sigue siendo todo-o-nada según estadoPago (como antes).
  const totalPendiente = pedidos.reduce((acc, p) => {
    if (p.tieneCuotas) {
      const r = cuotasResumen[p.idPedido]
      return acc + (r ? r.montoPendiente : p.monto) // fallback mientras carga el resumen
    }
    return p.estadoPago === 'pendiente' ? acc + p.monto : acc
  }, 0)

  const totalPagado = pedidos.reduce((acc, p) => {
    if (p.tieneCuotas) {
      const r = cuotasResumen[p.idPedido]
      return acc + (r ? r.montoPagado : 0)
    }
    return p.estadoPago === 'pagado' ? acc + p.monto : acc
  }, 0)

  function abrirDetalle(p) { setSelected(p); setVista('detalle') }
  function volverLista()   { setSelected(null); setVista('lista'); load() }

  function handleGuardado(id) {
    const isEdit = vista === 'editar'
    setToast(isEdit ? `Pedido #${id} actualizado correctamente ✓` : `Pedido #${id} creado correctamente ✓`)
    setVista('lista')
    load()
  }

  function handleUpdated() {
    setToast('Pedido actualizado ✓')
    load()
  }

  function handleEditar() {
    setVista('editar')
  }

  if (vista === 'nuevo')
    return <NuevoPedido onGuardado={handleGuardado} onCancelar={volverLista} />

  if (vista === 'editar' && selected)
    return <NuevoPedido onGuardado={handleGuardado} onCancelar={() => setVista('detalle')} pedidoEditando={selected} />

  if (vista === 'detalle')
    return (
      <PedidoDetalle
        pedido={selected}
        onBack={volverLista}
        onUpdated={handleUpdated}
        onEditar={handleEditar}
      />
    )

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}

      <PageHeader
        title="Pedidos de Compra"
        subtitle="Órdenes a proveedores"
        actions={
          <Button icon={Plus} onClick={() => setVista('nuevo')}>Nuevo Pedido</Button>
        }
      />

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total pedidos',   value: pedidos.length,      color: 'text-white' },
          { label: 'Deuda pendiente', value: fmt(totalPendiente), color: 'text-yellow-400' },
          { label: 'Total pagado',    value: fmt(totalPagado),    color: 'text-emerald-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface-800 border border-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body">{label}</p>
            <p className={`font-display text-2xl tracking-widest mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end w-full">

          {/* Buscador */}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
            <input
              type="text" value={filterProv}
              onChange={e => setFilterProv(e.target.value)}
              placeholder="Buscar por proveedor o ID..."
              className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2 text-white
                         text-sm font-body placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all"
            />
          </div>

          {/* Dropdown: Estado Logístico */}
          <select
            value={filterLog}
            onChange={e => setFilterLog(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm font-body focus:outline-none focus:border-brand-500 cursor-pointer [color-scheme:dark]">
            <option value="all">Estado logístico</option>
            <option value="encargado">Encargado</option>
            <option value="recibido">Recibido</option>
          </select>

          {/* Dropdown: Estado Pago */}
          <select
            value={filterEst}
            onChange={e => setFilterEst(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm font-body focus:outline-none focus:border-brand-500 cursor-pointer [color-scheme:dark]">
            <option value="all">Estado de pago</option>
            <option value="pendiente">Pago pendiente</option>
            <option value="pagado">Pagado</option>
          </select>

          {/* Fecha Desde */}
          <div className="flex flex-col gap-1">
            <label className="text-surface-400 text-xs uppercase tracking-widest font-body">Desde</label>
            <input type="date" value={filterDesde} onChange={e => setFilterDesde(e.target.value)}
              className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm font-body focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
          </div>

          {/* Fecha Hasta */}
          <div className="flex flex-col gap-1">
            <label className="text-surface-400 text-xs uppercase tracking-widest font-body">Hasta</label>
            <input type="date" value={filterHasta} onChange={e => setFilterHasta(e.target.value)}
              className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm font-body focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
          </div>

          {/* Limpiar */}
          {(filterProv || filterDesde || filterHasta || filterEst !== 'all' || filterLog !== 'all') && (
            <button
              onClick={() => { setFilterProv(''); setFilterDesde(''); setFilterHasta(''); setFilterEst('all'); setFilterLog('all') }}
              className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-surface-400 text-sm font-body
                         hover:text-white hover:border-surface-500 transition-all whitespace-nowrap">
              Limpiar
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
                {['ID','Fecha pedido','Proveedor','Monto','Método pago','Estado logístico','Pago',''].map(h => (
                  <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map(p => {
                const estadoLog = p.estadoLogistico ?? 'encargado'
                const cfg       = ESTADO_CONFIG[estadoLog] ?? ESTADO_CONFIG.encargado
                return (
                  <tr key={p.idPedido} onClick={() => abrirDetalle(p)}
                    className="border-b border-surface-700/50 hover:bg-surface-700/40 cursor-pointer transition-colors">
                    <td className="py-3 px-4 text-brand-400 font-mono text-sm">#{p.idPedido}</td>
                    <td className="py-3 px-4 text-surface-300 font-mono text-xs">{fmtFecha(p.fecha)}</td>
                    <td className="py-3 px-4">
                      {p.nombreProveedor ? (
                        <p className="text-white text-sm font-body font-medium">{p.nombreProveedor}</p>
                      ) : (
                        <span className="text-surface-600 text-sm font-body">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-white font-mono font-medium">{fmt(p.monto)}</td>
                    <td className="py-3 px-4 text-surface-300 text-xs font-body">
                      {metodoPagoLabel(p)}
                    </td>
                    <td className="py-3 px-4">
                      <Badge color={cfg.color}>
                        <cfg.icon size={11} className="inline mr-1" />{cfg.label}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      {p.tieneCuotas ? (
                        (() => {
                          const r = cuotasResumen[p.idPedido]
                          if (!r) {
                            // Resumen todavía cargando: usar estadoPago como fallback
                            // seguro (nunca mostrar "Pagado" a ciegas mientras se resuelve).
                            return p.estadoPago === 'pagado'
                              ? <Badge color="green"><CheckCircle2 size={11} className="inline mr-1" />Pagado</Badge>
                              : <Badge color="yellow"><Clock size={11} className="inline mr-1" />Pendiente</Badge>
                          }
                          return r.cuotasPendientes > 0 ? (
                            <Badge color="blue">
                              <Layers size={11} className="inline mr-1" />
                              {r.cuotasPendientes} cuota{r.cuotasPendientes !== 1 ? 's' : ''} pendiente{r.cuotasPendientes !== 1 ? 's' : ''}
                            </Badge>
                          ) : (
                            <Badge color="green"><CheckCircle2 size={11} className="inline mr-1" />Pagado</Badge>
                          )
                        })()
                      ) : (
                        p.estadoPago === 'pendiente'
                          ? <Badge color="yellow"><Clock size={11} className="inline mr-1" />Pendiente</Badge>
                          : <Badge color="green"><CheckCircle2 size={11} className="inline mr-1" />Pagado</Badge>
                      )}
                    </td>
                    <td className="py-3 px-4 text-surface-500"><ShoppingCart size={15} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {filteredPedidos.length === 0 && (
          <div className="flex flex-col items-center py-16 gap-3 text-surface-500">
            <ShoppingCart size={32} className="opacity-30" />
            <p className="font-body text-sm">
              {pedidos.length === 0 ? 'Sin pedidos registrados.' : 'No hay pedidos que coincidan con los filtros.'}
            </p>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-surface-700">
            <p className="text-surface-400 text-xs font-body">
              {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, filteredPedidos.length)} de {filteredPedidos.length}
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
