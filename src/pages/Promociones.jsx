// src/pages/Promociones.jsx
// ABMC completo para el sistema de Promociones.
// Refactorizado para usar exclusivamente promocionesService y productosService.
// Sin lógica de BD directa en el componente.

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  obtenerPromociones,
  crearPromocion,
  actualizarPromocion,
  togglePromocion,
} from '../services/promocionesService'
import { obtenerProductos, obtenerCategorias } from '../services/productosService'
import { Button, Card, PageHeader, Modal, Input } from '../components/ui'
import { Plus, Tag, Edit2, Power, PowerOff, AlertCircle, CheckCircle2, X, Search } from 'lucide-react'
import { createPortal } from 'react-dom'

// ─── Helpers ────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10) }

function fmtFecha(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const TIPO_LABELS = {
  porcentaje_producto: '% Descuento',
  '2x1':              '2×1',
  precio_fijo:        'Precio fijo',
}

const ALCANCE_LABELS = {
  producto:  'Producto',
  categoria: 'Categoría',
  global:    'Global',
}

function vigenciaLabel(promo) {
  const hoy = today()
  if (hoy < promo.fechaInicio) return { text: 'Próxima',  color: 'text-brand-400' }
  if (hoy > promo.fechaFin)    return { text: 'Vencida',  color: 'text-red-400'   }
  return                              { text: 'Vigente',  color: 'text-emerald-400' }
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

// ─── Estado inicial del formulario ─────────────────────────────────────────

const FORM_EMPTY = {
  nombre:      '',
  descripcion: '',
  tipo:        'porcentaje_producto',
  alcance:     'global',
  idProducto:  '',
  idCategoria: '',
  fechaInicio: today(),
  fechaFin:    '',
  valor:       '',
  activo:      true,
}

// ─── Buscador de producto ────────────────────────────────────────────────────

function norm(s) {
  return (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * Input de búsqueda de producto con dropdown filtrado.
 * Cuando el usuario selecciona un producto guarda su idProducto.
 * Si borra el texto limpia la selección.
 *
 * Props:
 *   value       {string}   – idProducto seleccionado actualmente
 *   onChange    {fn}       – recibe el nuevo idProducto (string) o ''
 *   productos   {array}    – lista completa { idProducto, nombre }
 *   error       {string}   – mensaje de error a mostrar
 */
function ProductoBuscador({ value, onChange, productos, error }) {
  const [search,   setSearch]   = useState('')
  const [results,  setResults]  = useState([])
  const [showDrop, setShowDrop] = useState(false)
  const wrapRef = useRef(null)

  // Sincronizar el label cuando el valor externo cambia (ej: al abrir modal de edición)
  useEffect(() => {
    if (value) {
      const prod = productos.find(p => String(p.idProducto) === String(value))
      if (prod) setSearch(`#${prod.idProducto} · ${prod.nombre}`)
    } else {
      setSearch('')
    }
  }, [value, productos])

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    const handler = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowDrop(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function buscar(text) {
    setSearch(text)
    onChange('')
    if (!text.trim()) { setResults([]); setShowDrop(false); return }
    const normText = norm(text.trim())
    const filtered = productos
      .filter(p =>
        norm(p.nombre).includes(normText) ||
        String(p.idProducto).includes(text.trim())
      )
      .slice(0, 12)
    setResults(filtered)
    setShowDrop(true)
  }

  function seleccionar(p) {
    setSearch(`#${p.idProducto} · ${p.nombre}`)
    onChange(String(p.idProducto))
    setShowDrop(false)
    setResults([])
  }

  function limpiar() {
    setSearch('')
    onChange('')
    setResults([])
    setShowDrop(false)
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
        <input
          value={search}
          onChange={e => buscar(e.target.value)}
          onFocus={() => { if (results.length) setShowDrop(true) }}
          placeholder="Buscá por nombre o ID..."
          className={`w-full bg-surface-700 border rounded-xl pl-8 pr-8 py-2.5 text-white text-sm
                      font-body placeholder-surface-500 focus:outline-none focus:border-brand-500
                      focus:ring-1 focus:ring-brand-500/30 transition-all
                      ${error ? 'border-red-500' : 'border-surface-600'}`}
        />
        {search && (
          <button
            type="button"
            onClick={limpiar}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-white transition-colors text-lg leading-none">
            ×
          </button>
        )}
      </div>

      {showDrop && (
        <div className="absolute z-[9999] top-full mt-1 w-full bg-surface-800 border border-surface-600
                        rounded-xl shadow-2xl overflow-hidden max-h-[220px] overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-surface-300 text-xs font-body">Sin resultados para "{search}"</p>
          ) : (
            results.map(p => (
              <button
                key={p.idProducto}
                type="button"
                onClick={() => seleccionar(p)}
                className="w-full text-left px-4 py-2.5 hover:bg-surface-700 transition-colors
                           border-b border-surface-700/60 last:border-0">
                <p className="text-white text-sm font-body leading-tight">{p.nombre}</p>
                <p className="text-surface-400 text-xs font-mono mt-0.5">#{p.idProducto}</p>
              </button>
            ))
          )}
        </div>
      )}

      {error && <p className="text-red-400 text-xs mt-1 font-body">{error}</p>}
    </div>
  )
}

// ─── Modal Formulario ───────────────────────────────────────────────────────

function PromoModal({ open, onClose, onSaved, promoEditar }) {
  const [form,      setForm]      = useState(FORM_EMPTY)
  const [errors,    setErrors]    = useState({})
  const [productos,  setProductos]  = useState([])
  const [categorias, setCategorias] = useState([])
  const [loading,   setLoading]   = useState(false)

  const esNueva = !promoEditar

  // Cargar listas auxiliares al abrir
  useEffect(() => {
    if (!open) return
    // obtenerProductos() devuelve { idProducto, nombre, ... } — compatible con ProductoBuscador
    obtenerProductos().then(setProductos).catch(console.error)
    obtenerCategorias().then(setCategorias).catch(console.error)
  }, [open])

  // Rellenar form si estamos editando
  useEffect(() => {
    if (!open) { setForm(FORM_EMPTY); setErrors({}); return }
    if (promoEditar) {
      setForm({
        nombre:      promoEditar.nombre      ?? '',
        descripcion: promoEditar.descripcion ?? '',
        tipo:        promoEditar.tipo        ?? 'porcentaje_producto',
        alcance:     promoEditar.alcance     ?? 'global',
        // el service devuelve números; el buscador compara con String()
        idProducto:  promoEditar.idProducto  != null ? String(promoEditar.idProducto) : '',
        idCategoria: promoEditar.idCategoria != null ? String(promoEditar.idCategoria) : '',
        fechaInicio: promoEditar.fechaInicio ?? today(),
        fechaFin:    promoEditar.fechaFin    ?? '',
        valor:       promoEditar.valor       != null ? String(promoEditar.valor) : '',
        // el service devuelve boolean; el form lo mantiene como boolean
        activo:      promoEditar.activo      ?? true,
      })
    } else {
      setForm(FORM_EMPTY)
    }
    setErrors({})
  }, [open, promoEditar])

  function set(k, v) { setForm(p => ({ ...p, [k]: v })) }

  // ¿Requiere campo `valor`?
  const requiereValor = form.tipo === 'porcentaje_producto' || form.tipo === 'precio_fijo'

  function validar() {
    const e = {}
    if (!form.nombre.trim())              e.nombre      = 'Requerido'
    if (!form.fechaInicio)                e.fechaInicio = 'Requerido'
    if (!form.fechaFin)                   e.fechaFin    = 'Requerido'
    if (form.fechaFin && form.fechaInicio && form.fechaFin < form.fechaInicio)
                                          e.fechaFin    = 'Debe ser ≥ fecha de inicio'
    if (requiereValor) {
      const v = parseFloat(form.valor)
      if (!form.valor || isNaN(v) || v <= 0) e.valor = 'Debe ser un número mayor a 0'
    }
    if (form.alcance === 'producto' && !form.idProducto)
                                          e.idProducto  = 'Seleccioná un producto'
    if (form.alcance === 'categoria' && !form.idCategoria)
                                          e.idCategoria = 'Seleccioná una categoría'
    return e
  }

  async function guardar() {
    const e = validar()
    setErrors(e)
    if (Object.keys(e).length) return

    // Construir el payload en el formato que espera el service
    const payload = {
      nombre:      form.nombre.trim(),
      descripcion: form.descripcion.trim() || null,
      tipo:        form.tipo,
      alcance:     form.alcance,
      idProducto:  form.alcance === 'producto'  ? parseInt(form.idProducto,  10) : null,
      idCategoria: form.alcance === 'categoria' ? parseInt(form.idCategoria, 10) : null,
      fechaInicio: form.fechaInicio,
      fechaFin:    form.fechaFin,
      valor:       requiereValor ? parseFloat(form.valor) : null,
      activo:      form.activo,
    }

    setLoading(true)
    try {
      if (esNueva) {
        await crearPromocion(payload)
      } else {
        await actualizarPromocion(promoEditar.idPromocion, payload)
      }
      onClose()
      onSaved(esNueva ? 'Promoción creada correctamente ✓' : 'Promoción actualizada ✓')
    } catch (err) {
      setErrors({ _general: err.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={esNueva ? 'Nueva Promoción' : 'Editar Promoción'}>
      <div className="space-y-4">

        {/* Error general (fallo de red / BD) */}
        {errors._general && (
          <div className="flex items-center gap-2 bg-red-900/30 border border-red-500/40 rounded-xl px-4 py-3">
            <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
            <p className="text-red-300 text-xs font-body">{errors._general}</p>
          </div>
        )}

        {/* Nombre */}
        <Input
          label="Nombre *"
          value={form.nombre}
          onChange={e => set('nombre', e.target.value)}
          error={errors.nombre}
          placeholder="Ej: Descuento verano 20%"
        />

        {/* Descripción */}
        <div>
          <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1">Descripción</label>
          <textarea
            value={form.descripcion}
            onChange={e => set('descripcion', e.target.value)}
            rows={2}
            placeholder="Descripción opcional de la promo..."
            className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white text-sm
                       font-body placeholder-surface-500 focus:outline-none focus:border-brand-500
                       focus:ring-1 focus:ring-brand-500/30 transition-all resize-none"
          />
        </div>

        {/* Tipo + Alcance */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1">Tipo *</label>
            <select value={form.tipo} onChange={e => set('tipo', e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-white text-sm
                         font-body focus:outline-none focus:border-brand-500 transition-all cursor-pointer">
              <option value="porcentaje_producto">% Descuento</option>
              <option value="precio_fijo">Precio fijo</option>
            </select>
          </div>
          <div>
            <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1">Alcance *</label>
            <select value={form.alcance} onChange={e => set('alcance', e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-white text-sm
                         font-body focus:outline-none focus:border-brand-500 transition-all cursor-pointer">
              <option value="global">Global (todo el carrito)</option>
              <option value="producto">Producto específico</option>
              <option value="categoria">Categoría</option>
            </select>
          </div>
        </div>

        {/* Campos condicionales por alcance */}
        {form.alcance === 'producto' && (
          <div>
            <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1">Producto *</label>
            <ProductoBuscador
              value={form.idProducto}
              onChange={v => set('idProducto', v)}
              productos={productos}
              error={errors.idProducto}
            />
          </div>
        )}

        {form.alcance === 'categoria' && (
          <div>
            <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1">Categoría *</label>
            <select value={form.idCategoria} onChange={e => set('idCategoria', e.target.value)}
              className={`w-full bg-surface-700 border rounded-xl px-3 py-2.5 text-white text-sm
                         font-body focus:outline-none focus:border-brand-500 transition-all cursor-pointer
                         ${errors.idCategoria ? 'border-red-500' : 'border-surface-600'}`}>
              <option value="">— Seleccioná una categoría —</option>
              {categorias.map(c => (
                <option key={c.idCategoria} value={c.idCategoria}>{c.nombre}</option>
              ))}
            </select>
            {errors.idCategoria && <p className="text-red-400 text-xs mt-1 font-body">{errors.idCategoria}</p>}
          </div>
        )}

        {/* Valor — solo para tipos que lo requieren */}
        {requiereValor && (
          <Input
            label={form.tipo === 'porcentaje_producto' ? 'Descuento (%) *' : 'Precio fijo (ARS) *'}
            value={form.valor}
            onChange={e => { const v = e.target.value.replace(',', '.'); if (/^\d*\.?\d*$/.test(v)) set('valor', v) }}
            error={errors.valor}
            placeholder={form.tipo === 'porcentaje_producto' ? 'Ej: 15 (para 15%)' : 'Ej: 9500'}
            inputMode="decimal"
          />
        )}

        {/* Fechas de vigencia */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1">Desde *</label>
            <input type="date" value={form.fechaInicio} onChange={e => set('fechaInicio', e.target.value)}
              className={`w-full bg-surface-700 border rounded-xl px-3 py-2.5 text-white text-sm
                         font-mono focus:outline-none focus:border-brand-500 transition-all
                         ${errors.fechaInicio ? 'border-red-500' : 'border-surface-600'}`} />
            {errors.fechaInicio && <p className="text-red-400 text-xs mt-1 font-body">{errors.fechaInicio}</p>}
          </div>
          <div>
            <label className="block text-surface-300 text-xs tracking-widest uppercase font-body mb-1">Hasta *</label>
            <input type="date" value={form.fechaFin} onChange={e => set('fechaFin', e.target.value)}
              min={form.fechaInicio || undefined}
              className={`w-full bg-surface-700 border rounded-xl px-3 py-2.5 text-white text-sm
                         font-mono focus:outline-none focus:border-brand-500 transition-all
                         ${errors.fechaFin ? 'border-red-500' : 'border-surface-600'}`} />
            {errors.fechaFin && <p className="text-red-400 text-xs mt-1 font-body">{errors.fechaFin}</p>}
          </div>
        </div>

        {/* Preview de la promo */}
        {form.nombre && form.fechaInicio && form.fechaFin && (
          <div className="bg-surface-700/50 border border-surface-600 rounded-xl px-4 py-3 text-xs font-body space-y-1">
            <p className="text-surface-400 uppercase tracking-widest">Vista previa</p>
            <p className="text-white">
              <span className="text-brand-400 font-semibold">{form.nombre}</span>
              {' · '}
              {TIPO_LABELS[form.tipo]}
              {requiereValor && form.valor ? (form.tipo === 'porcentaje_producto' ? ` −${form.valor}%` : ` $${form.valor}`) : ''}
              {' · '}
              {ALCANCE_LABELS[form.alcance]}
            </p>
            <p className="text-surface-400">
              Vigente del {fmtFecha(form.fechaInicio)} al {fmtFecha(form.fechaFin)}
            </p>
          </div>
        )}

        {/* Botones */}
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button className="flex-1" onClick={guardar} disabled={loading}>
            {loading
              ? (esNueva ? 'Creando…' : 'Guardando…')
              : (esNueva ? 'Crear Promoción' : 'Guardar Cambios')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Página principal ────────────────────────────────────────────────────────

export default function Promociones() {
  const [promos,    setPromos]    = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editando,  setEditando]  = useState(null)
  const [toast,     setToast]     = useState('')
  const [filtro,    setFiltro]    = useState('todas') // 'todas' | 'activas' | 'inactivas'

  // ── Carga de datos ──────────────────────────────────────────────────────
  // obtenerPromociones ordena por fecha_inicio DESC por defecto.
  // El .jsx original ordenaba: activo DESC, fechaFin DESC, idPromocion DESC.
  // Replicamos ese orden en el cliente (sin tocar el service) para no romper
  // la presentación visual sin necesidad de un nuevo parámetro de orden.
  const cargar = useCallback(async () => {
    try {
      const data = await obtenerPromociones()
      // Replicar el orden original: activo DESC → fechaFin DESC → idPromocion DESC
      data.sort((a, b) => {
        if (b.activo !== a.activo) return (b.activo ? 1 : 0) - (a.activo ? 1 : 0)
        if (b.fechaFin !== a.fechaFin) return b.fechaFin.localeCompare(a.fechaFin)
        return b.idPromocion - a.idPromocion
      })
      setPromos(data)
    } catch (err) {
      console.error('[Promociones] cargar:', err.message)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // ── Toggle activo/inactivo ──────────────────────────────────────────────
  async function toggleActivo(promo) {
    try {
      await togglePromocion(promo.idPromocion, !promo.activo)
      await cargar()
      setToast(promo.activo ? 'Promoción desactivada' : 'Promoción activada ✓')
    } catch (err) {
      console.error('[Promociones] toggleActivo:', err.message)
    }
  }

  function abrirNueva()        { setEditando(null);  setModalOpen(true) }
  function abrirEditar(promo)  { setEditando(promo); setModalOpen(true) }

  async function handleSaved(msg) {
    await cargar()
    setToast(msg)
  }

  // ── Filtros client-side ─────────────────────────────────────────────────
  // El service devuelve `activo` como boolean; comparamos con true/false.
  const promosFiltradas = promos.filter(p => {
    if (filtro === 'activas')   return p.activo === true
    if (filtro === 'inactivas') return p.activo === false
    return true
  })

  // ── Resumen rápido ──────────────────────────────────────────────────────
  const hoy = today()
  const totalActivas  = promos.filter(p => p.activo === true  && p.fechaInicio <= hoy && p.fechaFin >= hoy).length
  const totalProximas = promos.filter(p => p.activo === true  && p.fechaInicio  > hoy).length
  const totalVencidas = promos.filter(p => p.fechaFin < hoy).length

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}

      <div className="flex items-center justify-between">
        <PageHeader title="Promociones" subtitle="Gestioná descuentos y ofertas especiales" />
        <Button icon={Plus} onClick={abrirNueva}>Nueva Promoción</Button>
      </div>

      {/* Resumen rápido */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Vigentes hoy', value: totalActivas,  color: 'text-emerald-400' },
          { label: 'Próximas',     value: totalProximas, color: 'text-brand-400'   },
          { label: 'Vencidas',     value: totalVencidas, color: 'text-surface-400' },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-4 text-center">
            <p className={`text-2xl font-display font-bold ${color}`}>{value}</p>
            <p className="text-surface-400 text-xs font-body mt-1 uppercase tracking-widest">{label}</p>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        {[
          { key: 'todas',     label: 'Todas'     },
          { key: 'activas',   label: 'Activas'   },
          { key: 'inactivas', label: 'Inactivas' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFiltro(f.key)}
            className={`px-4 py-1.5 rounded-xl text-sm font-body transition-all border
              ${filtro === f.key
                ? 'bg-brand-500/15 border-brand-500/50 text-white'
                : 'bg-surface-700 border-surface-600 text-surface-400 hover:border-surface-500'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Tabla de promociones */}
      <Card className="overflow-hidden">
        {promosFiltradas.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <Tag size={40} className="text-surface-600 mx-auto" />
            <p className="text-surface-400 font-body text-sm">
              {filtro === 'todas'
                ? 'Todavía no hay promociones. Creá la primera.'
                : `No hay promociones ${filtro}.`}
            </p>
            {filtro === 'todas' && (
              <Button size="sm" icon={Plus} onClick={abrirNueva}>Nueva Promoción</Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-700">
                  {['Nombre','Tipo','Alcance','Vigencia','Estado',''].map(h => (
                    <th key={h} className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {promosFiltradas.map(promo => {
                  const vig = vigenciaLabel(promo)
                  return (
                    <tr key={promo.idPromocion} className="border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors">

                      {/* Nombre + descripción */}
                      <td className="py-3 px-4">
                        <p className="text-white font-body font-medium">{promo.nombre}</p>
                        {promo.descripcion && (
                          <p className="text-surface-500 text-xs font-body mt-0.5 truncate max-w-[200px]">
                            {promo.descripcion}
                          </p>
                        )}
                      </td>

                      {/* Tipo */}
                      <td className="py-3 px-4">
                        <span className="bg-surface-700 border border-surface-600 text-surface-300 text-xs font-body px-2 py-0.5 rounded-lg">
                          {TIPO_LABELS[promo.tipo]}
                        </span>
                        {promo.valor != null && (
                          <p className="text-brand-400 text-xs font-mono mt-1">
                            {promo.tipo === 'porcentaje_producto' ? `−${promo.valor}%` : `$${promo.valor}`}
                          </p>
                        )}
                      </td>

                      {/* Alcance */}
                      <td className="py-3 px-4">
                        <p className="text-surface-300 text-xs font-body">{ALCANCE_LABELS[promo.alcance]}</p>
                        {promo.alcance === 'producto'  && promo.nombreProducto  && (
                          <p className="text-surface-500 text-xs font-body mt-0.5 truncate max-w-[140px]">
                            #{promo.idProducto} · {promo.nombreProducto}
                          </p>
                        )}
                        {promo.alcance === 'categoria' && promo.nombreCategoria && (
                          <p className="text-surface-500 text-xs font-body mt-0.5">{promo.nombreCategoria}</p>
                        )}
                      </td>

                      {/* Vigencia */}
                      <td className="py-3 px-4">
                        <p className={`text-xs font-body font-semibold ${vig.color}`}>{vig.text}</p>
                        <p className="text-surface-500 text-xs font-mono mt-0.5">
                          {fmtFecha(promo.fechaInicio)} → {fmtFecha(promo.fechaFin)}
                        </p>
                      </td>

                      {/* Estado activo/inactivo */}
                      <td className="py-3 px-4">
                        <span className={`text-xs font-body px-2 py-0.5 rounded-full border
                          ${promo.activo
                            ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
                            : 'text-surface-500 bg-surface-700 border-surface-600'}`}>
                          {promo.activo ? 'Activa' : 'Inactiva'}
                        </span>
                      </td>

                      {/* Acciones */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => abrirEditar(promo)}
                            title="Editar"
                            className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700 transition-colors">
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => toggleActivo(promo)}
                            title={promo.activo ? 'Desactivar' : 'Activar'}
                            className={`p-1.5 rounded-lg transition-colors
                              ${promo.activo
                                ? 'text-surface-400 hover:text-red-400 hover:bg-red-400/10'
                                : 'text-surface-400 hover:text-emerald-400 hover:bg-emerald-400/10'}`}>
                            {promo.activo ? <PowerOff size={14} /> : <Power size={14} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal crear/editar */}
      <PromoModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
        promoEditar={editando}
      />
    </div>
  )
}
