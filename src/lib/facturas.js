// src/lib/facturas.js
// Lógica PURA del módulo Facturas (sin React, sin BD, sin DOM): agrupación,
// filtrado, totales y formateo. Vive aparte para poder testearla de forma
// aislada y compartirla entre la pantalla y el generador de PDF.

import { ajustarDetallesAlMonto } from './calculoPresupuesto'

/**
 * @typedef {'efectivo'|'transferencia'|'cc15'|'cc30'} MetodoPago
 * @typedef {MetodoPago|'pago_parcial'} EstadoComprobante
 *
 * @typedef {object} ItemFactura
 * @property {number|string} idProducto
 * @property {string} [nombreProducto]
 * @property {number} cantidad
 * @property {number} precioNeto      Precio unitario sin IVA.
 * @property {number} subtotalNeto    Subtotal sin IVA.
 * @property {number} subtotal        Subtotal con IVA.
 *
 * @typedef {object} Comprobante
 * @property {number|string} idPresupuesto
 * @property {number|string} [idAplicacion]   Sólo en pagos parciales.
 * @property {'pago_parcial'} [tipo]
 * @property {MetodoPago} metodoPago
 * @property {number} monto                   Total con IVA.
 * @property {string} [fecha]                 Pagos parciales (YYYY-MM-DD).
 * @property {string} [fechaFacturacion]      Ventas (YYYY-MM-DD).
 * @property {ItemFactura[]} [items]
 *
 * @typedef {object} GrupoCliente
 * @property {number|string} idCliente
 * @property {string} nombre
 * @property {string} [cuit]
 * @property {Comprobante[]} presupuestos
 * @property {number} totalCliente
 *
 * @typedef {object} FiltrosFactura
 * @property {string} cliente              Texto libre: nombre o CUIT.
 * @property {'todos'|EstadoComprobante} estado
 */

// ─── Constantes ────────────────────────────────────────────────────────────

/** Métodos que van al documento "No efectivo" (transferencia + CC). */
export const METODOS_NO_EFECTIVO = ['transferencia', 'cc15', 'cc30']
export const METODOS_EFECTIVO    = ['efectivo']

export const FACTOR_IVA = 1.21

export const ESTADO_LABEL = Object.freeze({
  efectivo:      'Efectivo',
  transferencia: 'Transferencia',
  cc15:          'CC 15d',
  cc30:          'CC 30d',
  pago_parcial:  'Pago parcial',
})

export const ESTADO_COLOR = Object.freeze({
  efectivo:      'green',
  transferencia: 'blue',
  cc15:          'yellow',
  cc30:          'yellow',
  pago_parcial:  'yellow',
})

export const ESTADO_OPCIONES = Object.freeze([
  { valor: 'todos', label: 'Todos' },
  ...Object.entries(ESTADO_LABEL).map(([valor, label]) => ({ valor, label })),
])

/** @type {Readonly<FiltrosFactura>} */
export const FILTROS_VACIOS = Object.freeze({ cliente: '', estado: 'todos' })

// ─── Formateo ──────────────────────────────────────────────────────────────

const formatoMoneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })

/** @param {number|null|undefined} n */
export function fmt(n) {
  return formatoMoneda.format(n ?? 0)
}

/** @param {string|null|undefined} iso YYYY-MM-DD → DD-MM-YYYY */
export function fmtFecha(iso) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}-${m}-${y}`
}

const pad2 = (n) => String(n).padStart(2, '0')

/** Fecha en HORA LOCAL (toISOString usa UTC: en Argentina, después de las
 *  21:00 devolvería el día siguiente). */
function isoLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export const today        = () => isoLocal(new Date())
export const firstOfMonth = () => { const d = new Date(); return isoLocal(new Date(d.getFullYear(), d.getMonth(), 1)) }

/** @returns {string} Mensaje de error, o '' si el período es válido. */
export function validarPeriodo(desde, hasta) {
  if (!desde || !hasta) return 'Seleccioná ambas fechas.'
  if (desde > hasta)    return 'La fecha de inicio no puede ser posterior a la de fin.'
  return ''
}

// ─── Modelo ────────────────────────────────────────────────────────────────

/** Lo que muestra el badge: un pago parcial es un estado propio. */
export const estadoDe = (/** @type {Comprobante} */ c) =>
  c.tipo === 'pago_parcial' ? 'pago_parcial' : c.metodoPago

export const fechaDe = (/** @type {Comprobante} */ c) =>
  c.tipo === 'pago_parcial' ? c.fecha : c.fechaFacturacion

/** Key estable y única (un presupuesto puede tener varios pagos parciales). */
export const claveComprobante = (/** @type {Comprobante} */ c) =>
  c.tipo === 'pago_parcial' ? `pp-${c.idAplicacion}` : `v-${c.idPresupuesto}`

/**
 * Agrupa los presupuestos por cliente calculando los ajustes de IVA.
 * (Lógica original de Facturas.jsx, sin cambios de comportamiento.)
 * @returns {GrupoCliente[]}
 */
export function agruparPresupuestos(presupuestos, metodos) {
  const porCliente = {}

  for (const p of presupuestos) {
    if (!metodos.includes(p.metodoPago)) continue

    const key = p.idCliente
    if (!porCliente[key]) {
      porCliente[key] = {
        idCliente:    p.idCliente,
        nombre:       `${p.nombreCliente} ${p.apellidoCliente}`,
        cuit:         p.cuit,
        presupuestos: [],
        totalCliente: 0,
      }
    }

    // Pago parcial: cobro puntual, sin ítems propios.
    if (p.tipo === 'pago_parcial') {
      porCliente[key].presupuestos.push(p)
      porCliente[key].totalCliente += p.monto
      continue
    }

    // El ajuste por método de pago se reparte SOLO entre los detalles sin
    // promoción; la suma de subtotales ajustados es exactamente `p.monto`.
    const detallesAjustados = ajustarDetallesAlMonto(p.detalles ?? [], p.monto)

    const agrupados = {}
    for (const d of detallesAjustados) {
      const pid = d.idProducto
      if (!agrupados[pid]) agrupados[pid] = { ...d, cantidad: 0, subtotal: 0 }
      agrupados[pid].cantidad += d.cantidad
      agrupados[pid].subtotal += d.subtotalAjustado
    }

    const items = Object.values(agrupados).map((d) => {
      const subtotalAjustado       = d.subtotal
      const precioUnitarioAjustado = d.cantidad > 0 ? subtotalAjustado / d.cantidad : 0
      return {
        ...d,
        precioUnitario: precioUnitarioAjustado,
        precioNeto:     precioUnitarioAjustado / FACTOR_IVA,
        subtotalNeto:   subtotalAjustado / FACTOR_IVA,
        subtotal:       subtotalAjustado,
        medida:         '—',
      }
    })

    porCliente[key].presupuestos.push({ ...p, items })
    porCliente[key].totalCliente += p.monto
  }

  return Object.values(porCliente).sort((a, b) => a.nombre.localeCompare(b.nombre))
}

// ─── Filtros (en memoria) ──────────────────────────────────────────────────

/** Minúsculas y sin tildes: "Perez" encuentra "Pérez". */
export const normalizar = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

const soloDigitos = (s) => String(s ?? '').replace(/\D/g, '')

/** @param {FiltrosFactura} f */
export function contarFiltros(f) {
  return (f.cliente.trim() ? 1 : 0) + (f.estado !== 'todos' ? 1 : 0)
}

/** @param {FiltrosFactura} f @returns {string[]} Etiquetas legibles de los filtros activos. */
export function describirFiltros(f) {
  const out = []
  if (f.cliente.trim()) out.push(`Cliente: ${f.cliente.trim()}`)
  if (f.estado !== 'todos') out.push(ESTADO_LABEL[f.estado] ?? f.estado)
  return out
}

/**
 * Filtra comprobantes y recalcula el total de cada cliente. Si no hay filtros
 * activos devuelve la MISMA referencia (no rompe memoizaciones aguas abajo).
 * @param {GrupoCliente[]} grupos
 * @param {FiltrosFactura} filtros
 * @returns {GrupoCliente[]}
 */
export function filtrarGrupos(grupos, filtros) {
  if (contarFiltros(filtros) === 0) return grupos

  const q       = normalizar(filtros.cliente)
  const qDig    = soloDigitos(filtros.cliente)
  const estado  = filtros.estado

  const salida = []
  for (const g of grupos) {
    if (q) {
      const porNombre = normalizar(g.nombre).includes(q)
      const porCuit   = qDig !== '' && soloDigitos(g.cuit).includes(qDig)
      if (!porNombre && !porCuit) continue
    }
    const presupuestos = g.presupuestos.filter((c) => estado === 'todos' || estadoDe(c) === estado)
    if (presupuestos.length === 0) continue

    salida.push({
      ...g,
      presupuestos,
      totalCliente: presupuestos.reduce((acc, c) => acc + c.monto, 0),
    })
  }
  return salida
}

// ─── Totales ───────────────────────────────────────────────────────────────

/** @param {GrupoCliente[]} grupos */
export function totalesGrupos(grupos) {
  return {
    total:        grupos.reduce((acc, g) => acc + g.totalCliente, 0),
    clientes:     grupos.length,
    comprobantes: grupos.reduce((acc, g) => acc + g.presupuestos.length, 0),
  }
}

/**
 * Desglose impositivo de un comprobante. En un pago parcial no hay ítems ni
 * desglose: `neto` e `iva` son `null` y la UI sólo muestra el total.
 * @param {Comprobante} c
 * @returns {{neto: number|null, iva: number|null, total: number}}
 */
export function totalesComprobante(c) {
  const total = c.monto ?? 0
  if (c.tipo === 'pago_parcial') return { neto: null, iva: null, total }
  const neto = c.items?.length
    ? c.items.reduce((acc, it) => acc + (it.subtotalNeto ?? 0), 0)
    : total / FACTOR_IVA
  return { neto, iva: total - neto, total }
}
