// src/pages/PedidosCompra.jsx
import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import { usePaginatedList } from '../hooks/usePaginatedList'
import { useScrollAnchor } from '../hooks/useScrollToTopOnChange'
import { supabase } from '../lib/supabase'
import { Card, PageHeader, Button, Badge, Modal, Input } from '../components/ui'
import {
  Plus, Trash2, Search, CheckCircle2, AlertCircle,
  ArrowLeft, ShoppingCart, Package, Clock, BadgeCheck,
  Pencil, Truck, RotateCcw, UserPlus, Building2, CalendarCheck,
  Layers, Landmark, Lock, Loader2, WifiOff,
} from 'lucide-react'
import {
  obtenerPedidos,
  obtenerPedidoPorId,
  obtenerDetallesDePedido,
  marcarPedidoPagado,
  recibirPedido,
} from '../services/pedidosService'
import {
  validarPlanCuotas,
  obtenerCuotasDePedido,
  obtenerResumenCuotasPorPedidos,
  marcarCuotaPagada,
  validarEdicionPlanCuotas,
} from '../services/pedidosCuotasService'
// Guardado transaccional en lote (1 RPC) + carga con joins (1 query).
import {
  guardarPedido,
  obtenerPedidoParaEdicion,
  crearGestorIdempotencia,
} from '../services/pedidosGuardadoService'
import PlanCuotasCC, { CUOTA_EMPTY } from '../components/pedidos/PlanCuotasCC'
import { generarPDFPedidoCompra, MENSAJE_SIN_SELECCION } from '../lib/pdfPedidoCompra'
import ExportarHojaToolbar from '../components/pedidos/ExportarHojaToolbar'
import { useSeleccionItems } from '../hooks/useSeleccionItems'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import FiltrosPedidos, { FILTROS_INICIALES } from '../components/pedidos/FiltrosPedidos'
import PedidosListado from '../components/pedidos/PedidosListado'
import PaginadorTabla from '../components/ui/PaginadorTabla'
import { CuotasPlanDetalle, ItemsPedidoDetalle } from '../components/pedidos/PedidoDetalleListas'
import { TOUCH, ESTADO_CONFIG, cap, fmt, fmtFecha, metodoPagoLabel } from '../components/pedidos/pedidosPresentacion'

// ─── Helpers ───────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10) }

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

// ─── Toast ─────────────────────────────────────────────────────────────────

function Toast({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [onDone])
  return createPortal(
    <div className="fixed top-4 left-4 right-4 sm:left-auto sm:right-5 sm:top-5 z-[9999] pointer-events-none pt-[env(safe-area-inset-top)]">
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
      console.error('[NuevoProveedorModal] Error creando proveedor', err)
      setErrors({ general: 'No se pudo crear el proveedor. Intentá nuevamente.' })
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Teléfono" value={form.telefono} type="tel" inputMode="numeric" pattern="[0-9+\-() ]*"
            onChange={e => setField('telefono', e.target.value)} placeholder="3510000000"  />
          <Input label="Email" value={form.email}
            onChange={e => set('email', e.target.value)} placeholder="email@ejemplo.com" />
        </div>
        {errors.general && (
          <p className="text-red-400 text-sm min-[1025px]:text-xs font-body">{errors.general}</p>
        )}
        <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
          <Button variant="secondary" className={`flex-1 ${TOUCH}`} onClick={onClose}>Cancelar</Button>
          <Button className={`flex-1 ${TOUCH}`} onClick={guardar} disabled={saving}>
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

    const termino = text.replace(/[%,()*\\]/g, ' ').trim()
    const { data } = await supabase
      .from('proveedor')
      .select('*')
      .or(`nombre_fiscal.ilike.%${termino}%,nombre_comercial.ilike.%${termino}%`)
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
      <label className="block text-surface-300 text-sm min-[1025px]:text-xs tracking-widest uppercase font-body mb-1">
        Proveedor
      </label>

      {value ? (
        <div className="flex items-center gap-3 bg-surface-700 border border-brand-500/40 rounded-xl px-4 py-2.5">
          <Building2 size={15} className="text-brand-400 flex-shrink-0" />
          <div className="flex-1 min-w-0 break-words">
            <p className="text-white text-sm font-body">{value.nombreComercial || value.nombreFiscal}</p>
            <p className="text-surface-400 text-sm min-[1025px]:text-xs font-mono">
              #{value.idProveedor} · {value.nombreFiscal}
              {value.identificacionTributaria ? ` · CUIT ${value.identificacionTributaria}` : ''}
            </p>
          </div>
          <button type="button" onClick={limpiar} aria-label="Quitar proveedor"
            className="flex items-center justify-center min-h-[44px] min-w-[44px] -mr-2 text-surface-400 hover:text-red-400 transition-colors text-2xl leading-none">×</button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 pointer-events-none" />
              <input value={search} onChange={e => buscar(e.target.value)}
                onFocus={() => search && setShowDrop(true)}
                placeholder="Buscar proveedor..."
                className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2.5 text-white text-base min-[1025px]:text-sm font-body placeholder-surface-500
                           focus:outline-none focus:border-brand-500 transition-all min-h-[44px] min-[1025px]:min-h-0" />
            </div>
            <Button size="sm" variant="secondary" icon={UserPlus} onClick={abrirNuevo} className={TOUCH}>Nuevo</Button>
          </div>

          {showDrop && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface-800 border border-surface-600
                            rounded-xl shadow-2xl z-50 overflow-y-auto max-h-64">
              {results.length === 0 ? (
                <div className="px-4 py-3">
                  <p className="text-surface-300 text-sm min-[1025px]:text-xs font-body mb-2">Sin resultados para "{search}"</p>
                  <button onClick={abrirNuevo}
                    className="text-brand-400 text-sm min-[1025px]:text-xs font-body hover:underline flex items-center gap-1 min-h-[44px]">
                    <UserPlus size={12} /> Crear proveedor "{search}"
                  </button>
                </div>
              ) : (
                results.map(p => (
                  <button key={p.idProveedor} onClick={() => seleccionar(p)}
                    className="w-full text-left px-4 py-2.5 min-h-[44px] hover:bg-surface-700 transition-colors border-b border-surface-700/60 last:border-0">
                    <p className="text-white text-sm font-body">{p.nombreComercial || p.nombreFiscal}</p>
                    <p className="text-surface-400 text-sm min-[1025px]:text-xs font-mono">
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

// Grilla de la fila de ítems en escritorio (cabecera y filas comparten columnas).
// En mobile/tablet cada ítem es una tarjeta con los campos apilados en 1 columna.
const ITEM_GRID =
  'grid grid-cols-[2rem_5rem_minmax(12rem,1fr)_7rem_8rem_9rem_9rem_2.5rem] items-center gap-x-2 px-1 py-2'


function ItemRow({ item, index, onUpdate, onRemove, disabled = false, isDesktop = true }) {
  const uid = useId()
  const [nombreSearch,   setNombreSearch]   = useState(item.nombreProducto || '')
  const [nombreResults,  setNombreResults]  = useState([])
  const [showDrop,       setShowDrop]       = useState(false)
  const [dropPos,        setDropPos]        = useState({ top: 0, left: 0, width: 0, above: false })
  const [medidas,        setMedidas]        = useState([])
  // En edición el padre ya trajo las medidas con el JOIN de carga del pedido:
  // se usan tal cual y NO se consulta nada por ítem. Se indexan por producto para
  // que, si el usuario cambia el producto de la fila, se vuelva a consultar.
  const precargadas = useRef(
    Array.isArray(item.medidasPrecargadas)
      ? { idProducto: String(item.idProducto), medidas: item.medidasPrecargadas }
      : null
  )
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
      // Se ajusta al viewport (pantallas de 320 px) y, si el teclado virtual deja poco
      // espacio debajo, el listado se abre hacia arriba.
      const margen = 8
      const vw     = document.documentElement.clientWidth
      const vh     = window.visualViewport?.height ?? window.innerHeight
      const width  = Math.min(Math.max(rect.width, 280), vw - margen * 2)
      const left   = Math.min(Math.max(rect.left, margen), vw - width - margen)
      const above  = vh - rect.bottom < 220 && rect.top > vh - rect.bottom
      setDropPos({
        top: (above ? rect.top - 4 : rect.bottom + 4) + window.scrollY,
        left: left + window.scrollX, width, above,
      })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
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

    const pre = precargadas.current
    if (pre && pre.idProducto === String(item.idProducto)) { setMedidas(pre.medidas); return }

    let cancelado = false
    async function fetchMedidas() {
      // UNA consulta con relación (antes: 2 consultas secuenciales por ítem).
      const { data: prod } = await supabase
        .from('producto')
        .select('tiene_medidas, producto_medida ( medida )')
        .eq('id_producto', parseInt(item.idProducto))
        .single()
      if (cancelado) return
      if (prod?.tiene_medidas) {
        setMedidas((prod.producto_medida ?? []).map(r => r.medida).sort())
      } else {
        setMedidas([])
        onUpdate(index, 'medida', null)
      }
    }
    fetchMedidas()
    return () => { cancelado = true }
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

  // text-base (16 px) + 44 px de alto en táctil: legible y sin zoom automático de iOS.
  const cell = `bg-surface-700 border border-surface-600 rounded-lg px-2 py-1.5 text-white text-base min-[1025px]:text-sm
                font-mono focus:outline-none focus:border-brand-500 transition-all min-h-[44px] min-[1025px]:min-h-0
                [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none
                disabled:opacity-40 disabled:cursor-not-allowed`

  const subtotal = (parseInt(item.cantidad) || 0) * (parseFloat(String(item.precioUnitario).replace(',', '.')) || 0)

  // Etiqueta visible en tarjeta; sólo para lectores de pantalla en la grilla (la cabecera ya rotula).
  const lab = (suf, texto) => (
    <label htmlFor={`${uid}-${suf}`}
      className={isDesktop ? 'sr-only' : 'block text-surface-300 text-sm font-body mb-1'}>{texto}</label>
  )

  const cCantidad = (
    <div role={isDesktop ? 'cell' : undefined}>
      {lab('cant', 'Cantidad')}
      <input id={`${uid}-cant`} type="text" inputMode="numeric" value={item.cantidad}
        onChange={e => onUpdate(index, 'cantidad', e.target.value.replace(/\D/g, ''))}
        onBlur={e => { if (!e.target.value) onUpdate(index, 'cantidad', '1') }}
        disabled={disabled}
        className={cell + (isDesktop ? ' w-full text-center' : ' w-full text-left')} />
    </div>
  )

  const cNombre = (
    <div role={isDesktop ? 'cell' : undefined} ref={wrapRef} className="min-w-0">
      {lab('nombre', 'Nombre del producto')}
      <input id={`${uid}-nombre`} ref={inputRef} value={nombreSearch}
        onChange={e => buscarPorNombre(e.target.value)}
        placeholder="Nombre del producto..."
        disabled={disabled} autoComplete="off"
        className={cell + ' w-full font-body'} />
      {showDrop && createPortal(
        <div
          ref={dropRef}
          data-producto-drop
          style={{
            position: 'absolute', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999,
            transform: dropPos.above ? 'translateY(-100%)' : undefined,
          }}
          className="bg-surface-800 border border-surface-600 rounded-xl shadow-2xl max-h-[min(260px,40dvh)] overflow-y-auto"
        >
          {nombreResults.length === 0 ? (
            <p className="px-4 py-3 text-surface-300 text-sm font-body">Sin resultados para "{nombreSearch}"</p>
          ) : (
            nombreResults.map(p => (
              <button key={p.idProducto} type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => seleccionarProducto(p)}
                className="w-full text-left px-3 py-2.5 min-h-[44px] hover:bg-surface-700 transition-colors border-b border-surface-700/60 last:border-0">
                <p className="text-white text-sm font-body leading-tight">{p.nombre}</p>
                <p className="text-surface-400 text-sm min-[1025px]:text-xs font-mono mt-0.5">
                  #{p.idProducto}{p.tieneMedidas ? ' · Con medidas' : ''}
                  {p.precioProveedor > 0 ? ` · Último precio: ${fmt(p.precioProveedor)}` : ''}
                </p>
              </button>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  )

  const cId = (
    <div role={isDesktop ? 'cell' : undefined}>
      {lab('id', 'ID de producto')}
      <input id={`${uid}-id`} type="text" inputMode="numeric" value={item.idProducto || ''}
        onChange={e => handleIdChange(e.target.value)}
        placeholder="ID" disabled={disabled}
        className={cell + (isDesktop ? ' w-full text-center' : ' w-full text-left')} />
    </div>
  )

  const cMedida = (medidas.length > 0 || isDesktop) && (
    <div role={isDesktop ? 'cell' : undefined}>
      {medidas.length > 0 ? (
        <>
          {lab('medida', 'Medida')}
          <select id={`${uid}-medida`} value={item.medida || ''}
            onChange={e => onUpdate(index, 'medida', e.target.value)}
            disabled={disabled}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-2 py-1.5 text-white text-base
                       min-[1025px]:text-sm font-body focus:outline-none focus:border-brand-500 cursor-pointer
                       min-h-[44px] min-[1025px]:min-h-0 disabled:opacity-40 disabled:cursor-not-allowed">
            <option value="">— medida —</option>
            {medidas.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </>
      ) : (
        <span className="text-surface-500 text-sm min-[1025px]:text-xs px-2">—</span>
      )}
    </div>
  )

  const cPrecio = (
    <div role={isDesktop ? 'cell' : undefined}>
      {lab('precio', 'Precio proveedor')}
      <input id={`${uid}-precio`} type="text" inputMode="decimal" value={item.precioUnitario}
        onChange={e => {
          const v = e.target.value.replace(',', '.')
          if (/^\d*\.?\d*$/.test(v)) onUpdate(index, 'precioUnitario', v)
        }}
        onBlur={e => {
          const parsed = parseFloat(e.target.value) || 0
          onUpdate(index, 'precioUnitario', parsed === 0 ? '' : parsed)
        }}
        placeholder="0.00" disabled={disabled}
        className={cell + ' w-full'} />
    </div>
  )

  const cBorrar = (
    <button type="button" onClick={() => onRemove(index)} disabled={disabled}
      aria-label={`Eliminar ítem ${index + 1}`}
      className="flex items-center justify-center min-h-[44px] min-w-[44px] min-[1025px]:min-h-0 min-[1025px]:min-w-0
                 text-surface-500 hover:text-red-400 transition-colors p-1 rounded
                 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-surface-500">
      <Trash2 size={isDesktop ? 15 : 18} />
    </button>
  )

  // ── Escritorio: fila de la grilla ─────────────────────────────────────────
  if (isDesktop) {
    return (
      <div role="row" className={`${ITEM_GRID} border-b border-surface-700/50`}>
        <div role="cell" className="px-2 text-surface-500 text-sm font-mono select-none">{index + 1}</div>
        {cCantidad}{cNombre}{cId}{cMedida}{cPrecio}
        <div role="cell" className="text-right px-1">
          <span className="text-surface-200 text-sm font-mono">{fmt(subtotal)}</span>
        </div>
        <div role="cell">{cBorrar}</div>
      </div>
    )
  }

  // ── Mobile / tablet: tarjeta, campos apilados en UNA columna ───────────────
  return (
    <div role="listitem" className="bg-surface-800/60 border border-surface-700 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-surface-300 text-sm font-mono">Ítem {index + 1}</span>
        {cBorrar}
      </div>
      {cNombre}{cId}{cMedida}{cCantidad}{cPrecio}
      <div className="flex items-center justify-between pt-2 border-t border-surface-700/60">
        <span className="text-surface-300 text-sm font-body">Subtotal</span>
        <span className="text-white text-base font-mono font-semibold">{fmt(subtotal)}</span>
      </div>
    </div>
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
  const [listarCantidad, setListarCantidad] = useState(false) // 'Listar cantidad' desactivada por defecto
  const sel = useSeleccionItems(detalles)
  const { isMobile, isDesktop } = useBreakpoint()

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

  // Limpia el aviso de "sin selección" apenas el usuario marca algo.
  useEffect(() => { if (sel.cantidad > 0) setPdfError('') }, [sel.cantidad])

  async function descargarHojaRecepcion() {
    if (generandoPDF) return
    // Bloqueo en UI (criterio: sin selección no se exporta). El generador valida también.
    if (sel.cantidad === 0) {
      setPdfError(MENSAJE_SIN_SELECCION)
      return
    }
    setPdfError('')
    setGenerandoPDF(true)
    try {
      // La configuración se lee en el momento del clic: el PDF refleja exactamente lo definido.
      await generarPDFPedidoCompra(pedido.idPedido, {
        idsDetalle: sel.idsSeleccionados,
        listarCantidad,
      })
    } catch (err) {
      if (err?.code === 'SIN_SELECCION') {
        setPdfError(MENSAJE_SIN_SELECCION)
      } else {
        console.error('[PedidoDetalle] Error generando PDF', { idPedido: pedido.idPedido, err })
        setPdfError('No se pudo generar el PDF. Intentá nuevamente.')
      }
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
    <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-slide-up">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <button onClick={onBack}
            className={`flex items-center gap-2 -ml-2 px-2 ${TOUCH} text-surface-300 hover:text-white text-sm font-body transition-colors`}>
            <ArrowLeft size={16} />Volver a pedidos
          </button>
          <span className="text-surface-600" aria-hidden="true">/</span>
          <span className="text-surface-300 text-sm font-body">
            Pedido <span className="text-brand-400 font-mono">#{pedido.idPedido}</span>
          </span>
        </div>
        {estadoLog === 'encargado' && (
          <Button size="sm" variant="secondary" icon={Pencil} onClick={onEditar} className={TOUCH}>
            Editar
          </Button>
        )}
      </div>

      {/* Cabecera */}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-surface-400 text-sm min-[1025px]:text-xs tracking-widest uppercase font-body mb-1">Pedido de Compra</p>
            <h2 className="font-display text-3xl sm:text-4xl text-white tracking-widest">#{pedido.idPedido}</h2>
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

        <div className="grid grid-cols-1 md:grid-cols-2 min-[1025px]:grid-cols-4 gap-3 sm:gap-4 mt-6">
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-sm min-[1025px]:text-xs uppercase tracking-widest font-body mb-1">Fecha pedido</p>
            <p className="text-white text-sm font-mono">{fmtFecha(pedido.fecha)}</p>
          </div>
          {pedido.fechaRecepcion && (
            <div className="bg-surface-700 rounded-xl p-4">
              <p className="text-surface-400 text-sm min-[1025px]:text-xs uppercase tracking-widest font-body mb-1">Fecha recepción</p>
              <p className="text-white text-sm font-mono">{fmtFecha(pedido.fechaRecepcion)}</p>
            </div>
          )}
          {pedido.estadoPago === 'pagado' && (
            <div className="bg-surface-700 rounded-xl p-4">
              <p className="text-surface-400 text-sm min-[1025px]:text-xs uppercase tracking-widest font-body mb-1">Fecha de pago</p>
              <p className="text-emerald-400 text-sm font-mono">{fmtFecha(pedido.fechaPago)}</p>
            </div>
          )}
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-sm min-[1025px]:text-xs uppercase tracking-widest font-body mb-1">Método de pago</p>
            <p className="text-white text-sm font-body">
              {metodoPagoLabel(pedido)}
            </p>
          </div>
          {proveedor && (
            <div className="bg-surface-700 rounded-xl p-4">
              <p className="text-surface-400 text-sm min-[1025px]:text-xs uppercase tracking-widest font-body mb-1">Proveedor</p>
              <p className="text-white text-sm font-body">{proveedor.nombreComercial || proveedor.nombreFiscal}</p>
            </div>
          )}
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-sm min-[1025px]:text-xs uppercase tracking-widest font-body mb-1">Total</p>
            <p className="text-brand-400 font-mono font-bold text-lg">{fmt(pedido.monto)}</p>
          </div>
        </div>
        {/* Acciones de estado */}
        {(estadoLog === 'encargado' || (esPendientePago && !pedido.tieneCuotas)) && (
          <div className="mt-6 pt-5 border-t border-surface-700">
            <p className="text-surface-400 text-sm min-[1025px]:text-xs uppercase tracking-widest font-body mb-3">Cambiar estado</p>
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
              {estadoLog === 'encargado' && (
                <Button size="sm" icon={Truck} onClick={() => setConfirmEstado('recibido')}
                  className={`${TOUCH} w-full sm:w-auto bg-brand-600 hover:bg-brand-500 border-brand-500 text-white`}>
                  Marcar Recibido
                </Button>
              )}
              {esPendientePago && !pedido.tieneCuotas && (
                <Button size="sm" icon={BadgeCheck} onClick={() => setConfirmPagar(true)}
                  className={`${TOUCH} w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 border-emerald-500 text-white`}>
                  Marcar Pagado
                </Button>
              )}
            </div>
          </div>
        )}
        {/* CC con cuotas: el pago único no aplica — se paga cuota por cuota más abajo */}
        {esPendientePago && pedido.tieneCuotas && (
          <div className="mt-6 pt-5 border-t border-surface-700">
            <p className="text-surface-500 text-sm min-[1025px]:text-xs font-body flex items-center gap-2">
              <Layers size={13} className="text-brand-400 flex-shrink-0" />
              Este pedido se paga por cuotas: se debe confirmar cada pago individualmente en el plan de cuotas de abajo.
            </p>
          </div>
        )}
      </Card>

      {/* Plan de cuotas (CC fraccionada) */}
      {pedido.tieneCuotas && (
        <Card className="overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-surface-700 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-body font-semibold text-white text-sm">
              <Layers size={14} className="text-brand-400" /> Plan de cuotas
            </h3>
            <span className="text-surface-400 text-sm min-[1025px]:text-xs font-mono">
              {cuotas.filter(c => c.estado === 'pagada').length} / {cuotas.length} pagadas
            </span>
          </div>
          <CuotasPlanDetalle cuotas={cuotas} onPagar={setConfirmCuota} mobile={isMobile} />
        </Card>
      )}

      {/* Tabla de ítems */}
      <Card className="overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-surface-700 flex items-center gap-3">
          <h3 className="font-body font-semibold text-white text-sm">Productos</h3>
          <span className="text-surface-400 text-sm min-[1025px]:text-xs font-mono">{detalles.length} ítem{detalles.length !== 1 ? 's' : ''}</span>
        </div>
        {detalles.length > 0 && (
          <ExportarHojaToolbar
            total={sel.total}
            seleccionados={sel.cantidad}
            todos={sel.todos}
            listarCantidad={listarCantidad}
            generando={generandoPDF}
            error={pdfError}
            onToggleTodos={sel.toggleTodos}
            onCambiarCantidad={setListarCantidad}
            onExportar={descargarHojaRecepcion}
          />
        )}
        <ItemsPedidoDetalle detalles={detalles} sel={sel} mobile={isMobile} desktop={isDesktop} />
        {detalles.length === 0 && (
          <p className="text-center py-10 text-surface-500 text-sm font-body">Sin ítems registrados.</p>
        )}
      </Card>

      {/* Total */}
      <Card className="p-4 sm:p-6">
        <div className="flex justify-end">
          <div className="space-y-2 text-sm font-body text-right w-full sm:w-auto">
            {pedido.tieneCuotas && (
              <div className="flex justify-between gap-6 sm:gap-16 text-surface-400">
                <span>Pagado hasta ahora:</span>
                <span className="font-mono text-emerald-400">
                  {fmt(cuotas.reduce((a, c) => a + (c.estado === 'pagada' ? c.monto : 0), 0))}
                </span>
              </div>
            )}
            <div className="border-t border-surface-700 pt-2 flex justify-between gap-6 sm:gap-16">
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
        <p className="text-surface-500 text-sm min-[1025px]:text-xs font-body mb-6">
          Esta acción registrará el egreso de <span className="text-brand-400 font-mono">{fmt(pedido.monto)}</span>.
        </p>
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <Button variant="secondary" className={`flex-1 ${TOUCH}`} onClick={() => setConfirmPagar(false)}>Cancelar</Button>
          <Button className={`flex-1 ${TOUCH}`} icon={BadgeCheck} onClick={marcarPagado} disabled={loading}>
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
            <p className="text-emerald-400 text-sm min-[1025px]:text-xs font-body mb-6 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3 py-2">
              El stock de todos los productos de este pedido se sumará al Inventario.
            </p>
          </>
        ) : (
          <>
            <p className="text-surface-300 text-sm font-body mb-2">
              ¿Marcar el pedido <span className="text-white font-mono">#{pedido.idPedido}</span> para revisión?
            </p>
            <p className="text-yellow-400 text-sm min-[1025px]:text-xs font-body mb-6 bg-yellow-500/10 border border-yellow-500/25 rounded-xl px-3 py-2">
              El stock NO se actualizará hasta que el pedido sea marcado como Recibido.
            </p>
          </>
        )}
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <Button variant="secondary" className={`flex-1 ${TOUCH}`} onClick={() => setConfirmEstado(null)}>Cancelar</Button>
          <Button className={`flex-1 ${TOUCH}`}
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
              <p className="text-surface-500 text-sm min-[1025px]:text-xs font-body mb-6">
                Se registrará el pago de <span className="text-brand-400 font-mono">{fmt(c.monto)}</span>.
                Si es la última cuota pendiente, el pedido completo pasará a estado "Pagado".
              </p>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <Button variant="secondary" className={`flex-1 ${TOUCH}`} onClick={() => setConfirmCuota(null)}>Cancelar</Button>
                <Button className={`flex-1 ${TOUCH}`} icon={BadgeCheck} onClick={() => pagarCuota(c.idCuota)} disabled={loadingCuota}>
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

// Ícono giratorio para el botón de guardar (Button recibe el ícono como componente).
function IconoGuardando({ className = '', ...rest }) {
  return <Loader2 {...rest} className={`${className} animate-spin`} aria-hidden="true" />
}

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
  const { isDesktop } = useBreakpoint()

  const [items,      setItems]      = useState([ITEM_EMPTY()])
  const [metodoPago, setMetodoPago] = useState(esEdicion ? (pedidoEditando.metodoPago || 'efectivo') : 'efectivo')
  const [proveedor,  setProveedor]  = useState(null)
  const [toast,      setToast]      = useState('')
  const [error,      setError]      = useState('')
  const [saving,     setSaving]     = useState(false)
  const savingRef                   = useRef(false)   // guardia síncrona contra doble-click
  const [guardandoLento, setGuardandoLento] = useState(false) // feedback si el guardado tarda > 1 s
  // Clave de idempotencia ligada al contenido: reintento = misma clave (no duplica);
  // contenido corregido = clave nueva.
  const idemRef = useRef(crearGestorIdempotencia())
  const [loadingInit, setLoadingInit] = useState(esEdicion)
  const [errorCarga,   setErrorCarga]   = useState('')
  const [reintentoCarga, setReintentoCarga] = useState(0)

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
  // cuotasPagadas / hayCuotaPagada más abajo y el RPC guardarPedido() en
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

  // En edición: UNA sola consulta con relaciones trae pedido + proveedor + ítems
  // (con las medidas disponibles de cada producto) + plan de cuotas.
  // Antes: 3 consultas fijas + 2 por ítem (medidas) → crecía con N.
  useEffect(() => {
    if (!esEdicion) return
    let cancelado = false
    async function init() {
      try {
        const { detalles, proveedor: prov, cuotas: todas } =
          await obtenerPedidoParaEdicion(pedidoEditando.idPedido)
        if (cancelado) return

        if (detalles.length > 0) {
          setItems(detalles.map(d => ({
            idDetallePedido:    d.idDetallePedido,          // habilita el diff en lote
            idProducto:         d.idProducto,
            nombreProducto:     d.nombreProducto || '',
            cantidad:           d.cantidad,
            precioUnitario:     d.precioUnitario,
            medida:             d.medida || null,
            medidasPrecargadas: d.medidasDisponibles,       // evita fetch por ítem en ItemRow
          })))
        }
        if (prov) setProveedor(prov)

        // Plan de cuotas: pagadas (bloqueadas, sólo lectura) vs pendientes (borrador editable).
        if (pedidoEditando.tieneCuotas) {
          setCuotasPagadas(todas.filter(c => c.estado === 'pagada'))
          const pendientes = todas.filter(c => c.estado !== 'pagada')
          setCuotas(pendientes.length
            ? pendientes.map(c => ({ porcentaje: String(c.porcentaje), diasVencimiento: String(c.diasVencimiento) }))
            : [CUOTA_EMPTY()])
        }
        setLoadingInit(false)
      } catch (err) {
        // IMPORTANTE: no mostrar el formulario vacío si la carga falló — guardarlo
        // con la tabla en blanco eliminaría los ítems existentes.
        if (!cancelado) {
          setErrorCarga(err.message || 'No se pudo cargar el pedido.')
          setLoadingInit(false)
        }
      }
    }
    init()
    return () => { cancelado = true }
  }, [esEdicion, reintentoCarga])

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
    // Si tarda más de 1 s se muestra un mensaje de progreso (aria-live) además del spinner.
    const temporizadorLento = setTimeout(() => setGuardandoLento(true), 1000)

    try {
      // ── Validaciones SIN red (feedback inmediato) ──────────────────────────
      // La existencia de productos y la obligatoriedad de medida se validan en
      // el servidor dentro de la misma transacción (antes: 1 SELECT por ítem).
      if (!proveedor) { setError('Seleccioná un proveedor antes de guardar el pedido.'); return }
      const validItems = items.filter(it => it.idProducto && parseInt(it.cantidad) > 0)
      if (!validItems.length) { setError('Agregá al menos un producto con ID válido.'); return }

      // Plan de cuotas: en creación el borrador completo debe sumar 100%; en
      // edición sólo las PENDIENTES son editables y deben sumar 100% menos lo
      // ya bloqueado por cuotas pagadas. El servidor revalida (fuente de verdad).
      const esCCFraccionada = metodoPago === 'cuenta_corriente' && conFraccion
      const llevaCuotas     = esEdicion ? !!pedidoEditando.tieneCuotas : esCCFraccionada
      if (llevaCuotas) {
        const cuotasErr = esEdicion
          ? validarEdicionPlanCuotas(cuotasPagadas, cuotas)
          : validarPlanCuotas(cuotas)
        if (cuotasErr) { setError(cuotasErr); return }
      }
      if (metodoPago === 'cuenta_corriente' && !conFraccion && (diasVencimientoCC === '' || Number(diasVencimientoCC) < 0)) {
        setError('Ingresá los días de vencimiento de la Cuenta Corriente.')
        return
      }

      const detallesPayload = []
      for (const it of validItems) {
        const precio = parseFloat(String(it.precioUnitario).replace(',', '.')) || 0
        if (precio <= 0) { setError(`Ingresá el precio del proveedor para "${it.nombreProducto || `ID ${it.idProducto}`}".`); return }
        detallesPayload.push({
          idDetallePedido: it.idDetallePedido ?? null,   // presente = ítem existente (diff)
          idProducto:      parseInt(it.idProducto),
          nombreProducto:  it.nombreProducto || null,
          medida:          it.medida || null,
          cantidad:        parseInt(it.cantidad),
          precioUnitario:  precio,
        })
      }

      // Días de vencimiento de la CC simple (mismas reglas que antes).
      const diasVencimiento = esEdicion
        ? (metodoPago === 'cuenta_corriente' && !pedidoEditando.tieneCuotas
            ? (parseInt(diasVencimientoCC, 10) || null)
            : pedidoEditando.diasVencimientoCC ?? null)
        : (metodoPago === 'cuenta_corriente' && !esCCFraccionada
            ? (parseInt(diasVencimientoCC, 10) || null)
            : null)

      // monto, subtotales y nombre del proveedor los calcula el servidor; el
      // estado de pago/logística y la fecha del pedido existente no se tocan.
      const args = {
        idPedido: esEdicion ? pedidoEditando.idPedido : null,
        pedido: {
          metodoPago,
          idProveedor:       proveedor.idProveedor,
          diasVencimientoCC: diasVencimiento,
        },
        detalles: detallesPayload,
        cuotas:   llevaCuotas ? cuotas : null,
      }

      // UNA llamada, UNA transacción (cabecera + ítems + stock + cuotas).
      const idempotencyKey = idemRef.current.obtener(JSON.stringify(args))
      const guardado = await guardarPedido({ ...args, idempotencyKey })
      onGuardado(guardado.idPedido)
    } catch (err) {
      // Mensaje ya traducido y seguro (GuardadoPedidoError). El formulario
      // conserva todos los datos cargados para poder reintentar.
      setError(err.message || 'Ocurrió un error al guardar el pedido.')
    } finally {
      clearTimeout(temporizadorLento)
      setGuardandoLento(false)
      savingRef.current = false
      setSaving(false)
    }
  }

  if (loadingInit) {
    return (
      <div className="max-w-5xl mx-auto flex items-center justify-center py-24" role="status" aria-live="polite">
        <p className="text-surface-400 text-sm font-body">Cargando pedido...</p>
      </div>
    )
  }

  if (errorCarga) {
    return (
      <div className="max-w-5xl mx-auto py-24 flex flex-col items-center gap-4" role="alert">
        <AlertCircle size={20} className="text-red-400" />
        <p className="text-red-400 text-sm font-body text-center max-w-md">{errorCarga}</p>
        <div className="flex items-center gap-3">
          <Button onClick={() => { setErrorCarga(''); setLoadingInit(true); setReintentoCarga(n => n + 1) }}>
            Reintentar
          </Button>
          <button onClick={onCancelar}
            className="text-surface-400 hover:text-white text-sm font-body transition-colors">
            Volver a pedidos
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6 animate-slide-up">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}

      <div className="flex items-center gap-3">
        <button onClick={onCancelar}
          className="flex items-center gap-2 -ml-2 px-2 min-h-[44px] min-[1025px]:min-h-0 text-surface-300 hover:text-white text-sm font-body transition-colors">
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
      <Card className="p-4 sm:p-6 space-y-5">
        <ProveedorSelector value={proveedor} onChange={setProveedor} onToast={setToast} />

        <div>
          <label className="block text-surface-300 text-sm min-[1025px]:text-xs tracking-widest uppercase font-body mb-2">
            Método de pago
          </label>
          <div className="grid grid-cols-1 min-[480px]:grid-cols-2 sm:flex sm:flex-wrap gap-2">
            {METODOS_PAGO.map(m => (
              <button key={m.value} onClick={() => setMetodoPago(m.value)}
                className={`px-4 py-2 ${TOUCH} rounded-xl text-sm font-body border transition-all
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
                <p className="text-surface-400 text-sm min-[1025px]:text-xs uppercase tracking-widest font-body mb-2">Modalidad</p>
                <div className="flex sm:inline-flex w-full sm:w-auto bg-surface-900/50 border border-surface-600 rounded-xl p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => setConFraccion(false)}
                    disabled={esEdicion}
                    aria-pressed={!conFraccion}
                    className={`flex flex-1 sm:flex-none items-center justify-center text-center gap-1.5 px-3 sm:px-4 py-2 ${TOUCH} rounded-lg text-sm font-body font-medium
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
                    className={`flex flex-1 sm:flex-none items-center justify-center text-center gap-1.5 px-3 sm:px-4 py-2 ${TOUCH} rounded-lg text-sm font-body font-medium
                               transition-all disabled:cursor-not-allowed
                               ${conFraccion
                                 ? 'bg-brand-600 text-white shadow-md shadow-brand-900/40'
                                 : 'text-surface-400 hover:text-surface-200 disabled:hover:text-surface-400'}`}>
                    <Layers size={14} /> Con fracción / Cuotas
                  </button>
                </div>
              </div>
              {esEdicion && (
                <p className="text-surface-500 text-sm min-[1025px]:text-xs font-body">
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
                  <label className="block text-surface-300 text-sm min-[1025px]:text-xs tracking-widest uppercase font-body mb-1">
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
                      className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2.5 text-white text-base min-[1025px]:text-sm font-mono focus:outline-none
                                 focus:border-brand-500 transition-all disabled:opacity-40 min-h-[44px] min-[1025px]:min-h-0"
                    />
                  </div>
                  <p className="text-surface-500 text-sm min-[1025px]:text-xs font-body mt-1">
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

      {/* Productos: grilla en escritorio, tarjetas apiladas en mobile/tablet */}
      <Card className="overflow-visible">
        <div className="px-4 sm:px-6 py-4 border-b border-surface-700 flex items-center justify-between gap-3">
          <h2 className="font-body font-semibold text-white text-sm">Productos</h2>
          <Button size="sm" icon={Plus} onClick={addItem} disabled={hayCuotaPagada || saving} className={TOUCH}>Agregar ítem</Button>
        </div>
        <div className={isDesktop ? 'overflow-x-auto' : 'p-3'}>
          <div role={isDesktop ? 'table' : 'list'} aria-label="Productos del pedido"
            className={isDesktop ? 'min-w-[56rem]' : 'space-y-3'}>
            {isDesktop && (
              <div role="row" className={`${ITEM_GRID} border-b border-surface-700 text-surface-400 text-sm min-[1025px]:text-xs tracking-widest uppercase font-body`}>
                {['#', 'Cant.', 'Nombre', 'ID', 'Medida', 'Precio Proveedor', 'Subtotal'].map(h => (
                  <div key={h} role="columnheader" className="px-1">{h}</div>
                ))}
                <div role="columnheader"><span className="sr-only">Acciones</span></div>
              </div>
            )}
            {items.map((item, idx) => (
              <ItemRow key={idx} item={item} index={idx} onUpdate={updateItem} onRemove={removeItem}
                disabled={hayCuotaPagada || saving} isDesktop={isDesktop} />
            ))}
          </div>
        </div>
        {items.length > 0 && (
          <div className="px-4 py-3 border-t border-surface-700/50">
            <button
              onClick={addItem}
              disabled={hayCuotaPagada || saving}
              className="flex items-center gap-2 text-brand-400 hover:text-brand-300 text-sm font-body transition-colors min-h-[44px] min-[1025px]:min-h-0
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

      {/* Total + guardar. En mobile/tablet queda fijo al pie: el botón nunca se pierde al scrollear. */}
      <Card className={`p-4 sm:p-6 ${isDesktop ? '' : 'sticky bottom-0 z-30 shadow-2xl shadow-black/50 pb-[max(1rem,env(safe-area-inset-bottom))]'}`}>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 md:gap-6">
          <div className="text-sm font-body">
            <div className="md:border-t md:border-surface-700 md:pt-2 flex items-baseline justify-between gap-6 sm:gap-16">
              <span className="text-white font-semibold">Total del pedido:</span>
              <span className="text-brand-400 font-mono font-bold text-lg">{fmt(total)}</span>
            </div>
          </div>
          <div className="flex flex-col md:items-end gap-2">
            {error && (
              <div role="alert"
                   className="flex items-start gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/30
                              rounded-xl px-3 py-2 md:max-w-xs max-h-32 overflow-y-auto">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />{error}
              </div>
            )}
            <Button size="lg" icon={saving ? IconoGuardando : (esEdicion ? Pencil : ShoppingCart)}
                    className={`w-full md:w-auto ${TOUCH}`}
                    onClick={guardar} disabled={saving} aria-busy={saving}>
              {saving ? 'Guardando...' : (esEdicion ? 'Guardar cambios' : 'Guardar Pedido')}
            </Button>
            {/* Región en vivo: anuncia el progreso a lectores de pantalla y a la vista */}
            <p role="status" aria-live="polite" className="text-surface-300 text-sm min-[1025px]:text-xs font-body min-h-[1rem] md:text-right">
              {saving && guardandoLento ? 'Guardando el pedido… puede demorar unos segundos. No cierres esta pantalla.' : ''}
            </p>
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
  // Filtros aplicados: un solo objeto en el padre, por eso sobreviven a la rotación del equipo
  // (FiltrosPedidos sólo guarda un borrador mientras su panel está abierto).
  const [filtros,     setFiltros]      = useState(FILTROS_INICIALES)
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
    page, setPage, totalPages, loading, error,
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
    serverFilters: {
      filterEst: filtros.filterEst, filterLog: filtros.filterLog,
      filterDesde: filtros.filterDesde, filterHasta: filtros.filterHasta,
    },
    clientFilters: { filterProv: filtros.filterProv },
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
  const { anchorRef: tableAnchorRef, scrollToStart } = useScrollAnchor()
  const { isCompact } = useBreakpoint()
  const online = useOnlineStatus()

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
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}

      {/* Offline: en mobile la conexión es intermitente; los datos mostrados pueden estar viejos. */}
      {!online && (
        <div role="status" className="flex items-center gap-2 text-amber-300 text-sm font-body bg-amber-500/10
                                      border border-amber-500/30 rounded-xl px-4 py-2.5">
          <WifiOff size={15} className="flex-shrink-0" />
          Sin conexión: los datos pueden estar desactualizados y no se podrán guardar cambios.
        </div>
      )}

      <PageHeader
        title="Pedidos de Compra"
        subtitle="Órdenes a proveedores"
        actions={
          <Button icon={Plus} onClick={() => setVista('nuevo')} className={TOUCH}>Nuevo Pedido</Button>
        }
      />

      {/* Resumen: filas compactas en mobile, 3 tarjetas desde tablet */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-4">
        {[
          { label: 'Total pedidos',   value: pedidos.length,      color: 'text-white' },
          { label: 'Deuda pendiente', value: fmt(totalPendiente), color: 'text-yellow-400' },
          { label: 'Total pagado',    value: fmt(totalPagado),    color: 'text-emerald-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface-800 border border-surface-700 rounded-xl px-4 py-3 md:p-4
                                      flex md:block items-baseline justify-between gap-3">
            <p className="text-surface-400 text-sm min-[1025px]:text-xs uppercase tracking-widest font-body">{label}</p>
            <p className={`font-display text-xl min-[1025px]:text-2xl tracking-wider min-[1025px]:tracking-widest md:mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <FiltrosPedidos value={filtros} onChange={setFiltros} compact={isCompact} />

      {/* Listado + paginador en UN solo Card (igual que Inventario). El ancla marca el inicio de la lista. */}
      <div ref={tableAnchorRef}>
        <PedidosListado
          pedidos={paginated}
          cuotasResumen={cuotasResumen}
          totalSinFiltrar={pedidos.length}
          loading={loading}
          error={error}
          onRetry={load}
          onAbrir={abrirDetalle}
          footer={
            <PaginadorTabla
              page={page} totalPages={totalPages} pageSize={PAGE_SIZE} total={filteredPedidos.length}
              onChange={(n) => { setPage(n); scrollToStart() }}
            />
          }
        />
      </div>
    </div>
  )
}
