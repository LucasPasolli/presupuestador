// src/pages/Inventario.jsx
import { useState, useEffect, useCallback } from 'react'
import {
  obtenerProductos,
  obtenerCategorias,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
  actualizarCantidadProducto,
  obtenerMedidasDeProducto,
} from '../services/productosService'
import { supabase } from '../lib/supabase'
import { Button, Card, PageHeader, Modal, Input, Select, Badge, Table, Tr, Td } from '../components/ui'
import { Plus, Search, Pencil, Trash2, ChevronDown, ChevronUp, PackagePlus, X, CheckCircle2, TrendingUp, FileSpreadsheet } from 'lucide-react'
import * as XLSX from 'xlsx'

// ─── Constantes ───────────────────────────────────────────────────────────

const MEDIDAS_VALIDAS = ['standard', '0.25', '0.50', '0.75', '1.00', '1.25', '1.50', '1.75', '2.00']

function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)
}

// ─── Toast ────────────────────────────────────────────────────────────────

function Toast({ message, visible, onDone }) {
  useEffect(() => {
    if (!visible) return
    const t = setTimeout(onDone, 3000)
    return () => clearTimeout(t)
  }, [visible, onDone])

  return (
    <div className={`fixed top-5 right-5 z-[9999] transition-all duration-300 pointer-events-none
      ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
      <div className="flex items-center gap-3 bg-emerald-900/95 border border-emerald-500/50 rounded-2xl px-5 py-3 shadow-2xl backdrop-blur-sm">
        <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
        <span className="text-emerald-100 text-sm font-body">{message}</span>
      </div>
    </div>
  )
}

// ─── Modal: editar producto ───────────────────────────────────────────────

function EditarProductoModal({ open, onClose, producto, categorias, onSaved }) {
  const [form, setForm] = useState({
    nombre: '', idCategoria: 1, precioProveedor: '', precioUnitario: '', puntoReposicion: '',
  })
  const [margen,  setMargen]  = useState('')
  const [errors,  setErrors]  = useState({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !producto) return
    setForm({
      nombre:          producto.nombre,
      idCategoria:     producto.idCategoria,
      precioProveedor: producto.precioProveedor && producto.precioProveedor > 0 ? String(producto.precioProveedor) : '',
      precioUnitario:  producto.precioUnitario  && producto.precioUnitario  > 0 ? String(producto.precioUnitario)  : '',
      puntoReposicion: producto.puntoReposicion && producto.puntoReposicion > 0 ? String(producto.puntoReposicion) : '',
    })
    setMargen('')
    setErrors({})
  }, [open, producto])

  function set(k, v) { setForm((p) => ({ ...p, [k]: v })) }

  function aplicarMargen(margenVal, proveedorVal) {
    const pp = parseFloat(String(proveedorVal ?? form.precioProveedor).replace(',', '.'))
    const mg = parseFloat(String(margenVal).replace(',', '.'))
    if (isNaN(pp) || isNaN(mg)) return
    set('precioUnitario', (pp * (1 + mg / 100)).toFixed(2))
  }

  function validate() {
    const e = {}
    if (!form.nombre.trim()) e.nombre = 'Requerido'
    const pp = parseFloat(String(form.precioProveedor).replace(',', '.'))
    const pu = parseFloat(String(form.precioUnitario).replace(',', '.'))
    if (form.precioProveedor !== '' && isNaN(pp)) e.precioProveedor = 'Precio inválido'
    if (form.precioUnitario  !== '' && isNaN(pu)) e.precioUnitario  = 'Precio inválido'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function guardar() {
    if (!validate()) return
    setLoading(true)
    try {
      const pp = parseFloat(String(form.precioProveedor).replace(',', '.')) || 0
      const pu = form.precioUnitario === '' ? 0 : parseFloat(String(form.precioUnitario).replace(',', '.'))
      const pr = parseInt(form.puntoReposicion) || 0
      await actualizarProducto(producto.idProducto, {
        nombre: form.nombre.trim(), idCategoria: form.idCategoria,
        precioProveedor: pp, precioUnitario: pu, puntoReposicion: pr,
        cantidad: producto.cantidad, tieneMedidas: producto.tieneMedidas,
      })
      onSaved()
      onClose()
    } catch (err) {
      setErrors({ general: err.message })
    } finally {
      setLoading(false)
    }
  }

  const ppVal = parseFloat(String(form.precioProveedor).replace(',', '.')) || 0
  const puVal = parseFloat(String(form.precioUnitario).replace(',', '.'))  || 0
  const margenCalculado = ppVal > 0 && puVal > 0 ? (((puVal - ppVal) / ppVal) * 100).toFixed(1) : null

  return (
    <Modal open={open} onClose={onClose} title="Editar Producto" width="max-w-lg">
      <div className="space-y-4">
        <Input label="Nombre del Producto *" value={form.nombre}
          onChange={(e) => set('nombre', e.target.value)} error={errors.nombre}
          placeholder="Ej: CADENA DE DISTRIBUCIÓN 25H-98L" />

        <Select label="Categoría" value={form.idCategoria}
          onChange={(e) => set('idCategoria', parseInt(e.target.value))}>
          {categorias.map((c) => (
            <option key={c.idCategoria} value={c.idCategoria} className="font-body">{c.nombre}</option>
          ))}
        </Select>

        <Input label="Precio del Proveedor" value={form.precioProveedor}
          onChange={(e) => {
            const v = e.target.value.replace(',', '.')
            if (/^\d*\.?\d*$/.test(v)) { set('precioProveedor', v); if (margen) aplicarMargen(margen, v) }
          }}
          error={errors.precioProveedor} placeholder="0.00" />

        <div>
          <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1.5">
            Margen de Ganancia (%)
          </label>
          <div className="relative">
            <TrendingUp size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
            <input type="text" inputMode="decimal" value={margen}
              onChange={(e) => {
                const v = e.target.value.replace(',', '.')
                if (!/^\d*\.?\d*$/.test(v)) return
                setMargen(v)
                if (v.trim() === '') {
                  const proveedor = parseFloat(String(form.precioProveedor).replace(',', '.'))
                  if (!isNaN(proveedor)) set('precioUnitario', proveedor.toFixed(2))
                  return
                }
                aplicarMargen(v, form.precioProveedor)
              }}
              placeholder="Ej: 42.5"
              className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-10 py-2 text-white
                        text-sm font-body placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm font-body">%</span>
          </div>
          {margenCalculado !== null && (
            <p className="text-surface-400 text-xs font-body mt-1.5">
              Margen actual: <span className="text-brand-400 font-mono ml-1">+{margenCalculado}%</span>
            </p>
          )}
        </div>

        <div>
          <Input label="Precio Unitario de Venta" value={form.precioUnitario}
            onChange={(e) => { const v = e.target.value.replace(',', '.'); if (/^\d*\.?\d*$/.test(v)) set('precioUnitario', v) }}
            error={errors.precioUnitario} placeholder="0.00" />
          {ppVal > 0 && puVal > 0 && (
            <p className="text-surface-500 text-xs font-body mt-1">
              Ganancia por unidad:&nbsp;
              <span className={`font-mono ${puVal >= ppVal ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(puVal - ppVal)}</span>
            </p>
          )}
        </div>

        <Input label="Punto de Reposición (stock mínimo)" value={form.puntoReposicion}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); set('puntoReposicion', v) }}
          placeholder="Ej: 5" />

        {errors.general && <p className="text-red-400 text-xs font-body">{errors.general}</p>}

        <div className="flex gap-2 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" onClick={guardar} disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar Cambios'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal: nuevo producto ────────────────────────────────────────────────

function NuevoProductoModal({ open, onClose, categorias, onSaved }) {
  const emptyForm = { nombre: '', idCategoria: categorias[0]?.idCategoria ?? 1, precioUnitario: '' }
  const [form,    setForm]    = useState(emptyForm)
  const [errors,  setErrors]  = useState({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm({ ...emptyForm, idCategoria: categorias[0]?.idCategoria ?? 1 })
    setErrors({})
  }, [open])

  function set(k, v) { setForm((p) => ({ ...p, [k]: v })) }

  function validate() {
    const e = {}
    if (!form.nombre.trim()) e.nombre = 'Requerido'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function guardar() {
    if (!validate()) return
    setLoading(true)
    try {
      const precio = parseFloat(String(form.precioUnitario).replace(',', '.')) || 0
      await crearProducto({
        idCategoria: form.idCategoria, nombre: form.nombre.trim(),
        precioProveedor: 0, precioUnitario: precio, cantidad: 0, tieneMedidas: 0, puntoReposicion: 0,
      })
      onSaved()
      onClose()
    } catch (err) {
      setErrors({ general: err.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nuevo Producto" width="max-w-md">
      <div className="space-y-4">
        <Input label="Nombre del Producto *" value={form.nombre}
          onChange={(e) => set('nombre', e.target.value)} error={errors.nombre}
          placeholder="Ej: CADENA DE DISTRIBUCIÓN 25H-98L" />
        <Select label="Categoría" value={form.idCategoria}
          onChange={(e) => set('idCategoria', parseInt(e.target.value))}>
          {categorias.map((c) => (
            <option key={c.idCategoria} value={c.idCategoria} className="font-body">{c.nombre}</option>
          ))}
        </Select>
        <Input label="Precio Unitario de Venta" value={form.precioUnitario}
          onChange={(e) => { const v = e.target.value.replace(',', '.'); if (/^\d*\.?\d*$/.test(v)) set('precioUnitario', v) }}
          error={errors.precioUnitario} placeholder="0.00" />
        {errors.general && <p className="text-red-400 text-xs font-body">{errors.general}</p>}
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" onClick={guardar} disabled={loading}>{loading ? 'Creando...' : 'Crear Producto'}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal: actualizar stock ──────────────────────────────────────────────

function StockModal({ open, onClose, producto, onSaved }) {
  const [modo,         setModo]         = useState(null)
  const [stockNuevo,   setStockNuevo]   = useState('')
  const [tipoFijado,   setTipoFijado]   = useState(false)
  const [medidasStock, setMedidasStock] = useState([])
  const [editMedidas,  setEditMedidas]  = useState({})
  const [loading,      setLoading]      = useState(false)

  useEffect(() => {
    if (!open) {
      setModo(null); setStockNuevo(''); setEditMedidas({}); setTipoFijado(false)
      return
    }
    if (producto?.tieneMedidas === 1) {
      setModo('conMedidas'); setTipoFijado(true); cargarMedidas()
      return
    }
    setModo('sinMedidas')
    setStockNuevo((producto?.cantidad ?? 0) > 0 ? String(producto.cantidad) : '')
    setTipoFijado((producto?.cantidad ?? 0) > 0)
  }, [open, producto])

  async function cargarMedidas(prevEdit = {}) {
    const existentes = await obtenerMedidasDeProducto(producto.idProducto)
    const existentesMap = {}
    existentes.forEach((m) => { existentesMap[m.medida] = m })
    const rows = MEDIDAS_VALIDAS.map((medida) =>
      existentesMap[medida] ?? { idMedida: `nuevo-${medida}`, medida, cantidad: '', esNueva: true }
    )
    setMedidasStock(rows)
    const nuevosEditados = {}
    rows.forEach((r) => { if (prevEdit[r.idMedida] !== undefined) nuevosEditados[r.idMedida] = prevEdit[r.idMedida] })
    setEditMedidas(nuevosEditados)
  }

  async function guardarSinMedidas() {
    setLoading(true)
    try {
      await actualizarCantidadProducto(producto.idProducto, parseInt(stockNuevo) || 0)
      onSaved(); onClose()
    } catch (err) { console.error('[StockModal]', err) }
    finally { setLoading(false) }
  }

  async function guardarConMedidas() {
    setLoading(true)
    try {
      await supabase.from('producto').update({ tiene_medidas: true }).eq('id_producto', producto.idProducto)
      for (const medida of medidasStock) {
        const valor = editMedidas[medida.idMedida] !== undefined ? editMedidas[medida.idMedida] : medida.cantidad
        if (valor === '' || valor === null || valor === undefined) continue
        const cantidad = parseInt(valor) || 0
        if (!medida.esNueva) {
          await supabase.from('producto_medida').update({ cantidad }).eq('id_medida', medida.idMedida)
        } else {
          await supabase.from('producto_medida').upsert(
            { id_producto: producto.idProducto, medida: medida.medida, cantidad },
            { onConflict: 'id_producto,medida' }
          )
        }
      }
      const { data } = await supabase.from('producto_medida').select('cantidad').eq('id_producto', producto.idProducto)
      const total = (data ?? []).reduce((acc, m) => acc + m.cantidad, 0)
      await actualizarCantidadProducto(producto.idProducto, total)
      onSaved(); onClose()
    } catch (err) { console.error('[StockModal conMedidas]', err) }
    finally { setLoading(false) }
  }

  if (!producto) return null

  return (
    <Modal open={open} onClose={onClose} title="Actualizar Stock" width="max-w-md">
      <p className="text-surface-400 text-xs font-body mb-4 truncate">{producto.nombre}</p>

      {!tipoFijado && (
        <div className="grid grid-cols-2 gap-2 mb-5">
          {[
            { v: 'sinMedidas', label: 'Sin Medidas', sub: 'Stock único general' },
            { v: 'conMedidas', label: 'Con Medidas', sub: 'Stock por medida' },
          ].map(({ v, label, sub }) => (
            <button key={v} onClick={() => { setModo(v); if (v === 'conMedidas') cargarMedidas() }}
              className={`rounded-xl px-4 py-3 text-left border text-sm font-body transition-all
                ${modo === v ? 'bg-brand-500/15 border-brand-500/50 text-white' : 'bg-surface-700 border-surface-600 text-surface-400 hover:border-surface-500'}`}>
              <p className="font-medium">{label}</p>
              <p className={`text-xs mt-0.5 ${modo === v ? 'text-brand-400' : 'text-surface-500'}`}>{sub}</p>
            </button>
          ))}
        </div>
      )}

      {tipoFijado && (
        <div className="mb-5 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
          <p className="text-amber-300 text-sm font-body">
            PRODUCTO <span className="font-semibold ml-1">{modo === 'conMedidas' ? 'CON MEDIDAS' : 'SIN MEDIDAS'}</span>
          </p>
        </div>
      )}

      {modo === 'sinMedidas' && (
        <div className="space-y-4">
          <div className="bg-surface-700 rounded-xl px-4 py-3 text-center">
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body">Stock actual</p>
            <p className="text-3xl font-display text-white tracking-widest mt-1">{producto.cantidad}</p>
          </div>
          <Input label="Nuevo valor de stock" type="text" inputMode="numeric" value={stockNuevo}
            onChange={(e) => setStockNuevo(e.target.value.replace(/\D/g, ''))} placeholder="Ej: 25" />
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
            <Button className="flex-1" onClick={guardarSinMedidas} disabled={loading}>
              {loading ? 'Aplicando...' : 'Aplicar'}
            </Button>
          </div>
        </div>
      )}

      {modo === 'conMedidas' && (
        <div className="space-y-4">
          {medidasStock.length === 0 ? (
            <p className="text-surface-500 text-sm font-body py-2 text-center">Sin medidas cargadas.</p>
          ) : (
            <div className="space-y-2">
              {medidasStock.map((m) => (
                <div key={m.idMedida} className="flex items-center gap-3 bg-surface-700 rounded-xl px-4 py-2.5">
                  <span className="text-white text-sm font-mono flex-1">{m.medida}</span>
                  <input type="text" inputMode="numeric" placeholder="—"
                    value={editMedidas[m.idMedida] !== undefined ? editMedidas[m.idMedida] : m.cantidad}
                    onChange={(e) => setEditMedidas((p) => ({ ...p, [m.idMedida]: e.target.value.replace(/\D/g, '') }))}
                    className="w-20 bg-surface-600 border border-surface-500 rounded-lg px-2 py-1 text-white
                               text-sm font-mono text-center focus:outline-none focus:border-brand-500 transition-all
                               [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                  <span className="text-surface-400 text-xs font-body">und.</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
            <Button className="flex-1" onClick={guardarConMedidas} disabled={medidasStock.length === 0 || loading}>
              {loading ? 'Guardando...' : 'Guardar Stock'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── Modal: actualizar precios masivamente ────────────────────────────────

function ActualizarPreciosModal({ open, onClose, onSaved }) {
  const [margen,  setMargen]  = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (!open) { setMargen(''); setLoading(false) } }, [open])

  async function actualizar() {
    const mg = parseFloat(String(margen).replace(',', '.'))
    if (isNaN(mg)) return
    setLoading(true)
    try {
      const { error } = await supabase.rpc('actualizar_precios_por_margen', {
        margen_porcentaje: mg
      })
      if (error) throw error
      onSaved(); onClose()
    } catch (err) {
      console.error('[ActualizarPrecios]', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Actualizar Precios Masivamente" width="max-w-md">
      <div className="space-y-4">
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
          <p className="text-amber-200 text-sm font-body">
            Esta acción actualizará el precio de venta de todos los productos utilizando el margen indicado sobre el precio proveedor.
          </p>
        </div>
        <div className="relative">
          <TrendingUp size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
          <input type="text" inputMode="decimal" value={margen}
            onChange={(e) => { const v = e.target.value.replace(',', '.'); if (/^\d*\.?\d*$/.test(v)) setMargen(v) }}
            placeholder="Margen de ganancia (%)"
            className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-10 py-2 text-white
                       text-sm font-mono focus:outline-none focus:border-brand-500 transition-all" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm font-mono">%</span>
        </div>
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" onClick={actualizar} disabled={!margen || loading}>
            {loading ? 'Actualizando...' : 'Actualizar'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal: nueva categoría ───────────────────────────────────────────────

function CatModal({ open, onClose, onSaved, categorias }) {
  const [nombre,  setNombre]  = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const nombreNormalizado  = nombre.trim().toLowerCase()
  const categoriaExistente = categorias.some((c) => c.nombre.trim().toLowerCase() === nombreNormalizado)

  async function guardar() {
    if (!nombre.trim()) { setError('Requerido'); return }
    if (categoriaExistente) { setError('Ya existe una categoría con ese nombre'); return }
    setLoading(true)
    try {
      const { crearCategoria } = await import('../services/productosService')
      await crearCategoria(nombre.trim())
      onSaved(); setNombre(''); setError(''); onClose()
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  return (
    <Modal open={open} onClose={() => { setNombre(''); setError(''); onClose() }} title="Nueva Categoría" width="max-w-sm">
      <div className="space-y-4">
        <Input label="Nombre" value={nombre}
          onChange={(e) => {
            setNombre(e.target.value)
            const nuevoValor = e.target.value.trim().toLowerCase()
            setError(categorias.some((c) => c.nombre.trim().toLowerCase() === nuevoValor) ? 'Ya existe una categoría con ese nombre' : '')
          }}
          error={error} placeholder="Ej: Transmisión" />
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" onClick={guardar} disabled={categoriaExistente || !nombre.trim() || loading}>
            {loading ? 'Creando...' : 'Crear'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────

const PAGE_SIZE = 50

export default function Inventario() {
  const [productos,    setProductos]    = useState([])
  const [allProductos, setAllProductos] = useState([])
  const [categorias,   setCategorias]   = useState([])
  const [searchNombre, setSearchNombre] = useState('')
  const [searchId,     setSearchId]     = useState('')
  const [filterCat,    setFilterCat]    = useState('all')
  const [filterStock,  setFilterStock]  = useState('all')
  const [filterBajoStock, setFilterBajoStock] = useState(false)
  const [page,         setPage]         = useState(1)
  const [sortKey,      setSortKey]      = useState('nombre')
  const [sortDir,      setSortDir]      = useState('asc')

  const [modalNuevo,   setModalNuevo]   = useState(false)
  const [modalEditar,  setModalEditar]  = useState(false)
  const [modalStock,   setModalStock]   = useState(false)
  const [modalCat,     setModalCat]     = useState(false)
  const [modalActualizarPrecios, setModalActualizarPrecios] = useState(false)
  const [selected,      setSelected]      = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [toast,         setToast]         = useState('')

  const load = useCallback(async (resetPage = true) => {
    try {
      const [cats, prods] = await Promise.all([obtenerCategorias(), obtenerProductos()])
      setCategorias(cats)
      const conStock = prods.map((p) => ({ ...p, categoriaNombre: p.categoria, stockTotal: p.cantidad }))
      setAllProductos(conStock)
      if (resetPage) setPage(1)
    } catch (err) {
      console.error('[Inventario] Error cargando datos:', err)
    }
  }, [])

  const loadSinResetPage = useCallback(() => load(false), [load])

  useEffect(() => { load() }, [load])

  // Filtrado y ordenamiento en memoria — sin llamadas a Supabase
  useEffect(() => {
    let resultado = [...allProductos]

    if (searchId.trim()) resultado = resultado.filter((p) => String(p.idProducto) === searchId.trim())
    if (searchNombre.trim()) {
      const needle = normalize(searchNombre.trim())
      resultado = resultado.filter((p) => normalize(p.nombre).includes(needle))
    }
    if (filterCat !== 'all') resultado = resultado.filter((p) => p.idCategoria === parseInt(filterCat))
    if (filterStock === 'con') resultado = resultado.filter((p) => p.stockTotal > 0)
    else if (filterStock === 'sin') resultado = resultado.filter((p) => p.stockTotal === 0)
    if (filterBajoStock) resultado = resultado.filter((p) => p.puntoReposicion > 0 && p.stockTotal <= p.puntoReposicion)

    resultado = resultado.sort((a, b) => {
      let valA, valB
      if (sortKey === 'stock')       { valA = a.stockTotal;     valB = b.stockTotal }
      else if (sortKey === 'precio') { valA = a.precioUnitario; valB = b.precioUnitario }
      else                           { valA = a.nombre;          valB = b.nombre }
      if (typeof valA === 'string') return sortDir === 'asc' ? valA.localeCompare(valB, 'es') : valB.localeCompare(valA, 'es')
      return sortDir === 'asc' ? valA - valB : valB - valA
    })

    setProductos(resultado)
    setPage(1)
  }, [allProductos, searchNombre, searchId, filterCat, filterStock, filterBajoStock, sortKey, sortDir])

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function SortIcon({ col }) {
    if (sortKey !== col) return <span className="text-surface-600 ml-1">↕</span>
    return sortDir === 'asc' ? <ChevronUp size={13} className="inline ml-1" /> : <ChevronDown size={13} className="inline ml-1" />
  }

  async function eliminar(p) {
    try {
      await eliminarProducto(p.idProducto)
      setDeleteConfirm(null)
      loadSinResetPage()
      setToast(`"${p.nombre.slice(0, 30)}..." eliminado`)
    } catch (err) { console.error('[Inventario] Error eliminando:', err) }
  }

  function exportarExcel() {
    const data = productos.map((p) => ({ Codigo: p.idProducto, Producto: p.nombre, Precio: p.precioUnitario || '' }))
    const worksheet = XLSX.utils.json_to_sheet(data)
    worksheet['!cols'] = [{ wch: 12 }, { wch: 55 }, { wch: 15 }]
    const range = XLSX.utils.decode_range(worksheet['!ref'])
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: C })
      if (!worksheet[cellAddress]) continue
      worksheet[cellAddress].s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '1F2937' } },
        alignment: { horizontal: 'center', vertical: 'center' },
      }
    }
    for (let R = 1; R <= range.e.r; ++R) {
      const priceCell = XLSX.utils.encode_cell({ r: R, c: 2 })
      if (worksheet[priceCell]) worksheet[priceCell].z = '$ #,##0.00'
    }
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Lista Productos')
    XLSX.writeFile(workbook, `Lista_Productos_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const paginated  = productos.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(productos.length / PAGE_SIZE))

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <Toast message={toast} visible={!!toast} onDone={() => setToast('')} />

      <PageHeader title="Inventario" subtitle="Gestión de productos"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setModalCat(true)}>+ Categoría</Button>
            <Button variant="secondary" onClick={() => setModalActualizarPrecios(true)}>Actualizar Precios</Button>
            <Button variant="secondary" icon={FileSpreadsheet} onClick={exportarExcel}>Exportar Lista</Button>
            <Button icon={PackagePlus} onClick={() => setModalNuevo(true)}>Nuevo Producto</Button>
          </div>
        }
      />

      {/* Resumen rápido */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
          <p className="text-surface-400 text-xs uppercase tracking-widest font-body">Total productos</p>
          <p className="font-display text-3xl text-white tracking-widest mt-0.5">{allProductos.length}</p>
        </div>
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
          <p className="text-surface-400 text-xs uppercase tracking-widest font-body">Con stock</p>
          <p className="font-display text-3xl text-white tracking-widest mt-0.5">{allProductos.filter((p) => p.stockTotal > 0).length}</p>
        </div>
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
          <p className="text-surface-400 text-xs uppercase tracking-widest font-body">Sin stock</p>
          <p className="font-display text-3xl text-white tracking-widest mt-0.5">{allProductos.filter((p) => p.stockTotal === 0).length}</p>
        </div>
        <button onClick={() => setFilterBajoStock((v) => !v)}
          className={`rounded-xl p-4 border text-left transition-all
            ${filterBajoStock ? 'bg-yellow-500/20 border-yellow-400/60' : 'bg-yellow-500/10 border-yellow-500/30 hover:bg-yellow-500/15'}`}>
          <p className="text-yellow-300 text-xs uppercase tracking-widest font-body">Bajo stock</p>
          <p className="font-display text-3xl text-yellow-200 tracking-widest mt-0.5">
            {allProductos.filter((p) => p.puntoReposicion > 0 && p.stockTotal <= p.puntoReposicion).length}
          </p>
          <p className="text-yellow-400/70 text-xs mt-1">Click para filtrar</p>
        </button>
      </div>

      {/* Filtros */}
      <Card className="p-4">
        {(() => {
          const hayFiltros = searchNombre || searchId || filterCat !== 'all' || filterStock !== 'all' || filterBajoStock
          return (
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex flex-1 gap-3 min-w-[200px]">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
                  <input value={searchNombre} onChange={(e) => setSearchNombre(e.target.value)}
                    placeholder="Buscar por nombre..."
                    className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2 text-white
                              text-sm font-body placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all" />
                </div>
                <div className="relative w-40 flex-shrink-0">
                  <input value={searchId} onChange={(e) => setSearchId(e.target.value.replace(/\D/g, ''))}
                    placeholder="ID..."
                    className="w-full bg-surface-700 border border-surface-600 rounded-xl px-4 py-2 text-white
                              text-sm font-mono placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all" />
                </div>
              </div>

              <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
                className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                           font-body focus:outline-none focus:border-brand-500 transition-all cursor-pointer">
                <option value="all" className="font-body">Todas las categorías</option>
                {categorias.map((c) => (
                  <option key={c.idCategoria} value={c.idCategoria} className="font-body">{c.nombre}</option>
                ))}
              </select>

              <select value={filterStock} onChange={(e) => setFilterStock(e.target.value)}
                className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                           font-body focus:outline-none focus:border-brand-500 transition-all cursor-pointer">
                <option value="all" className="font-body">Todo el stock</option>
                <option value="con" className="font-body">Con stock</option>
                <option value="sin" className="font-body">Sin stock</option>
              </select>

              {hayFiltros && (
                <button
                  onClick={() => { setSearchNombre(''); setSearchId(''); setFilterCat('all'); setFilterStock('all'); setFilterBajoStock(false) }}
                  className="flex items-center gap-2 bg-surface-700 border border-surface-600 rounded-xl px-3 py-2
                             text-surface-300 text-sm font-body hover:border-red-500/50 hover:text-red-400
                             hover:bg-red-500/10 transition-all cursor-pointer whitespace-nowrap">
                  <X size={13} /> Limpiar filtros
                </button>
              )}
            </div>
          )
        })()}
      </Card>

      {/* Tabla */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm font-body">
            <thead>
              <tr className="border-b border-surface-700">
                <th className="w-16 text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">ID</th>
                <th className="w-[32%] text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body cursor-pointer hover:text-white transition-colors"
                  onClick={() => toggleSort('nombre')}>
                  <div className="flex items-center gap-1"><span>NOMBRE</span><SortIcon col="nombre" /></div>
                </th>
                <th className="w-44 text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">CATEGORÍA</th>
                <th className="w-36 text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">P. PROVEEDOR</th>
                <th className="w-36 text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body cursor-pointer hover:text-white transition-colors"
                  onClick={() => toggleSort('precio')}>
                  <div className="flex items-center gap-1"><span>P. VENTA</span><SortIcon col="precio" /></div>
                </th>
                <th className="w-24 text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body cursor-pointer hover:text-white transition-colors"
                  onClick={() => toggleSort('stock')}>
                  <div className="flex items-center gap-1"><span>STOCK</span><SortIcon col="stock" /></div>
                </th>
                <th className="w-32 text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">TIPO</th>
                <th className="w-28 py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((p) => (
                <tr key={p.idProducto}
                  className={`border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors
                    ${p.puntoReposicion > 0 && p.stockTotal <= p.puntoReposicion ? 'bg-yellow-500/5' : ''}`}>
                  <Td className="font-mono text-surface-400 whitespace-nowrap">#{p.idProducto}</Td>
                  <Td><span className="text-white font-body">{p.nombre}</span></Td>
                  <Td><div className="truncate"><Badge color="gray">{p.categoriaNombre}</Badge></div></Td>
                  <Td className="font-mono text-surface-400 whitespace-nowrap">
                    {p.precioProveedor > 0 ? fmt(p.precioProveedor) : <span className="text-surface-600">—</span>}
                  </Td>
                  <Td className="font-mono whitespace-nowrap">
                    {p.precioUnitario > 0 ? fmt(p.precioUnitario) : <span className="text-surface-500">—</span>}
                  </Td>
                  <Td>
                    <span className={`font-mono font-medium ${
                      p.stockTotal === 0 ? 'text-red-400'
                      : p.puntoReposicion > 0 && p.stockTotal <= p.puntoReposicion ? 'text-yellow-400'
                      : 'text-emerald-400'}`}>
                      {p.stockTotal}
                    </span>
                  </Td>
                  <Td>
                    {p.tieneMedidas ? <Badge color="blue">Con medidas</Badge> : <Badge color="gray">General</Badge>}
                  </Td>
                  <td className="py-2 px-4">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => { setSelected(p); setModalStock(true) }} title="Actualizar stock"
                        className="p-1.5 text-surface-400 hover:text-emerald-400 transition-colors rounded-lg hover:bg-surface-700">
                        <PackagePlus size={15} />
                      </button>
                      <button onClick={() => { setSelected(p); setModalEditar(true) }} title="Editar"
                        className="p-1.5 text-surface-400 hover:text-brand-400 transition-colors rounded-lg hover:bg-surface-700">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => setDeleteConfirm(p)} title="Eliminar"
                        className="p-1.5 text-surface-400 hover:text-red-400 transition-colors rounded-lg hover:bg-surface-700">
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
          <div className="text-center py-16 text-surface-500 font-body text-sm">Sin resultados para la búsqueda actual.</div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-surface-700">
            <p className="text-surface-400 text-xs font-body">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, productos.length)} de {productos.length}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>← Anterior</Button>
              <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Siguiente →</Button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Modales ── */}
      <NuevoProductoModal open={modalNuevo} onClose={() => setModalNuevo(false)} categorias={categorias}
        onSaved={() => { loadSinResetPage(); setToast('Producto creado correctamente ✓') }} />
      <EditarProductoModal open={modalEditar} onClose={() => setModalEditar(false)} producto={selected} categorias={categorias}
        onSaved={() => { loadSinResetPage(); setToast('Producto actualizado ✓') }} />
      <StockModal open={modalStock} onClose={() => setModalStock(false)} producto={selected}
        onSaved={() => { loadSinResetPage(); setToast('Stock actualizado ✓') }} />
      <CatModal open={modalCat} onClose={() => setModalCat(false)} categorias={categorias}
        onSaved={() => { loadSinResetPage(); setToast('Categoría creada ✓') }} />
      <ActualizarPreciosModal open={modalActualizarPrecios} onClose={() => setModalActualizarPrecios(false)}
        onSaved={() => { loadSinResetPage(); setToast('Precios actualizados correctamente ✓') }} />

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
