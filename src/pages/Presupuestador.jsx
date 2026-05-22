// src/pages/Presupuestador.jsx
import { useState, useEffect, useRef } from 'react'
import { query, run } from '../lib/database'
import { Button, Card, PageHeader, Modal, Input, Select } from '../components/ui'
import { Plus, Trash2, Search, UserPlus, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react'

// ─── Constantes ────────────────────────────────────────────────────────────

const MEDIDAS_VALIDAS = ['standard','0.25','0.50','0.75','1.00','1.25','1.50','1.75','2.00']

const METODOS_BASE = [
  { value: 'efectivo',      label: 'Efectivo',                factor: 0.95,  texto: '5% descuento' },
  { value: 'transferencia', label: 'Transferencia',            factor: 0.95,  texto: '5% descuento' },
  { value: 'cc15',          label: 'Cta. Cte. 15 días',        factor: 1.00,  texto: 'Precio de lista' },
  { value: 'cc30',          label: 'Cta. Cte. 30 días',        factor: 1.105, texto: '10.5% recargo' },
]

function today() {
  return new Date().toISOString().slice(0, 10)
}

function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)
}

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

// ─── Modal nuevo cliente ────────────────────────────────────────────────────

function NuevoClienteModal({ open, onClose, onCreated }) {
  const empty = { nombre: '', apellido: '', cuit: '', domicilio: '', telefono: '', mail: '' }
  const [form,   setForm]   = useState(empty)
  const [errors, setErrors] = useState({})

  function set(k, v) { setForm((p) => ({ ...p, [k]: v })) }

  function validate() {
    const e = {}
    if (!form.nombre.trim())   e.nombre   = 'Requerido'
    if (!form.apellido.trim()) e.apellido = 'Requerido'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function guardar() {
    if (!validate()) return
    const id = run(
      `INSERT INTO Cliente (nombre, apellido, cuit, domicilio, telefono, mail) VALUES (?,?,?,?,?,?)`,
      [form.nombre.trim(), form.apellido.trim(), form.cuit, form.domicilio, form.telefono, form.mail]
    )
    const cliente = query('SELECT * FROM Cliente WHERE idCliente = ?', [id])[0]
    onCreated(cliente)   // dispara toast en el padre
    setForm(empty)
    setErrors({})
    onClose()
  }

  function cerrar() { setForm(empty); setErrors({}); onClose() }

  return (
    <Modal open={open} onClose={cerrar} title="Nuevo Cliente">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Nombre *"   value={form.nombre}   onChange={(e) => set('nombre', e.target.value)}   error={errors.nombre}   placeholder="Juan" />
          <Input label="Apellido *" value={form.apellido} onChange={(e) => set('apellido', e.target.value)} error={errors.apellido} placeholder="García" />
        </div>
        <Input label="CUIT"      value={form.cuit}      onChange={(e) => set('cuit', e.target.value)}      placeholder="20-12345678-9" />
        <Input label="Domicilio" value={form.domicilio}  onChange={(e) => set('domicilio', e.target.value)} placeholder="Av. Siempreviva 742" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Teléfono" value={form.telefono} onChange={(e) => set('telefono', e.target.value)} placeholder="351 000-0000" />
          <Input label="Email"    value={form.mail}      onChange={(e) => set('mail', e.target.value)}     placeholder="email@ejemplo.com" />
        </div>
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" className="flex-1" onClick={cerrar}>Cancelar</Button>
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
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowDrop(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function buscar(text) {
    setSearch(text)
    if (!text.trim()) { setResults([]); setShowDrop(false); return }
    const rows = query(
      `SELECT * FROM Cliente WHERE nombre LIKE ? OR apellido LIKE ? OR CAST(idCliente AS TEXT) = ? LIMIT 8`,
      [`%${text}%`, `%${text}%`, text.trim()]
    )
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
    setShowDrop(false)   // cierra el dropdown antes de abrir el modal
    setShowNew(true)
  }

  function handleCreated(c) {
    seleccionar(c)
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
            <input
              value={search}
              onChange={(e) => buscar(e.target.value)}
              onFocus={() => search && setShowDrop(true)}
              placeholder="Buscá por nombre o ID..."
              className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2.5
                         text-white text-sm font-body placeholder-surface-500
                         focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 transition-all"
            />
          </div>

          {showDrop && (
            <div className="absolute z-[9999] top-full mt-1 w-full bg-surface-800 border border-surface-600 rounded-xl shadow-2xl overflow-hidden">
              {results.length === 0 ? (
                <div className="px-4 py-3 text-surface-300 text-sm font-body">
                  Sin resultados.{' '}
                  <button onClick={abrirNuevo} className="text-brand-400 underline hover:text-brand-300">
                    Crear cliente nuevo
                  </button>
                </div>
              ) : (
                results.map((c) => (
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

      {/* Botón crear debajo — cierra el dropdown antes de abrir el modal */}
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

function ItemRow({ item, index, onUpdate, onRemove }) {
  const [nombreSearch,   setNombreSearch]   = useState(item.nombreProducto || '')
  const [nombreResults,  setNombreResults]  = useState([])
  const [showNombreDrop, setShowNombreDrop] = useState(false)
  const [medidas,        setMedidas]        = useState([])   // medidas del producto elegido
  const wrapRef = useRef(null)

  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowNombreDrop(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Cargar medidas cuando cambia idProducto
  useEffect(() => {
    if (!item.idProducto) { setMedidas([]); return }
    const prod = query('SELECT * FROM Producto WHERE idProducto = ?', [parseInt(item.idProducto)])[0]
    if (prod?.tieneMedidas) {
      const ms = query('SELECT medida FROM ProductoMedida WHERE idProducto = ? ORDER BY medida', [parseInt(item.idProducto)])
      setMedidas(ms.map((r) => r.medida))
    } else {
      setMedidas([])
      onUpdate(index, 'medida', null)
    }
  }, [item.idProducto])

  // Búsqueda por nombre únicamente (no por ID)
  function buscarPorNombre(text) {
    setNombreSearch(text)
    onUpdate(index, 'nombreProducto', text)
    if (!text.trim()) { setNombreResults([]); setShowNombreDrop(false); return }
    const rows = query(
      `SELECT p.* FROM Producto p WHERE p.nombre LIKE ? LIMIT 10`,
      [`%${text.trim()}%`]
    )
    setNombreResults(rows)
    setShowNombreDrop(true)
  }

  function seleccionarProducto(p) {
    setNombreSearch(p.nombre)
    setShowNombreDrop(false)
    onUpdate(index, 'idProducto',     p.idProducto)
    onUpdate(index, 'nombreProducto', p.nombre)
    onUpdate(index, 'precioUnitario', p.precioUnitario)
    onUpdate(index, 'medida',         null)
  }

  // Búsqueda por ID: sincroniza nombre y precio automáticamente
  function handleIdChange(val) {
    const clean = val.replace(/\D/g, '')
    onUpdate(index, 'idProducto', clean)
    if (clean) {
      const p = query('SELECT * FROM Producto WHERE idProducto = ?', [parseInt(clean)])[0]
      if (p) {
        setNombreSearch(p.nombre)
        onUpdate(index, 'nombreProducto', p.nombre)
        onUpdate(index, 'precioUnitario', p.precioUnitario)
        onUpdate(index, 'medida', null)
      }
    }
  }

  const cellBase = `bg-surface-700 border border-surface-600 rounded-lg px-2 py-1.5 text-white text-sm
                    font-mono focus:outline-none focus:border-brand-500 transition-all
                    [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`

  return (
    <tr className="border-b border-surface-700/50">
      {/* # */}
      <td className="py-2 px-3 text-surface-500 text-sm font-mono w-8 select-none">{index + 1}</td>

      {/* Cantidad */}
      <td className="py-2 px-2 w-20">
        <input type="text" inputMode="numeric" value={item.cantidad}
          onChange={(e) => onUpdate(index, 'cantidad', e.target.value.replace(/\D/g, '') || '1')}
          className={cellBase + ' w-full text-center'} />
      </td>

      {/* Nombre — búsqueda solo por nombre */}
      <td className="py-2 px-2 min-w-[200px]" ref={wrapRef}>
        <div className="relative">
          <input value={nombreSearch} onChange={(e) => buscarPorNombre(e.target.value)}
            placeholder="Nombre del producto..."
            className={cellBase + ' w-full'} />
          {showNombreDrop && (
            <div className="fixed z-[9999] mt-1 w-80 bg-surface-800 border border-surface-600 rounded-xl shadow-2xl overflow-hidden"
              style={{
                top:  wrapRef.current ? wrapRef.current.getBoundingClientRect().bottom + 4 : 'auto',
                left: wrapRef.current ? wrapRef.current.getBoundingClientRect().left : 'auto',
              }}>
              {nombreResults.length === 0 ? (
                <p className="px-4 py-3 text-surface-300 text-xs font-body">Sin resultados para "{nombreSearch}"</p>
              ) : (
                nombreResults.map((p) => (
                  <button key={p.idProducto} onClick={() => seleccionarProducto(p)}
                    className="w-full text-left px-3 py-2.5 hover:bg-surface-700 transition-colors border-b border-surface-700/60 last:border-0">
                    <p className="text-white text-xs font-body leading-tight">{p.nombre}</p>
                    <p className="text-surface-400 text-xs font-mono mt-0.5">
                      #{p.idProducto} · {fmt(p.precioUnitario)}{p.tieneMedidas ? ' · Con medidas' : ''}
                    </p>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </td>

      {/* ID — 5 dígitos cómodos */}
      <td className="py-2 px-2 w-28">
        <input type="text" inputMode="numeric" value={item.idProducto || ''}
          onChange={(e) => handleIdChange(e.target.value)}
          placeholder="ID"
          className={cellBase + ' w-full text-center'} />
      </td>

      {/* Medida — solo aparece si el producto la tiene */}
      <td className="py-2 px-2 w-32">
        {medidas.length > 0 ? (
          <select value={item.medida || ''}
            onChange={(e) => onUpdate(index, 'medida', e.target.value)}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-2 py-1.5 text-white text-sm
                       font-body focus:outline-none focus:border-brand-500 transition-all cursor-pointer">
            <option value="">— medida —</option>
            {medidas.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <span className="text-surface-500 text-xs font-body px-2">—</span>
        )}
      </td>

      {/* Precio unitario — READ ONLY */}
      <td className="py-2 px-2 w-36">
        <div className="w-full bg-surface-800 border border-surface-700 rounded-lg px-2 py-1.5
                        text-surface-300 text-sm font-mono select-none cursor-not-allowed">
          {item.precioUnitario ? fmt(parseFloat(item.precioUnitario)) : <span className="text-surface-600">—</span>}
        </div>
      </td>

      {/* Subtotal */}
      <td className="py-2 px-3 text-right w-36">
        <span className="text-surface-200 text-sm font-mono">
          {fmt((parseInt(item.cantidad) || 0) * (parseFloat(item.precioUnitario) || 0))}
        </span>
      </td>

      {/* Borrar */}
      <td className="py-2 px-2 w-10">
        <button onClick={() => onRemove(index)} className="text-surface-500 hover:text-red-400 transition-colors p-1 rounded">
          <Trash2 size={15} />
        </button>
      </td>
    </tr>
  )
}

// ─── Selector de método de pago ─────────────────────────────────────────────

function MetodoPagoSelector({ metodo, onMetodo, excepcionDesc, onExcepcionDesc, excepcionFactor, onExcepcionFactor }) {
  const [modoExcepcion, setModoExcepcion] = useState(false)
  const [subMetodo, setSubMetodo]         = useState('efectivo')
  const [pct, setPct]                     = useState('')   // porcentaje ingresado

  useEffect(() => {
    if (modoExcepcion) {
      // factor = 1 - pct/100  (descuento) o 1 + pct/100 (recargo si negativo)
      const num = parseFloat(pct) || 0
      onExcepcionFactor(1 - num / 100)
      onExcepcionDesc(`Excepción (${subMetodo}) ${num >= 0 ? '-' : '+'}${Math.abs(num)}%`)
      onMetodo('excepcion')
    }
  }, [modoExcepcion, subMetodo, pct])

  function seleccionar(v) {
    if (v === 'excepcion') { setModoExcepcion(true); return }
    setModoExcepcion(false)
    onMetodo(v)
  }

  const todos = [...METODOS_BASE, { value: 'excepcion', label: 'Excepción', texto: 'Desc. manual' }]

  return (
    <div className="mt-5">
      <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-2">Método de Pago</label>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {todos.map((m) => {
          const active = modoExcepcion ? m.value === 'excepcion' : metodo === m.value
          return (
            <button key={m.value} onClick={() => seleccionar(m.value)}
              className={`rounded-xl px-3 py-3 text-left border transition-all duration-200
                ${active
                  ? 'bg-brand-500/15 border-brand-500/50 text-white'
                  : 'bg-surface-700 border-surface-600 text-surface-300 hover:border-surface-500'}`}>
              <p className="text-sm font-body font-medium leading-tight">{m.label}</p>
              <p className={`text-xs mt-0.5 font-mono ${active ? 'text-brand-400' : 'text-surface-500'}`}>{m.texto}</p>
            </button>
          )
        })}
      </div>

      {/* Panel de excepción */}
      {modoExcepcion && (
        <div className="mt-3 bg-surface-700/60 border border-surface-600 rounded-xl p-4 space-y-3">
          <p className="text-surface-300 text-xs font-body uppercase tracking-widest">Configurar Excepción</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-surface-400 text-xs font-body mb-1">Forma de pago</label>
              <select value={subMetodo} onChange={(e) => setSubMetodo(e.target.value)}
                className="w-full bg-surface-800 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                           font-body focus:outline-none focus:border-brand-500 transition-all">
                {METODOS_BASE.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-surface-400 text-xs font-body mb-1">% Descuento (positivo) / Recargo (negativo)</label>
              <input type="text" inputMode="decimal" value={pct}
                onChange={(e) => { const v = e.target.value.replace(',', '.'); if (/^-?\d*\.?\d*$/.test(v)) setPct(v) }}
                placeholder="Ej: 10 = 10% desc."
                className="w-full bg-surface-800 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                           font-mono focus:outline-none focus:border-brand-500 transition-all
                           [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
            </div>
          </div>
          {pct !== '' && (
            <p className="text-brand-400 text-xs font-mono">
              Factor aplicado: {(1 - (parseFloat(pct) || 0) / 100).toFixed(4)}
              {' '}→ {excepcionDesc}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ───────────────────────────────────────────────────

const ITEM_EMPTY = () => ({ idProducto: '', nombreProducto: '', cantidad: 1, precioUnitario: 0, medida: null })

export default function Presupuestador() {
  const [cliente,         setCliente]         = useState(null)
  const [metodoPago,      setMetodoPago]       = useState('efectivo')
  const [excepcionFactor, setExcepcionFactor]  = useState(1)
  const [excepcionDesc,   setExcepcionDesc]    = useState('')
  const [items,           setItems]            = useState([ITEM_EMPTY()])
  const [guardado,        setGuardado]         = useState(null)
  const [error,           setError]            = useState('')
  const [toast,           setToast]            = useState('')

  // Factor real según método
  const esExcepcion = metodoPago === 'excepcion'
  const factorReal  = esExcepcion
    ? excepcionFactor
    : (METODOS_BASE.find((m) => m.value === metodoPago)?.factor ?? 1)

  const subtotalOriginal = items.reduce((acc, it) => {
    return acc + (parseInt(it.cantidad) || 0) * (parseFloat(it.precioUnitario) || 0)
  }, 0)
  const totalFinal = subtotalOriginal * factorReal

  function updateItem(idx, key, val) {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [key]: val } : it))
  }
  function addItem()       { setItems((prev) => [...prev, ITEM_EMPTY()]) }
  function removeItem(idx) { setItems((prev) => prev.filter((_, i) => i !== idx)) }

  function guardar() {
    setError('')

    if (!cliente) { setError('Seleccioná un cliente antes de guardar.'); return }

    const validItems = items.filter((it) => it.idProducto && parseInt(it.cantidad) > 0)
    if (!validItems.length) { setError('Agregá al menos un producto con ID válido.'); return }

    // Validar que los productos existan
    for (const it of validItems) {
      const existe = query('SELECT idProducto, tieneMedidas FROM Producto WHERE idProducto = ?', [parseInt(it.idProducto)])[0]
      if (!existe) { setError(`El producto ID ${it.idProducto} no existe en el inventario.`); return }
      if (existe.tieneMedidas && !it.medida) { setError(`El producto ID ${it.idProducto} requiere que selecciones una medida.`); return }
    }

    const fecha = today()
    const metodoGuardado = esExcepcion ? 'efectivo' : metodoPago   // en DB guardamos el sub-método base

    const idPresupuesto = run(
      `INSERT INTO Presupuesto (idCliente, fecha, metodoPago, montoOriginal, monto) VALUES (?,?,?,?,?)`,
      [cliente.idCliente, fecha, metodoGuardado, subtotalOriginal, totalFinal]
    )

    for (const it of validItems) {
      const precio   = parseFloat(it.precioUnitario) || 0
      const cantidad = parseInt(it.cantidad)
      run(
        `INSERT INTO DetallePresupuesto (idPresupuesto, idProducto, medida, cantidad, precioUnitario, subtotal) VALUES (?,?,?,?,?,?)`,
        [idPresupuesto, parseInt(it.idProducto), it.medida || null, cantidad, precio, cantidad * precio]
      )
    }

    // Crear saldo para CC
    if (metodoPago === 'cc15' || metodoPago === 'cc30') {
      const dias = metodoPago === 'cc15' ? 15 : 30
      const fechaFin = new Date()
      fechaFin.setDate(fechaFin.getDate() + dias)
      run(
        `INSERT INTO Saldo (idPresupuesto, idCliente, fechaInicio, fechaFin, monto, estado) VALUES (?,?,?,?,?,'pendiente')`,
        [idPresupuesto, cliente.idCliente, fecha, fechaFin.toISOString().slice(0, 10), totalFinal]
      )
    }

    setGuardado({ idPresupuesto, esCuenta: metodoPago === 'cc15' || metodoPago === 'cc30' })
  }

  function nuevo() {
    setCliente(null); setMetodoPago('efectivo'); setItems([ITEM_EMPTY()])
    setGuardado(null); setError(''); setExcepcionFactor(1); setExcepcionDesc('')
  }

  const metodoLabel = esExcepcion ? excepcionDesc || 'Excepción'
    : METODOS_BASE.find((m) => m.value === metodoPago)?.label ?? metodoPago

  // ── Vista éxito ──
  if (guardado) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center animate-slide-up">
        <div className="bg-surface-800 border border-surface-700 rounded-2xl p-10 space-y-4">
          <CheckCircle2 size={52} className="text-emerald-400 mx-auto" />
          <h2 className="font-display text-3xl text-white tracking-widest">GUARDADO</h2>
          <p className="text-surface-300 font-body">
            Presupuesto <span className="text-brand-400 font-mono">#{guardado.idPresupuesto}</span> creado correctamente.
          </p>
          {guardado.esCuenta && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 text-yellow-300 text-sm font-body">
              Se generó un <strong>Saldo pendiente</strong> por {fmt(totalFinal)} ({metodoLabel}).
            </div>
          )}
          <Button variant="secondary" className="w-full" onClick={nuevo}>Nuevo Presupuesto</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      <PageHeader title="Presupuestador" subtitle="Nuevo presupuesto" />

      {/* Cabecera */}
      <Card className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          <div className="md:col-span-2">
            <ClienteSelector value={cliente} onChange={setCliente} onToast={setToast} />
          </div>
          <div>
            <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1">Fecha</label>
            <div className="bg-surface-700 border border-surface-600 rounded-xl px-4 py-2.5 text-surface-300 text-sm font-mono">
              {today()}
            </div>
          </div>
        </div>

        <MetodoPagoSelector
          metodo={metodoPago}
          onMetodo={setMetodoPago}
          excepcionDesc={excepcionDesc}
          onExcepcionDesc={setExcepcionDesc}
          excepcionFactor={excepcionFactor}
          onExcepcionFactor={setExcepcionFactor}
        />
      </Card>

      {/* Tabla de ítems */}
      <Card className="overflow-visible">
        <div className="px-6 py-4 border-b border-surface-700 flex items-center justify-between">
          <h2 className="font-body font-semibold text-white text-sm">Productos</h2>
          <Button size="sm" icon={Plus} onClick={addItem}>Agregar ítem</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700">
                {['#','Cant.','Nombre','ID','Medida','Precio Unit.','Subtotal',''].map((h) => (
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
              <span className={`font-mono font-medium ${
                factorReal < 1 ? 'text-emerald-400' : factorReal > 1 ? 'text-red-400' : 'text-surface-400'
              }`}>
                {factorReal === 1 ? '—'
                  : factorReal < 1 ? `- ${fmt(subtotalOriginal - totalFinal)}`
                  : `+ ${fmt(totalFinal - subtotalOriginal)}`}
              </span>
            </div>
            <div className="border-t border-surface-700 pt-2 flex justify-between gap-12">
              <span className="text-white font-semibold">Total a pagar:</span>
              <span className="text-brand-400 font-mono font-bold text-lg">{fmt(totalFinal)}</span>
            </div>
          </div>

          <div className="space-y-2">
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 max-w-xs">
                <AlertCircle size={14} className="flex-shrink-0" />{error}
              </div>
            )}
            <Button size="lg" onClick={guardar} className="w-full md:w-auto">Guardar Presupuesto</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
