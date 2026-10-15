// src/lib/pdfPedidoCompra.js
// Generación del PDF "Hoja de recepción" de un Pedido de Compra.
// Usado por PedidosCompra.jsx (vista PedidoDetalle).
//
// Formato COMPACTO de dos listas por hoja, pensado para imprimir en el depósito:
//   - Sólo los ítems seleccionados por el usuario.
//   - Datos por ítem: Código, Nombre, Medida y (opcional) Cantidad.
//   - Sin precios/montos. Escala de grises (bajo consumo de tóner).
//   - Orden original del pedido: lista izquierda → lista derecha → hoja nueva.
//   - Encabezado mínimo en cada hoja: sólo "CLAUDIO RER GROUP".
//
// Nota sobre "Código": el esquema (`detalle_pedido_compra` / `producto`) no tiene
// una columna de código propia, por lo que se usa `id_producto` (el mismo valor
// que la vista web muestra como "ID Prod.").

import { obtenerPedidoPorId, obtenerDetallesDePedido } from '../services/pedidosService'
import {
  PAGE_W, PAGE_H, MARGIN_X, MARGIN_BOTTOM, GUTTER,
  FONT_SIZE_ROW, LINE_H, ROW_PAD_Y, CELL_PAD_X, COL_HEADER_H,
  anchoLista, definirColumnas, celdasDeDetalle, altoFila,
  distribuirEnPaginas,
} from './pdfPedidoCompraLayout'

export const MENSAJE_SIN_SELECCION = 'Debe seleccionar al menos un ítem para exportar'

/** Error tipado para que la UI distinga "sin selección" de un fallo técnico. */
export class SinSeleccionError extends Error {
  constructor() {
    super(MENSAJE_SIN_SELECCION)
    this.name = 'SinSeleccionError'
    this.code = 'SIN_SELECCION'
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Paleta de grises
const GRIS_HEADER = [235, 235, 235]
const GRIS_TEXTO  = [50, 50, 50]
const GRIS_LINEA  = [215, 215, 215]

/**
 * Genera y descarga la "Hoja de recepción" compacta de un Pedido de Compra.
 *
 * @param {number} idPedido
 * @param {Object} opciones
 * @param {Array<number|string>} opciones.idsDetalle  ids (`idDetallePedido`) de los ítems a incluir. Obligatorio, ≥1.
 * @param {boolean} [opciones.listarCantidad=false]   incluir la columna Cantidad.
 * @throws {SinSeleccionError} si no hay ítems seleccionados (validación de dominio, además de la de UI).
 */
export async function generarPDFPedidoCompra(idPedido, opciones = {}) {
  const { idsDetalle = [], listarCantidad = false } = opciones

  // Validación temprana: no cargamos librerías ni datos si no hay nada que exportar.
  if (!Array.isArray(idsDetalle) || idsDetalle.length === 0) throw new SinSeleccionError()

  const { default: jsPDF } = await import('jspdf')

  // ── Datos ───────────────────────────────────────────────────────────────
  const [pedido, todosLosDetalles] = await Promise.all([
    obtenerPedidoPorId(idPedido),
    obtenerDetallesDePedido(idPedido),
  ])
  if (!pedido) throw new Error('No se encontró el pedido solicitado.')

  // Filtramos PRESERVANDO el orden original del pedido (no el de selección).
  const elegidos = new Set(idsDetalle.map(String))
  const detalles = (todosLosDetalles ?? []).filter(d => elegidos.has(String(d.idDetallePedido)))
  if (detalles.length === 0) throw new SinSeleccionError()

  // ── Documento ───────────────────────────────────────────────────────────
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const columnas = definirColumnas(listarCantidad)
  const W = anchoLista()

  // Encabezado mínimo: sólo la banda con el nombre de la empresa (idéntica en todas las hojas).
  const ALTO_BANDA = 13
  const TOP_LISTAS = ALTO_BANDA + 6

  // Medición de cada ítem (envuelve texto largo: NO se trunca) → alturas → paginación.
  doc.setFontSize(FONT_SIZE_ROW)
  const filas = detalles.map(d => {
    const celdas = celdasDeDetalle(d, listarCantidad)
    const lineas = {}
    let max = 1
    for (const c of columnas) {
      lineas[c.key] = doc.splitTextToSize(celdas[c.key], c.width - CELL_PAD_X * 2)
      max = Math.max(max, lineas[c.key].length)
    }
    return { lineas, alto: altoFila(max) }
  })

  const altoLista = PAGE_H - MARGIN_BOTTOM - TOP_LISTAS - COL_HEADER_H
  const paginas = distribuirEnPaginas(filas.map(f => f.alto), altoLista)

  // ── Render ──────────────────────────────────────────────────────────────
  function dibujarEncabezado() {
    doc.setFillColor(...GRIS_HEADER)
    doc.rect(0, 0, PAGE_W, ALTO_BANDA, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...GRIS_TEXTO)
    doc.text('CLAUDIO RER GROUP', MARGIN_X, 8.5)
  }

  function dibujarLista(indices, x0) {
    if (indices.length === 0) return 0 // lista vacía (cantidad impar): no se dibuja nada

    // Rótulo de columnas
    doc.setFillColor(...GRIS_HEADER)
    doc.rect(x0, TOP_LISTAS, W, COL_HEADER_H, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...GRIS_TEXTO)
    let cx = x0
    for (const c of columnas) {
      const tx = c.align === 'center' ? cx + c.width / 2 : cx + CELL_PAD_X
      doc.text(c.label, tx, TOP_LISTAS + COL_HEADER_H / 2, { align: c.align, baseline: 'middle' })
      cx += c.width
    }

    // Filas
    doc.setFontSize(FONT_SIZE_ROW)
    let y = TOP_LISTAS + COL_HEADER_H
    for (const i of indices) {
      const { lineas, alto } = filas[i]
      let x = x0
      for (const c of columnas) {
        const negrita = c.key === 'cantidad'
        doc.setFont('helvetica', negrita ? 'bold' : 'normal'); doc.setTextColor(...GRIS_TEXTO)
        const tx = c.align === 'center' ? x + c.width / 2 : x + CELL_PAD_X
        lineas[c.key].forEach((l, k) => {
          doc.text(l, tx, y + ROW_PAD_Y + k * LINE_H, { align: c.align, baseline: 'top' })
        })
        x += c.width
      }
      y += alto
      doc.setDrawColor(...GRIS_LINEA); doc.setLineWidth(0.15)
      doc.line(x0, y, x0 + W, y)
    }
    return y
  }

  paginas.forEach((pag, p) => {
    if (p > 0) doc.addPage()
    dibujarEncabezado()
    const xIzq = MARGIN_X
    const xDer = MARGIN_X + W + GUTTER
    const yFinIzq = dibujarLista(pag.izquierda, xIzq)
    const yFinDer = dibujarLista(pag.derecha, xDer)

    // Divisor central sólo si hay lista derecha
    if (pag.derecha.length > 0) {
      doc.setDrawColor(...GRIS_LINEA); doc.setLineWidth(0.2)
      doc.line(MARGIN_X + W + GUTTER / 2, TOP_LISTAS, MARGIN_X + W + GUTTER / 2, Math.max(yFinIzq, yFinDer))
    }
  })

  doc.save(`Pedido_${idPedido}_HojaRecepcion.pdf`)
}
