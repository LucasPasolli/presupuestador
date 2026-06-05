// src/pages/Presupuestador.jsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { query, run } from '../lib/database'
import { Button, Card, PageHeader, Modal, Input } from '../components/ui'
import { Plus, Trash2, Search, UserPlus, CheckCircle2, AlertCircle, Download, FileText, ArrowLeft } from 'lucide-react'

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

// Elimina tildes para búsquedas insensibles a acentos
function norm(s) {
  return (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// Capitaliza la primera letra de un string (igual que ABMC)
const cap = (s) => s ? s.trim().charAt(0).toUpperCase() + s.trim().slice(1) : ''

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

// ─── Modal nuevo cliente ────────────────────────────────────────────────────

function NuevoClienteModal({ open, onClose, onCreated }) {
  const empty = { nombre: '', apellido: '', cuit: '', domicilio: '', telefono: '', mail: '', apodo: '', nombreComercio: '' }
  const [form, setForm]     = useState(empty)
  const [errors, setErrors] = useState({})

  useEffect(() => { if (!open) { setForm(empty); setErrors({}) } }, [open])

  function set(k, v) { setForm(p => ({ ...p, [k]: v })) }

  // CUIT: dígitos y guiones. Teléfono: solo dígitos. Igual que ABMC.
  function setField(k, v) {
    let val = v
    if (k === 'cuit')     val = v.replace(/[^0-9-]/g, '')
    if (k === 'telefono') val = v.replace(/[^0-9]/g, '')
    setForm(p => ({ ...p, [k]: val }))
  }

  function guardar() {
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

    const id = run(
      `INSERT INTO Cliente (nombre,apellido,cuit,domicilio,telefono,mail,apodo,nombreComercio,activo)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      [nombre, apellido, form.cuit, domicilio,
       form.telefono, form.mail, apodo, nombreComercio]
    )
    const cliente = query('SELECT * FROM Cliente WHERE idCliente = ?', [id])[0]
    // Cierra primero el modal, luego notifica al padre — así el toast se monta en un árbol vivo
    onClose()
    setTimeout(() => onCreated(cliente), 0)
  }

  return (
    <Modal open={open} onClose={onClose} title="Nuevo Cliente">
      <div className="space-y-4">
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
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" onClick={guardar}>Crear Cliente</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Buscador de clientes ───────────────────────────────────────────────────

function ClienteSelector({ value, onChange, onToast }) {
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

  function buscar(text) {
    setSearch(text)
    if (!text.trim()) { setResults([]); setShowDrop(false); return }
    const normText = norm(text.trim())
    // Solo clientes activos (activo = 1); los borrados desde ABMC tienen activo = 0
    const byId = query(`SELECT * FROM Cliente WHERE CAST(idCliente AS TEXT) = ? AND activo = 1 LIMIT 1`, [text.trim()])
    const byName = query(`SELECT * FROM Cliente WHERE activo = 1 LIMIT 300`)
      .filter(c => norm(c.nombre).includes(normText) || norm(c.apellido).includes(normText)
               || norm(c.apodo ?? '').includes(normText) || norm(c.nombreComercio ?? '').includes(normText))
    // Unir sin duplicados
    const seen = new Set(byId.map(c => c.idCliente))
    const rows = [...byId, ...byName.filter(c => !seen.has(c.idCliente))].slice(0, 8)
    setResults(rows)
    setShowDrop(true)
  }

  function seleccionar(c) {
    onChange(c)
    setSearch(`${c.nombre} ${c.apellido}`)
    setShowDrop(false)
  }

  function limpiar() { onChange(null); setSearch(''); setResults([]) }

  function abrirNuevo() {
    setShowDrop(false)
    // pequeño delay para que el dropdown cierre visualmente antes de abrir el modal
    setTimeout(() => setShowNew(true), 50)
  }

  // onCreated recibe el cliente ya guardado → selecciona + dispara toast
  function handleCreated(cliente) {
    seleccionar(cliente)
    // El toast se dispara aquí, en el padre, no dentro del modal que se desmonta
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
            <input value={search} onChange={e => buscar(e.target.value)} onFocus={() => search && setShowDrop(true)}
              placeholder="Buscá por nombre o ID..."
              className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2.5
                         text-white text-sm font-body placeholder-surface-500
                         focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 transition-all" />
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

// Dropdown renderizado inline — ver ItemRow

// ─── Fila de ítem ───────────────────────────────────────────────────────────

function ItemRow({ uid, item, index, onUpdate, onRemove, onClearError, onStockError }) {
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
  const cantRef   = useRef(null)
  const wrapRef   = useRef(null)
  const inputRef  = useRef(null)
  const priceRef  = useRef(null)
  const [showPriceTooltip, setShowPriceTooltip] = useState(false)
  const [priceTooltipPos,  setPriceTooltipPos]  = useState({ top: 0, left: 0 })

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

  // Recalcula posición del dropdown cuando se muestra o al hacer scroll/resize
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

  // Cargar medidas cuando cambia el producto seleccionado
  useEffect(() => {
    if (!item.idProducto) { setMedidas([]); return }
    const prod = query('SELECT * FROM Producto WHERE idProducto = ?', [parseInt(item.idProducto)])[0]
    if (prod?.tieneMedidas) {
      const ms = query('SELECT medida FROM ProductoMedida WHERE idProducto = ? ORDER BY medida', [parseInt(item.idProducto)])
      setMedidas(ms.map(r => r.medida))
    } else {
      setMedidas([])
      onUpdate(uid, 'medida', null)
    }
  }, [item.idProducto])

  function checkStock(idProducto, medida, cantidad) {
    if (!idProducto || !cantidad || parseInt(cantidad) <= 0) {
      setStockWarning(''); onStockError(uid, false); return
    }
    const prod = query('SELECT * FROM Producto WHERE idProducto = ?', [parseInt(idProducto)])[0]
    if (!prod) { setStockWarning(''); onStockError(uid, false); return }
    let stockDisp = 0
    if (prod.tieneMedidas && medida) {
      const pm = query('SELECT cantidad FROM ProductoMedida WHERE idProducto = ? AND medida = ?', [parseInt(idProducto), medida])[0]
      stockDisp = pm?.cantidad ?? 0
    } else if (!prod.tieneMedidas) {
      stockDisp = prod.cantidad ?? 0
    } else {
      setStockWarning(''); onStockError(uid, false); return
    }
    const pedido = parseInt(cantidad) || 0
    if (pedido > stockDisp) {
      setStockWarning(`Stock Disponible: ${stockDisp}.`)
      onStockError(uid, true)
    } else {
      setStockWarning('')
      onStockError(uid, false)
    }
  }

  function buscarPorNombre(text) {
    setNombreSearch(text)
    onClearError()
    onUpdate(uid, 'nombreProducto', text)
    // Si había un producto seleccionado y el usuario modifica el nombre, limpiar el ID y precio
    if (item.idProducto) {
      onUpdate(uid, 'idProducto', '')
      onUpdate(uid, 'precioUnitario', 0)
      onUpdate(uid, 'medida', null)
      setStockWarning('')
      onStockError(uid, false)
      setPriceWarning(false)
    }
    if (!text.trim()) { setNombreResults([]); setShowDrop(false); return }
    const normText = norm(text.trim())
    const rows = query(`SELECT * FROM Producto LIMIT 2000`)
      .filter(p => norm(p.nombre).includes(normText))
      .slice(0, 12)
    setNombreResults(rows)
    setShowDrop(true)
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

  function handleIdChange(val) {
    const clean = val.replace(/\D/g, '')
    onClearError()
    onUpdate(uid, 'idProducto', clean)
    if (clean) {
      const p = query('SELECT * FROM Producto WHERE idProducto = ?', [parseInt(clean)])[0]
      if (p) {
        setNombreSearch(p.nombre)
        onUpdate(uid, 'nombreProducto', p.nombre)
        onUpdate(uid, 'precioUnitario', p.precioUnitario)
        onUpdate(uid, 'medida', null)
        setIdError('')
        setPriceWarning(!p.precioUnitario)
        checkStock(p.idProducto, null, item.cantidad)
      } else {
        // ID no existe — limpiamos nombre y precio, no rellenamos nada
        setNombreSearch('')
        onUpdate(uid, 'nombreProducto', '')
        onUpdate(uid, 'precioUnitario', 0)
        onUpdate(uid, 'medida', null)
        setIdError(`Sin producto con ID ${clean}`)
      }
    } else {
      // ID vacío → limpiar todo el producto
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

      {/* Nombre — dropdown renderizado via portal para escapar del overflow de la tabla */}
      <td className="py-2 px-2 min-w-[200px]" ref={wrapRef}>
        <input ref={inputRef} value={nombreSearch} onChange={e => buscarPorNombre(e.target.value)}
          placeholder="Nombre del producto..."
          className={cell + ' w-full'} />
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

      {/* Precio — read only */}
      <td className="py-2 px-2 w-36">
        <div ref={priceRef}
             className={`w-full rounded-lg px-2 py-1.5 text-sm font-mono cursor-not-allowed select-none
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
        {priceWarning && showPriceTooltip && createPortal(
          <div style={{ position: 'absolute', top: priceTooltipPos.top, left: priceTooltipPos.left, zIndex: 9999, pointerEvents: 'none' }}
               className="bg-yellow-900/95 border border-yellow-500/60 text-yellow-200 text-[11px] font-body
                          rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap flex items-center gap-1.5">
            <span>⚠</span><span>Sin precio definido — asignarlo desde Inventario</span>
          </div>,
          document.body
        )}
      </td>

      {/* Subtotal */}
      <td className="py-2 px-3 text-right w-36">
        <span className="text-surface-200 text-sm font-mono">
          {fmt((parseInt(item.cantidad) || 0) * (parseFloat(item.precioUnitario) || 0))}
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

// ─── Componente principal ───────────────────────────────────────────────────

// ─── Generador PDF de presupuesto ──────────────────────────────────────────

async function generarPDFPresupuesto(idPresupuesto) {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const pres = query('SELECT p.*, c.nombre AS cNombre, c.apellido AS cApellido, c.cuit, c.telefono, c.mail FROM Presupuesto p JOIN Cliente c ON c.idCliente = p.idCliente WHERE p.idPresupuesto = ?', [idPresupuesto])[0]
  if (!pres) return

  const detalles = query(`
    SELECT dp.*, pr.nombre AS nombreProducto
    FROM DetallePresupuesto dp
    LEFT JOIN Producto pr ON pr.idProducto = dp.idProducto
    WHERE dp.idPresupuesto = ?
    ORDER BY dp.idDetalle
  `, [idPresupuesto])

  const metodoLabel = { efectivo:'Efectivo', transferencia:'Transferencia', cc15:'CC 15 días', cc30:'CC 30 días' }
  const fmtFecha = iso => { if(!iso) return '—'; const [y,m,d]=iso.split('-'); return `${d}/${m}/${y}` }

  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const PW   = 210
  const ML   = 14

  // Encabezado naranja
  doc.setFillColor(200, 200, 200)
  doc.rect(0, 0, PW, 18, 'F')
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(50,50,50)
  doc.text('CLAUDIO RER GROUP', ML, 12)

  // Datos cabecera
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(50,50,50)
  doc.text(`PRESUPUESTO #${idPresupuesto}`, ML, 28)
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(100,100,100)
  doc.text(`Fecha: ${fmtFecha(pres.fecha)}`, ML, 34)
  doc.text(`Método de pago: ${metodoLabel[pres.metodoPago] ?? pres.metodoPago}`, ML, 39)

  // Datos cliente
  doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(50,50,50)
  doc.text('CLIENTE', PW - ML - 70, 26)
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(100,100,100)
  doc.text(`${pres.cNombre} ${pres.cApellido}`, PW - ML - 70, 32)
  if (pres.cuit)    doc.text(`CUIT: ${pres.cuit}`,       PW - ML - 70, 37)
  if (pres.telefono) doc.text(`Tel: ${pres.telefono}`,    PW - ML - 70, 42)
  if (pres.mail)    doc.text(pres.mail,                   PW - ML - 70, 47)

  // Tabla de ítems
  autoTable(doc, {
    startY: 55,
    margin: { left: ML, right: ML },
    head: [['Producto', 'Medida', 'Cant.', 'Precio Unit.', 'Subtotal']],
    body: detalles.map(d => [
      d.nombreProducto ?? `#${d.idProducto}`,
      d.medida ?? '—',
      d.cantidad,
      fmt(d.precioUnitario),
      fmt(d.subtotal),
    ]),
    styles:     { fontSize: 8, cellPadding: 2.5, textColor: [50,50,50] },
    headStyles: { fillColor: [200,200,200], textColor: [60,60,60], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245,245,245] },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 22, halign: 'center' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 34, halign: 'right' },
      4: { cellWidth: 34, halign: 'right' },
    },
  })

  const finalY = doc.lastAutoTable.finalY + 6

  // Totales
  doc.setDrawColor(220,220,220); doc.line(ML, finalY, PW - ML, finalY)
  doc.setFontSize(8.5); doc.setFont('helvetica','normal'); doc.setTextColor(100,100,100)
  doc.text('Subtotal (precio lista):', PW - ML - 70, finalY + 7)
  doc.setFont('helvetica','normal'); doc.setTextColor(50,50,50)
  doc.text(fmt(pres.montoOriginal), PW - ML, finalY + 7, { align: 'right' })

  const ajuste = pres.monto - pres.montoOriginal
  if (ajuste !== 0) {
    // Calcular el porcentaje real a partir del factor aplicado
    const factorAplicado = pres.montoOriginal > 0 ? pres.monto / pres.montoOriginal : 1
    const pctDiff = ((factorAplicado - 1) * 100)
    const pctLabel = pctDiff < 0
      ? `${Math.abs(pctDiff).toFixed(1)}% descuento`
      : `${pctDiff.toFixed(1)}% recargo`
    doc.setFontSize(8.5); doc.setTextColor(100,100,100)
    doc.text(`Ajuste (${pctLabel}):`, PW - ML - 70, finalY + 13)
    doc.setTextColor(50,50,50)
    doc.text(`${ajuste < 0 ? '- ' : '+ '}${fmt(Math.abs(ajuste))}`, PW - ML, finalY + 13, { align: 'right' })
  }

  doc.setFillColor(200,200,200)
  doc.roundedRect(ML, finalY + 18, PW - ML*2, 12, 2, 2, 'F')
  doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(50,50,50)
  doc.text('TOTAL', ML + 4, finalY + 26)
  doc.text(fmt(pres.monto), PW - ML - 4, finalY + 26, { align: 'right' })

  doc.save(`Presupuesto_${idPresupuesto}_${pres.cNombre}_${pres.cApellido}.pdf`)
}

const ITEM_EMPTY = () => ({ _uid: Math.random().toString(36).slice(2), idProducto: '', nombreProducto: '', cantidad: 1, precioUnitario: 0, medida: null })

export default function Presupuestador({ presupuestoEditar, onEditarVolver }) {
  // ── Modo edición: cargar datos existentes ──
  const modoEdicion = !!presupuestoEditar

  function cargarDatosEdicion() {
    if (!presupuestoEditar) return {}
    const pres = query(
      'SELECT p.*, c.nombre, c.apellido, c.cuit, c.domicilio, c.telefono, c.mail FROM Presupuesto p JOIN Cliente c ON c.idCliente = p.idCliente WHERE p.idPresupuesto = ?',
      [presupuestoEditar]
    )[0]
    if (!pres) return {}

    const detalles = query(
      `SELECT dp.*, pr.nombre AS nombreProducto FROM DetallePresupuesto dp
       LEFT JOIN Producto pr ON pr.idProducto = dp.idProducto
       WHERE dp.idPresupuesto = ? ORDER BY dp.idDetalle`,
      [presupuestoEditar]
    )

    const clienteObj = {
      idCliente: pres.idCliente,
      nombre: pres.nombre,
      apellido: pres.apellido,
      cuit: pres.cuit,
      domicilio: pres.domicilio,
      telefono: pres.telefono,
      mail: pres.mail,
    }

    const esExcepcionDB = pres.esExcepcion === 1
    const factorDB = pres.montoOriginal > 0 ? pres.monto / pres.montoOriginal : 1
    // Convertir factor → porcentaje para el campo de excepción: factor=0.92 → pct='8'
    const pctDB = esExcepcionDB ? String(((1 - factorDB) * 100).toFixed(4).replace(/\.?0+$/, '')) : ''

    const itemsDB = detalles.map(d => ({
      _uid: Math.random().toString(36).slice(2),
      idProducto: String(d.idProducto),
      nombreProducto: d.nombreProducto ?? '',
      cantidad: String(d.cantidad),
      precioUnitario: d.precioUnitario,
      medida: d.medida ?? null,
    }))

    return {
      clienteObj,
      metodoPagoInit: esExcepcionDB ? 'excepcion' : pres.metodoPago,
      excepcionSubMetodoInit: esExcepcionDB ? pres.metodoPago : 'efectivo',
      excepcionFactorInit: factorDB,
      pctInit: pctDB,
      itemsInit: itemsDB.length ? itemsDB : [ITEM_EMPTY()],
    }
  }

  const init = cargarDatosEdicion()

  const [cliente,            setCliente]            = useState(init.clienteObj ?? null)
  const [metodoPago,         setMetodoPago]          = useState(init.metodoPagoInit ?? 'efectivo')
  const [excepcionFactor,    setExcepcionFactor]     = useState(init.excepcionFactorInit ?? 1)
  const [excepcionSubMetodo, setExcepcionSubMetodo]  = useState(init.excepcionSubMetodoInit ?? 'efectivo')
  const [items,              setItems]               = useState(init.itemsInit ?? [ITEM_EMPTY()])
  const [pctInit]                                    = useState(init.pctInit ?? '')
  const [guardado,           setGuardado]            = useState(null)
  const [error,              setError]               = useState('')
  const [toast,              setToast]               = useState('')
  const [stockErrors,        setStockErrors]         = useState({})  // { idx: bool }

  const esExcepcion = metodoPago === 'excepcion'
  const factorReal  = esExcepcion
    ? excepcionFactor
    : (METODOS_BASE.find(m => m.value === metodoPago)?.factor ?? 1)

  const subtotalOriginal = items.reduce((acc, it) =>
    acc + (parseInt(it.cantidad) || 0) * (parseFloat(it.precioUnitario) || 0), 0)
  const totalFinal = subtotalOriginal * factorReal

  function updateItem(uid, key, val) {
    setItems(prev => prev.map(it => it._uid === uid ? { ...it, [key]: val } : it))
    setError('')
  }
  function addItem() { setItems(prev => [...prev, ITEM_EMPTY()]) }
  function removeItem(uid) {
    setItems(prev => prev.filter(it => it._uid !== uid))
    setStockErrors(prev => { const n = { ...prev }; delete n[uid]; return n })
  }
  function handleStockError(uid, hasError) {
    setStockErrors(prev => ({ ...prev, [uid]: hasError }))
  }

  function guardar() {
    setError('')
    if (!cliente) { setError('Seleccioná un cliente antes de guardar.'); return }

    const validItems = items.filter(it => it.idProducto && parseInt(it.cantidad) > 0)
    if (!validItems.length) { setError('Agregá al menos un producto con ID válido.'); return }

    for (const it of validItems) {
      const existe = query('SELECT idProducto, tieneMedidas FROM Producto WHERE idProducto = ?', [parseInt(it.idProducto)])[0]
      if (!existe) { setError(`El producto ID ${it.idProducto} no existe en el inventario.`); return }
      if (existe.tieneMedidas && !it.medida) { setError(`Seleccioná una medida para el producto ID ${it.idProducto}.`); return }
    }

    // Verificar que todos los ítems tengan precio definido
    for (const it of validItems) {
      if (!parseFloat(it.precioUnitario)) {
        setError(`El producto "${it.nombreProducto || 'ID ' + it.idProducto}" no tiene precio definido. Asignalo desde Inventario.`)
        return
      }
    }

    // Verificar stock suficiente para todos los ítems
    for (const it of validItems) {
      const prod = query('SELECT * FROM Producto WHERE idProducto = ?', [parseInt(it.idProducto)])[0]
      if (!prod) continue
      let stockDisp = 0
      if (prod.tieneMedidas && it.medida) {
        const pm = query('SELECT cantidad FROM ProductoMedida WHERE idProducto = ? AND medida = ?', [parseInt(it.idProducto), it.medida])[0]
        stockDisp = pm?.cantidad ?? 0
      } else if (!prod.tieneMedidas) {
        stockDisp = prod.cantidad ?? 0
      } else continue
      if (parseInt(it.cantidad) > stockDisp) {
        setError(`Stock insuficiente de algun producto.`)
        return
      }
    }

    const fecha = today()
    // Para excepción guardamos el sub-método base en la columna metodoPago de la DB
    const metodoDb = esExcepcion ? excepcionSubMetodo : metodoPago

    let presupuestoReal

    if (modoEdicion) {
      // ── UPDATE: sobreescribir el presupuesto existente ──
      run(
        `UPDATE Presupuesto SET idCliente=?, nombreCliente=?, apellidoCliente=?, metodoPago=?, montoOriginal=?, monto=?, esExcepcion=? WHERE idPresupuesto=?`,
        [cliente.idCliente, cliente.nombre, cliente.apellido, metodoDb, subtotalOriginal, totalFinal, esExcepcion ? 1 : 0, presupuestoEditar]
      )
      // Reemplazar todos los detalles
      run(`DELETE FROM DetallePresupuesto WHERE idPresupuesto = ?`, [presupuestoEditar])
      for (const it of validItems) {
        const precio   = parseFloat(it.precioUnitario) || 0
        const cantidad = parseInt(it.cantidad)
        run(
          `INSERT INTO DetallePresupuesto (idPresupuesto, idProducto, nombreProducto, medida, cantidad, precioUnitario, subtotal) VALUES (?,?,?,?,?,?,?)`,
          [presupuestoEditar, parseInt(it.idProducto), it.nombreProducto || null, it.medida || null, cantidad, precio, cantidad * precio]
        )
      }
      presupuestoReal = presupuestoEditar
      // Volver al historial/detalle directamente
      if (onEditarVolver) { onEditarVolver(presupuestoReal); return }
    } else {
      // ── INSERT: presupuesto nuevo ──
      const idPresupuesto = run(
        `INSERT INTO Presupuesto (idCliente, nombreCliente, apellidoCliente, fecha, metodoPago, montoOriginal, monto, estado, esExcepcion) VALUES (?,?,?,?,?,?,?,'borrador',?)`,
        [cliente.idCliente, cliente.nombre, cliente.apellido, fecha, metodoDb, subtotalOriginal, totalFinal, esExcepcion ? 1 : 0]
      )
      // Verificamos leyendo el ID real de la DB por si last_insert_rowid fue afectado
      presupuestoReal = query('SELECT MAX(idPresupuesto) as id FROM Presupuesto WHERE idCliente = ? AND fecha = ?', [cliente.idCliente, fecha])[0]?.id ?? idPresupuesto

      for (const it of validItems) {
        const precio   = parseFloat(it.precioUnitario) || 0
        const cantidad = parseInt(it.cantidad)
        run(
          `INSERT INTO DetallePresupuesto (idPresupuesto, idProducto, nombreProducto, medida, cantidad, precioUnitario, subtotal) VALUES (?,?,?,?,?,?,?)`,
          [idPresupuesto, parseInt(it.idProducto), it.nombreProducto || null, it.medida || null, cantidad, precio, cantidad * precio]
        )
      }
    }

    // El saldo CC se crea solo cuando el presupuesto sea APROBADO desde Historial
    const esCuenta = metodoPago === 'cc15' || metodoPago === 'cc30' ||
                     (esExcepcion && (excepcionSubMetodo === 'cc15' || excepcionSubMetodo === 'cc30'))

    // Capturamos todos los datos necesarios para la pantalla de éxito ANTES de resetear
    const metodoLabel = esExcepcion
      ? `Excepción (${METODOS_BASE.find(m => m.value === excepcionSubMetodo)?.label})`
      : METODOS_BASE.find(m => m.value === metodoPago)?.label ?? metodoPago

    setGuardado({ idPresupuesto: presupuestoReal, esCuenta, totalFinal, metodoLabel, clienteNombre: `${cliente.nombre} ${cliente.apellido}`, clienteId: cliente.idCliente })
  }

  function nuevo() {
    setCliente(null); setMetodoPago('efectivo'); setItems([ITEM_EMPTY()])
    setGuardado(null); setError(''); setExcepcionFactor(1); setExcepcionSubMetodo('efectivo')
  }

  // ── Pantalla de éxito ──
  if (guardado) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
        <div className="max-w-lg w-full bg-surface-800 border border-surface-700 rounded-2xl p-10 space-y-4 text-center animate-slide-up">
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
                <ItemRow key={item._uid} uid={item._uid} item={item} index={idx} onUpdate={updateItem} onRemove={removeItem} onClearError={() => setError('')} onStockError={handleStockError} />
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
            <div className="flex justify-between gap-12">
              <span className="text-surface-400">Subtotal (precio lista):</span>
              <span className="text-surface-200 font-mono">{fmt(subtotalOriginal)}</span>
            </div>
            <div className="flex justify-between gap-12">
              <span className="text-surface-400">Ajuste ({metodoLabel}):</span>
              <span className={`font-mono font-medium ${factorReal < 1 ? 'text-emerald-400' : factorReal > 1 ? 'text-red-400' : 'text-surface-400'}`}>
                {factorReal === 1 ? '—' : factorReal < 1
                  ? `- ${fmt(subtotalOriginal - totalFinal)}`
                  : `+ ${fmt(totalFinal - subtotalOriginal)}`}
              </span>
            </div>
            <div className="border-t border-surface-700 pt-2 flex justify-between gap-12">
              <span className="text-white font-semibold">Total a pagar:</span>
              <span className="text-brand-400 font-mono font-bold text-lg">{fmt(totalFinal)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2 items-end">
            {/* Área de error con altura reservada — el botón nunca se mueve */}
            <div className="h-9 flex items-center justify-end">
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/30
                                rounded-xl px-3 py-2 max-w-xs">
                  <AlertCircle size={14} className="flex-shrink-0" />{error}
                </div>
              )}
            </div>
            <Button size="lg" onClick={guardar} className="w-full md:w-auto">{modoEdicion ? 'Guardar Cambios' : 'Guardar Presupuesto'}</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
