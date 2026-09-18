// src/pages/Inventario.jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { usePaginatedList } from '../hooks/usePaginatedList'
import {
  obtenerProductos,
  obtenerCategorias,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
  actualizarCantidadProducto,
  obtenerMedidasDeProducto,
} from '../services/productosService'
import { obtenerProveedores, contarProductosDeProveedor, actualizarPrecioPorProveedor } from '../services/proveedoresService'
import { supabase } from '../lib/supabase'
import { Button, Card, PageHeader, Modal, Input, Select, Badge, Table, Tr, Td } from '../components/ui'
import { Plus, Search, Pencil, Trash2, ChevronDown, ChevronUp, PackagePlus, X, CheckCircle2, TrendingUp, FileSpreadsheet, AlertTriangle, Truck, ChevronsUpDown, Check } from 'lucide-react'
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

function Toast({ message, visible, onDone, type = 'success' }) {
  useEffect(() => {
    if (!visible) return
    const t = setTimeout(onDone, 3800)
    return () => clearTimeout(t)
  }, [visible, onDone])

  const styles = {
    success: { wrap: 'bg-emerald-900/95 border-emerald-500/50', text: 'text-emerald-100', icon: 'text-emerald-400', Icon: CheckCircle2 },
    info:    { wrap: 'bg-amber-900/95 border-amber-500/50',     text: 'text-amber-100',   icon: 'text-amber-400',   Icon: AlertTriangle },
    error:   { wrap: 'bg-red-900/95 border-red-500/50',         text: 'text-red-100',     icon: 'text-red-400',     Icon: AlertTriangle },
  }[type]

  return (
    <div className={`fixed top-5 right-5 z-[9999] transition-all duration-300 pointer-events-none
      ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
      <div className={`flex items-center gap-3 border rounded-2xl px-5 py-3 shadow-2xl backdrop-blur-sm max-w-md ${styles.wrap}`}>
        <styles.Icon size={18} className={`flex-shrink-0 ${styles.icon}`} />
        <span className={`text-sm font-body ${styles.text}`}>{message}</span>
      </div>
    </div>
  )
}

// ─── Selector múltiple de proveedores ──────────────────────────────────────
//
// Un producto puede tener 0..N proveedores asociados (ver 004_producto_proveedor.sql).
// No existe un componente <MultiSelect> en components/ui, así que se resuelve
// acá con un combobox accesible: botón que abre un panel de checkboxes,
// navegable por teclado y anunciado por lectores de pantalla (role="listbox",
// aria-selected por opción, aria-expanded en el trigger).
function ProveedorMultiSelect({ proveedores, value, onChange, error }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    function onClickFuera(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    function onEscape(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClickFuera)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickFuera)
      document.removeEventListener('keydown', onEscape)
    }
  }, [])

  function toggle(idProveedor) {
    if (value.includes(idProveedor)) onChange(value.filter((id) => id !== idProveedor))
    else onChange([...value, idProveedor])
  }

  function quitar(idProveedor) {
    onChange(value.filter((id) => id !== idProveedor))
  }

  const seleccionados = proveedores.filter((p) => value.includes(p.idProveedor))

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1.5">
        Proveedor(es)
      </label>

      <button type="button" onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox" aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 bg-surface-700 border rounded-xl px-3 py-2
          text-left text-sm font-body focus:outline-none focus:border-brand-500 transition-all
          ${error ? 'border-red-500/60' : 'border-surface-600'}`}>
        <span className="flex flex-wrap gap-1.5 min-h-[1.25rem]">
          {seleccionados.length === 0 && (
            <span className="text-surface-500">Sin proveedor asignado (opcional)</span>
          )}
          {seleccionados.map((p) => (
            <span key={p.idProveedor}
              className="inline-flex items-center gap-1 bg-surface-600/70 border border-surface-500/50 rounded-lg px-2 py-0.5 text-xs text-white">
              {p.nombreComercial || p.nombreFiscal}
              <X size={11} className="cursor-pointer hover:text-red-400"
                onClick={(e) => { e.stopPropagation(); quitar(p.idProveedor) }} />
            </span>
          ))}
        </span>
        <ChevronsUpDown size={14} className="flex-shrink-0 text-surface-400" />
      </button>

      {open && (
        <div role="listbox" aria-multiselectable="true"
          className="absolute z-20 mt-1.5 w-full max-h-56 overflow-y-auto bg-surface-800 border border-surface-600
                     rounded-xl shadow-2xl py-1.5">
          {proveedores.length === 0 ? (
            <p className="px-3 py-2 text-surface-500 text-xs font-body">
              No hay proveedores cargados todavía.
            </p>
          ) : (
            proveedores.map((p) => {
              const activo = value.includes(p.idProveedor)
              return (
                <div key={p.idProveedor} role="option" aria-selected={activo} tabIndex={0}
                  onClick={() => toggle(p.idProveedor)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(p.idProveedor) } }}
                  className="flex items-center gap-2.5 px-3 py-2 cursor-pointer text-sm font-body text-surface-200
                             hover:bg-surface-700 transition-colors focus:outline-none focus:bg-surface-700">
                  <span className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center
                    ${activo ? 'bg-brand-500 border-brand-500' : 'border-surface-500'}`}>
                    {activo && <Check size={11} className="text-white" />}
                  </span>
                  <span className="truncate">{p.nombreComercial || p.nombreFiscal}</span>
                </div>
              )
            })
          )}
        </div>
      )}

      {error && <p className="text-red-400 text-xs font-body mt-1">{error}</p>}
    </div>
  )
}

// ─── Modal: editar producto ───────────────────────────────────────────────

function EditarProductoModal({ open, onClose, producto, categorias, proveedores, onSaved }) {
  const [form, setForm] = useState({
    nombre: '', idCategoria: 1, precioProveedor: '', precioUnitario: '', puntoReposicion: '', idsProveedores: [],
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
      // Escenario 2: el producto puede llegar sin proveedor asignado o con
      // uno o más ya asociados — en ambos casos se precarga tal cual está.
      idsProveedores:  (producto.proveedores ?? []).map((p) => p.idProveedor),
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
      }, form.idsProveedores)
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

        <ProveedorMultiSelect proveedores={proveedores} value={form.idsProveedores}
          onChange={(ids) => set('idsProveedores', ids)} />

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

function NuevoProductoModal({ open, onClose, categorias, proveedores, onSaved }) {
  const emptyForm = { nombre: '', idCategoria: categorias[0]?.idCategoria ?? 1, precioUnitario: '', idsProveedores: [] }
  const [form,    setForm]    = useState(emptyForm)
  const [errors,  setErrors]  = useState({})
  const [loading, setLoading] = useState(false)
  // Clave de idempotencia del intento de alta en curso. Se regenera cada vez
  // que se abre el modal (nuevo intento de creación) pero se conserva entre
  // reintentos del MISMO intento (p. ej. si guardar() falla por un error de
  // red transitorio y el usuario le da a "Crear Producto" de nuevo sin
  // cerrar el modal), para que un reintento no pueda crear un duplicado.
  const [idempotencyKey, setIdempotencyKey] = useState(null)

  useEffect(() => {
    if (!open) return
    setForm({ ...emptyForm, idCategoria: categorias[0]?.idCategoria ?? 1 })
    setErrors({})
    setIdempotencyKey(crypto.randomUUID())
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
      }, form.idsProveedores, idempotencyKey)
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
        <ProveedorMultiSelect proveedores={proveedores} value={form.idsProveedores}
          onChange={(ids) => set('idsProveedores', ids)} />
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

// ─── Modal: actualizar precio proveedor (costo) por proveedor ────────────
//
// Distinto del modal anterior: ese actualiza precio_unitario (venta) sobre
// TODOS los productos usando su propio precio_proveedor como base. Este
// actualiza precio_proveedor (costo) y solo para los productos asociados a
// UN proveedor puntual — ver historia "Actualizar precio de producto por
// proveedor aplicando un margen de aumento porcentual".
function ActualizarPrecioPorProveedorModal({ open, onClose, onSaved, proveedores }) {
  const [idProveedor,  setIdProveedor]  = useState('')
  const [margen,       setMargen]       = useState('')
  const [confirmado,   setConfirmado]   = useState(false)
  const [cantidad,     setCantidad]     = useState(null) // null = todavía no se consultó
  const [loadingCount, setLoadingCount] = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')
  const idempotencyKeyRef = useRef(null)

  // Una clave de idempotencia por apertura de modal (un "intento de
  // guardado"), no una por click: si el usuario reintenta tras un error de
  // red sin cerrar el modal, reutiliza la misma clave — ver justificación
  // completa en proveedoresService.actualizarPrecioPorProveedor().
  useEffect(() => {
    if (!open) return
    idempotencyKeyRef.current = crypto.randomUUID()
    setIdProveedor(''); setMargen(''); setConfirmado(false)
    setCantidad(null); setError(''); setLoading(false)
  }, [open])

  // Escenario 3: apenas se elige un proveedor, chequeamos si tiene
  // productos asociados ANTES de dejar avanzar al margen y la confirmación.
  useEffect(() => {
    if (!idProveedor) { setCantidad(null); return }
    let cancelado = false
    setLoadingCount(true); setConfirmado(false)
    contarProductosDeProveedor(Number(idProveedor))
      .then((n) => { if (!cancelado) setCantidad(n) })
      .catch(() => { if (!cancelado) { setCantidad(null); setError('No se pudo verificar los productos de este proveedor.') } })
      .finally(() => { if (!cancelado) setLoadingCount(false) })
    return () => { cancelado = true }
  }, [idProveedor])

  const proveedorSeleccionado = proveedores.find((p) => p.idProveedor === Number(idProveedor))
  const sinProductos = idProveedor !== '' && !loadingCount && cantidad === 0

  function validarMargen(valor) {
    if (valor.trim() === '') return 'Ingresá un margen de aumento.'
    const n = parseFloat(valor.replace(',', '.'))
    if (isNaN(n)) return 'El margen debe ser un número.'
    if (n <= 0) return 'El margen debe ser mayor a 0%.'
    if (n > 1000) return 'Ese margen es demasiado alto. Revisá el valor.'
    return ''
  }

  const errorMargen    = margen ? validarMargen(margen) : ''
  const puedeConfirmar = idProveedor && cantidad > 0 && margen && !errorMargen && confirmado && !loading && !loadingCount

  async function confirmar() {
    const mensaje = validarMargen(margen)
    if (mensaje) { setError(mensaje); return } // defensa extra: cubre un submit por Enter con el botón deshabilitado
    if (!idProveedor || !cantidad) return

    setLoading(true); setError('')
    try {
      const mg = parseFloat(margen.replace(',', '.'))
      const resultado = await actualizarPrecioPorProveedor(Number(idProveedor), mg, idempotencyKeyRef.current)

      if (resultado.resultado === 'sin_productos') {
        // Carrera improbable: el proveedor se quedó sin productos asociados
        // entre el conteo inicial y la confirmación. Se informa sin
        // tratarlo como error de sistema, y no se cierra el modal para que
        // el usuario pueda elegir otro proveedor.
        setCantidad(0)
        setError('Este proveedor ya no tiene productos asociados. No se realizó ningún cambio.')
        return
      }

      onSaved(resultado.cantidadProductos)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Actualizar Precio por Proveedor" width="max-w-md">
      <div className="space-y-4">
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
          <p className="text-amber-200 text-sm font-body">
            Esta acción actualiza el <strong>precio proveedor (costo)</strong> de los productos asociados
            al proveedor elegido. No modifica el precio de venta.
          </p>
        </div>

        <Select label="Proveedor" value={idProveedor} disabled={loading}
          onChange={(e) => setIdProveedor(e.target.value)}>
          <option value="">Seleccioná un proveedor…</option>
          {proveedores.map((p) => (
            <option key={p.idProveedor} value={p.idProveedor} className="font-body">
              {p.nombreComercial || p.nombreFiscal}
            </option>
          ))}
        </Select>

        {idProveedor !== '' && (
          <div className="text-sm font-body">
            {loadingCount ? (
              <p className="text-surface-400">Buscando productos asociados…</p>
            ) : sinProductos ? (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
                <AlertTriangle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-300">Este proveedor no tiene productos asociados. No hay nada para actualizar.</p>
              </div>
            ) : cantidad > 0 ? (
              <p className="text-surface-300 flex items-center gap-1.5">
                <Truck size={13} className="text-surface-400 flex-shrink-0" />
                {cantidad} producto{cantidad === 1 ? '' : 's'} asociado{cantidad === 1 ? '' : 's'} — se {cantidad === 1 ? 'actualizará' : 'actualizarán'} su precio proveedor.
              </p>
            ) : null}
          </div>
        )}

        {cantidad > 0 && (
          <>
            <div className="relative">
              <TrendingUp size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
              <input type="text" inputMode="decimal" value={margen} disabled={loading}
                onChange={(e) => {
                  const v = e.target.value.replace(',', '.')
                  if (/^-?\d*\.?\d*$/.test(v)) { setMargen(v); setConfirmado(false); setError('') }
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmar() }}
                placeholder="Margen de aumento (%)"
                className={`w-full bg-surface-700 border rounded-xl pl-9 pr-10 py-2 text-white
                           text-sm font-mono focus:outline-none focus:border-brand-500 transition-all
                           ${errorMargen ? 'border-red-500/60' : 'border-surface-600'}`} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm font-mono">%</span>
            </div>
            {errorMargen && <p className="text-red-400 text-xs font-body -mt-2">{errorMargen}</p>}

            {margen && !errorMargen && (
              <label className="flex items-start gap-2.5 text-sm font-body text-surface-300 cursor-pointer select-none">
                <input type="checkbox" checked={confirmado} disabled={loading}
                  onChange={(e) => setConfirmado(e.target.checked)}
                  className="mt-0.5 accent-brand-500 cursor-pointer" />
                <span>
                  Confirmo que quiero aumentar el precio proveedor de <strong>{cantidad}</strong> producto{cantidad === 1 ? '' : 's'} de{' '}
                  <strong>{proveedorSeleccionado?.nombreComercial || proveedorSeleccionado?.nombreFiscal}</strong> en un {margen}%.
                </span>
              </label>
            )}
          </>
        )}

        {error && <p className="text-red-400 text-sm font-body">{error}</p>}

        <div className="flex gap-2 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button className="flex-1" onClick={confirmar} disabled={!puedeConfirmar}>
            {loading ? 'Actualizando...' : 'Actualizar precios'}
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
  const [categorias,   setCategorias]   = useState([])
  const [proveedores,  setProveedores]  = useState([])
  const [searchNombre, setSearchNombre] = useState('')
  const [searchId,     setSearchId]     = useState('')
  const [filterCat,    setFilterCat]    = useState('all')
  const [filterProveedor, setFilterProveedor] = useState('all')
  const [filterStock,  setFilterStock]  = useState('all')
  const [filterBajoStock, setFilterBajoStock] = useState(false)
  const [sortKey,      setSortKey]      = useState('nombre')
  const [sortDir,      setSortDir]      = useState('asc')

  const [modalNuevo,   setModalNuevo]   = useState(false)
  const [modalEditar,  setModalEditar]  = useState(false)
  const [modalStock,   setModalStock]   = useState(false)
  const [modalCat,     setModalCat]     = useState(false)
  const [modalActualizarPrecios, setModalActualizarPrecios] = useState(false)
  const [modalActualizarPrecioProveedor, setModalActualizarPrecioProveedor] = useState(false)
  const [selected,      setSelected]      = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [toast,         setToast]         = useState(null)

  const showToast = useCallback((message, type = 'success') => setToast({ message, type }), [])

  // ── Datos + paginación ────────────────────────────────────────────────
  // El fetcher trae categorías y proveedores como efecto colateral (los
  // necesita el resto de la pantalla) y devuelve solo el array de
  // productos, que es lo que el hook filtra/ordena/pagina.
  // `reload()` (alias `loadSinResetPage` más abajo) NUNCA resetea `page`:
  // por eso guardar un producto desde la página 3 ya no vuelve a la 1.
  const {
    pageItems: paginated,
    items:     productos,
    rawItems:  allProductos,
    page, setPage, totalPages,
    reload,
  } = usePaginatedList({
    fetcher: async () => {
      // incluirInactivos: false → los productos dados de baja lógica nunca
      // vuelven a listarse en el catálogo, sin necesidad de filtro visual.
      const [cats, prods, provs] = await Promise.all([
        obtenerCategorias(),
        obtenerProductos({ incluirInactivos: false }),
        obtenerProveedores(),
      ])
      setCategorias(cats)
      setProveedores(provs)
      return prods.map((p) => ({ ...p, categoriaNombre: p.categoria, stockTotal: p.cantidad }))
    },
    clientFilters: { searchNombre, searchId, filterCat, filterProveedor, filterStock, filterBajoStock, sortKey, sortDir },
    clientFilter: (p, cf) => {
      if (cf.searchId.trim() && String(p.idProducto) !== cf.searchId.trim()) return false
      if (cf.searchNombre.trim() && !normalize(p.nombre).includes(normalize(cf.searchNombre.trim()))) return false
      if (cf.filterCat !== 'all' && p.idCategoria !== parseInt(cf.filterCat)) return false
      if (cf.filterProveedor !== 'all') {
        const idProv = parseInt(cf.filterProveedor)
        if (!(p.proveedores ?? []).some((pv) => pv.idProveedor === idProv)) return false
      }
      if (cf.filterStock === 'con' && !(p.stockTotal > 0)) return false
      if (cf.filterStock === 'sin' && !(p.stockTotal === 0)) return false
      if (cf.filterBajoStock && !(p.puntoReposicion > 0 && p.stockTotal <= p.puntoReposicion)) return false
      return true
    },
    sort: (a, b, cf) => {
      let valA, valB
      if (cf.sortKey === 'stock')       { valA = a.stockTotal;     valB = b.stockTotal }
      else if (cf.sortKey === 'precio') { valA = a.precioUnitario; valB = b.precioUnitario }
      else                              { valA = a.nombre;          valB = b.nombre }
      if (typeof valA === 'string') return cf.sortDir === 'asc' ? valA.localeCompare(valB, 'es') : valB.localeCompare(valA, 'es')
      return cf.sortDir === 'asc' ? valA - valB : valB - valA
    },
    pageSize: PAGE_SIZE,
  })

  const loadSinResetPage = reload

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
      // eliminarProducto resuelve en el servidor, de forma atómica, si el
      // producto se puede borrar físicamente o si -por tener historial en
      // presupuestos/facturas- debe darse de baja lógica en su lugar. En
      // cualquier caso, para quien usa Inventario el resultado visible es
      // el mismo: el producto deja de listarse.
      await eliminarProducto(p.idProducto)
      setDeleteConfirm(null)
      loadSinResetPage()
      showToast(`"${p.nombre.slice(0, 30)}" eliminado`)
    } catch (err) {
      console.error('[Inventario] Error eliminando:', err)
      // No se expone el mensaje técnico del backend: solo un aviso genérico.
      showToast('No se pudo eliminar el producto. Intentá nuevamente.', 'error')
      setDeleteConfirm(null)
    }
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

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <Toast message={toast?.message} type={toast?.type} visible={!!toast} onDone={() => setToast(null)} />

      <PageHeader title="Inventario" subtitle="Gestión de productos"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setModalCat(true)}>+ Categoría</Button>
            <Button variant="secondary" onClick={() => setModalActualizarPrecios(true)}>Actualizar Precios de Venta</Button>
            <Button variant="secondary" icon={Truck} onClick={() => setModalActualizarPrecioProveedor(true)}>Precio por Proveedor</Button>
            <Button variant="secondary" icon={FileSpreadsheet} onClick={exportarExcel}>Exportar Lista</Button>
            <Button icon={PackagePlus} onClick={() => setModalNuevo(true)}>Nuevo Producto</Button>
          </div>
        }
      />

      {/* Resumen rápido */}
      {(() => {
        const hayFiltrosActivos = searchNombre || searchId || filterCat !== 'all' || filterProveedor !== 'all' || filterStock !== 'all' || filterBajoStock
        // Con filtros activos los contadores reflejan la selección actual;
        // sin filtros muestran los totales reales del catálogo completo.
        const base = hayFiltrosActivos ? productos : allProductos
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
              <p className="text-surface-400 text-xs uppercase tracking-widest font-body">
                {hayFiltrosActivos ? 'Productos filtrados' : 'Total productos'}
              </p>
              <p className="font-display text-3xl text-white tracking-widest mt-0.5">{base.length}</p>
              {hayFiltrosActivos && (
                <p className="text-surface-500 text-xs font-body mt-1">de {allProductos.length} totales</p>
              )}
            </div>
            <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
              <p className="text-surface-400 text-xs uppercase tracking-widest font-body">Con stock</p>
              <p className="font-display text-3xl text-white tracking-widest mt-0.5">
                {base.filter((p) => p.stockTotal > 0).length}
              </p>
            </div>
            <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
              <p className="text-surface-400 text-xs uppercase tracking-widest font-body">Sin stock</p>
              <p className="font-display text-3xl text-white tracking-widest mt-0.5">
                {base.filter((p) => p.stockTotal === 0).length}
              </p>
            </div>
            <button onClick={() => setFilterBajoStock((v) => !v)}
              className={`rounded-xl p-4 border text-left transition-all
                ${filterBajoStock ? 'bg-yellow-500/20 border-yellow-400/60' : 'bg-yellow-500/10 border-yellow-500/30 hover:bg-yellow-500/15'}`}>
              <p className="text-yellow-300 text-xs uppercase tracking-widest font-body">Bajo stock</p>
              <p className="font-display text-3xl text-yellow-200 tracking-widest mt-0.5">
                {base.filter((p) => p.puntoReposicion > 0 && p.stockTotal <= p.puntoReposicion).length}
              </p>
              <p className="text-yellow-400/70 text-xs mt-1">Click para filtrar</p>
            </button>
          </div>
        )
      })()}

      {/* Filtros */}
      <Card className="p-4">
        {(() => {
          const hayFiltros = searchNombre || searchId || filterCat !== 'all' || filterProveedor !== 'all' || filterStock !== 'all' || filterBajoStock
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

              <select value={filterProveedor} onChange={(e) => setFilterProveedor(e.target.value)}
                className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                           font-body focus:outline-none focus:border-brand-500 transition-all cursor-pointer">
                <option value="all" className="font-body">Todos los proveedores</option>
                {proveedores.map((p) => (
                  <option key={p.idProveedor} value={p.idProveedor} className="font-body">
                    {p.nombreComercial || p.nombreFiscal}
                  </option>
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
                  onClick={() => { setSearchNombre(''); setSearchId(''); setFilterCat('all'); setFilterProveedor('all'); setFilterStock('all'); setFilterBajoStock(false) }}
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
                  <Td>
                    <span className="text-white font-body">{p.nombre}</span>
                    {p.proveedores?.length > 0 ? (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        <Truck size={11} className="text-surface-500 flex-shrink-0" />
                        {p.proveedores.slice(0, 2).map((pv) => (
                          <span key={pv.idProveedor} className="text-surface-400 text-xs font-body truncate">
                            {pv.nombreComercial || pv.nombreFiscal}
                            {p.proveedores.indexOf(pv) < Math.min(1, p.proveedores.length - 1) ? ',' : ''}
                          </span>
                        ))}
                        {p.proveedores.length > 2 && (
                          <span className="text-surface-500 text-xs font-body">+{p.proveedores.length - 2}</span>
                        )}
                      </div>
                    ) : (
                      <p className="text-surface-600 text-xs font-body mt-1">Sin proveedor asignado</p>
                    )}
                  </Td>
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
      <NuevoProductoModal open={modalNuevo} onClose={() => setModalNuevo(false)} categorias={categorias} proveedores={proveedores}
        onSaved={() => { loadSinResetPage(); showToast('Producto creado correctamente ✓') }} />
      <EditarProductoModal open={modalEditar} onClose={() => setModalEditar(false)} producto={selected} categorias={categorias} proveedores={proveedores}
        onSaved={() => { loadSinResetPage(); showToast('Producto actualizado ✓') }} />
      <StockModal open={modalStock} onClose={() => setModalStock(false)} producto={selected}
        onSaved={() => { loadSinResetPage(); showToast('Stock actualizado ✓') }} />
      <CatModal open={modalCat} onClose={() => setModalCat(false)} categorias={categorias}
        onSaved={() => { loadSinResetPage(); showToast('Categoría creada ✓') }} />
      <ActualizarPreciosModal open={modalActualizarPrecios} onClose={() => setModalActualizarPrecios(false)}
        onSaved={() => { loadSinResetPage(); showToast('Precios actualizados correctamente ✓') }} />
      <ActualizarPrecioPorProveedorModal open={modalActualizarPrecioProveedor} proveedores={proveedores}
        onClose={() => setModalActualizarPrecioProveedor(false)}
        onSaved={(cantidad) => {
          loadSinResetPage()
          showToast(`Precio proveedor actualizado en ${cantidad} producto${cantidad === 1 ? '' : 's'} ✓`)
        }} />

      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Confirmar eliminación" width="max-w-sm">
        <p className="text-surface-300 text-sm font-body mb-4">
          ¿Eliminar <span className="text-white font-medium">"{deleteConfirm?.nombre?.slice(0, 50)}"</span>?
          Esta acción no se puede deshacer y el producto dejará de aparecer en el catálogo.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
          <Button variant="danger" className="flex-1" onClick={() => eliminar(deleteConfirm)}>Eliminar</Button>
        </div>
      </Modal>
    </div>
  )
}
