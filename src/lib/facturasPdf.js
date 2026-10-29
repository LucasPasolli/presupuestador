// src/lib/facturasPdf.js
// Generación y DESCARGA del PDF, separadas a propósito:
//   · construirPDF → devuelve { blob, nombre } sin tocar el DOM.
//   · descargarBlob → efecto de plataforma.
// Antes `doc.save()` hacía todo junto y en iOS Safari / WebViews no era
// confiable; descargar un Blob con <a download> sí lo es.

import { fmt, fmtFecha } from './facturas'

/** Nombre de archivo seguro: sin tildes, espacios ni caracteres de ruta. */
export function nombreArchivo(titulo, desde, hasta) {
  const base = String(titulo)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  return `${base}_${fmtFecha(desde)}_${fmtFecha(hasta)}.pdf`
}

/**
 * @param {import('./facturas').GrupoCliente[]} grupos
 * @param {string} titulo
 * @param {string} desde YYYY-MM-DD
 * @param {string} hasta YYYY-MM-DD
 * @returns {Promise<{blob: Blob, nombre: string}>}
 */
export async function construirPDF(grupos, titulo, desde, hasta) {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  doc.setProperties({ title: titulo })
  /** Devuelve el archivo en memoria; la descarga la decide el llamador. */
  const salida = () => ({ blob: doc.output('blob'), nombre: nombreArchivo(titulo, desde, hasta) })
  const PW   = 210
  const ML   = 14
  const MR   = 14
  const CW   = PW - ML - MR

  const NARANJA = [234, 88, 12]
  const GRIS    = [50, 50, 50]
  const CLARO   = [245, 245, 245]
  const BORDE   = [220, 220, 220]

  function header() {
    doc.setFillColor(...NARANJA)
    doc.rect(0, 0, PW, 18, 'F')

    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(255, 255, 255)
    doc.text('CLAUDIO RER GROUP', ML, 12)

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(`Pág. ${doc.getNumberOfPages()}`, PW - MR, 12, { align: 'right' })

    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GRIS)
    doc.text(titulo, ML, 26)

    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 100, 100)
    doc.text(`Período: ${fmtFecha(desde)} al ${fmtFecha(hasta)}`, ML, 32)

    return 38
  }

  let y = header()

  function checkPage(needed = 30) {
    if (y + needed > 280) {
      doc.addPage()
      y = header()
    }
  }

  if (grupos.length === 0) {
    doc.setFontSize(10)
    doc.setTextColor(150, 150, 150)
    doc.text('Sin movimientos en el período seleccionado.', ML, y + 10)
    return salida()
  }

  let totalGeneral = 0

  for (const cliente of grupos) {
    checkPage(40)

    doc.setFillColor(...CLARO)
    doc.roundedRect(ML, y, CW, 12, 2, 2, 'F')
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GRIS)
    doc.text(cliente.nombre, ML + 4, y + 8)

    if (cliente.cuit) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(120, 120, 120)
      doc.text(`CUIT: ${cliente.cuit}`, PW - MR - 4, y + 8, { align: 'right' })
    }
    y += 15

    for (const pres of cliente.presupuestos) {
      checkPage(20)

      const metodoLabel = { efectivo: 'Efectivo', transferencia: 'Transferencia', cc15: 'CC 15d', cc30: 'CC 30d' }

      // CORRECCIÓN (Pago Parcial): línea de cobro puntual — no tiene ítems
      // propios (esos ya se facturaron en el presupuesto original, que puede
      // haberse listado en otro período). Se muestra el monto efectivamente
      // cobrado y la fecha de ESE pago, resaltado para diferenciarlo de una
      // venta completa.
      if (pres.tipo === 'pago_parcial') {
        doc.setFillColor(255, 248, 235)
        doc.roundedRect(ML + 2, y - 4, CW - 4, 9, 1.5, 1.5, 'F')

        doc.setFontSize(8)
        doc.setFont('helvetica', 'italic')
        doc.setTextColor(120, 120, 120)
        doc.text(
          `Pago parcial recibido — Presupuesto #${pres.idPresupuesto} — ${fmtFecha(pres.fecha)} — ${metodoLabel[pres.metodoPago] ?? pres.metodoPago}`,
          ML + 4, y + 1.5
        )

        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...NARANJA)
        doc.text(fmt(pres.monto), PW - MR - 4, y + 1.5, { align: 'right' })

        y += 11
        continue
      }

      doc.setFontSize(8)
      doc.setFont('helvetica', 'italic')
      doc.setTextColor(120, 120, 120)
      doc.text(
        `Presupuesto #${pres.idPresupuesto} — ${fmtFecha(pres.fechaFacturacion)} — ${metodoLabel[pres.metodoPago] ?? pres.metodoPago}`,
        ML + 4, y
      )
      y += 5

      if (!pres.items || pres.items.length === 0) {
        doc.setFontSize(8)
        doc.setTextColor(180, 180, 180)
        doc.text('Sin ítems registrados.', ML + 4, y)
        y += 6
        continue
      }

      autoTable(doc, {
        startY: y,
        margin: { left: ML, right: MR },
        head: [['Producto', 'Cant.', 'P. Unit. (sin IVA)', 'Subtotal (sin IVA)']],
        body: pres.items.map(it => [
          it.nombreProducto ?? `#${it.idProducto}`,
          it.cantidad,
          fmt(it.precioNeto),
          fmt(it.subtotalNeto),
        ]),
        foot: [[
          { content: 'Total con IVA', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } },
          { content: fmt(pres.monto), styles: { fontStyle: 'bold', textColor: NARANJA } },
        ]],
        styles:     { fontSize: 7.5, cellPadding: 2.5, textColor: GRIS },
        headStyles: { fillColor: NARANJA, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
        footStyles: { fillColor: [255, 248, 235], fontSize: 7.5 },
        alternateRowStyles: { fillColor: [252, 252, 252] },
        columnStyles: {
          0: { cellWidth: 'auto' },
          1: { cellWidth: 14, halign: 'center' },
          2: { cellWidth: 36, halign: 'right' },
          3: { cellWidth: 36, halign: 'right' },
        },
      })

      y = doc.lastAutoTable.finalY + 5
    }

    checkPage(12)
    doc.setDrawColor(...BORDE)
    doc.line(ML, y, PW - MR, y)
    y += 4

    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...NARANJA)
    doc.text(`Total ${cliente.nombre}: ${fmt(cliente.totalCliente)}`, PW - MR, y, { align: 'right' })
    y += 12

    totalGeneral += cliente.totalCliente
  }

  checkPage(20)
  doc.setFillColor(...NARANJA)
  doc.roundedRect(ML, y, CW, 14, 3, 3, 'F')
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(255, 255, 255)
  doc.text('TOTAL GENERAL', ML + 6, y + 9.5)
  doc.text(fmt(totalGeneral), PW - MR - 6, y + 9.5, { align: 'right' })

  return salida()
}

// ─── Entrega ───────────────────────────────────────────────────────────────

const PDF_MIME = 'application/pdf'

/** Descarga un Blob. Sin `download` (WebViews viejos) lo abre en otra pestaña. */
export function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  if ('download' in a) {
    a.href = url
    a.download = nombre
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } else if (!window.open(url, '_blank')) {
    URL.revokeObjectURL(url)
    throw Object.assign(new Error('DESCARGA_BLOQUEADA'), { codigo: 'DESCARGA_BLOQUEADA' })
  }
  // Se libera tarde: revocar enseguida cancela la descarga en algunos móviles.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
