// src/pages/Presupuestador.jsx
import { useState, useEffect, useRef } from 'react'
import { query, run } from '../lib/database'
import { Button, Card, PageHeader, Modal, Input } from '../components/ui'
import { Plus, Trash2, Search, UserPlus, CheckCircle2, AlertCircle } from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────────────────

const METODOS_PAGO = [
  { value: 'efectivo',      label: 'Efectivo',                factor: 0.95,  texto: '5% de descuento' },
  { value: 'transferencia', label: 'Transferencia',            factor: 0.95,  texto: '5% de descuento' },
  { value: 'cc15',          label: 'Cuenta Corriente 15 días', factor: 1.00,  texto: 'Precio de lista' },
  { value: 'cc30',          label: 'Cuenta Corriente 30 días', factor: 1.105, texto: '10.5% de recargo' },
]

function getMétodo(value) {
  return METODOS_PAGO.find((m) => m.value === value) || METODOS_PAGO[0]
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)
}

// ─── Toast global ─────────────────────────────────────────────────────────
// FIX 1: feedback al crear cliente — aparece en esquina, desaparece solo a los 3s.

function Toast({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className="fixed top-5 right-5 z-[200] animate-slide-up pointer-events-none">
      <div className="flex items-center gap-3 bg-emerald-900/95 border border-emerald-500/50
                      rounded-2xl px-5 py-3 shadow-2xl backdrop-blur-sm">
        <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
        <span className="text-emerald-100 text-sm font-body">{message}</span>
      </div>
    </div>
  )
}

// ─── Buscador de clientes ─────────────────────────────────────────────────

function ClienteSelector({ value, onChange }) {
  const [search,   setSearch]   = useState('')
  const [results,  setResults]  = useState([])
  const [showDrop, setShowDrop] = useState(false)
  const [showNew,  setShowNew]  = useState(false)
  const [toast,    setToast]    = useState(false)
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
    if (text.trim().length < 1) { setResults([]); setShowDrop(false); return }
    const rows = query(
      `SELECT * FROM Cliente WHERE nombre LIKE ? OR apellido LIKE ? OR idCliente = ? LIMIT 8`,
      [`%${text}%`, `%${text}%`, parseInt(text) || -1]
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

  function handleCreated(c) {
    seleccionar(c)
    setToast(true)   // FIX 1: dispara el toast
  }

  return (
    <div ref={wrapRef} className="relative">
      {toast && <Toast message="Cliente creado correctamente ✓" onDone={() => setToast(false)} />}

      <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1">
        Cliente
      </label>

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

          {/* FIX 3: dropdown con min-width y z-index alto para que no quede recortado */}
          {showDrop && (
            <div className="absolute z-[60] top-full mt-1 w-full min-w-[260px] bg-surface-800 border border-surface-600
                            rounded-xl shadow-2xl overflow-hidden">
              {results.length === 0 ? (
                <div className="px-4 py-3 text-surface-300 text-sm font-body">
                  Sin resultados.{' '}
                  <button
                    onClick={() => { setShowDrop(false); setShowNew(true) }}
                    className="text-brand-400 underline hover:text-brand-300"
                  >
                    Crear cliente nuevo
                  </button>
                </div>
              ) : (
                results.map((c) => (
                  <button
                    key={c.idCliente}
                    onClick={() => seleccionar(c)}
                    className="w-full text-left px-4 py-2.5 hover:bg-surface-700 transition-colors
                               border-b border-surface-700/60 last:border-0"
                  >
                    <p className="text-white text-sm font-body">{c.nombre} {c.apellido}</p>
                    <p className="text-surface-400 text-xs font-mono">ID #{c.idCliente} · {c.telefono || ''}</p>
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}

      <button
        onClick={() => setShowNew(true)}
        className="mt-1.5 flex items-center gap-1.5 text-xs text-surface-400 hover:text-brand-400 transition-colors font-body"
      >
        <UserPlus size={12} /> Crear cliente nuevo
      </button>

      <NuevoClienteModal open={showNew} onClose={() => setShowNew(false)} onCreated={handleCreated} />
    </div>
  )
}

// ─── Modal nuevo cliente ───────────────────────────────────────────────────

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
      `INSERT INTO Cliente (nombre, apellido, cuit, domicilio, telefono, mail) VALUES (?, ?, ?, ?, ?, ?)`,
      [form.nombre.trim(), form.apellido.trim(), form.cuit, form.domicilio, form.telefono, form.mail]
    )
    const cliente = query('SELECT * FROM Cliente WHERE idCliente = ?', [id])[0]
    onCreated(cliente)
    setForm(empty)
    setErrors({})
    onClose()
  }

  function cerrar() { setForm(empty); setErrors({}); onClose() }

  return (
    <Modal open={open} onClose={cerrar} title="Nuevo Cliente">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Nombre *"   value={form.nombre}    onChange={(e) => set('nombre', e.target.value)}    error={errors.nombre}   placeholder="Juan" />
          <Input label="Apellido *" value={form.apellido}  onChange={(e) => set('apellido', e.target.value)}  error={errors.apellido} placeholder="García" />
        </div>
        <Input label="CUIT"       value={form.cuit}      onChange={(e) => set('cuit', e.target.value)}      placeholder="20-12345678-9" />
        <Input label="Domicilio"  value={form.domicilio}  onChange={(e) => set('domicilio', e.target.value)} placeholder="Av. Siempreviva 742" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Teléfono" value={form.telefono}  onChange={(e) => set('telefono', e.target.value)}  placeholder="351 000-0000" />
          <Input label="Email"    value={form.mail}       onChange={(e) => set('mail', e.target.value)}      placeholder="email@ejemplo.com" />
        </div>
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" className="flex-1" onClick={cerrar}>Cancelar</Button>
          <Button className="flex-1" onClick={guardar}>Crear Cliente</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Fila de ítem en la tabla ─────────────────────────────────────────────

function ItemRow({ item, index, onUpdate, onRemove }) {
  const [prodSearch,   setProdSearch]   = useState(item.nombreProducto || '')
  const [prodResults,  setProdResults]  = useState([])
  const [showProdDrop, setShowProdDrop] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowProdDrop(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function buscarProducto(text) {
    setProdSearch(text)
    onUpdate(index, 'nombreProducto', text)
    if (text.trim().length < 1) { setProdResults([]); setShowProdDrop(false); return }
    const rows = query(
      `SELECT p.*, c.nombre as nombreCategoria FROM Producto p
       JOIN Categoria c ON p.idCategoria = c.idCategoria
       WHERE p.nombre LIKE ? OR p.idProducto = ? LIMIT 8`,
      [`%${text}%`, parseInt(text) || -1]
    )
    setProdResults(rows)
    setShowProdDrop(true)
  }

  function seleccionarProducto(p) {
    setProdSearch(p.nombre)
    setShowProdDrop(false)
    onUpdate(index, 'idProducto',      p.idProducto)
    onUpdate(index, 'nombreProducto',  p.nombre)
    onUpdate(index, 'precioUnitario',  p.precioUnitario)
  }

  function handleIdChange(val) {
    onUpdate(index, 'idProducto', val)
    const id = parseInt(val)
    if (id > 0) {
      const p = query('SELECT * FROM Producto WHERE idProducto = ?', [id])[0]
      if (p) {
        setProdSearch(p.nombre)
        onUpdate(index, 'nombreProducto', p.nombre)
        onUpdate(index, 'precioUnitario', p.precioUnitario)
      }
    }
  }

  // FIX 2: inputStyle sin flechitas numéricas (type="text" con inputMode para mobile)
  const cellInput = `w-full bg-surface-700 border border-surface-600 rounded-lg px-2 py-1.5
                     text-white text-sm font-mono focus:outline-none focus:border-brand-500
                     transition-all [appearance:textfield]
                     [&::-webkit-outer-spin-button]:appearance-none
                     [&::-webkit-inner-spin-button]:appearance-none`

  return (
    <tr className="border-b border-surface-700/50">
      {/* # */}
      <td className="py-2 px-3 text-surface-500 text-sm font-mono w-8 select-none">{index + 1}</td>

      {/* Cantidad */}
      <td className="py-2 px-2 w-20">
        <input
          type="number"
          inputMode="numeric"
          min="1"
          value={item.cantidad}
          onChange={(e) => onUpdate(index, 'cantidad', Math.max(1, parseInt(e.target.value) || 1))}
          className={cellInput + ' text-center'}
        />
      </td>

      {/* Buscador de producto */}
      <td className="py-2 px-2 min-w-[180px]" ref={wrapRef}>
        <div className="relative">
          <input
            value={prodSearch}
            onChange={(e) => buscarProducto(e.target.value)}
            placeholder="Buscá por nombre..."
            className={cellInput + ' w-full'}
          />

          {/* FIX 3: dropdown con fondo sólido, z-index alto y ancho mínimo garantizado */}
          {showProdDrop && (
            <div className="absolute z-[60] top-full mt-1 left-0 w-72 bg-surface-800 border border-surface-600
                            rounded-xl shadow-2xl overflow-hidden">
              {prodResults.length === 0 ? (
                <p className="px-4 py-3 text-surface-300 text-xs font-body">
                  Sin resultados para "{prodSearch}"
                </p>
              ) : (
                prodResults.map((p) => (
                  <button
                    key={p.idProducto}
                    onClick={() => seleccionarProducto(p)}
                    className="w-full text-left px-3 py-2.5 hover:bg-surface-700 transition-colors
                               border-b border-surface-700/60 last:border-0"
                  >
                    <p className="text-white text-xs font-body leading-tight">{p.nombre}</p>
                    <p className="text-surface-400 text-xs font-mono mt-0.5">
                      #{p.idProducto} · {fmt(p.precioUnitario)} · Stock: {p.cantidad}
                    </p>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </td>

      {/* ID Producto — FIX 2: sin flechitas */}
      <td className="py-2 px-2 w-20">
        <input
          type="text"
          inputMode="numeric"
          value={item.idProducto || ''}
          onChange={(e) => handleIdChange(e.target.value.replace(/\D/g, ''))}
          placeholder="ID"
          className={cellInput + ' text-center'}
        />
      </td>

      {/* Precio unitario — FIX 2: sin flechitas */}
      <td className="py-2 px-2 w-36">
        <input
          type="text"
          inputMode="decimal"
          value={item.precioUnitario}
          onChange={(e) => {
            const val = e.target.value.replace(',', '.')
            if (/^\d*\.?\d*$/.test(val)) onUpdate(index, 'precioUnitario', val)
          }}
          onBlur={(e) => {
            const parsed = parseFloat(e.target.value) || 0
            onUpdate(index, 'precioUnitario', parsed)
          }}
          className={cellInput}
        />
      </td>

      {/* Subtotal */}
      <td className="py-2 px-3 text-right w-36">
        <span className="text-surface-200 text-sm font-mono">
          {fmt(item.cantidad * (parseFloat(String(item.precioUnitario).replace(',', '.')) || 0))}
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

// ─── Componente principal ──────────────────────────────────────────────────

const ITEM_EMPTY = () => ({ idProducto: '', nombreProducto: '', cantidad: 1, precioUnitario: 0 })

export default function Presupuestador() {
  const [cliente,    setCliente]    = useState(null)
  const [metodoPago, setMetodoPago] = useState('efectivo')
  const [items,      setItems]      = useState([ITEM_EMPTY()])
  const [guardado,   setGuardado]   = useState(null)
  const [error,      setError]      = useState('')

  const metodo = getMétodo(metodoPago)

  const subtotalOriginal = items.reduce((acc, it) => {
    return acc + it.cantidad * (parseFloat(String(it.precioUnitario).replace(',', '.')) || 0)
  }, 0)
  const totalFinal = subtotalOriginal * metodo.factor

  function updateItem(idx, key, val) {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [key]: val } : it))
  }
  function addItem()       { setItems((prev) => [...prev, ITEM_EMPTY()]) }
  function removeItem(idx) { setItems((prev) => prev.filter((_, i) => i !== idx)) }

  function guardar() {
    setError('')
    if (!cliente) { setError('Seleccioná un cliente antes de guardar.'); return }
    const validItems = items.filter((it) => it.idProducto && it.cantidad > 0)
    if (validItems.length === 0) { setError('Agregá al menos un producto con ID válido.'); return }

    for (const it of validItems) {
      const exists = query('SELECT idProducto FROM Producto WHERE idProducto = ?', [it.idProducto])
      if (!exists.length) { setError(`El producto ID ${it.idProducto} no existe en el inventario.`); return }
    }

    const fecha = today()
    const idPresupuesto = run(
      `INSERT INTO Presupuesto (idCliente, fecha, metodoPago, montoOriginal, monto) VALUES (?, ?, ?, ?, ?)`,
      [cliente.idCliente, fecha, metodoPago, subtotalOriginal, totalFinal]
    )

    for (const it of validItems) {
      const precio = parseFloat(String(it.precioUnitario).replace(',', '.')) || 0
      run(
        `INSERT INTO DetallePresupuesto (idPresupuesto, idProducto, cantidad, precioUnitario, subtotal) VALUES (?, ?, ?, ?, ?)`,
        [idPresupuesto, it.idProducto, it.cantidad, precio, it.cantidad * precio]
      )
    }

    if (metodoPago === 'cc15' || metodoPago === 'cc30') {
      const dias = metodoPago === 'cc15' ? 15 : 30
      const fechaFin = new Date()
      fechaFin.setDate(fechaFin.getDate() + dias)
      run(
        `INSERT INTO Saldo (idPresupuesto, idCliente, fechaInicio, fechaFin, monto, estado) VALUES (?, ?, ?, ?, ?, 'pendiente')`,
        [idPresupuesto, cliente.idCliente, fecha, fechaFin.toISOString().slice(0, 10), totalFinal]
      )
    }

    setGuardado({ idPresupuesto })
  }

  function nuevo() {
    setCliente(null); setMetodoPago('efectivo'); setItems([ITEM_EMPTY()]); setGuardado(null); setError('')
  }

  // ── Vista éxito ──
  if (guardado) {
    const esCuenta = metodoPago === 'cc15' || metodoPago === 'cc30'
    return (
      <div className="max-w-lg mx-auto mt-16 text-center animate-slide-up">
        <div className="bg-surface-800 border border-surface-700 rounded-2xl p-10 space-y-4">
          <CheckCircle2 size={52} className="text-emerald-400 mx-auto" />
          <h2 className="font-display text-3xl text-white tracking-widest">GUARDADO</h2>
          <p className="text-surface-300 font-body">
            Presupuesto <span className="text-brand-400 font-mono">#{guardado.idPresupuesto}</span> creado correctamente.
          </p>
          {esCuenta && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 text-yellow-300 text-sm font-body">
              Se generó un <strong>Saldo pendiente</strong> por {fmt(totalFinal)} ({metodo.label}).
            </div>
          )}
          <Button variant="secondary" className="w-full" onClick={nuevo}>Nuevo Presupuesto</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader title="Presupuestador" subtitle="Nuevo presupuesto" />

      {/* Cabecera */}
      <Card className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          <div className="md:col-span-2">
            <ClienteSelector value={cliente} onChange={setCliente} />
          </div>
          <div>
            <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1">Fecha</label>
            <div className="bg-surface-700 border border-surface-600 rounded-xl px-4 py-2.5 text-surface-300 text-sm font-mono">
              {today()}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-2">Método de Pago</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {METODOS_PAGO.map((m) => (
              <button
                key={m.value}
                onClick={() => setMetodoPago(m.value)}
                className={`rounded-xl px-3 py-3 text-left border transition-all duration-200
                  ${metodoPago === m.value
                    ? 'bg-brand-500/15 border-brand-500/50 text-white'
                    : 'bg-surface-700 border-surface-600 text-surface-300 hover:border-surface-500'}`}
              >
                <p className="text-sm font-body font-medium leading-tight">{m.label}</p>
                <p className={`text-xs mt-0.5 font-mono ${metodoPago === m.value ? 'text-brand-400' : 'text-surface-500'}`}>
                  {m.texto}
                </p>
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Tabla — overflow-visible para que los dropdowns no queden recortados (FIX 3) */}
      <Card className="overflow-visible">
        <div className="px-6 py-4 border-b border-surface-700 flex items-center justify-between">
          <h2 className="font-body font-semibold text-white text-sm">Productos</h2>
          <Button size="sm" icon={Plus} onClick={addItem}>Agregar ítem</Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ overflowY: 'visible' }}>
            <thead>
              <tr className="border-b border-surface-700">
                {['#', 'Cant.', 'Producto', 'ID', 'Precio Unit.', 'Subtotal', ''].map((h) => (
                  <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-2 first:px-3 font-body">
                    {h}
                  </th>
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
              <span className="text-surface-400">Ajuste ({metodo.label}):</span>
              <span className={`font-mono font-medium ${
                metodo.factor < 1 ? 'text-emerald-400' : metodo.factor > 1 ? 'text-red-400' : 'text-surface-300'
              }`}>
                {metodo.factor < 1
                  ? `- ${fmt(subtotalOriginal - totalFinal)}`
                  : metodo.factor > 1
                  ? `+ ${fmt(totalFinal - subtotalOriginal)}`
                  : '—'}
              </span>
            </div>
            <div className="border-t border-surface-700 pt-2 flex justify-between gap-12">
              <span className="text-white font-semibold">Total a pagar:</span>
              <span className="text-brand-400 font-mono font-bold text-lg">{fmt(totalFinal)}</span>
            </div>
          </div>

          <div className="space-y-2">
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-xs font-body bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 max-w-xs">
                <AlertCircle size={14} className="flex-shrink-0" />
                {error}
              </div>
            )}
            <Button size="lg" onClick={guardar} className="w-full md:w-auto">
              Guardar Presupuesto
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
