// src/lib/pdfPedidoCompra.js
// Generación de PDF "Hoja de recepción" para un Pedido de Compra.
// Usado por PedidosCompra.jsx (vista PedidoDetalle).
//
// A diferencia del presupuesto/factura (documentos contables), este PDF
// es una PLANILLA OPERATIVA: se imprime y se completa a mano en el depósito
// mientras se controla la mercadería recibida. Por eso:
//   - No incluye precios/montos (ese dato ya vive en la vista web).
//   - Reserva espacio en blanco por ítem para anotar cantidades parciales
//     (un mismo artículo puede llegar repartido en varias cajas/bultos).
//   - Incluye un casillero de verificación en gris claro para no gastar
//     tóner/tinta de más al imprimir en cantidad.

import { obtenerPedidoPorId, obtenerDetallesDePedido } from '../services/pedidosService'
import { supabase } from './supabase'

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtFecha(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function metodoPagoLabel(pedido) {
  if (pedido.metodoPago === 'echeck') return 'E-Check (CC30)'
  if (pedido.metodoPago === 'cuenta_corriente') return pedido.tieneCuotas ? 'CC Cuotas' : 'Cuenta Corriente'
  if (pedido.metodoPago === 'efectivo') return 'Efectivo'
  if (pedido.metodoPago === 'transferencia') return 'Transferencia'
  return pedido.metodoPago ?? '—'
}

// Cantidad de líneas de escritura en blanco dentro de la celda "registro de
// recepción". 3 alcanza para la mayoría de los casos (artículo repartido en
// hasta 3 bultos); si un ítem necesita más, el depósito puede usar el reverso.
const LINEAS_RECEPCION = 3
const ALTO_FILA = 22 // mm — suficiente para 3 líneas de escritura cómodas

// ─── Generador de PDF ──────────────────────────────────────────────────────

/**
 * Genera y descarga la "Hoja de recepción" de un Pedido de Compra dado su ID.
 * Pensada para imprimirse y completarse a mano al recibir la mercadería.
 *
 * - PDF en escala de grises, con casillero de verificación en gris claro
 *   (ahorro de tóner/tinta al imprimirse en volumen).
 * - Por cada producto: cantidad pedida + espacio en blanco para ir anotando
 *   las cantidades a medida que se controlan las cajas/bultos recibidos,
 *   más un total y un casillero de "línea completa".
 */
export async function generarPDFPedidoCompra(idPedido) {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  // ── Cargar datos ────────────────────────────────────────────────────────
  const [pedido, detalles] = await Promise.all([
    obtenerPedidoPorId(idPedido),
    obtenerDetallesDePedido(idPedido),
  ])
  if (!pedido) throw new Error('No se encontró el pedido solicitado.')

  // Proveedor: mismo criterio que la vista de detalle — BD fresca con
  // fallback al snapshot del pedido si el proveedor fue borrado.
  let proveedorNombre = pedido.nombreProveedor ?? null
  if (pedido.idProveedor) {
    try {
      const { data: prov } = await supabase
        .from('proveedor')
        .select('nombre_comercial, nombre_fiscal')
        .eq('id_proveedor', pedido.idProveedor)
        .single()
      if (prov) proveedorNombre = prov.nombre_comercial || prov.nombre_fiscal || proveedorNombre
    } catch {
      // proveedor eliminado — se usa el snapshot del pedido
    }
  }

  // ── Paleta de grises ─────────────────────────────────────────────────────
  const GRIS_HEADER     = [235, 235, 235]
  const GRIS_TEXTO      = [50,  50,  50]
  const GRIS_SUAVE      = [100, 100, 100]
  const GRIS_ALT_ROW    = [250, 250, 250]
  const GRIS_LINEA      = [220, 220, 220]
  const GRIS_ESCRITURA  = [195, 195, 195] // líneas para completar a mano
  const GRIS_CHECKBOX   = [190, 190, 190] // casillero: gris claro, bajo consumo de tóner

  // ── Documento ────────────────────────────────────────────────────────────
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const PW  = 210
  const ML  = 14
  const MR  = 14
  const TOP_CONTENT = 52 // alto reservado para el encabezado repetido en cada página

  // Encabezado repetido en cada página (se dibuja vía didDrawPage)
  function drawHeader(pageNumber) {
    doc.setFillColor(...GRIS_HEADER)
    doc.rect(0, 0, PW, 18, 'F')
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_TEXTO)
    doc.text('CLAUDIO RER GROUP', ML, 12)
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRIS_SUAVE)
    doc.text(`Pág. ${pageNumber}`, PW - MR, 12, { align: 'right' })

    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_TEXTO)
    doc.text(`HOJA DE RECEPCIÓN — PEDIDO DE COMPRA #${idPedido}`, ML, 27)

    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRIS_SUAVE)
    doc.text(`Proveedor: ${proveedorNombre ?? '—'}`, ML, 33)
    doc.text(`Fecha de pedido: ${fmtFecha(pedido.fecha)}`, ML, 38)
    doc.text(`Método de pago: ${metodoPagoLabel(pedido)}`, ML, 43)

    doc.setDrawColor(...GRIS_LINEA)
    doc.setLineWidth(0.2)
    doc.line(ML, 47, PW - MR, 47)
  }

  // ── Estado vacío ────────────────────────────────────────────────────────
  if (!detalles || detalles.length === 0) {
    drawHeader(1)
    doc.setFontSize(10); doc.setTextColor(150, 150, 150)
    doc.text('Este pedido no tiene ítems registrados.', ML, TOP_CONTENT + 6)
    doc.save(`Pedido_${idPedido}_HojaRecepcion.pdf`)
    return
  }

  // ── Tabla de productos con espacio de control manual ───────────────────
  autoTable(doc, {
    startY: TOP_CONTENT,
    margin: { top: TOP_CONTENT, left: ML, right: MR, bottom: 20 },
    head: [['#', 'Producto', 'Medida', 'Cant.\nPedida', 'Registro de recepción  (anotar por bulto / caja)', 'Total\nRecibido', 'OK']],
    body: detalles.map((d, idx) => [
      String(idx + 1),
      d.nombreProducto ?? `#${d.idProducto}`,
      d.medida ?? '—',
      String(d.cantidad ?? ''),
      '', // se dibuja a mano en didDrawCell
      '', // se dibuja a mano en didDrawCell
      '', // checkbox, se dibuja en didDrawCell
    ]),
    styles: {
      fontSize: 8.5,
      cellPadding: 2.5,
      textColor: GRIS_TEXTO,
      valign: 'middle',
      minCellHeight: ALTO_FILA,
      lineColor: GRIS_LINEA,
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: GRIS_HEADER,
      textColor: [60, 60, 60],
      fontStyle: 'bold',
      fontSize: 8,
      valign: 'middle',
      minCellHeight: 10,
    },
    alternateRowStyles: { fillColor: GRIS_ALT_ROW },
    columnStyles: {
      0: { cellWidth: 8,  halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
      4: { cellWidth: 68, halign: 'left' },
      5: { cellWidth: 20, halign: 'center' },
      6: { cellWidth: 12, halign: 'center' },
    },
    didDrawPage: (data) => {
      drawHeader(doc.internal.getNumberOfPages())
    },
    didDrawCell: (data) => {
      if (data.section !== 'body') return
      const { column, cell } = data

      // Col. 4 — líneas en blanco para anotar cantidades parciales por bulto
      if (column.index === 4) {
        doc.setDrawColor(...GRIS_ESCRITURA)
        doc.setLineWidth(0.15)
        const padTop = 5
        const padBottom = 3
        const usable = cell.height - padTop - padBottom
        const gap = usable / (LINEAS_RECEPCION - 1 || 1)
        for (let i = 0; i < LINEAS_RECEPCION; i++) {
          const ly = cell.y + padTop + gap * i
          doc.line(cell.x + 3, ly, cell.x + cell.width - 3, ly)
        }
      }

      // Col. 5 — línea para el total recibido de esa línea de pedido
      if (column.index === 5) {
        doc.setDrawColor(...GRIS_ESCRITURA)
        doc.setLineWidth(0.15)
        const ly = cell.y + cell.height - 6
        doc.line(cell.x + 3, ly, cell.x + cell.width - 3, ly)
      }

      // Col. 6 — casillero de verificación, gris claro (ahorro de tóner)
      if (column.index === 6) {
        const size = 5.5
        const cx = cell.x + cell.width / 2 - size / 2
        const cy = cell.y + cell.height / 2 - size / 2
        doc.setDrawColor(...GRIS_CHECKBOX)
        doc.setLineWidth(0.3)
        doc.roundedRect(cx, cy, size, size, 0.6, 0.6)
      }
    },
  })

  doc.save(`Pedido_${idPedido}_HojaRecepcion.pdf`)
}
