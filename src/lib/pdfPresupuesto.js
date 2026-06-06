// src/lib/pdfPresupuesto.js
// Función unificada de generación de PDF de presupuesto.
// Usada por Presupuestador.jsx e Historial.jsx.

import { query } from './database'

// ─── Mapa de métodos de pago (fuente de verdad compartida con Presupuestador) ─
// Exportado para que otros módulos puedan consultarlo sin duplicar la definición.
export const METODOS_BASE_PDF = [
  { value: 'efectivo',      label: 'Efectivo',          factor: 0.95,  pct: -5   },
  { value: 'transferencia', label: 'Transferencia',      factor: 0.95,  pct: -5   },
  { value: 'cc15',          label: 'CC 15 días',         factor: 1.00,  pct:  0   },
  { value: 'cc30',          label: 'CC 30 días',         factor: 1.105, pct:  10.5 },
]

/**
 * Devuelve el string de porcentaje fijo del método de pago para mostrar en PDF.
 * Ej: "efectivo" → "(5% descuento)", "cc30" → "(10.5% recargo)", "cc15" → null
 * Para excepciones, devuelve el % calculado entre montoOriginal y montoConPromos.
 *
 * @param {string} metodoPago   - valor del método (efectivo, transferencia, cc15, cc30)
 * @param {boolean} esExcepcion
 * @param {number}  montoFinal       - pres.monto
 * @param {number}  subtotalConPromo - suma de subtotales de detalles
 * @returns {string|null}
 */
function pctMetodoPago(metodoPago, esExcepcion, montoFinal, subtotalConPromo) {
  if (esExcepcion) {
    // Para excepciones calculamos el ajuste real sobre el subtotal con promos
    if (!subtotalConPromo || subtotalConPromo === 0) return null
    const ajuste = montoFinal - subtotalConPromo
    if (Math.abs(ajuste) < 0.01) return null
    const pct = Math.abs((ajuste / subtotalConPromo) * 100)
    const pctStr = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/\.?0+$/, '')
    return ajuste < 0 ? `(${pctStr}% descuento)` : `(${pctStr}% recargo)`
  }

  const metodo = METODOS_BASE_PDF.find(m => m.value === metodoPago)
  if (!metodo || metodo.pct === 0) return null
  if (metodo.pct < 0) return `(${Math.abs(metodo.pct)}% descuento)`
  return `(${metodo.pct}% recargo)`
}

function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)
}

/**
 * Genera y descarga el PDF de un presupuesto dado su ID.
 * - PDF completamente en escala de grises.
 * - Muestra precio con promo marcado con asterisco en la tabla de productos.
 * - Desglosa totales: subtotal lista / ahorro promos / ajuste método de pago (con %) / total.
 */
export async function generarPDFPresupuesto(idPresupuesto) {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const pres = query(`
    SELECT p.*,
           COALESCE(c.nombre,  p.nombreCliente)   AS cNombre,
           COALESCE(c.apellido,p.apellidoCliente) AS cApellido,
           c.cuit, c.telefono, c.mail
    FROM Presupuesto p
    LEFT JOIN Cliente c ON c.idCliente = p.idCliente
    WHERE p.idPresupuesto = ?
  `, [idPresupuesto])[0]
  if (!pres) return

  const detalles = query(`
    SELECT dp.*,
           COALESCE(dp.nombreProducto, pr.nombre, '(producto eliminado #' || dp.idProducto || ')') AS nombreProducto
    FROM DetallePresupuesto dp
    LEFT JOIN Producto pr ON pr.idProducto = dp.idProducto
    WHERE dp.idPresupuesto = ?
    ORDER BY dp.idDetalle
  `, [idPresupuesto])

  // ── Cálculo de desglose de totales ──────────────────────────────────────
  const montoOriginal = pres.montoOriginal ??
    detalles.reduce((acc, d) => acc + (parseFloat(d.precioUnitario) || 0) * (parseInt(d.cantidad) || 0), 0)

  const subtotalConPromo = detalles.reduce((acc, d) => acc + (parseFloat(d.subtotal) || 0), 0)

  const ahorroPromo  = montoOriginal - subtotalConPromo
  const ajusteMetodo = (parseFloat(pres.monto) || 0) - subtotalConPromo

  const esExcepcion = pres.esExcepcion === 1

  // Etiqueta del método con porcentaje fijo
  const metodoLabelBase = {
    efectivo:      'Efectivo',
    transferencia: 'Transferencia',
    cc15:          'CC 15 días',
    cc30:          'CC 30 días',
  }
  const metodoNombre = metodoLabelBase[pres.metodoPago] ?? pres.metodoPago
  const pctSufijo = pctMetodoPago(pres.metodoPago, esExcepcion, parseFloat(pres.monto) || 0, subtotalConPromo)
  const ajusteLineaLabel = esExcepcion
    ? `Ajuste${pctSufijo ? ' ' + pctSufijo : ''}:`
    : `Ajuste${pctSufijo ? ' ' + pctSufijo : ''}:`

  // ── Helpers ──────────────────────────────────────────────────────────────
  const fmtFecha = iso => {
    if (!iso) return '—'
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }

  // ── Paleta de grises ─────────────────────────────────────────────────────
  // Todos los colores del PDF son tonos de gris para impresión en blanco y negro.
  const GRIS_HEADER   = [200, 200, 200]  // fondo encabezado / total
  const GRIS_TEXTO    = [50,  50,  50]   // texto principal
  const GRIS_SUAVE    = [100, 100, 100]  // texto secundario / etiquetas
  const GRIS_ALT_ROW  = [245, 245, 245]  // filas alternadas tabla
  const GRIS_LINEA    = [220, 220, 220]  // línea separadora
  const GRIS_DESCUENTO= [80,  80,  80]   // descuentos (gris oscuro, reemplaza verde)
  const GRIS_RECARGO  = [40,  40,  40]   // recargos (gris muy oscuro / casi negro)
  const GRIS_NOTA     = [130, 130, 130]  // nota al pie

  // ── Documento ────────────────────────────────────────────────────────────
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const PW  = 210
  const ML  = 14

  // Encabezado empresa
  doc.setFillColor(...GRIS_HEADER)
  doc.rect(0, 0, PW, 18, 'F')
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_TEXTO)
  doc.text('CLAUDIO RER GROUP', ML, 12)

  // Número y fecha
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_TEXTO)
  doc.text(`PRESUPUESTO #${idPresupuesto}`, ML, 28)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRIS_SUAVE)
  doc.text(`Fecha: ${fmtFecha(pres.fecha)}`, ML, 34)
  doc.text(
    `Método de pago: ${esExcepcion ? `Excepción (${metodoNombre})` : metodoNombre}`,
    ML, 39
  )

  // Datos cliente
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_TEXTO)
  doc.text('CLIENTE', PW - ML - 70, 26)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRIS_SUAVE)
  doc.text(`${pres.cNombre} ${pres.cApellido}`, PW - ML - 70, 32)
  if (pres.cuit)     doc.text(`CUIT: ${pres.cuit}`,    PW - ML - 70, 37)
  if (pres.telefono) doc.text(`Tel: ${pres.telefono}`, PW - ML - 70, 42)
  if (pres.mail)     doc.text(pres.mail,               PW - ML - 70, 47)

  // Tabla de productos
  autoTable(doc, {
    startY: 55,
    margin: { left: ML, right: ML },
    head: [['Producto', 'Medida', 'Cant.', 'Precio Unit.', 'Subtotal']],
    body: detalles.map(d => [
      d.nombreProducto ?? `#${d.idProducto}`,
      d.medida ?? '—',
      d.cantidad,
      d.precioConPromo != null
        ? `${fmt(d.precioConPromo)} *`
        : fmt(d.precioUnitario),
      fmt(d.subtotal),
    ]),
    styles:     { fontSize: 8, cellPadding: 2.5, textColor: GRIS_TEXTO },
    headStyles: { fillColor: GRIS_HEADER, textColor: [60, 60, 60], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: GRIS_ALT_ROW },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 22, halign: 'center' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 34, halign: 'right' },
      4: { cellWidth: 34, halign: 'right' },
    },
  })

  // ── Desglose de totales ──────────────────────────────────────────────────
  const finalY = doc.lastAutoTable.finalY + 6
  let curY = finalY

  doc.setDrawColor(...GRIS_LINEA)
  doc.line(ML, curY, PW - ML, curY)
  curY += 7

  // 1. Subtotal precio lista
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRIS_SUAVE)
  doc.text('Subtotal (precio lista):', PW - ML - 70, curY)
  doc.setTextColor(...GRIS_TEXTO)
  doc.text(fmt(montoOriginal), PW - ML, curY, { align: 'right' })
  curY += 6

  // 2. Ahorro por promociones (solo si existe)
  if (ahorroPromo > 0.01) {
    doc.setTextColor(...GRIS_SUAVE)
    doc.text('Promoción:', PW - ML - 70, curY)
    doc.setTextColor(...GRIS_DESCUENTO)   // gris oscuro (antes verde)
    doc.text(`- ${fmt(ahorroPromo)}`, PW - ML, curY, { align: 'right' })
    curY += 6

    // 3. Subtotal con promociones (solo si hay ahorro)
    doc.setTextColor(...GRIS_SUAVE)
    doc.text('Subtotal con promociones:', PW - ML - 70, curY)
    doc.setTextColor(...GRIS_TEXTO)
    doc.text(fmt(subtotalConPromo), PW - ML, curY, { align: 'right' })
    curY += 6
  }

  // 4. Ajuste por método de pago (solo si existe) — incluye % fijo del método
  if (Math.abs(ajusteMetodo) > 0.01) {
    doc.setFontSize(8.5); doc.setTextColor(...GRIS_SUAVE)
    doc.text(ajusteLineaLabel, PW - ML - 70, curY)
    doc.setFontSize(8.5)
    if (ajusteMetodo < 0) {
      doc.setTextColor(...GRIS_DESCUENTO)  // gris oscuro — descuento (antes verde)
      doc.text(`- ${fmt(Math.abs(ajusteMetodo))}`, PW - ML, curY, { align: 'right' })
    } else {
      doc.setTextColor(...GRIS_RECARGO)    // gris muy oscuro — recargo (antes rojo)
      doc.text(`+ ${fmt(ajusteMetodo)}`, PW - ML, curY, { align: 'right' })
    }
    curY += 6
  }

  // 5. Total final
  doc.setFillColor(...GRIS_HEADER)
  doc.roundedRect(ML, curY + 2, PW - ML * 2, 12, 2, 2, 'F')
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_TEXTO)
  doc.text('TOTAL', ML + 4, curY + 10)
  doc.text(fmt(pres.monto), PW - ML - 4, curY + 10, { align: 'right' })

  // Nota al pie si hay precios con promo
  const hayPromos = detalles.some(d => d.precioConPromo != null)
  if (hayPromos) {
    const noteY = curY + 20
    doc.setFontSize(7); doc.setFont('helvetica', 'italic'); doc.setTextColor(...GRIS_NOTA)
    doc.text('* Precio con descuento promocional aplicado.', ML, noteY)
  }

  doc.save(`Presupuesto_${idPresupuesto}_${pres.cNombre}_${pres.cApellido}.pdf`)
}
