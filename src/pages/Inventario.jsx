// src/pages/Inventario.jsx
import { useState, useEffect, useCallback } from 'react'
import { query, run } from '../lib/database'
import { Button, Card, PageHeader, Modal, Input, Select, Badge, Table, Tr, Td } from '../components/ui'
import { Plus, Search, Pencil, Trash2, ChevronDown, ChevronUp, PackagePlus, X, CheckCircle2 } from 'lucide-react'

// ─── Constantes ───────────────────────────────────────────────────────────

const MEDIDAS_VALIDAS = ['standard', '0.25', '0.50', '0.75', '1.00', '1.25', '1.50', '1.75', '2.00']

function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)
}

// ─── Toast ────────────────────────────────────────────────────────────────

function Toast({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className="fixed top-5 right-5 z-[200] animate-slide-up pointer-events-none">
      <div className="flex items-center gap-3 bg-emerald-900/95 border border-emerald-500/50 rounded-2xl px-5 py-3 shadow-2xl">
        <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
        <span className="text-emerald-100 text-sm font-body">{message}</span>
      </div>
    </div>
  )
}

// ─── Modal: crear / editar producto ──────────────────────────────────────

function ProductoModal({ open, onClose, producto, categorias, onSaved }) {
  const esEdicion = !!producto

  const emptyForm = { nombre: '', idCategoria: categorias[0]?.idCategoria ?? 1, precioUnitario: '', tieneMedidas: false }
  const [form,        setForm]        = useState(emptyForm)
  const [medidas,     setMedidas]     = useState([])   // [{ medida, cantidad }]
  const [errors,      setErrors]      = useState({})
  const [medidasUsed, setMedidasUsed] = useState([])

  // Poblar al abrir en modo edición
  useEffect(() => {
    if (!open) return
    if (producto) {
      setForm({
        nombre:        producto.nombre,
        idCategoria:   producto.idCategoria,
        precioUnitario: producto.precioUnitario,
        tieneMedidas:  producto.tieneMedidas === 1,
      })
      if (producto.tieneMedidas === 1) {
        const rows = query('SELECT medida, cantidad FROM ProductoMedida WHERE idProducto = ? ORDER BY medida', [producto.idProducto])
        setMedidas(rows)
        setMedidasUsed(rows.map((r) => r.medida))
      } else {
        setMedidas([])
        setMedidasUsed([])
      }
    } else {
      setForm({ ...emptyForm, idCategoria: categorias[0]?.idCategoria ?? 1 })
      setMedidas([])
      setMedidasUsed([])
    }
    setErrors({})
  }, [open, producto])

  function set(k, v) { setForm((p) => ({ ...p, [k]: v })) }

  // Gestión de filas de medidas
  function addMedida() {
    const libre = MEDIDAS_VALIDAS.find((m) => !medidasUsed.includes(m))
    if (!libre) return
    const nueva = { medida: libre, cantidad: 0 }
    setMedidas((p) => [...p, nueva])
    setMedidasUsed((p) => [...p, libre])
  }

  function updateMedida(idx, key, val) {
    setMedidas((prev) => {
      const next = prev.map((r, i) => i === idx ? { ...r, [key]: val } : r)
      setMedidasUsed(next.map((r) => r.medida))
      return next
    })
  }

  function removeMedida(idx) {
    setMedidas((prev) => {
      const next = prev.filter((_, i) => i !== idx)
      setMedidasUsed(next.map((r) => r.medida))
      return next
    })
  }

  function validate() {
    const e = {}
    if (!form.nombre.trim()) e.nombre = 'Requerido'
    if (form.precioUnitario === '' || isNaN(parseFloat(form.precioUnitario))) e.precioUnitario = 'Ingresá un precio válido'
    if (form.tieneMedidas && medidas.length === 0) e.medidas = 'Agregá al menos una medida'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function guardar() {
    if (!validate()) return
    const precio = parseFloat(String(form.precioUnitario).replace(',', '.'))
    const tiene  = form.tieneMedidas ? 1 : 0

    if (esEdicion) {
      // Calcular stock total si no tiene medidas
      const stockTotal = tiene ? 0 : (producto.cantidad ?? 0)
      run(
        `UPDATE Producto SET nombre=?, idCategoria=?, precioUnitario=?, tieneMedidas=?, cantidad=? WHERE idProducto=?`,
        [form.nombre.trim(), form.idCategoria, precio, tiene, stockTotal, producto.idProducto]
      )
      if (tiene) {
        run(`DELETE FROM ProductoMedida WHERE idProducto=?`, [producto.idProducto])
        for (const m of medidas) {
          run(`INSERT INTO ProductoMedida (idProducto, medida, cantidad) VALUES (?,?,?)`,
            [producto.idProducto, m.medida, parseInt(m.cantidad) || 0])
        }
      } else {
        run(`DELETE FROM ProductoMedida WHERE idProducto=?`, [producto.idProducto])
      }
    } else {
      const idProducto = run(
        `INSERT INTO Producto (idCategoria, nombre, precioUnitario, cantidad, tieneMedidas) VALUES (?,?,?,0,?)`,
        [form.idCategoria, form.nombre.trim(), precio, tiene]
      )
      if (tiene) {
        for (const m of medidas) {
          run(`INSERT INTO ProductoMedida (idProducto, medida, cantidad) VALUES (?,?,?)`,
            [idProducto, m.medida, parseInt(m.cantidad) || 0])
        }
      }
    }

    onSaved()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={esEdicion ? 'Editar Producto' : 'Nuevo Producto'} width="max-w-xl">
      <div className="space-y-4">
        {/* Nombre */}
        <Input
          label="Nombre del Producto *"
          value={form.nombre}
          onChange={(e) => set('nombre', e.target.value)}
          error={errors.nombre}
          placeholder="Ej: CADENA DE DISTRIBUCIÓN 25H-98L"
        />

        {/* Categoría */}
        <Select
          label="Categoría"
          value={form.idCategoria}
          onChange={(e) => set('idCategoria', parseInt(e.target.value))}
        >
          {categorias.map((c) => (
            <option key={c.idCategoria} value={c.idCategoria}>{c.nombre}</option>
          ))}
        </Select>

        {/* Precio */}
        <Input
          label="Precio Unitario *"
          value={form.precioUnitario}
          onChange={(e) => {
            const v = e.target.value.replace(',', '.')
            if (/^\d*\.?\d*$/.test(v)) set('precioUnitario', v)
          }}
          error={errors.precioUnitario}
          placeholder="0.00"
        />

        {/* Toggle medidas */}
        <div>
          <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-2">
            Gestión de Stock
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => set('tieneMedidas', false)}
              className={`rounded-xl px-4 py-3 text-left border text-sm font-body transition-all
                ${!form.tieneMedidas
                  ? 'bg-brand-500/15 border-brand-500/50 text-white'
                  : 'bg-surface-700 border-surface-600 text-surface-400 hover:border-surface-500'}`}
            >
              <p className="font-medium">Sin medidas</p>
              <p className={`text-xs mt-0.5 ${!form.tieneMedidas ? 'text-brand-400' : 'text-surface-500'}`}>
                Stock único general
              </p>
            </button>
            <button
              onClick={() => set('tieneMedidas', true)}
              className={`rounded-xl px-4 py-3 text-left border text-sm font-body transition-all
                ${form.tieneMedidas
                  ? 'bg-brand-500/15 border-brand-500/50 text-white'
                  : 'bg-surface-700 border-surface-600 text-surface-400 hover:border-surface-500'}`}
            >
              <p className="font-medium">Con medidas</p>
              <p className={`text-xs mt-0.5 ${form.tieneMedidas ? 'text-brand-400' : 'text-surface-500'}`}>
                Stock por medida
              </p>
            </button>
          </div>
        </div>

        {/* Stock simple (sin medidas) */}
        {!form.tieneMedidas && esEdicion && (
          <Input
            label="Stock actual"
            type="text"
            inputMode="numeric"
            value={producto?.cantidad ?? 0}
            readOnly
            className="opacity-60 cursor-not-allowed"
          />
        )}

        {/* Tabla de medidas */}
        {form.tieneMedidas && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-surface-300 text-xs tracking-widest uppercase font-body">
                Medidas y Stock
              </label>
              <Button size="sm" variant="secondary" icon={Plus} onClick={addMedida}
                disabled={medidasUsed.length >= MEDIDAS_VALIDAS.length}>
                Agregar medida
              </Button>
            </div>

            {errors.medidas && (
              <p className="text-red-400 text-xs mb-2">{errors.medidas}</p>
            )}

            {medidas.length === 0 ? (
              <p className="text-surface-500 text-sm font-body py-2">Sin medidas cargadas.</p>
            ) : (
              <div className="space-y-2">
                {medidas.map((m, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <select
                      value={m.medida}
                      onChange={(e) => updateMedida(idx, 'medida', e.target.value)}
                      className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                                 font-body focus:outline-none focus:border-brand-500 transition-all flex-1"
                    >
                      {MEDIDAS_VALIDAS.map((mv) => (
                        <option key={mv} value={mv} disabled={medidasUsed.includes(mv) && mv !== m.medida}>
                          {mv}
                        </option>
                      ))}
                    </select>

                    <input
                      type="text"
                      inputMode="numeric"
                      value={m.cantidad}
                      onChange={(e) => updateMedida(idx, 'cantidad', e.target.value.replace(/\D/g, ''))}
                      placeholder="Stock"
                      className="w-24 bg-surface-700 border border-surface-600 rounded-xl px-3 py-2
                                 text-white text-sm font-mono focus:outline-none focus:border-brand-500 transition-all
                                 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    />

                    <button onClick={() => removeMedida(idx)} className="text-surface-500 hover:text-red-400 transition-colors p-1.5">
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" onClick={guardar}>
            {esEdicion ? 'Guardar Cambios' : 'Crear Producto'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal: actualizar stock (sin medidas) ────────────────────────────────

function StockModal({ open, onClose, producto, onSaved }) {
  const [delta, setDelta] = useState('')
  const [modo,  setModo]  = useState('add')   // 'add' | 'set'

  useEffect(() => { if (open) { setDelta(''); setModo('add') } }, [open])

  function guardar() {
    const val = parseInt(delta) || 0
    const nuevo = modo === 'set' ? val : Math.max(0, producto.cantidad + val)
    run(`UPDATE Producto SET cantidad=? WHERE idProducto=?`, [nuevo, producto.idProducto])
    onSaved()
    onClose()
  }

  if (!producto) return null
  return (
    <Modal open={open} onClose={onClose} title={`Stock: ${producto.nombre.slice(0, 40)}...`} width="max-w-sm">
      <div className="space-y-4">
        <div className="bg-surface-700 rounded-xl px-4 py-3 text-center">
          <p className="text-surface-400 text-xs uppercase tracking-widest font-body">Stock actual</p>
          <p className="text-3xl font-display text-white tracking-widest mt-1">{producto.cantidad}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[['add', 'Sumar/Restar'], ['set', 'Fijar valor']].map(([v, l]) => (
            <button key={v} onClick={() => setModo(v)}
              className={`rounded-xl px-3 py-2 text-sm font-body border transition-all
                ${modo === v
                  ? 'bg-brand-500/15 border-brand-500/50 text-white'
                  : 'bg-surface-700 border-surface-600 text-surface-400 hover:border-surface-500'}`}>
              {l}
            </button>
          ))}
        </div>

        <Input
          label={modo === 'add' ? 'Cantidad (negativo para restar)' : 'Nuevo valor'}
          value={delta}
          onChange={(e) => setDelta(e.target.value.replace(/[^-\d]/g, ''))}
          placeholder={modo === 'add' ? 'Ej: +10 o -5' : 'Ej: 25'}
        />

        {modo === 'add' && delta !== '' && (
          <p className="text-surface-400 text-xs font-body">
            Resultado: <span className="text-white font-mono">{Math.max(0, producto.cantidad + (parseInt(delta) || 0))}</span>
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" onClick={guardar}>Aplicar</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal: ver detalle / stock por medida ────────────────────────────────

function DetalleModal({ open, onClose, producto, onSaved }) {
  const [medidas, setMedidas] = useState([])
  const [editing, setEditing] = useState({})  // { idMedida: cantidad }

  useEffect(() => {
    if (open && producto?.tieneMedidas) {
      const rows = query('SELECT * FROM ProductoMedida WHERE idProducto = ? ORDER BY medida', [producto.idProducto])
      setMedidas(rows)
      setEditing({})
    }
  }, [open, producto])

  function saveAll() {
    for (const [idMedida, cantidad] of Object.entries(editing)) {
      run(`UPDATE ProductoMedida SET cantidad=? WHERE idMedida=?`, [parseInt(cantidad) || 0, idMedida])
    }
    onSaved()
    onClose()
  }

  if (!producto) return null
  return (
    <Modal open={open} onClose={onClose} title={`Stock por medida`} width="max-w-md">
      <p className="text-surface-400 text-xs font-body mb-4 truncate">{producto.nombre}</p>
      <div className="space-y-2 mb-4">
        {medidas.map((m) => (
          <div key={m.idMedida} className="flex items-center gap-3 bg-surface-700 rounded-xl px-4 py-2.5">
            <span className="text-white text-sm font-mono flex-1">{m.medida}</span>
            <input
              type="text"
              inputMode="numeric"
              value={editing[m.idMedida] !== undefined ? editing[m.idMedida] : m.cantidad}
              onChange={(e) => setEditing((p) => ({ ...p, [m.idMedida]: e.target.value.replace(/\D/g, '') }))}
              className="w-20 bg-surface-600 border border-surface-500 rounded-lg px-2 py-1 text-white
                         text-sm font-mono text-center focus:outline-none focus:border-brand-500 transition-all
                         [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-surface-400 text-xs font-body">und.</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1" onClick={saveAll}>Guardar Stock</Button>
      </div>
    </Modal>
  )
}

// ─── Modal: nueva categoría ───────────────────────────────────────────────

function CatModal({ open, onClose, onSaved }) {
  const [nombre, setNombre] = useState('')
  const [error,  setError]  = useState('')

  function guardar() {
    if (!nombre.trim()) { setError('Requerido'); return }
    run(`INSERT INTO Categoria (nombre) VALUES (?)`, [nombre.trim()])
    onSaved()
    setNombre('')
    setError('')
    onClose()
  }

  return (
    <Modal open={open} onClose={() => { setNombre(''); setError(''); onClose() }} title="Nueva Categoría" width="max-w-sm">
      <div className="space-y-4">
        <Input label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} error={error} placeholder="Ej: Transmisión" />
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" onClick={guardar}>Crear</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────

const PAGE_SIZE = 50

export default function Inventario() {
  const [productos,   setProductos]   = useState([])
  const [categorias,  setCategorias]  = useState([])
  const [search,      setSearch]      = useState('')
  const [filterCat,   setFilterCat]   = useState('all')
  const [filterStock, setFilterStock] = useState('all')
  const [page,        setPage]        = useState(1)
  const [sortKey,     setSortKey]     = useState('nombre')
  const [sortDir,     setSortDir]     = useState('asc')

  const [modalProd,    setModalProd]    = useState(false)
  const [modalStock,   setModalStock]   = useState(false)
  const [modalDetalle, setModalDetalle] = useState(false)
  const [modalCat,     setModalCat]     = useState(false)
  const [selected,     setSelected]     = useState(null)
  const [deleteConfirm,setDeleteConfirm]= useState(null)
  const [toast,        setToast]        = useState('')

  const load = useCallback(() => {
    const cats = query('SELECT * FROM Categoria ORDER BY nombre')
    setCategorias(cats)

    let sql = `
      SELECT p.*, c.nombre as categoriaNombre,
        CASE WHEN p.tieneMedidas=1
          THEN (SELECT COALESCE(SUM(pm.cantidad),0) FROM ProductoMedida pm WHERE pm.idProducto=p.idProducto)
          ELSE p.cantidad
        END as stockTotal
      FROM Producto p
      JOIN Categoria c ON p.idCategoria=c.idCategoria
      WHERE 1=1`
    const params = []

    if (search.trim()) {
      sql += ` AND (p.nombre LIKE ? OR p.idProducto=?)`
      params.push(`%${search.trim()}%`, parseInt(search) || -1)
    }
    if (filterCat !== 'all') {
      sql += ` AND p.idCategoria=?`
      params.push(parseInt(filterCat))
    }
    if (filterStock === 'con') {
      sql += ` AND stockTotal > 0`
    } else if (filterStock === 'sin') {
      sql += ` AND stockTotal = 0`
    }

    sql += ` ORDER BY ${sortKey === 'stock' ? 'stockTotal' : sortKey === 'precio' ? 'precioUnitario' : 'p.nombre'} ${sortDir.toUpperCase()}`

    setProductos(query(sql, params))
    setPage(1)
  }, [search, filterCat, filterStock, sortKey, sortDir])

  useEffect(() => { load() }, [load])

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function SortIcon({ col }) {
    if (sortKey !== col) return <span className="text-surface-600 ml-1">↕</span>
    return sortDir === 'asc' ? <ChevronUp size={13} className="inline ml-1" /> : <ChevronDown size={13} className="inline ml-1" />
  }

  function eliminar(p) {
    run(`DELETE FROM Producto WHERE idProducto=?`, [p.idProducto])
    setDeleteConfirm(null)
    load()
    setToast(`"${p.nombre.slice(0, 30)}..." eliminado`)
  }

  const paginated = productos.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(productos.length / PAGE_SIZE))

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}

      <PageHeader
        title="Inventario"
        subtitle="Gestión de productos"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setModalCat(true)}>
              + Categoría
            </Button>
            <Button icon={PackagePlus} onClick={() => { setSelected(null); setModalProd(true) }}>
              Nuevo Producto
            </Button>
          </div>
        }
      />

      {/* Resumen rápido */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total productos', value: productos.length },
          { label: 'Con stock',       value: productos.filter((p) => p.stockTotal > 0).length },
          { label: 'Sin stock',       value: productos.filter((p) => p.stockTotal === 0).length },
          { label: 'Categorías',      value: categorias.length },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-800 border border-surface-700 rounded-xl p-4">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body">{label}</p>
            <p className="font-display text-3xl text-white tracking-widest mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Búsqueda */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscá por nombre o ID..."
              className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2 text-white
                         text-sm font-body placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all"
            />
          </div>

          {/* Filtro categoría */}
          <select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                       font-body focus:outline-none focus:border-brand-500 transition-all cursor-pointer"
          >
            <option value="all">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c.idCategoria} value={c.idCategoria}>{c.nombre}</option>
            ))}
          </select>

          {/* Filtro stock */}
          <select
            value={filterStock}
            onChange={(e) => setFilterStock(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                       font-body focus:outline-none focus:border-brand-500 transition-all cursor-pointer"
          >
            <option value="all">Todo el stock</option>
            <option value="con">Con stock</option>
            <option value="sin">Sin stock</option>
          </select>
        </div>
      </Card>

      {/* Tabla */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="border-b border-surface-700">
                <th className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body w-16">ID</th>
                <th
                  className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body cursor-pointer hover:text-white transition-colors"
                  onClick={() => toggleSort('nombre')}
                >
                  Nombre <SortIcon col="nombre" />
                </th>
                <th className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">Categoría</th>
                <th
                  className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body cursor-pointer hover:text-white transition-colors"
                  onClick={() => toggleSort('precio')}
                >
                  Precio <SortIcon col="precio" />
                </th>
                <th
                  className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body cursor-pointer hover:text-white transition-colors"
                  onClick={() => toggleSort('stock')}
                >
                  Stock <SortIcon col="stock" />
                </th>
                <th className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">Tipo</th>
                <th className="py-3 px-4 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((p) => (
                <tr key={p.idProducto} className="border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors">
                  <Td className="font-mono text-surface-400">#{p.idProducto}</Td>
                  <Td>
                    <span className="text-white font-body">{p.nombre}</span>
                  </Td>
                  <Td>
                    <Badge color="gray">{p.categoriaNombre}</Badge>
                  </Td>
                  <Td className="font-mono">{p.precioUnitario > 0 ? fmt(p.precioUnitario) : <span className="text-surface-500">—</span>}</Td>
                  <Td>
                    <span className={`font-mono font-medium ${p.stockTotal === 0 ? 'text-red-400' : p.stockTotal < 5 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                      {p.stockTotal}
                    </span>
                  </Td>
                  <Td>
                    {p.tieneMedidas
                      ? <Badge color="blue">Con medidas</Badge>
                      : <Badge color="gray">General</Badge>
                    }
                  </Td>
                  <td className="py-2 px-4">
                    <div className="flex items-center gap-1 justify-end">
                      {/* Stock */}
                      {p.tieneMedidas ? (
                        <button
                          onClick={() => { setSelected(p); setModalDetalle(true) }}
                          title="Ver stock por medida"
                          className="p-1.5 text-surface-400 hover:text-blue-400 transition-colors rounded-lg hover:bg-surface-700"
                        >
                          <PackagePlus size={15} />
                        </button>
                      ) : (
                        <button
                          onClick={() => { setSelected(p); setModalStock(true) }}
                          title="Actualizar stock"
                          className="p-1.5 text-surface-400 hover:text-emerald-400 transition-colors rounded-lg hover:bg-surface-700"
                        >
                          <PackagePlus size={15} />
                        </button>
                      )}
                      {/* Editar */}
                      <button
                        onClick={() => { setSelected(p); setModalProd(true) }}
                        title="Editar"
                        className="p-1.5 text-surface-400 hover:text-brand-400 transition-colors rounded-lg hover:bg-surface-700"
                      >
                        <Pencil size={15} />
                      </button>
                      {/* Eliminar */}
                      <button
                        onClick={() => setDeleteConfirm(p)}
                        title="Eliminar"
                        className="p-1.5 text-surface-400 hover:text-red-400 transition-colors rounded-lg hover:bg-surface-700"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {productos.length === 0 && (
          <div className="text-center py-16 text-surface-500 font-body text-sm">
            Sin resultados para la búsqueda actual.
          </div>
        )}

        {/* Paginación */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-surface-700">
            <p className="text-surface-400 text-xs font-body">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, productos.length)} de {productos.length}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                ← Anterior
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                Siguiente →
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Modales */}
      <ProductoModal
        open={modalProd}
        onClose={() => setModalProd(false)}
        producto={selected}
        categorias={categorias}
        onSaved={() => { load(); setToast(selected ? 'Producto actualizado' : 'Producto creado correctamente ✓') }}
      />

      <StockModal
        open={modalStock}
        onClose={() => setModalStock(false)}
        producto={selected}
        onSaved={() => { load(); setToast('Stock actualizado') }}
      />

      <DetalleModal
        open={modalDetalle}
        onClose={() => setModalDetalle(false)}
        producto={selected}
        onSaved={() => { load(); setToast('Stock actualizado') }}
      />

      <CatModal
        open={modalCat}
        onClose={() => setModalCat(false)}
        onSaved={() => { load(); setToast('Categoría creada ✓') }}
      />

      {/* Confirm delete */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Confirmar eliminación" width="max-w-sm">
        <p className="text-surface-300 text-sm font-body mb-4">
          ¿Eliminar <span className="text-white font-medium">"{deleteConfirm?.nombre?.slice(0, 50)}"</span>?
          Esta acción no se puede deshacer.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
          <Button variant="danger" className="flex-1" onClick={() => eliminar(deleteConfirm)}>Eliminar</Button>
        </div>
      </Modal>
    </div>
  )
}
