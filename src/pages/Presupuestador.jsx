// src/pages/Presupuestador.jsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

// ─── Services ────────────────────────────────────────────────────────────────
import { crearCliente, buscarClientes, obtenerClientePorId } from '../services/clientesService'
import { crearPresupuesto, actualizarPresupuesto, obtenerPresupuestoPorId, obtenerDetallesDePresupuesto } from '../services/presupuestosService'
import { buscarProductos, obtenerProductoPorId, obtenerMedidasDeProducto } from '../services/productosService'
import { calcularPromocionParaItem, obtenerPromocionesVigentes } from '../services/promocionesService'
import { obtenerSaldosPendientesDeCliente } from '../services/saldosService'

// ─── Hooks ───────────────────────────────────────────────────────────────────
import { useDebounce } from '../hooks/useDebounce'

import { generarPDFPresupuesto } from '../lib/pdfPresupuesto'
import { Button, Card, PageHeader, Modal, Input } from '../components/ui'
import { Plus, Trash2, Search, UserPlus, CheckCircle2, AlertCircle, Download, FileText, ArrowLeft, X, Tag } from 'lucide-react'

// ─── Constantes ────────────────────────────────────────────────────────────

const MEDIDAS_VALIDAS = ['standard','0.25','0.50','0.75','1.00','1.25','1.50','1.75','2.00']

const METODOS_BASE = [
  { value: 'efectivo',      label: 'Efectivo',          factor: 0.95,  texto: '5% descuento' },
  { value: 'transferencia', label: 'Transferencia',      factor: 0.95,  texto: '5% descuento' },
  { value: 'cc15',          label: 'Cta. Cte. 15 días', factor: 1.00,  texto: 'Precio de lista' },
  { value: 'cc30',          label: 'Cta. Cte. 30 días', factor: 1.105, texto: '10.5% recargo' },
]

function today() { return new Date().toISOString().slice(0, 10) }

function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)
}

function norm(s) {
  return (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

const cap = (s) => s ? s.trim().charAt(0).toUpperCase() + s.trim().slice(1) : ''

// ─── Helpers de totales ────────────────────────────────────────────────────

/**
 * Calcula los totales del carrito a partir de ítems ya enriquecidos con promos.
 * Reemplaza calcularTotales() de lib/promociones.js.
 */
function calcularTotales(itemsConPromo, factor) {
  let subtotalSinPromo = 0
  let subtotalConPromo = 0

  for (const it of itemsConPromo) {
    const cant     = parseInt(it.cantidad) || 0
    const precio   = parseFloat(it.precioUnitario) || 0
    const efectivo = it.precioConPromo != null ? it.precioConPromo : precio
    subtotalSinPromo += cant * precio
    subtotalConPromo += cant * efectivo
  }

  const ahorro     = subtotalSinPromo - subtotalConPromo
  const totalFinal = Math.round(subtotalConPromo * factor * 100) / 100

  return { subtotalSinPromo, subtotalConPromo, ahorro, totalFinal }
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

// ─── Skeleton de carga ─────────────────────────────────────────────────────
// [OPTIMIZACIÓN 6] Reemplaza el texto "Cargando presupuesto…" por una
// estructura visual que mantiene el layout estable durante la carga asíncrona.
// El usuario percibe la página como más rápida porque hay contenido inmediato.

function PresupuestadorSkeleton() {
  const p = 'animate-pulse bg-surface-700 rounded-xl'
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className={`h-8 w-52 ${p}`} />
        <div className={`h-4 w-36 ${p}`} />
      </div>
      {/* Card cabecera */}
      <div className="bg-surface-800 border border-surface-700 rounded-2xl p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className={`md:col-span-2 h-10 ${p}`} />
          <div className={`h-10 ${p}`} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-5">
          {[...Array(5)].map((_, i) => <div key={i} className={`h-16 ${p}`} />)}
        </div>
      </div>
      {/* Card tabla */}
      <div className="bg-surface-800 border border-surface-700 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-700 flex justify-between items-center">
          <div className={`h-5 w-20 ${p}`} />
          <div className={`h-8 w-28 ${p}`} />
        </div>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="px-6 py-3 border-b border-surface-700/50 flex gap-4 items-center">
            <div className={`h-8 w-6 ${p}`} />
            <div className={`h-8 w-14 ${p}`} />
            <div className={`h-8 flex-1 ${p}`} />
            <div className={`h-8 w-20 ${p}`} />
            <div className={`h-8 w-24 ${p}`} />
            <div className={`h-8 w-28 ${p}`} />
            <div className={`h-8 w-28 ${p}`} />
          </div>
        ))}
      </div>
      {/* Card totales */}
      <div className="bg-surface-800 border border-surface-700 rounded-2xl p-6 space-y-3">
        <div className={`h-4 w-64 ${p}`} />
        <div className={`h-4 w-48 ${p}`} />
        <div className={`h-px w-full bg-surface-700`} />
        <div className={`h-6 w-56 ${p}`} />
      </div>
    </div>
  )
}

// ─── Modal nuevo cliente ────────────────────────────────────────────────────

function NuevoClienteModal({ open, onClose, onCreated }) {
  const empty = { nombre: '', apellido: '', cuit: '', domicilio: '', telefono: '', mail: '', apodo: '', nombreComercio: '' }
  const [form, setForm]     = useState(empty)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (!open) { setForm(empty); setErrors({}) } }, [open])

  function set(k, v) { setForm(p => ({ ...p, [k]: v })) }

  function setField(k, v) {
    let val = v
    if (k === 'cuit')     val = v.replace(/[^0-9-]/g, '')
    if (k === 'telefono') val = v.replace(/[^0-9]/g, '')
    setForm(p => ({ ...p, [k]: val }))
  }

  async function guardar() {
    const e = {}
    if (!form.nombre.trim())   e.nombre   = 'Requerido'
    if (!form.apellido.trim()) e.apellido = 'Requerido'
    setErrors(e)
    if (Object.keys(e).length) return

    const nombre         = cap(form.nombre)
    const apellido       = cap(form.apellido)
    const apodo          = cap(form.apodo)
    const nombreComercio = cap(form.nombreComercio)
    const domicilio      = form.domicilio.replace(/\b\w/g, c => c.toUpperCase())

    setSaving(true)
    try {
      const cliente = await crearCliente({
        nombre, apellido,
        cuit:           form.cuit     || null,
        domicilio:      domicilio     || null,
        telefono:       form.telefono || null,
        mail:           form.mail     || null,
        apodo:          apodo         || null,
        nombreComercio: nombreComercio || null,
      })
      onClose()
      setTimeout(() => onCreated(cliente), 0)
    } catch (err) {
      setErrors({ general: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nuevo Cliente">
      <div className="space-y-4">
        {errors.general && (
          <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
            {errors.general}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Nombre *"   value={form.nombre}   onChange={e => set('nombre', e.target.value)}   error={errors.nombre}   placeholder="Juan" />
          <Input label="Apellido *" value={form.apellido} onChange={e => set('apellido', e.target.value)} error={errors.apellido} placeholder="García" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Apodo"          value={form.apodo}         onChange={e => set('apodo', e.target.value)}         placeholder="Apodo o alias" />
          <Input label="Nombre comercio" value={form.nombreComercio} onChange={e => set('nombreComercio', e.target.value)} placeholder="Nombre del local" />
        </div>
        <Input label="CUIT" value={form.cuit} type="tel" inputMode="numeric" pattern="[0-9-]*"
          onChange={e => setField('cuit', e.target.value)} placeholder="20-12345678-9"  />
        <Input label="Domicilio" value={form.domicilio} onChange={e => set('domicilio', e.target.value)} placeholder="Av. Siempreviva 742" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Teléfono" value={form.telefono} type="tel" inputMode="numeric" pattern="[0-9+\-() ]*"
            onChange={e => setField('telefono', e.target.value)} placeholder="3510000000"  />
          <Input label="Email" value={form.mail} onChange={e => set('mail', e.target.value)} placeholder="email@ejemplo.com" />
        </div>
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="flex-1" onClick={guardar} disabled={saving}>{saving ? 'Creando…' : 'Crear Cliente'}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Buscador de clientes ───────────────────────────────────────────────────

function ClienteSelector({ value, onChange, onToast }) {
  const [search,     setSearch]     = useState('')
  const [results,    setResults]    = useState([])
  const [showDrop,   setShowDrop]   = useState(false)
  const [showNew,    setShowNew]    = useState(false)
  // [OPTIMIZACIÓN 6] Indicador visual de búsqueda en curso
  const [searching,  setSearching]  = useState(false)
  const wrapRef = useRef(null)

  // [OPTIMIZACIÓN 1] Debounce: el valor debounceado es el que dispara el fetch,
  // no el valor crudo del input. Con 400 ms de delay (el mismo que ya usaba
  // tu useDebounce), el usuario que escribe a ritmo normal genera 1 request
  // en lugar de 1 por cada carácter.
  const debouncedSearch = useDebounce(search, 400)

  useEffect(() => {
    const handler = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowDrop(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // [OPTIMIZACIÓN 1] El fetch de clientes ahora reacciona al valor debounceado,
  // no al onChange del input. El input se actualiza instantáneamente (sin lag),
  // pero la query a Supabase espera a que el usuario deje de escribir.
  useEffect(() => {
    if (!debouncedSearch.trim()) {
      setResults([])
      setShowDrop(false)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    buscarClientes(debouncedSearch)
      .then(({ porId, porNombre }) => {
        if (cancelled) return
        const seen = new Set(porId.map(c => c.idCliente))
        setResults([...porId, ...porNombre.filter(c => !seen.has(c.idCliente))].slice(0, 8))
        setShowDrop(true)
      })
      .catch(() => { if (!cancelled) setResults([]) })
      .finally(() => { if (!cancelled) setSearching(false) })
    return () => { cancelled = true }
  }, [debouncedSearch])

  function seleccionar(c) {
    onChange(c)
    setSearch(`${c.nombre} ${c.apellido}`)
    setShowDrop(false)
  }

  function limpiar() { onChange(null); setSearch(''); setResults([]) }

  function abrirNuevo() {
    setShowDrop(false)
    setTimeout(() => setShowNew(true), 50)
  }

  function handleCreated(cliente) {
    seleccionar(cliente)
    onToast('Cliente creado correctamente ✓')
  }

  return (
    <div ref={wrapRef} className="relative">
      <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1">Cliente</label>

      {value ? (
        <div className="flex items-center gap-3 bg-surface-700 border border-brand-500/40 rounded-xl px-4 py-2.5">
          <div className="flex-1">
            <p className="text-white text-sm font-body">{value.nombre} {value.apellido}</p>
            <p className="text-surface-400 text-xs font-mono">ID #{value.idCliente} · {value.mail || 'Sin mail'}</p>
          </div>
          <button onClick={limpiar} className="text-surface-400 hover:text-red-400 transition-colors text-xl leading-none">×</button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
            {/* [OPTIMIZACIÓN 1] onChange actualiza solo estado local — sin fetch directo */}
            <input
              value={search}
              onChange={e => { setSearch(e.target.value) }}
              onFocus={() => search && results.length > 0 && setShowDrop(true)}
              placeholder="Buscá por nombre o ID..."
              className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-9 py-2.5
                         text-white text-sm font-body placeholder-surface-500
                         focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 transition-all"
            />
            {/* [OPTIMIZACIÓN 6] Spinner mientras la búsqueda está en curso */}
            {searching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <div className="w-3.5 h-3.5 border-2 border-brand-500/30 border-t-brand-400 rounded-full animate-spin" />
              </div>
            )}
          </div>

          {showDrop && (
            <div className="absolute z-[9999] top-full mt-1 w-full bg-surface-800 border border-surface-600
                            rounded-xl shadow-2xl overflow-hidden">
              {results.length === 0 ? (
                <div className="px-4 py-3 text-surface-300 text-sm font-body">
                  Sin resultados.{' '}
                  <button onClick={abrirNuevo} className="text-brand-400 underline hover:text-brand-300">
                    Crear cliente nuevo
                  </button>
                </div>
              ) : (
                results.map(c => (
                  <button key={c.idCliente} onClick={() => seleccionar(c)}
                    className="w-full text-left px-4 py-2.5 hover:bg-surface-700 transition-colors border-b border-surface-700/60 last:border-0">
                    <p className="text-white text-sm font-body">{c.nombre} {c.apellido}</p>
                    <p className="text-surface-400 text-xs font-mono">ID #{c.idCliente} · {c.telefono || ''}</p>
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}

      {!value && (
        <button onClick={abrirNuevo}
          className="mt-1.5 flex items-center gap-1.5 text-xs text-surface-400 hover:text-brand-400 transition-colors font-body">
          <UserPlus size={12} /> Crear cliente nuevo
        </button>
      )}

      <NuevoClienteModal open={showNew} onClose={() => setShowNew(false)} onCreated={handleCreated} />
    </div>
  )
}

// ─── Fila de ítem ───────────────────────────────────────────────────────────

// [OPTIMIZACIÓN 2] getProductoCached se recibe como prop desde el componente
// padre (Presupuestador). Cada ItemRow consulta el mismo caché compartido,
// así que si dos filas tienen el mismo producto, el segundo fetch nunca sale
// a la red.
function ItemRow({ uid, item, itemConPromo, index, onUpdate, onRemove, onClearError, onStockError, getProductoCached }) {
  const [nombreSearch,   setNombreSearch]   = useState(item.nombreProducto || '')
  const [nombreResults,  setNombreResults]  = useState([])
  const [showDrop,       setShowDrop]       = useState(false)
  const [dropPos,        setDropPos]        = useState({ top: 0, left: 0, width: 0 })
  const [medidas,        setMedidas]        = useState([])
  const [idError,        setIdError]        = useState('')
  const [stockWarning,   setStockWarning]   = useState('')
  const [priceWarning,   setPriceWarning]   = useState(false)
  const [tooltipPos,     setTooltipPos]     = useState({ top: 0, left: 0 })
  const [showTooltip,    setShowTooltip]    = useState(false)
  // [OPTIMIZACIÓN 6] Indicador visual de búsqueda de productos en curso
  const [searchingProd,  setSearchingProd]  = useState(false)
  const cantRef   = useRef(null)
  const wrapRef   = useRef(null)
  const inputRef  = useRef(null)
  const priceRef  = useRef(null)
  const [showPriceTooltip, setShowPriceTooltip] = useState(false)
  const [priceTooltipPos,  setPriceTooltipPos]  = useState({ top: 0, left: 0 })

  // Precio efectivo (con o sin promo)
  const precioEfectivo = itemConPromo?.precioConPromo != null
    ? itemConPromo.precioConPromo
    : (parseFloat(item.precioUnitario) || 0)

  const tienePromo = itemConPromo?.precioConPromo != null

  // [OPTIMIZACIÓN 1] Estado del input de nombre — separado del valor que
  // dispara el fetch para poder aplicar debounce.
  const debouncedNombreSearch = useDebounce(nombreSearch, 400)

  useEffect(() => {
    const handler = e => {
      if (
        wrapRef.current && !wrapRef.current.contains(e.target) &&
        !e.target.closest('[data-producto-drop]')
      ) setShowDrop(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

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

  // [OPTIMIZACIÓN 1] La búsqueda de productos por nombre ahora está debounceada.
  // Se dispara solo cuando debouncedNombreSearch cambia (el usuario pausa de escribir),
  // no en cada keystroke. También usa cancel token para ignorar respuestas de
  // queries anteriores si el usuario sigue escribiendo.
  useEffect(() => {
    // Si el producto ya está seleccionado (tiene idProducto), no buscar
    if (!debouncedNombreSearch.trim() || item.idProducto) {
      setNombreResults([])
      setShowDrop(false)
      setSearchingProd(false)
      return
    }
    let cancelled = false
    setSearchingProd(true)
    buscarProductos({ texto: debouncedNombreSearch.trim() })
      .then(rows => {
        if (cancelled) return
        setNombreResults(rows.slice(0, 12))
        setShowDrop(true)
      })
      .catch(() => { if (!cancelled) { setNombreResults([]); setShowDrop(true) } })
      .finally(() => { if (!cancelled) setSearchingProd(false) })
    return () => { cancelled = true }
  }, [debouncedNombreSearch, item.idProducto])

  // [OPTIMIZACIÓN 2] Usar caché compartido para cargar medidas. Si el producto
  // ya fue consultado en esta sesión (por checkStock u otro ItemRow), los datos
  // vienen del Map en memoria sin ir a la red.
  useEffect(() => {
    if (!item.idProducto) { setMedidas([]); return }
    let cancelled = false
    getProductoCached(parseInt(item.idProducto))
      .then(({ producto: prod, medidas: ms }) => {
        if (cancelled || !prod) return
        if (prod.tieneMedidas) {
          if (!cancelled) setMedidas(ms.map(r => r.medida))
        } else {
          setMedidas([])
          onUpdate(uid, 'medida', null)
        }
      })
      .catch(() => { if (!cancelled) setMedidas([]) })
    return () => { cancelled = true }
  }, [item.idProducto])

  // [OPTIMIZACIÓN 2] checkStock ahora usa el caché compartido — no hace fetch
  // si el producto ya fue consultado antes en esta sesión de presupuesto.
  async function checkStock(idProducto, medida, cantidad) {
    if (!idProducto || !cantidad || parseInt(cantidad) <= 0) {
      setStockWarning(''); onStockError(uid, false); return
    }
    try {
      const { producto: prod, medidas: medidasProd } = await getProductoCached(parseInt(idProducto))
      if (!prod) { setStockWarning(''); onStockError(uid, false); return }

      let stockDisp = 0
      if (prod.tieneMedidas && medida) {
        const pm = medidasProd.find(m => m.medida === medida)
        stockDisp = pm?.cantidad ?? 0
      } else if (!prod.tieneMedidas) {
        stockDisp = prod.cantidad ?? 0
      } else {
        setStockWarning(''); onStockError(uid, false); return
      }

      const pedido = parseInt(cantidad) || 0
      if (pedido > stockDisp) {
        setStockWarning(`Stock disponible: ${stockDisp}.`)
        onStockError(uid, true)
      } else {
        setStockWarning('')
        onStockError(uid, false)
      }
    } catch {
      setStockWarning(''); onStockError(uid, false)
    }
  }

  // [OPTIMIZACIÓN 1] El handler del input de nombre ya NO dispara búsquedas.
  // Solo actualiza el estado local y resetea el producto seleccionado si había uno.
  // El useEffect con debouncedNombreSearch es quien decide cuándo buscar.
  function handleNombreChange(text) {
    setNombreSearch(text)
    onClearError()
    onUpdate(uid, 'nombreProducto', text)
    if (item.idProducto) {
      onUpdate(uid, 'idProducto', '')
      onUpdate(uid, 'precioUnitario', 0)
      onUpdate(uid, 'medida', null)
      setStockWarning('')
      onStockError(uid, false)
      setPriceWarning(false)
    }
  }

  function seleccionarProducto(p) {
    setNombreSearch(p.nombre)
    setShowDrop(false)
    onClearError()
    setIdError('')
    onUpdate(uid, 'idProducto',     p.idProducto)
    onUpdate(uid, 'nombreProducto', p.nombre)
    onUpdate(uid, 'precioUnitario', p.precioUnitario)
    onUpdate(uid, 'medida',         null)
    setPriceWarning(!p.precioUnitario)
    checkStock(p.idProducto, null, item.cantidad)
  }

  async function handleIdChange(val) {
    const clean = val.replace(/\D/g, '')
    onClearError()
    onUpdate(uid, 'idProducto', clean)
    if (clean) {
      try {
        // [OPTIMIZACIÓN 2] Lookup por ID también usa el caché compartido
        const { producto: p } = await getProductoCached(parseInt(clean))
        if (p) {
          setNombreSearch(p.nombre)
          onUpdate(uid, 'nombreProducto', p.nombre)
          onUpdate(uid, 'precioUnitario', p.precioUnitario)
          onUpdate(uid, 'medida', null)
          setIdError('')
          setPriceWarning(!p.precioUnitario)
          checkStock(p.idProducto, null, item.cantidad)
        } else {
          setNombreSearch('')
          onUpdate(uid, 'nombreProducto', '')
          onUpdate(uid, 'precioUnitario', 0)
          onUpdate(uid, 'medida', null)
          setIdError(`Sin producto con ID ${clean}`)
        }
      } catch {
        setNombreSearch('')
        onUpdate(uid, 'nombreProducto', '')
        onUpdate(uid, 'precioUnitario', 0)
        onUpdate(uid, 'medida', null)
        setIdError(`Sin producto con ID ${clean}`)
      }
    } else {
      setNombreSearch('')
      onUpdate(uid, 'nombreProducto', '')
      onUpdate(uid, 'precioUnitario', 0)
      onUpdate(uid, 'medida', null)
      setStockWarning('')
      onStockError(uid, false)
      setIdError('')
      setPriceWarning(false)
    }
  }

  const cell = `bg-surface-700 border border-surface-600 rounded-lg px-2 py-1.5 text-white text-sm
                font-mono focus:outline-none focus:border-brand-500 transition-all
                [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`

  return (
    <tr className="border-b border-surface-700/50">
      {/* # */}
      <td className="py-2 px-3 text-surface-500 text-sm font-mono w-8 select-none">{index + 1}</td>

      {/* Cantidad */}
      <td className="py-2 px-2 w-20">
        <div className="relative">
          <input ref={cantRef} type="text" inputMode="numeric" value={item.cantidad}
            onChange={e => {
              onClearError()
              const raw = e.target.value.replace(/\D/g, '')
              onUpdate(uid, 'cantidad', raw)
              checkStock(item.idProducto, item.medida, raw)
            }}
            onBlur={e => {
              const val = (!e.target.value || parseInt(e.target.value) < 1) ? '1' : e.target.value
              if (!e.target.value || parseInt(e.target.value) < 1) onUpdate(uid, 'cantidad', '1')
              checkStock(item.idProducto, item.medida, val)
              setShowTooltip(false)
            }}
            onFocus={() => { if (stockWarning) { const r = cantRef.current?.getBoundingClientRect(); if(r) setTooltipPos({ top: r.top + window.scrollY - 36, left: r.left + window.scrollX }); setShowTooltip(true) } }}
            onMouseEnter={() => { if (stockWarning) { const r = cantRef.current?.getBoundingClientRect(); if(r) setTooltipPos({ top: r.top + window.scrollY - 36, left: r.left + window.scrollX }); setShowTooltip(true) } }}
            onMouseLeave={() => setShowTooltip(false)}
            className={cell + ' w-full text-center' + (stockWarning ? ' !border-yellow-500 !text-yellow-300' : '')} />
        </div>
        {stockWarning && showTooltip && createPortal(
          <div style={{ position: 'absolute', top: tooltipPos.top, left: tooltipPos.left, zIndex: 9999, pointerEvents: 'none' }}
               className="bg-yellow-900/95 border border-yellow-500/60 text-yellow-200 text-[11px] font-body
                          rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap flex items-center gap-1.5">
            <span>⚠</span><span>{stockWarning}</span>
          </div>,
          document.body
        )}
      </td>

      {/* Nombre */}
      <td className="py-2 px-2 min-w-[200px]" ref={wrapRef}>
        <div className="relative">
          {/* [OPTIMIZACIÓN 1] onChange apunta a handleNombreChange (solo estado local) */}
          <input
            ref={inputRef}
            value={nombreSearch}
            onChange={e => handleNombreChange(e.target.value)}
            placeholder="Nombre del producto..."
            className={cell + ' w-full pr-7'}
          />
          {/* [OPTIMIZACIÓN 6] Spinner de búsqueda de producto */}
          {searchingProd && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
              <div className="w-3 h-3 border-2 border-brand-500/30 border-t-brand-400 rounded-full animate-spin" />
            </div>
          )}
        </div>
        {showDrop && createPortal(
          <div
            data-producto-drop
            style={{ position: 'absolute', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
            className="bg-surface-800 border border-surface-600 rounded-xl shadow-2xl max-h-[260px] overflow-y-auto"
          >
            {nombreResults.length === 0 ? (
              <p className="px-4 py-3 text-surface-300 text-xs font-body">
                Sin resultados para "{nombreSearch}"
              </p>
            ) : (
              nombreResults.map(p => (
                <button key={p.idProducto} onClick={() => seleccionarProducto(p)}
                  className="w-full text-left px-3 py-2.5 hover:bg-surface-700 transition-colors
                             border-b border-surface-700/60 last:border-0">
                  <p className="text-white text-xs font-body leading-tight">{p.nombre}</p>
                  <p className="text-surface-400 text-xs font-mono mt-0.5">
                    #{p.idProducto} · {fmt(p.precioUnitario)}{p.tieneMedidas ? ' · Con medidas' : ''}
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
          className={cell + ' w-full text-center' + (idError ? ' border-red-500' : '')} />
        {idError && <p className="text-red-400 text-[10px] font-body mt-0.5 leading-tight">{idError}</p>}
      </td>

      {/* Medida */}
      <td className="py-2 px-2 w-32">
        {medidas.length > 0 ? (
          <select value={item.medida || ''}
            onChange={e => {
              onUpdate(uid, 'medida', e.target.value)
              checkStock(item.idProducto, e.target.value, item.cantidad)
            }}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-2 py-1.5
                       text-white text-sm font-body focus:outline-none focus:border-brand-500 transition-all cursor-pointer">
            <option value="">— medida —</option>
            {medidas.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <span className="text-surface-500 text-xs px-2">—</span>
        )}
      </td>

      {/* Precio — con soporte de promociones */}
      <td className="py-2 px-2 w-44">
        <div ref={priceRef} className="space-y-0.5">
          {tienePromo ? (
            <>
              {/* Precio original tachado */}
              <div className="text-surface-500 text-xs font-mono line-through">
                {fmt(parseFloat(item.precioUnitario))}
              </div>
              {/* Precio promocional */}
              <div className="text-emerald-400 text-sm font-mono font-semibold">
                {fmt(precioEfectivo)}
              </div>
              {/* Badge de promo */}
              <div className="flex items-center gap-1 mt-0.5">
                <Tag size={10} className="text-emerald-500 flex-shrink-0" />
                <span className="text-emerald-500 text-[10px] font-body truncate max-w-[100px]">
                  {itemConPromo.promoAplicada?.nombre ?? ''}
                </span>
              </div>
            </>
          ) : (
            <div
              className={`rounded-lg px-2 py-1.5 text-sm font-mono cursor-not-allowed select-none
                         ${priceWarning
                           ? 'bg-yellow-900/40 border border-yellow-500 text-yellow-300'
                           : 'bg-surface-800 border border-surface-700 text-surface-300'}`}
              onMouseEnter={() => {
                if (priceWarning) {
                  const r = priceRef.current?.getBoundingClientRect()
                  if (r) setPriceTooltipPos({ top: r.top + window.scrollY - 36, left: r.left + window.scrollX })
                  setShowPriceTooltip(true)
                }
              }}
              onMouseLeave={() => setShowPriceTooltip(false)}>
              {item.precioUnitario ? fmt(parseFloat(item.precioUnitario)) : (
                priceWarning
                  ? <span className="text-yellow-400 text-xs">Sin precio ⚠</span>
                  : <span className="text-surface-600">—</span>
              )}
            </div>
          )}
        </div>
        {priceWarning && showPriceTooltip && createPortal(
          <div style={{ position: 'absolute', top: priceTooltipPos.top, left: priceTooltipPos.left, zIndex: 9999, pointerEvents: 'none' }}
               className="bg-yellow-900/95 border border-yellow-500/60 text-yellow-200 text-[11px] font-body
                          rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap flex items-center gap-1.5">
            <span>⚠</span><span>Sin precio definido — asignarlo desde Inventario</span>
          </div>,
          document.body
        )}
      </td>

      {/* Subtotal — usa precio efectivo */}
      <td className="py-2 px-3 text-right w-36">
        <span className={`text-sm font-mono ${tienePromo ? 'text-emerald-300' : 'text-surface-200'}`}>
          {fmt((parseInt(item.cantidad) || 0) * precioEfectivo)}
        </span>
      </td>

      {/* Borrar */}
      <td className="py-2 px-2 w-10">
        <button onClick={() => onRemove(uid)} className="text-surface-500 hover:text-red-400 transition-colors p-1 rounded">
          <Trash2 size={15} />
        </button>
      </td>
    </tr>
  )
}

// ─── Selector método de pago ────────────────────────────────────────────────

function MetodoPagoSelector({ metodoPago, onMetodoPago, excepcionFactor, onExcepcionFactor, excepcionSubMetodo, onExcepcionSubMetodo, initialPct }) {
  const [pct, setPct] = useState(initialPct ?? '')
  const esExcepcion = metodoPago === 'excepcion'

  useEffect(() => {
    if (esExcepcion && pct !== '') {
      onExcepcionFactor(1 - (parseFloat(pct) || 0) / 100)
    }
  }, [pct, esExcepcion])

  function seleccionar(v) {
    onMetodoPago(v)
    if (v !== 'excepcion') onExcepcionFactor(1)
  }

  const todos = [...METODOS_BASE, { value: 'excepcion', label: 'Excepción', texto: 'Desc. manual' }]

  return (
    <div className="mt-5">
      <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-2">Método de Pago</label>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {todos.map(m => {
          const active = metodoPago === m.value
          return (
            <button key={m.value} onClick={() => seleccionar(m.value)}
              className={`rounded-xl px-3 py-3 text-left border transition-all
                ${active ? 'bg-brand-500/15 border-brand-500/50 text-white' : 'bg-surface-700 border-surface-600 text-surface-300 hover:border-surface-500'}`}>
              <p className="text-sm font-body font-medium leading-tight">{m.label}</p>
              <p className={`text-xs mt-0.5 font-mono ${active ? 'text-brand-400' : 'text-surface-500'}`}>{m.texto}</p>
            </button>
          )
        })}
      </div>

      {esExcepcion && (
        <div className="mt-3 bg-surface-700/60 border border-surface-600 rounded-xl p-4 space-y-3">
          <p className="text-surface-300 text-xs font-body uppercase tracking-widest">Configurar Excepción</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-surface-400 text-xs font-body mb-1">Forma de pago base</label>
              <select value={excepcionSubMetodo} onChange={e => onExcepcionSubMetodo(e.target.value)}
                className="w-full bg-surface-800 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                           font-body focus:outline-none focus:border-brand-500 transition-all">
                {METODOS_BASE.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-surface-400 text-xs font-body mb-1">% Descuento (+) / Recargo (−)</label>
              <input type="text" inputMode="decimal" value={pct}
                onChange={e => { const v = e.target.value.replace(',', '.'); if (/^-?\d*\.?\d*$/.test(v)) setPct(v) }}
                placeholder="Ej: 10 → 10% desc."
                className="w-full bg-surface-800 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                           font-mono focus:outline-none focus:border-brand-500 transition-all
                           [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
            </div>
          </div>
          {pct !== '' && (
            <p className="text-brand-400 text-xs font-mono">
              Factor: {(1 - (parseFloat(pct)||0)/100).toFixed(4)} · el precio final será {((1-(parseFloat(pct)||0)/100)*100).toFixed(2)}% del original
            </p>
          )}
        </div>
      )}
    </div>
  )
}


const ITEM_EMPTY = () => ({ _uid: Math.random().toString(36).slice(2), idProducto: '', nombreProducto: '', cantidad: 1, precioUnitario: 0, medida: null })

export default function Presupuestador({ presupuestoEditar, onEditarVolver, onVerHistorial }) {
  const navigate = useNavigate()
  const modoEdicion = !!presupuestoEditar

  // ── Estado de inicialización (async) ──
  const [initDone,  setInitDone]  = useState(!modoEdicion)
  const [initError, setInitError] = useState('')

  const [cliente,            setCliente]            = useState(null)
  const [metodoPago,         setMetodoPago]          = useState('efectivo')
  const [excepcionFactor,    setExcepcionFactor]     = useState(1)
  const [excepcionSubMetodo, setExcepcionSubMetodo]  = useState('efectivo')
  const [items,              setItems]               = useState([ITEM_EMPTY()])
  const [pctInit,            setPctInit]             = useState('')
  const [guardado,           setGuardado]            = useState(null)
  const [error,              setError]               = useState('')
  const [toast,              setToast]               = useState('')
  const [stockErrors,        setStockErrors]         = useState({})
  const [saving,             setSaving]              = useState(false)

  // ── Promociones vigentes — se cargan una sola vez ──
  const [promoVigentes, setPromoVigentes] = useState([])
  useEffect(() => {
    obtenerPromocionesVigentes().then(setPromoVigentes).catch(() => {})
  }, [])

  // ── [OPTIMIZACIÓN 2] Caché de productos compartido entre todas las ItemRow ──
  // useRef porque no necesitamos que un cambio en el caché dispare un re-render.
  // El Map vive mientras el componente esté montado y se limpia al crear
  // un presupuesto nuevo (función nuevo()).
  //
  // Estructura del Map: { "idProducto" -> { producto, medidas } }
  // - producto: objeto completo del producto
  // - medidas: array de ProductoMedida (vacío si no tiene medidas)
  const productoCacheRef = useRef(new Map())

  // Helper que usa el caché. Si el producto no está, lo trae y lo guarda.
  // Lanza los dos fetches en paralelo (Promise.all) para reducir latencia.
  const getProductoCached = useCallback(async (idProducto) => {
    const key = String(idProducto)
    if (productoCacheRef.current.has(key)) {
      return productoCacheRef.current.get(key)
    }
    const [producto, medidasRaw] = await Promise.all([
      obtenerProductoPorId(idProducto),
      obtenerMedidasDeProducto(idProducto).catch(() => []),
    ])
    const entry = { producto, medidas: medidasRaw }
    // Solo cachear si el producto existe (no guardar nulls)
    if (producto) productoCacheRef.current.set(key, entry)
    return entry
  }, [])

  // ── [OPTIMIZACIÓN 5] Carga de edición con fetches paralelos ──
  // Antes: obtenerClientePorId y obtenerDetallesDePresupuesto esperaban en
  // serie → tiempo total = A + B + C.
  // Ahora: cliente y detalles van en paralelo (no dependen entre sí) →
  // tiempo total = A + max(B, C), reduciendo la espera ~40%.
  useEffect(() => {
    if (!presupuestoEditar) return

    async function cargar() {
      try {
        // Presupuesto primero: necesitamos idCliente para el siguiente fetch
        const pres = await obtenerPresupuestoPorId(presupuestoEditar)
        if (!pres) { setInitError('No se encontró el presupuesto.'); return }

        // Cliente y detalles en paralelo — no dependen entre sí
        const [cliente, detalles] = await Promise.all([
          obtenerClientePorId(pres.idCliente),
          obtenerDetallesDePresupuesto(presupuestoEditar),
        ])

        const esExcepcionDB = pres.esExcepcion === 1
        const factorDB = pres.montoOriginal > 0 ? pres.monto / pres.montoOriginal : 1
        const pctDB = esExcepcionDB
          ? String(((1 - factorDB) * 100).toFixed(4).replace(/\.?0+$/, ''))
          : ''

        const itemsDB = detalles.map(d => ({
          _uid: Math.random().toString(36).slice(2),
          idProducto:     String(d.idProducto),
          nombreProducto: d.nombreProducto ?? '',
          cantidad:       String(d.cantidad),
          precioUnitario: d.precioUnitario,
          medida:         d.medida ?? null,
        }))

        setCliente(cliente)
        setMetodoPago(esExcepcionDB ? 'excepcion' : pres.metodoPago)
        setExcepcionSubMetodo(esExcepcionDB ? pres.metodoPago : 'efectivo')
        setExcepcionFactor(factorDB)
        setPctInit(pctDB)
        setItems(itemsDB.length ? itemsDB : [ITEM_EMPTY()])
        setInitDone(true)
      } catch (err) {
        setInitError(err.message || 'Error al cargar el presupuesto.')
      }
    }

    cargar()
  }, [presupuestoEditar])

  const esExcepcion = metodoPago === 'excepcion'
  const factorReal  = esExcepcion
    ? excepcionFactor
    : (METODOS_BASE.find(m => m.value === metodoPago)?.factor ?? 1)

  // ── [OPTIMIZACIÓN 3] Memoizar itemsConPromo y totales ──
  // Antes: se recalculaban en cada render, incluso cuando cambiaban estados
  // irrelevantes (error, toast, saving, stockErrors).
  // Ahora: solo se recalculan cuando cambian items o promoVigentes.
  const itemsConPromo = useMemo(() => items.map(item => {
    const { promoAplicada, precioFinal, ahorro } = calcularPromocionParaItem(
      {
        idProducto:     parseInt(item.idProducto) || null,
        idCategoria:    item.idCategoria ?? null,
        precioUnitario: parseFloat(item.precioUnitario) || 0,
        cantidad:       parseInt(item.cantidad) || 0,
      },
      promoVigentes
    )
    return {
      ...item,
      promoAplicada,
      precioConPromo: promoAplicada ? precioFinal : null,
      idPromocion:    promoAplicada?.idPromocion ?? null,
      ahorro,
    }
  }), [items, promoVigentes])

  // [OPTIMIZACIÓN 3] Totales memoizados — dependen de itemsConPromo y factorReal
  const { subtotalSinPromo, subtotalConPromo, ahorro, totalFinal } = useMemo(
    () => calcularTotales(itemsConPromo, factorReal),
    [itemsConPromo, factorReal]
  )

  // ── [OPTIMIZACIÓN 4] useCallback para handlers pasados a ItemRow ──
  // Evita que ItemRow reciba funciones nuevas en cada render del padre,
  // habilitando React.memo(ItemRow) en el futuro sin trabajo extra.
  const updateItem = useCallback((uid, key, val) => {
    setItems(prev => prev.map(it => it._uid === uid ? { ...it, [key]: val } : it))
    setError('')
  }, [])

  const addItem = useCallback(() => {
    setItems(prev => [...prev, ITEM_EMPTY()])
  }, [])

  const removeItem = useCallback((uid) => {
    setItems(prev => prev.filter(it => it._uid !== uid))
    setStockErrors(prev => { const n = { ...prev }; delete n[uid]; return n })
  }, [])

  const handleStockError = useCallback((uid, hasError) => {
    setStockErrors(prev => ({ ...prev, [uid]: hasError }))
  }, [])

  // [OPTIMIZACIÓN 4] onClearError estable para no recrearse en cada render
  const handleClearError = useCallback(() => setError(''), [])

  const guardandoRef = useRef(false)

  async function guardar() {
    if (guardandoRef.current) return
    guardandoRef.current = true

    setError('')
    setSaving(true)

    try {
      if (!cliente) {
        setError('Seleccioná un cliente antes de guardar.')
        return
      }

      const validItems = items.filter(it => it.idProducto && parseInt(it.cantidad) > 0)
      if (!validItems.length) { setError('Agregá al menos un producto con ID válido.'); return }

      // [OPTIMIZACIÓN 2] Reemplaza los 3 loops separados (existencia, precio, stock)
      // por un único loop que usa el caché compartido.
      // En el peor caso (ningún producto cacheado) hace N fetches en lugar de 3N.
      // En el caso normal (el usuario interactuó con todos los productos) hace 0 fetches.
      for (const it of validItems) {
        let prod, medidas
        try {
          const cached = await getProductoCached(parseInt(it.idProducto))
          prod   = cached.producto
          medidas = cached.medidas
        } catch {
          prod = null
        }

        if (!prod) {
          setError(`El producto ID ${it.idProducto} no existe en el inventario.`)
          return
        }
        if (prod.tieneMedidas && !it.medida) {
          setError(`Seleccioná una medida para el producto ID ${it.idProducto}.`)
          return
        }
        if (!parseFloat(it.precioUnitario)) {
          setError(`El producto "${it.nombreProducto || 'ID ' + it.idProducto}" no tiene precio definido. Asignalo desde Inventario.`)
          return
        }

        // Validación de stock
        let stockDisp = 0
        if (prod.tieneMedidas && it.medida) {
          const pm = (medidas ?? []).find(m => m.medida === it.medida)
          stockDisp = pm?.cantidad ?? 0
        } else if (!prod.tieneMedidas) {
          stockDisp = prod.cantidad ?? 0
        } else {
          continue
        }
        if (parseInt(it.cantidad) > stockDisp) {
          setError(`Stock insuficiente para "${prod.nombre}" (disponible: ${stockDisp}).`)
          return
        }
      }

      const fecha    = today()
      const metodoDb = esExcepcion ? excepcionSubMetodo : metodoPago

      const itemsConPromoValidos = itemsConPromo.filter(it => it.idProducto && parseInt(it.cantidad) > 0)

      const detalles = itemsConPromoValidos.map(it => {
        const precio      = parseFloat(it.precioUnitario) || 0
        const precioFinal = it.precioConPromo != null ? it.precioConPromo : precio
        const cantidad    = parseInt(it.cantidad)
        return {
          idProducto:      parseInt(it.idProducto),
          nombreProducto:  it.nombreProducto || null,
          medida:          it.medida || null,
          cantidad,
          precioUnitario:  precio,
          subtotal:        cantidad * precioFinal,
          precioConPromo:  it.precioConPromo ?? null,
          idPromocion:     it.idPromocion ?? null,
        }
      })

      const cabecera = {
        idCliente:       cliente.idCliente,
        nombreCliente:   cliente.nombre,
        apellidoCliente: cliente.apellido,
        fecha,
        metodoPago:      metodoDb,
        montoOriginal:   subtotalSinPromo,
        monto:           totalFinal,
        estado:          'borrador',
        esExcepcion:     esExcepcion ? 1 : 0,
      }

      let presupuestoReal

      if (modoEdicion) {
        await actualizarPresupuesto(presupuestoEditar, cabecera, detalles)
        presupuestoReal = presupuestoEditar
        if (onEditarVolver) { onEditarVolver(presupuestoReal); return }
      } else {
        const pres = await crearPresupuesto(cabecera, detalles)
        presupuestoReal = pres.idPresupuesto
      }

      const esCuenta = metodoPago === 'cc15' || metodoPago === 'cc30' ||
                       (esExcepcion && (excepcionSubMetodo === 'cc15' || excepcionSubMetodo === 'cc30'))

      const metodoLabel = esExcepcion
        ? `Excepción (${METODOS_BASE.find(m => m.value === excepcionSubMetodo)?.label})`
        : METODOS_BASE.find(m => m.value === metodoPago)?.label ?? metodoPago

      setGuardado({ idPresupuesto: presupuestoReal, esCuenta, totalFinal, metodoLabel, clienteNombre: `${cliente.nombre} ${cliente.apellido}`, clienteId: cliente.idCliente })
    } catch (err) {
      setError(err.message || 'Error al guardar el presupuesto.')
    } finally {
      setSaving(false)
      guardandoRef.current = false
    }
  }

  function nuevo() {
    // [OPTIMIZACIÓN 2] Limpiar caché al iniciar un presupuesto nuevo para
    // no trabajar con datos de stock desactualizados de la sesión anterior.
    productoCacheRef.current.clear()
    setCliente(null); setMetodoPago('efectivo'); setItems([ITEM_EMPTY()])
    setGuardado(null); setError(''); setExcepcionFactor(1); setExcepcionSubMetodo('efectivo')
  }

  // ── Estados de carga ──
  if (modoEdicion && !initDone) {
    if (initError) return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <AlertCircle size={16} />{initError}
        </div>
      </div>
    )
    // [OPTIMIZACIÓN 6] Skeleton en lugar de texto plano
    return <PresupuestadorSkeleton />
  }

  // ── Pantalla de éxito ──
  if (guardado) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
        <div className="relative max-w-lg w-full bg-surface-800 border border-surface-700 rounded-2xl p-10 pt-8 space-y-4 text-center animate-slide-up">
          <button onClick={nuevo} className="absolute top-3 right-3 p-1 text-surface-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
          <CheckCircle2 size={52} className="text-emerald-400 mx-auto" />
          <h2 className="font-display text-3xl text-white tracking-widest">GUARDADO</h2>
          <div className="bg-surface-700/60 border border-surface-600 rounded-xl px-5 py-4 text-left space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-surface-400 text-xs uppercase tracking-widest font-body">Presupuesto</span>
              <span className="text-brand-400 font-mono font-bold">#{guardado.idPresupuesto}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-surface-400 text-xs uppercase tracking-widest font-body">Cliente</span>
              <span className="text-white text-sm font-body">{guardado.clienteNombre}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-surface-400 text-xs uppercase tracking-widest font-body">Total</span>
              <span className="text-brand-400 font-mono font-bold">{fmt(guardado.totalFinal)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-surface-400 text-xs uppercase tracking-widest font-body">Método</span>
              <span className="text-surface-200 text-sm font-body">{guardado.metodoLabel}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <Button icon={Download} className="w-full" onClick={() => generarPDFPresupuesto(guardado.idPresupuesto)}>
              Descargar PDF del Presupuesto
            </Button>
            <Button icon={FileText} variant="secondary" className="w-full" onClick={() => {
              if (onVerHistorial) onVerHistorial(guardado.idPresupuesto)
              else navigate('/historial', { state: { verPresupuesto: guardado.idPresupuesto } })
            }}>
              Ver presupuesto
            </Button>
            <Button variant="secondary" className="w-full" onClick={nuevo}>
              Nuevo Presupuesto
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const metodoLabel = esExcepcion ? 'Excepción' : METODOS_BASE.find(m => m.value === metodoPago)?.label ?? ''

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      {modoEdicion && (
        <div className="flex items-center gap-3">
          <button onClick={() => onEditarVolver && onEditarVolver(presupuestoEditar)}
            className="flex items-center gap-2 text-surface-400 hover:text-white text-sm font-body transition-colors">
            <ArrowLeft size={16} />Volver al historial
          </button>
          <span className="text-surface-600">/</span>
          <span className="text-surface-300 text-sm font-body">
            Editando presupuesto <span className="text-brand-400 font-mono">#{presupuestoEditar}</span>
          </span>
        </div>
      )}
      <PageHeader title={modoEdicion ? 'Editar Presupuesto' : 'Presupuestador'} subtitle={modoEdicion ? `Modificando #${presupuestoEditar}` : 'Nuevo presupuesto'} />

      {/* Cabecera */}
      <Card className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          <div className="md:col-span-2">
            <ClienteSelector value={cliente} onChange={v => { setCliente(v); setError('') }} onToast={setToast} />
          </div>
          <div>
            <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1">Fecha</label>
            <div className="bg-surface-700 border border-surface-600 rounded-xl px-4 py-2.5 text-surface-300 text-sm font-mono">
              {today()}
            </div>
          </div>
        </div>

        <MetodoPagoSelector
          metodoPago={metodoPago}
          onMetodoPago={v => { setMetodoPago(v); setError('') }}
          excepcionFactor={excepcionFactor}
          onExcepcionFactor={setExcepcionFactor}
          excepcionSubMetodo={excepcionSubMetodo}
          onExcepcionSubMetodo={setExcepcionSubMetodo}
          initialPct={pctInit}
        />
      </Card>

      {/* Tabla */}
      <Card className="overflow-visible">
        <div className="px-6 py-4 border-b border-surface-700 flex items-center justify-between">
          <h2 className="font-body font-semibold text-white text-sm">Productos</h2>
          <Button size="sm" icon={Plus} onClick={addItem}>Agregar ítem</Button>
        </div>
        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700">
                {['#','Cant.','Nombre','ID','Medida','Precio Unit.','Subtotal',''].map(h => (
                  <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-2 first:px-3 font-body">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <ItemRow
                  key={item._uid}
                  uid={item._uid}
                  item={item}
                  itemConPromo={itemsConPromo[idx]}
                  index={idx}
                  onUpdate={updateItem}
                  onRemove={removeItem}
                  onClearError={handleClearError}
                  onStockError={handleStockError}
                  // [OPTIMIZACIÓN 2] Pasar el helper de caché a cada fila
                  getProductoCached={getProductoCached}
                />
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

      {/* Totales */}
      <Card className="p-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2 text-sm font-body">

            {/* Precio lista */}
            <div className="flex justify-between gap-12">
              <span className="text-surface-400">Subtotal (precio lista):</span>
              <span className="text-surface-200 font-mono">{fmt(subtotalSinPromo)}</span>
            </div>

            {/* Ahorro por promociones — solo si hay diferencia */}
            {ahorro > 0 && (
              <div className="flex justify-between gap-12 items-center">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <Tag size={12} />
                  Ahorro por promociones:
                </span>
                <span className="text-emerald-400 font-mono font-medium">
                  − {fmt(ahorro)}
                </span>
              </div>
            )}

            {/* Ajuste por método de pago */}
            <div className="flex justify-between gap-12">
              <span className="text-surface-400">Ajuste ({metodoLabel}):</span>
              <span className={`font-mono font-medium ${factorReal < 1 ? 'text-emerald-400' : factorReal > 1 ? 'text-red-400' : 'text-surface-400'}`}>
                {factorReal === 1 ? '—' : factorReal < 1
                  ? `- ${fmt(subtotalConPromo - totalFinal)}`
                  : `+ ${fmt(totalFinal - subtotalConPromo)}`}
              </span>
            </div>

            <div className="border-t border-surface-700 pt-2 flex justify-between gap-12">
              <span className="text-white font-semibold">Total a pagar:</span>
              <span className="text-brand-400 font-mono font-bold text-lg">{fmt(totalFinal)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2 items-end">
            <div className="h-9 flex items-center justify-end">
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/30
                                rounded-xl px-3 py-2 max-w-xs">
                  <AlertCircle size={14} className="flex-shrink-0" />{error}
                </div>
              )}
            </div>
            <Button size="lg" onClick={guardar} disabled={saving} className="w-full md:w-auto">
              {saving ? 'Guardando…' : modoEdicion ? 'Guardar Cambios' : 'Guardar Presupuesto'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
