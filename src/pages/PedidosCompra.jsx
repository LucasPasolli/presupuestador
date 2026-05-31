// src/pages/PedidosCompra.jsx
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { query, run } from '../lib/database'
import { Card, PageHeader, Button, Badge, Modal } from '../components/ui'
import {
  Plus, Trash2, Search, CheckCircle2, AlertCircle,
  ArrowLeft, ShoppingCart, Package, Clock, BadgeCheck
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

// ─── Dropdown de productos con posición fixed ───────────────────────────────

function ProductoDropdown({ results, anchorRef, dropRef, onSelect, searchText }) {
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    const calc = () => {
      if (!anchorRef.current) return
      const rect       = anchorRef.current.getBoundingClientRect()
      const maxH       = 260
      const spaceBelow = window.innerHeight - rect.bottom - 8
      const spaceAbove = rect.top - 8
      const openUp     = spaceBelow < maxH && spaceAbove > spaceBelow
      const top        = openUp ? rect.top - Math.min(maxH, spaceAbove) - 4 : rect.bottom + 4
      const realMaxH   = openUp ? Math.min(maxH, spaceAbove) : Math.min(maxH, spaceBelow)
      setPos({ top, left: rect.left, width: Math.max(rect.width, 320), maxH: realMaxH })
    }
    const id = requestAnimationFrame(calc)
    window.addEventListener('scroll', calc, true)
    window.addEventListener('resize', calc)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('scroll', calc, true)
      window.removeEventListener('resize', calc)
    }
  }, [anchorRef, results])

  if (!pos) return null

  return createPortal(
    <div
      ref={dropRef}
      style={{
        position: 'fixed', top: pos.top, left: pos.left,
        width: pos.width, zIndex: 9999, maxHeight: pos.maxH, overflowY: 'auto'
      }}
      className="bg-surface-800 border border-surface-600 rounded-xl shadow-2xl"
    >
      {results.length === 0
        ? <p className="px-4 py-3 text-surface-300 text-xs font-body">Sin resultados para "{searchText}"</p>
        : results.map(p => (
          <button key={p.idProducto}
            onMouseDown={e => e.preventDefault()}
            onClick={() => onSelect(p)}
            className="w-full text-left px-3 py-2.5 hover:bg-surface-700 transition-colors border-b border-surface-700/60 last:border-0">
            <p className="text-white text-xs font-body leading-tight">{p.nombre}</p>
            <p className="text-surface-400 text-xs font-mono mt-0.5">
              #{p.idProducto}{p.tieneMedidas ? ' · Con medidas' : ''}
            </p>
          </button>
        ))
      }
    </div>,
    document.body
  )
}

// ─── Fila de ítem del pedido ────────────────────────────────────────────────

function ItemRow({ item, index, onUpdate, onRemove }) {
  const [nombreSearch,   setNombreSearch]   = useState(item.nombreProducto || '')
  const [nombreResults,  setNombreResults]  = useState([])
  const [showDrop,       setShowDrop]       = useState(false)
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

  // Cargar medidas si el producto las tiene
  useEffect(() => {
    if (!item.idProducto) { setMedidas([]); return }
    const prod = query('SELECT tieneMedidas FROM Producto WHERE idProducto = ?', [parseInt(item.idProducto)])[0]
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
    onUpdate(index, 'nombreProducto', text)
    if (!text.trim()) { setNombreResults([]); setShowDrop(false); return }
    const rows = query('SELECT * FROM Producto WHERE nombre LIKE ? LIMIT 12', [`%${text.trim()}%`])
    setNombreResults(rows)
    setShowDrop(true)
  }

  function seleccionarProducto(p) {
    setNombreSearch(p.nombre)
    setShowDrop(false)
    onUpdate(index, 'idProducto',     p.idProducto)
    onUpdate(index, 'nombreProducto', p.nombre)
    // precio NO se rellena automáticamente — es precio del proveedor, lo carga el usuario
    onUpdate(index, 'medida', null)
  }

  function handleIdChange(val) {
    const clean = val.replace(/\D/g, '')
    onUpdate(index, 'idProducto', clean)
    if (clean) {
      const p = query('SELECT * FROM Producto WHERE idProducto = ?', [parseInt(clean)])[0]
      if (p) {
        setNombreSearch(p.nombre)
        onUpdate(index, 'nombreProducto', p.nombre)
        onUpdate(index, 'medida', null)
      }
    }
  }

  const cell = `bg-surface-700 border border-surface-600 rounded-lg px-2 py-1.5 text-white text-sm
                font-mono focus:outline-none focus:border-brand-500 transition-all
                [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`

  const subtotal = (parseInt(item.cantidad) || 0) * (parseFloat(item.precioUnitario) || 0)

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
        {showDrop && (
          <ProductoDropdown results={nombreResults} anchorRef={inputRef} dropRef={dropRef}
            onSelect={seleccionarProducto} searchText={nombreSearch} />
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

      {/* Precio proveedor — EDITABLE (diferencia clave con presupuestador) */}
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
            onUpdate(index, 'precioUnitario', parsed)
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

// ─── Vista detalle de un pedido (read-only + acción pagar) ─────────────────

function PedidoDetalle({ pedido, onBack, onUpdated }) {
  const [detalles, setDetalles] = useState([])
  const [confirmPagar, setConfirmPagar] = useState(false)

  useEffect(() => {
    const rows = query(`
      SELECT dc.*, p.nombre AS nombreProducto
      FROM DetallePedidoCompra dc
      LEFT JOIN Producto p ON p.idProducto = dc.idProducto
      WHERE dc.idPedido = ?
      ORDER BY dc.idDetallePedido
    `, [pedido.idPedido])
    setDetalles(rows)
  }, [pedido.idPedido])

  function marcarPagado() {
    run(`UPDATE PedidoCompra SET estado = 'pagado' WHERE idPedido = ?`, [pedido.idPedido])
    setConfirmPagar(false)
    onUpdated()
    onBack()
  }

  const esPendiente = pedido.estado === 'pendiente'

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
      {/* Breadcrumb */}
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

      {/* Cabecera */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-surface-400 text-xs tracking-widest uppercase font-body mb-1">Pedido de Compra</p>
            <h2 className="font-display text-4xl text-white tracking-widest">#{pedido.idPedido}</h2>
          </div>
          <div className="flex items-center gap-3">
            <Badge color={esPendiente ? 'yellow' : 'green'}>
              {esPendiente ? 'Pendiente de pago' : 'Pagado'}
            </Badge>
            {esPendiente && (
              <Button icon={BadgeCheck} onClick={() => setConfirmPagar(true)}>
                Marcar como pagado
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Fecha</p>
            <p className="text-white text-sm font-mono">{fmtFecha(pedido.fecha)}</p>
          </div>
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Estado</p>
            <p className="text-white text-sm font-body">{esPendiente ? 'Pendiente de pago' : 'Pagado'}</p>
          </div>
          <div className="bg-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Total</p>
            <p className="text-brand-400 font-mono font-bold text-lg">{fmt(pedido.monto)}</p>
          </div>
        </div>
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
          Esta acción registrará el egreso de <span className="text-brand-400 font-mono">{fmt(pedido.monto)}</span> en las estadísticas.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmPagar(false)}>Cancelar</Button>
          <Button className="flex-1" icon={BadgeCheck} onClick={marcarPagado}>Confirmar pago</Button>
        </div>
      </Modal>
    </div>
  )
}

// ─── Formulario nuevo pedido ────────────────────────────────────────────────

const ITEM_EMPTY = () => ({ idProducto: '', nombreProducto: '', cantidad: 1, precioUnitario: '', medida: null })

function NuevoPedido({ onGuardado, onCancelar }) {
  const [items, setItems] = useState([ITEM_EMPTY()])
  const [error, setError] = useState('')

  const total = items.reduce((acc, it) =>
    acc + (parseInt(it.cantidad) || 0) * (parseFloat(String(it.precioUnitario).replace(',', '.')) || 0), 0)

  function updateItem(idx, key, val) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [key]: val } : it))
  }
  function addItem()       { setItems(prev => [...prev, ITEM_EMPTY()]) }
  function removeItem(idx) { setItems(prev => prev.filter((_, i) => i !== idx)) }

  function guardar() {
    setError('')
    const validItems = items.filter(it => it.idProducto && parseInt(it.cantidad) > 0)
    if (!validItems.length) { setError('Agregá al menos un producto con ID válido.'); return }

    for (const it of validItems) {
      const precio = parseFloat(String(it.precioUnitario).replace(',', '.')) || 0
      if (precio <= 0) { setError(`Ingresá el precio del proveedor para "${it.nombreProducto || `ID ${it.idProducto}`}".`); return }

      const existe = query('SELECT idProducto, tieneMedidas FROM Producto WHERE idProducto = ?', [parseInt(it.idProducto)])[0]
      if (!existe) { setError(`El producto ID ${it.idProducto} no existe en el inventario.`); return }
      if (existe.tieneMedidas && !it.medida) { setError(`Seleccioná una medida para el producto ID ${it.idProducto}.`); return }
    }

    const fecha      = today()
    const idPedido   = run(
      `INSERT INTO PedidoCompra (fecha, monto, estado) VALUES (?, ?, 'pendiente')`,
      [fecha, total]
    )
    const pedidoReal = query('SELECT MAX(idPedido) as id FROM PedidoCompra WHERE fecha = ?', [fecha])[0]?.id ?? idPedido

    for (const it of validItems) {
      const precio   = parseFloat(String(it.precioUnitario).replace(',', '.')) || 0
      const cantidad = parseInt(it.cantidad)
      run(
        `INSERT INTO DetallePedidoCompra (idPedido, idProducto, medida, cantidad, precioUnitario, subtotal)
         VALUES (?,?,?,?,?,?)`,
        [pedidoReal, parseInt(it.idProducto), it.medida || null, cantidad, precio, cantidad * precio]
      )
      // Actualizar precioProveedor en el producto con el precio del pedido
      run(
        `UPDATE Producto SET precioProveedor = ? WHERE idProducto = ?`,
        [precio, parseInt(it.idProducto)]
      )
    }

    onGuardado(pedidoReal)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-slide-up">
      <div className="flex items-center gap-3">
        <button onClick={onCancelar}
          className="flex items-center gap-2 text-surface-400 hover:text-white text-sm font-body transition-colors">
          <ArrowLeft size={16} />Volver a pedidos
        </button>
      </div>

      <PageHeader title="Nuevo Pedido" subtitle="Pedido de compra" />

      {/* Info */}
      <div className="bg-blue-500/10 border border-blue-500/25 rounded-xl px-5 py-3 flex items-start gap-3">
        <Package size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
        <p className="text-blue-300 text-sm font-body">
          Los precios unitarios son los del <strong>proveedor</strong> y deben cargarse manualmente.
          No se rellenan automáticamente desde el inventario.
        </p>
      </div>

      {/* Tabla */}
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
          <div className="space-y-2">
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/30
                              rounded-xl px-3 py-2 max-w-xs">
                <AlertCircle size={14} className="flex-shrink-0" />{error}
              </div>
            )}
            <Button size="lg" icon={ShoppingCart} onClick={guardar}>Guardar Pedido</Button>
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
  const [vista,        setVista]        = useState('lista')   // 'lista' | 'nuevo' | 'detalle'
  const [selected,     setSelected]     = useState(null)
  const [filterEst,    setFilterEst]    = useState('all')
  const [filterProv,   setFilterProv]   = useState('')
  const [filterDesde,  setFilterDesde]  = useState('')
  const [filterHasta,  setFilterHasta]  = useState('')
  const [page,         setPage]         = useState(1)
  const [toast,        setToast]        = useState('')

  const load = useCallback(() => {
    let sql = `SELECT * FROM PedidoCompra WHERE 1=1`
    const params = []
    if (filterEst !== 'all') { sql += ` AND estado = ?`;    params.push(filterEst) }
    if (filterDesde)         { sql += ` AND fecha >= ?`;    params.push(filterDesde) }
    if (filterHasta)         { sql += ` AND fecha <= ?`;    params.push(filterHasta) }
    sql += ` ORDER BY idPedido DESC`
    setPedidos(query(sql, params))
    setPage(1)
  }, [filterEst, filterDesde, filterHasta])

  useEffect(() => { load() }, [load])

  // Resumen financiero
  const totalPendiente = pedidos.filter(p => p.estado === 'pendiente').reduce((a, p) => a + p.monto, 0)
  const totalPagado    = pedidos.filter(p => p.estado === 'pagado').reduce((a, p) => a + p.monto, 0)

  // Client-side filter by proveedor name or ID (stored in notes/proveedor field if present, else filter by idPedido text)
  const filteredPedidos = filterProv.trim()
    ? pedidos.filter(p =>
        String(p.idPedido).includes(filterProv.trim()) ||
        (p.proveedor && p.proveedor.toLowerCase().includes(filterProv.trim().toLowerCase()))
      )
    : pedidos

  const paginated  = filteredPedidos.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(filteredPedidos.length / PAGE_SIZE))

  function abrirDetalle(p) { setSelected(p); setVista('detalle') }
  function volverLista()   { setSelected(null); setVista('lista'); load() }

  function handleGuardado(id) {
    setToast(`Pedido #${id} creado correctamente ✓`)
    setVista('lista')
    load()
  }

  function handleUpdated() {
    setToast('Pedido marcado como pagado ✓')
    load()
  }

  if (vista === 'nuevo')   return <NuevoPedido onGuardado={handleGuardado} onCancelar={volverLista} />
  if (vista === 'detalle') return <PedidoDetalle pedido={selected} onBack={volverLista} onUpdated={handleUpdated} />

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Toast rendered as fixed overlay — no layout impact */}
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
          { label: 'Total pedidos',      value: pedidos.length,  color: 'text-white' },
          { label: 'Deuda pendiente',    value: fmt(totalPendiente), color: 'text-yellow-400' },
          { label: 'Total pagado',       value: fmt(totalPagado),    color: 'text-emerald-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface-800 border border-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body">{label}</p>
            <p className={`font-display text-2xl tracking-widest mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex items-end gap-2 flex-nowrap overflow-x-auto">

          {/* Buscador */}
          <div className="w-[300px] flex-shrink-0">

            <div className="relative">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 pointer-events-none"
              />

              <input
                type="text"
                value={filterProv}
                onChange={e => {
                  setFilterProv(e.target.value)
                  setPage(1)
                }}
                placeholder="Buscar por proveedor o ID de pedido..."
                className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2 text-white
                        text-sm font-body placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all"
              />
            </div>
          </div>

          {/* Filtros */}
          <div className="flex flex-wrap gap-2 flex-1 items-end">

            {[
              { value: 'all', label: 'Todos' },
              { value: 'pendiente', label: 'Pendientes' },
              { value: 'pagado', label: 'Pagados' },
            ].map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setFilterEst(value)}
                className={`px-4 py-2.5 rounded-xl text-sm font-body border transition-all whitespace-nowrap flex items-center justify-center
                ${
                  filterEst === value
                    ? 'bg-brand-500/15 border-brand-500/40 text-white'
                    : 'bg-surface-700 border-surface-600 text-surface-400 hover:border-surface-500'
                }`}
              >
                {label}
              </button>
            ))}

            <div className="flex flex-col gap-1 min-w-[150px]">
              <span className="text-surface-400 text-xs font-body px-1">
                DESDE
              </span>

              <input
                type="date"
                value={filterDesde}
                onChange={e => setFilterDesde(e.target.value)}
                className="w-full bg-surface-700 border border-surface-600 rounded-xl
                          px-3 py-2.5 text-white text-sm font-mono
                          focus:outline-none focus:border-brand-500 transition-all"
              />
            </div>

            <div className="flex flex-col gap-1 min-w-[150px]">
              <span className="text-surface-400 text-xs font-body px-1">
                HASTA
              </span>

              <input
                type="date"
                value={filterHasta}
                onChange={e => setFilterHasta(e.target.value)}
                className="w-full bg-surface-700 border border-surface-600 rounded-xl
                          px-3 py-2.5 text-white text-sm font-mono
                          focus:outline-none focus:border-brand-500 transition-all"
              />
            </div>

            {(filterProv || filterDesde || filterHasta) && (
              <button
                onClick={() => {
                  setFilterProv('')
                  setFilterDesde('')
                  setFilterHasta('')
                  setPage(1)
                }}
                className="px-3 py-2 rounded-xl text-xs font-body
                          border border-surface-600 text-surface-400
                          hover:text-white hover:border-surface-500
                          transition-all bg-surface-700 whitespace-nowrap"
              >
                Limpiar
              </button>
            )}

          </div>
        </div>
      </Card>

      {/* Tabla */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="border-b border-surface-700">
                {['ID','Fecha','Monto','Estado',''].map(h => (
                  <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map(p => (
                <tr key={p.idPedido} onClick={() => abrirDetalle(p)}
                  className="border-b border-surface-700/50 hover:bg-surface-700/40 cursor-pointer transition-colors">
                  <td className="py-3 px-4 text-brand-400 font-mono text-sm">#{p.idPedido}</td>
                  <td className="py-3 px-4 text-surface-300 font-mono text-xs">{fmtFecha(p.fecha)}</td>
                  <td className="py-3 px-4 text-white font-mono font-medium">{fmt(p.monto)}</td>
                  <td className="py-3 px-4">
                    {p.estado === 'pendiente'
                      ? <Badge color="yellow"><Clock size={11} className="inline mr-1" />Pendiente de pago</Badge>
                      : <Badge color="green"><CheckCircle2 size={11} className="inline mr-1" />Pagado</Badge>
                    }
                  </td>
                  <td className="py-3 px-4 text-surface-500">
                    <ShoppingCart size={15} />
                  </td>
                </tr>
              ))}
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
