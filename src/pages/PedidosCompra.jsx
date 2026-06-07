// src/pages/PedidosCompra.jsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { Card, PageHeader, Button, Badge, Modal, Input } from '../components/ui'
import {
  Plus, Trash2, Search, CheckCircle2, AlertCircle,
  ArrowLeft, ShoppingCart, Package, Clock, BadgeCheck,
  Pencil, Truck, RotateCcw, UserPlus, Building2, CalendarCheck
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

// Calcula la fecha de vencimiento del echeck: 30 días corridos desde la fecha de emisión
function fechaVencimientoEcheck(fechaIso) {
  const base = fechaIso ? new Date(fechaIso + 'T00:00:00') : new Date()
  base.setDate(base.getDate() + 30)
  const [y, m, d] = base.toISOString().slice(0, 10).split('-')
  return `${d}/${m}/${y}`
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

function ItemRow({ item, index, onUpdate, onRemove }) {
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
          onChange={e => onUpdate(index, 'cantidad', e.target.value.replace(/\D/g, '') || '1')}
          className={cell + ' w-full text-center'} />
      </td>

      {/* Nombre con dropdown */}
      <td className="py-2 px-2 min-w-[200px]" ref={wrapRef}>
        <input ref={inputRef} value={nombreSearch}
          onChange={e => buscarPorNombre(e.target.value)}
          placeholder="Nombre del producto..."
          className={cell + ' w-full'} />
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
          className={cell + ' w-full text-center'} />
      </td>

      {/* Medida */}
      <td className="py-2 px-2 w-32">
        {medidas.length > 0 ? (
          <select value={item.medida || ''}
            onChange={e => onUpdate(index, 'medida', e.target.value)}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-2 py-1.5
                       text-white text-sm font-body focus:outline-none focus:border-brand-500 cursor-pointer">
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
          className={cell + ' w-full'}
        />
      </td>

      {/* Subtotal */}
      <td className="py-2 px-3 text-right w-36">
        <span className="text-surface-200 text-sm font-mono">{fmt(subtotal)}</span>
      </td>

      {/* Borrar */}
      <td className="py-2 px-2 w-10">
        <button onClick={() => onRemove(index)}
          className="text-surface-500 hover:text-red-400 transition-colors p-1 rounded">
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

  const reload = useCallback(async () => {
    // Pedido actualizado
    const p = await obtenerPedidoPorId(pedidoInit.idPedido)
    if (p) setPedido(p)

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
            <p className="text-white text-sm font-body capitalize">
              {pedido.metodoPago === 'echeck' ? 'E-Check (CC30)' : (pedido.metodoPago || '—')}
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
        {(estadoLog === 'encargado' || esPendientePago) && (
          <div className="mt-6 pt-5 border-t border-surface-700">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-3">Cambiar estado</p>
            <div className="flex flex-wrap gap-2">
              {estadoLog === 'encargado' && (
                <Button size="sm" icon={Truck} onClick={() => setConfirmEstado('recibido')}
                  className="bg-brand-600 hover:bg-brand-500 border-brand-500 text-white">
                  Marcar Recibido
                </Button>
              )}
              {esPendientePago && (
                <Button size="sm" icon={BadgeCheck} onClick={() => setConfirmPagar(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 border-emerald-500 text-white">
                  Marcar Pagado
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Tabla de ítems */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-700 flex items-center justify-between">
          <h3 className="font-body font-semibold text-white text-sm">Productos</h3>
          <span className="text-surface-400 text-xs font-mono">{detalles.length} ítem{detalles.length !== 1 ? 's' : ''}</span>
        </div>
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
          <div className="space-y-2 text-sm font-body">
            <div className="border-t border-surface-700 pt-2 flex justify-between gap-16">
              <span className="text-white font-semibold">Total del pedido:</span>
              <span className="text-brand-400 font-mono font-bold text-lg">{fmt(pedido.monto)}</span>
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
    </div>
  )
}

// ─── Formulario nuevo / editar pedido ──────────────────────────────────────

const ITEM_EMPTY = () => ({ idProducto: '', nombreProducto: '', cantidad: 1, precioUnitario: '', medida: null })

const METODOS_PAGO = [
  { value: 'efectivo',      label: 'Efectivo' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'echeck',        label: 'E-Check (CC30)' },
]

function NuevoPedido({ onGuardado, onCancelar, pedidoEditando }) {
  const esEdicion = !!pedidoEditando

  const [items,      setItems]      = useState([ITEM_EMPTY()])
  const [metodoPago, setMetodoPago] = useState(esEdicion ? (pedidoEditando.metodoPago || 'efectivo') : 'efectivo')
  const [proveedor,  setProveedor]  = useState(null)
  const [toast,      setToast]      = useState('')
  const [error,      setError]      = useState('')
  const [saving,     setSaving]     = useState(false)
  const [loadingInit, setLoadingInit] = useState(esEdicion)

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
      } finally {
        setLoadingInit(false)
      }
    }
    init()
  }, [esEdicion])

  const total = items.reduce((acc, it) =>
    acc + (parseInt(it.cantidad) || 0) * (parseFloat(String(it.precioUnitario).replace(',', '.')) || 0), 0)

  const dia30 = fechaVencimientoEcheck()

  function updateItem(idx, key, val) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [key]: val } : it))
  }
  function addItem()       { setItems(prev => [...prev, ITEM_EMPTY()]) }
  function removeItem(idx) { setItems(prev => prev.filter((_, i) => i !== idx)) }

  async function guardar() {
    setError('')
    if (!proveedor) { setError('Seleccioná un proveedor antes de guardar el pedido.'); return }
    const validItems = items.filter(it => it.idProducto && parseInt(it.cantidad) > 0)
    if (!validItems.length) { setError('Agregá al menos un producto con ID válido.'); return }

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

    setSaving(true)
    try {
      const detallesPayload = validItems.map(it => ({
        idProducto:     parseInt(it.idProducto),
        nombreProducto: it.nombreProducto || null,
        medida:         it.medida || null,
        cantidad:       parseInt(it.cantidad),
        precioUnitario: parseFloat(String(it.precioUnitario).replace(',', '.')) || 0,
        subtotal:       (parseInt(it.cantidad)) * (parseFloat(String(it.precioUnitario).replace(',', '.')) || 0),
      }))

      if (esEdicion) {
        // Actualizar — preserva estado logístico y de pago actuales
        const pedidoPayload = {
          fecha:           pedidoEditando.fecha,
          monto:           total,
          estadoPago:      pedidoEditando.estadoPago,
          estadoLogistico: pedidoEditando.estadoLogistico,
          fechaRecepcion:  pedidoEditando.fechaRecepcion ?? null,
          fechaPago:       pedidoEditando.fechaPago      ?? null,
          metodoPago:      metodoPago,
          idProveedor:     proveedor?.idProveedor ?? null,
          nombreProveedor: proveedor?.nombreComercial || proveedor?.nombreFiscal || null,
        }
        await actualizarPedido(pedidoEditando.idPedido, pedidoPayload, detallesPayload)
        onGuardado(pedidoEditando.idPedido)
      } else {
        const pedidoPayload = {
          fecha:           today(),
          monto:           total,
          estadoPago:      'pendiente',
          estadoLogistico: 'encargado',
          metodoPago:      metodoPago,
          idProveedor:     proveedor?.idProveedor ?? null,
          nombreProveedor: proveedor?.nombreComercial || proveedor?.nombreFiscal || null,
        }
        const creado = await crearPedido(pedidoPayload, detallesPayload)
        onGuardado(creado.idPedido)
      }
    } catch (err) {
      setError(err.message || 'Ocurrió un error al guardar el pedido.')
    } finally {
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
        </div>
      </Card>

      {/* Tabla de productos */}
      <Card className="overflow-visible">
        <div className="px-6 py-4 border-b border-surface-700 flex items-center justify-between">
          <h2 className="font-body font-semibold text-white text-sm">Productos</h2>
          <Button size="sm" icon={Plus} onClick={addItem}>Agregar ítem</Button>
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
                <ItemRow key={idx} item={item} index={idx} onUpdate={updateItem} onRemove={removeItem} />
              ))}
            </tbody>
          </table>
        </div>
        {items.length > 0 && (
          <div className="px-4 py-3 border-t border-surface-700/50">
            <button
              onClick={addItem}
              className="flex items-center gap-2 text-brand-400 hover:text-brand-300 text-sm font-body transition-colors">
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
  const [pedidos,      setPedidos]      = useState([])
  const [vista,        setVista]        = useState('lista') // 'lista' | 'nuevo' | 'detalle' | 'editar'
  const [selected,     setSelected]     = useState(null)
  const [filterEst,    setFilterEst]    = useState('all')
  const [filterLog,    setFilterLog]    = useState('all')
  const [filterProv,   setFilterProv]   = useState('')
  const [filterDesde,  setFilterDesde]  = useState('')
  const [filterHasta,  setFilterHasta]  = useState('')
  const [page,         setPage]         = useState(1)
  const [toast,        setToast]        = useState('')

  const load = useCallback(async () => {
    const data = await obtenerPedidos({
      estadoPago:      filterEst  !== 'all' ? filterEst  : null,
      estadoLogistico: filterLog  !== 'all' ? filterLog  : null,
      fechaDesde:      filterDesde || null,
      fechaHasta:      filterHasta || null,
      orden:           'desc',
    })
    setPedidos(data)
    setPage(1)
  }, [filterEst, filterLog, filterDesde, filterHasta])

  useEffect(() => { load() }, [load])

  const totalPendiente = pedidos.filter(p => p.estadoPago === 'pendiente').reduce((a, p) => a + p.monto, 0)
  const totalPagado    = pedidos.filter(p => p.estadoPago === 'pagado').reduce((a, p) => a + p.monto, 0)

  // Filtro de proveedor/ID se hace en cliente (no pasa al service) igual que antes
  const filteredPedidos = filterProv.trim()
    ? pedidos.filter(p => {
        const term      = norm(filterProv.trim())
        const isNumeric = /^\d+$/.test(filterProv.trim())
        return (
          (isNumeric ? String(p.idPedido) === filterProv.trim() : false) ||
          (p.nombreProveedor && norm(p.nombreProveedor).includes(term))
        )
      })
    : pedidos

  const paginated  = filteredPedidos.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(filteredPedidos.length / PAGE_SIZE))

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
              onChange={e => { setFilterProv(e.target.value); setPage(1) }}
              placeholder="Buscar por proveedor o ID..."
              className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2 text-white
                         text-sm font-body placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all"
            />
          </div>

          {/* Dropdown: Estado Logístico */}
          <select
            value={filterLog}
            onChange={e => { setFilterLog(e.target.value); setPage(1) }}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm font-body focus:outline-none focus:border-brand-500 cursor-pointer [color-scheme:dark]">
            <option value="all">Estado logístico</option>
            <option value="encargado">Encargado</option>
            <option value="recibido">Recibido</option>
          </select>

          {/* Dropdown: Estado Pago */}
          <select
            value={filterEst}
            onChange={e => { setFilterEst(e.target.value); setPage(1) }}
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
              onClick={() => { setFilterProv(''); setFilterDesde(''); setFilterHasta(''); setFilterEst('all'); setFilterLog('all'); setPage(1) }}
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
                    <td className="py-3 px-4 text-surface-300 text-xs font-body capitalize">
                      {p.metodoPago === 'echeck' ? 'E-Check' : (p.metodoPago || '—')}
                    </td>
                    <td className="py-3 px-4">
                      <Badge color={cfg.color}>
                        <cfg.icon size={11} className="inline mr-1" />{cfg.label}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      {p.estadoPago === 'pendiente'
                        ? <Badge color="yellow"><Clock size={11} className="inline mr-1" />Pendiente</Badge>
                        : <Badge color="green"><CheckCircle2 size={11} className="inline mr-1" />Pagado</Badge>
                      }
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
