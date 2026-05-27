// src/pages/Presupuestador.jsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { query, run } from '../lib/database'
import { Button, Card, PageHeader, Modal, Input } from '../components/ui'
import { Plus, Trash2, Search, UserPlus, CheckCircle2, AlertCircle, Download, FileText } from 'lucide-react'

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
  const [form, setForm]     = useState(empty)
  const [errors, setErrors] = useState({})

  useEffect(() => { if (!open) { setForm(empty); setErrors({}) } }, [open])

  function set(k, v) { setForm(p => ({ ...p, [k]: v })) }

  function guardar() {
    const e = {}
    if (!form.nombre.trim())   e.nombre   = 'Requerido'
    if (!form.apellido.trim()) e.apellido = 'Requerido'
    setErrors(e)
    if (Object.keys(e).length) return

    const id     = run(`INSERT INTO Cliente (nombre,apellido,cuit,domicilio,telefono,mail) VALUES (?,?,?,?,?,?)`,
                       [form.nombre.trim(), form.apellido.trim(), form.cuit, form.domicilio, form.telefono, form.mail])
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
        <Input label="CUIT"      value={form.cuit}      onChange={e => set('cuit', e.target.value)}      placeholder="20-12345678-9" />
        <Input label="Domicilio" value={form.domicilio}  onChange={e => set('domicilio', e.target.value)} placeholder="Av. Siempreviva 742" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Teléfono" value={form.telefono} onChange={e => set('telefono', e.target.value)} placeholder="351 000-0000" />
          <Input label="Email"    value={form.mail}      onChange={e => set('mail', e.target.value)}     placeholder="email@ejemplo.com" />
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

function ItemRow({ item, index, onUpdate, onRemove, onClearError }) {
  const [nombreSearch,   setNombreSearch]   = useState(item.nombreProducto || '')
  const [nombreResults,  setNombreResults]  = useState([])
  const [showDrop,       setShowDrop]       = useState(false)
  const [dropPos,        setDropPos]        = useState({ top: 0, left: 0, width: 0 })
  const [medidas,        setMedidas]        = useState([])
  const [idError,        setIdError]        = useState('')
  const wrapRef  = useRef(null)
  const inputRef = useRef(null)

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
      onUpdate(index, 'medida', null)
    }
  }, [item.idProducto])

  function buscarPorNombre(text) {
    setNombreSearch(text)
    onClearError()
    onUpdate(index, 'nombreProducto', text)
    if (!text.trim()) { setNombreResults([]); setShowDrop(false); return }
    const rows = query(`SELECT * FROM Producto WHERE nombre LIKE ? LIMIT 12`, [`%${text.trim()}%`])
    setNombreResults(rows)
    setShowDrop(true)
  }

  function seleccionarProducto(p) {
    setNombreSearch(p.nombre)
    setShowDrop(false)
    onClearError()
    setIdError('')
    onUpdate(index, 'idProducto',     p.idProducto)
    onUpdate(index, 'nombreProducto', p.nombre)
    onUpdate(index, 'precioUnitario', p.precioUnitario)
    onUpdate(index, 'medida',         null)
  }

  function handleIdChange(val) {
    const clean = val.replace(/\D/g, '')
    onClearError()
    onUpdate(index, 'idProducto', clean)
    if (clean) {
      const p = query('SELECT * FROM Producto WHERE idProducto = ?', [parseInt(clean)])[0]
      if (p) {
        setNombreSearch(p.nombre)
        onUpdate(index, 'nombreProducto', p.nombre)
        onUpdate(index, 'precioUnitario', p.precioUnitario)
        onUpdate(index, 'medida', null)
        setIdError('')
      } else {
        // ID no existe — limpiamos nombre y precio, no rellenamos nada
        setNombreSearch('')
        onUpdate(index, 'nombreProducto', '')
        onUpdate(index, 'precioUnitario', 0)
        onUpdate(index, 'medida', null)
        setIdError(`Sin producto con ID ${clean}`)
      }
    } else {
      setIdError('')
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
        <input type="text" inputMode="numeric" value={item.cantidad}
          onChange={e => {
            onClearError()
            const raw = e.target.value.replace(/\D/g, '')
            onUpdate(index, 'cantidad', raw)
          }}
          onBlur={e => {
            // Al salir del campo, si quedó vacío ponemos 1
            if (!e.target.value || parseInt(e.target.value) < 1) onUpdate(index, 'cantidad', '1')
          }}
          className={cell + ' w-full text-center'} />
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
            onChange={e => onUpdate(index, 'medida', e.target.value)}
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
        <div className="w-full bg-surface-800 border border-surface-700 rounded-lg px-2 py-1.5
                        text-surface-300 text-sm font-mono cursor-not-allowed select-none">
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

// ─── Selector método de pago ────────────────────────────────────────────────

function MetodoPagoSelector({ metodoPago, onMetodoPago, excepcionFactor, onExcepcionFactor, excepcionSubMetodo, onExcepcionSubMetodo }) {
  const [pct, setPct] = useState('')
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
    doc.setFontSize(8.5); doc.setTextColor(100,100,100)
    doc.text('Ajuste:', PW - ML - 70, finalY + 13)
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

const ITEM_EMPTY = () => ({ idProducto: '', nombreProducto: '', cantidad: 1, precioUnitario: 0, medida: null })

export default function Presupuestador() {
  const [cliente,            setCliente]            = useState(null)
  const [metodoPago,         setMetodoPago]          = useState('efectivo')
  const [excepcionFactor,    setExcepcionFactor]     = useState(1)
  const [excepcionSubMetodo, setExcepcionSubMetodo]  = useState('efectivo')
  const [items,              setItems]               = useState([ITEM_EMPTY()])
  const [guardado,           setGuardado]            = useState(null)   // { idPresupuesto, esCuenta, totalFinal, metodoLabel }
  const [error,              setError]               = useState('')
  const [toast,              setToast]               = useState('')

  const esExcepcion = metodoPago === 'excepcion'
  const factorReal  = esExcepcion
    ? excepcionFactor
    : (METODOS_BASE.find(m => m.value === metodoPago)?.factor ?? 1)

  const subtotalOriginal = items.reduce((acc, it) =>
    acc + (parseInt(it.cantidad) || 0) * (parseFloat(it.precioUnitario) || 0), 0)
  const totalFinal = subtotalOriginal * factorReal

  function updateItem(idx, key, val) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [key]: val } : it))
    setError('')   // limpiar error al editar cualquier campo
  }
  function addItem()       { setItems(prev => [...prev, ITEM_EMPTY()]) }
  function removeItem(idx) { setItems(prev => prev.filter((_, i) => i !== idx)) }

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

    const fecha = today()
    // Para excepción guardamos el sub-método base en la columna metodoPago de la DB
    const metodoDb = esExcepcion ? excepcionSubMetodo : metodoPago

    const idPresupuesto = run(
      `INSERT INTO Presupuesto (idCliente, fecha, metodoPago, montoOriginal, monto, estado) VALUES (?,?,?,?,?,'borrador')`,
      [cliente.idCliente, fecha, metodoDb, subtotalOriginal, totalFinal]
    )
    // Verificamos leyendo el ID real de la DB por si last_insert_rowid fue afectado
    const presupuestoReal = query('SELECT MAX(idPresupuesto) as id FROM Presupuesto WHERE idCliente = ? AND fecha = ?', [cliente.idCliente, fecha])[0]?.id ?? idPresupuesto

    for (const it of validItems) {
      const precio   = parseFloat(it.precioUnitario) || 0
      const cantidad = parseInt(it.cantidad)
      run(
        `INSERT INTO DetallePresupuesto (idPresupuesto, idProducto, medida, cantidad, precioUnitario, subtotal) VALUES (?,?,?,?,?,?)`,
        [idPresupuesto, parseInt(it.idProducto), it.medida || null, cantidad, precio, cantidad * precio]
      )
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
      <div className="max-w-lg mx-auto mt-16 text-center animate-slide-up">
        <div className="bg-surface-800 border border-surface-700 rounded-2xl p-10 space-y-4">
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
      <PageHeader title="Presupuestador" subtitle="Nuevo presupuesto" />

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
                <ItemRow key={idx} item={item} index={idx} onUpdate={updateItem} onRemove={removeItem} onClearError={() => setError('')} />
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
            <Button size="lg" onClick={guardar} className="w-full md:w-auto">Guardar Presupuesto</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
