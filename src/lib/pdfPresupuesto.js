// src/lib/pdfPresupuesto.js
// Generación unificada del PDF de presupuesto (Presupuestador.jsx e Historial.jsx).
//
// Paginación:
//  - La tabla de ítems se reparte en N hojas (cabecera repetida, filas nunca partidas).
//  - El bloque de totales es una unidad atómica: se mide antes de dibujar y, si no
//    entra en el espacio restante, se traslada ENTERO a una hoja nueva.
//  - El encabezado de página se dibuja al final sobre todas las hojas.

import { obtenerPresupuestoPorId, obtenerDetallesConNombreDePresupuesto } from '../services/presupuestosService'
import { obtenerClientePorId } from '../services/clientesService'
import { separarSubtotales } from './calculoPresupuesto'

// ─── Métodos de pago (fuente de verdad compartida con Presupuestador) ───────
export const METODOS_BASE_PDF = [
  { value: 'efectivo',      label: 'Efectivo',      factor: 0.95,  pct: -5   },
  { value: 'transferencia', label: 'Transferencia', factor: 0.95,  pct: -5   },
  { value: 'cc15',          label: 'CC 15 días',    factor: 1.00,  pct:  0   },
  { value: 'cc30',          label: 'CC 30 días',    factor: 1.105, pct:  10.5 },
]

// ─── Layout (mm, A4 vertical) ───────────────────────────────────────────────
export const LAYOUT = Object.freeze({
  PAGE_W: 210,
  PAGE_H: 297,
  ML: 14,
  HEADER_H: 18,            // banda gris superior (todas las hojas)
  FIRST_TABLE_Y: 55,       // la hoja 1 lleva además los datos de cliente
  CONT_TABLE_Y: 26,        // inicio de contenido en hojas 2..N
  FOOTER_H: 14,            // reservado para la numeración
  GAP_AFTER_TABLE: 6,
  TOTALS_SEP_H: 7,         // línea separadora + aire
  TOTALS_LINE_H: 6,
  TOTALS_BOX_H: 14,        // caja TOTAL (2 de aire + 12 de alto)
  NOTE_H: 8,
})
const CONTENT_BOTTOM = LAYOUT.PAGE_H - LAYOUT.FOOTER_H

// ─── Paleta de grises ───────────────────────────────────────────────────────
const GRIS_HEADER = [235, 235, 235]
const GRIS_TEXTO = [50, 50, 50]
const GRIS_SUAVE = [100, 100, 100]
const GRIS_ALT_ROW = [250, 250, 250]
const GRIS_LINEA = [235, 235, 235]
const GRIS_DESCUENTO = [80, 80, 80]
const GRIS_RECARGO = [40, 40, 40]
const GRIS_NOTA = [130, 130, 130]

// ─── Helpers puros (exportados para test) ───────────────────────────────────
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

export function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)
}

function fmtFecha(iso) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}

/** Elimina caracteres no seguros para nombre de archivo (path traversal, reservados). */
export function sanitizarNombreArchivo(s) {
  return String(s ?? '').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '')
}

/** "(5% descuento)" / "(10.5% recargo)" / null. Para excepciones calcula el % real. */
export function pctMetodoPago(metodoPago, esExcepcion, montoFinal, subtotalConPromo, baseAjustable = subtotalConPromo) {
  if (esExcepcion) {
    // [FIX Ajuste vs Promo] el % real se calcula sobre los ítems SIN promoción (los únicos ajustados)
    if (!subtotalConPromo || !baseAjustable) return null
    const ajuste = montoFinal - subtotalConPromo
    if (Math.abs(ajuste) < 0.01) return null
    const pct = Math.abs((ajuste / baseAjustable) * 100)
    const pctStr = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/\.?0+$/, '')
    return ajuste < 0 ? `(${pctStr}% descuento)` : `(${pctStr}% recargo)`
  }
  const metodo = METODOS_BASE_PDF.find(m => m.value === metodoPago)
  if (!metodo || metodo.pct === 0) return null
  return metodo.pct < 0 ? `(${Math.abs(metodo.pct)}% descuento)` : `(${metodo.pct}% recargo)`
}

/** "#0007" — hoy el código visible es el id_producto. */
export function formatearCodigoProducto(idProducto) {
  if (idProducto == null) return '—'
  return `#${String(idProducto).padStart(4, '0')}`
}

/**
 * Única fuente de las líneas del bloque de totales: se usa tanto para MEDIR
 * como para DIBUJAR, así nunca divergen. No incluye el TOTAL (caja aparte).
 * @returns {{label:string, valor:string, tono:'normal'|'descuento'|'recargo'}[]}
 */
export function construirLineasTotales({ montoOriginal, subtotalConPromo, ajusteMetodo, ajusteLabel }) {
  const ahorroPromo = round2(montoOriginal - subtotalConPromo)
  const ajuste = round2(ajusteMetodo)
  const lineas = [{ label: 'Subtotal (precio lista):', valor: fmt(montoOriginal), tono: 'normal' }]

  if (ahorroPromo > 0.01) {
    lineas.push({ label: 'Promoción:', valor: `- ${fmt(ahorroPromo)}`, tono: 'descuento' })
    lineas.push({ label: 'Subtotal con promociones:', valor: fmt(subtotalConPromo), tono: 'normal' })
  }
  if (Math.abs(ajuste) > 0.01) {
    lineas.push(
      ajuste < 0
        ? { label: ajusteLabel, valor: `- ${fmt(Math.abs(ajuste))}`, tono: 'descuento' }
        : { label: ajusteLabel, valor: `+ ${fmt(ajuste)}`, tono: 'recargo' },
    )
  }
  return lineas
}

/** Altura total (mm) del bloque: separador + líneas + caja TOTAL + nota opcional. */
export function alturaBloqueTotales(cantLineas, hayPromos) {
  const L = LAYOUT
  return L.TOTALS_SEP_H + cantLineas * L.TOTALS_LINE_H + L.TOTALS_BOX_H + (hayPromos ? L.NOTE_H : 0)
}

// ─── Dibujo ─────────────────────────────────────────────────────────────────
function dibujarBloqueTotales(doc, y, lineas, totalStr, hayPromos) {
  const { PAGE_W, ML, TOTALS_SEP_H, TOTALS_LINE_H } = LAYOUT
  const xLabel = PAGE_W - ML - 90 // más ancho: la etiqueta de ajuste puede aclarar "sin promo"
  let cur = y

  doc.setDrawColor(...GRIS_LINEA)
  doc.line(ML, cur, PAGE_W - ML, cur)
  cur += TOTALS_SEP_H

  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal')
  for (const l of lineas) {
    doc.setTextColor(...GRIS_SUAVE)
    doc.text(l.label, xLabel, cur)
    doc.setTextColor(...(l.tono === 'descuento' ? GRIS_DESCUENTO : l.tono === 'recargo' ? GRIS_RECARGO : GRIS_TEXTO))
    doc.text(l.valor, PAGE_W - ML, cur, { align: 'right' })
    cur += TOTALS_LINE_H
  }

  doc.setFillColor(...GRIS_HEADER)
  doc.roundedRect(ML, cur + 2, PAGE_W - ML * 2, 12, 2, 2, 'F')
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_TEXTO)
  doc.text('TOTAL', ML + 4, cur + 10)
  doc.text(totalStr, PAGE_W - ML - 4, cur + 10, { align: 'right' })

  if (hayPromos) {
    doc.setFontSize(7); doc.setFont('helvetica', 'italic'); doc.setTextColor(...GRIS_NOTA)
    doc.text('* Precio con descuento promocional. Los ítems con promoción no reciben ajuste por método de pago.', ML, cur + 20)
  }
}

/** Banda de encabezado en TODAS las hojas. */
function decorarPaginas(doc, idPresupuesto, cliente) {
  const { PAGE_W, ML, HEADER_H } = LAYOUT
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFillColor(...GRIS_HEADER)
    doc.rect(0, 0, PAGE_W, HEADER_H, 'F')
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_TEXTO)
    doc.text('CLAUDIO RER GROUP', ML, 12)

    if (i > 1) {
      doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRIS_SUAVE)
      doc.text(`Presupuesto #${idPresupuesto} · ${cliente}`.trim(), PAGE_W - ML, 12, { align: 'right' })
    }
  }
}

/**
 * Genera y descarga el PDF de un presupuesto.
 * @param {number|string} idPresupuesto
 * @returns {Promise<void>}
 */
export async function generarPDFPresupuesto(idPresupuesto) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const [pres, detalles] = await Promise.all([
    obtenerPresupuestoPorId(idPresupuesto),
    obtenerDetallesConNombreDePresupuesto(idPresupuesto),
  ])
  if (!pres) return

  let clienteData = null
  try {
    clienteData = await obtenerClientePorId(pres.idCliente)
  } catch {
    // cliente eliminado: se usan los snapshots del presupuesto
  }
  const cNombre = clienteData?.nombre ?? pres.nombreCliente ?? ''
  const cApellido = clienteData?.apellido ?? pres.apellidoCliente ?? ''
  const cCuit = clienteData?.cuit ?? null
  const cTelefono = clienteData?.telefono ?? null
  const cMail = clienteData?.mail ?? null

  // ── Importes (mismas fórmulas que la pantalla) ───────────────────────────
  const montoOriginal = pres.montoOriginal ??
    detalles.reduce((a, d) => a + (parseFloat(d.precioUnitario) || 0) * (parseInt(d.cantidad) || 0), 0)
  const subtotalConPromo = detalles.reduce((a, d) => a + (parseFloat(d.subtotal) || 0), 0)
  const montoFinal = parseFloat(pres.monto) || 0
  const ajusteMetodo = montoFinal - subtotalConPromo
  const esExcepcion = pres.esExcepcion === 1

  const nombresMetodo = { efectivo: 'Efectivo', transferencia: 'Transferencia', cc15: 'CC 15 días', cc30: 'CC 30 días' }
  const metodoNombre = nombresMetodo[pres.metodoPago] ?? pres.metodoPago
  const { subtotalAjustable } = separarSubtotales(detalles)
  const hayPromos = detalles.some(d => d.precioConPromo != null)
  const pctSufijo = pctMetodoPago(pres.metodoPago, esExcepcion, montoFinal, subtotalConPromo, subtotalAjustable)
  // [FIX Ajuste vs Promo] con promociones, el ajuste aplica solo a los ítems sin promoción
  const ajusteLabel = `Ajuste${hayPromos ? ' productos sin promoción' : ''}${pctSufijo ? ' ' + pctSufijo : ''}:`

  const lineas = construirLineasTotales({ montoOriginal, subtotalConPromo, ajusteMetodo, ajusteLabel })

  // ── Documento ────────────────────────────────────────────────────────────
  const { PAGE_W, ML, FIRST_TABLE_Y, CONT_TABLE_Y, GAP_AFTER_TABLE } = LAYOUT
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  // Datos propios de la hoja 1 (la banda y la numeración se aplican al final)
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_TEXTO)
  doc.text(`PRESUPUESTO #${idPresupuesto}`, ML, 28)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRIS_SUAVE)
  doc.text(`Fecha: ${fmtFecha(pres.fecha)}`, ML, 34)
  doc.text(`Método de pago: ${esExcepcion ? `Excepción (${metodoNombre})` : metodoNombre}`, ML, 39)

  const xCli = PAGE_W - ML - 70
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_TEXTO)
  doc.text('CLIENTE', xCli, 26)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRIS_SUAVE)
  doc.text(`${cNombre} ${cApellido}`, xCli, 32)
  if (cCuit) doc.text(`CUIT: ${cCuit}`, xCli, 37)
  if (cTelefono) doc.text(`Tel: ${cTelefono}`, xCli, 42)
  if (cMail) doc.text(cMail, xCli, 47)

  autoTable(doc, {
    startY: FIRST_TABLE_Y,
    // margin.top aplica a hojas 2..N; bottom reserva la numeración
    margin: { left: ML, right: ML, top: CONT_TABLE_Y, bottom: LAYOUT.FOOTER_H + 4 },
    head: [['Código', 'Producto', 'Medida', 'Cant.', 'Precio Unit.', 'Subtotal']],
    body: detalles.map(d => [
      formatearCodigoProducto(d.idProducto),
      d.nombreProducto ?? `(producto eliminado #${d.idProducto})`,
      d.medida ?? '—',
      d.cantidad,
      d.precioConPromo != null ? `${fmt(d.precioConPromo)} *` : fmt(d.precioUnitario),
      fmt(d.subtotal),
    ]),
    showHead: 'everyPage',
    rowPageBreak: 'avoid',            // una fila (aunque ocupe 2 líneas) nunca se parte
    styles: { fontSize: 8, cellPadding: 2.5, textColor: GRIS_TEXTO, overflow: 'linebreak' },
    headStyles: { fillColor: GRIS_HEADER, textColor: [60, 60, 60], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: GRIS_ALT_ROW },
    columnStyles: {
      0: { cellWidth: 20, halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 20, halign: 'center' },
      3: { cellWidth: 14, halign: 'center' },
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 30, halign: 'right' },
    },
  })

  // ── Bloque de totales: atómico ───────────────────────────────────────────
  const alto = alturaBloqueTotales(lineas.length, hayPromos)
  let y = doc.lastAutoTable.finalY + GAP_AFTER_TABLE
  if (y + alto > CONTENT_BOTTOM) {
    doc.addPage()
    y = CONT_TABLE_Y
  }
  dibujarBloqueTotales(doc, y, lineas, fmt(pres.monto), hayPromos)

  decorarPaginas(doc, idPresupuesto, `${cNombre} ${cApellido}`)

  const archivo = `Presupuesto_${sanitizarNombreArchivo(idPresupuesto)}_${sanitizarNombreArchivo(cNombre)}_${sanitizarNombreArchivo(cApellido)}.pdf`
  doc.save(archivo)
}
