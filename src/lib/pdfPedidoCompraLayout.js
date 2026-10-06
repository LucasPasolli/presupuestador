// src/lib/pdfPedidoCompraLayout.js
// Lógica PURA de maquetación de la "Hoja de recepción" compacta (2 listas por hoja).
// No depende de jsPDF ni del DOM: recibe alturas ya medidas y devuelve en qué
// página / lista cae cada ítem. Esto permite testearla sin generar un PDF.
//
// Patrón: separación Layout (puro) / Renderer (jsPDF) — el renderer sólo
// "pinta" lo que el layout decidió (Single Responsibility).

// ─── Geometría de la hoja (mm, A4 vertical) ────────────────────────────────
export const PAGE_W = 210
export const PAGE_H = 297
export const MARGIN_X = 12
export const MARGIN_BOTTOM = 14
export const GUTTER = 8 // separación entre la lista izquierda y la derecha

// ─── Tipografía / filas ────────────────────────────────────────────────────
export const FONT_SIZE_ROW = 8
export const LINE_H = 3.5        // alto de cada línea de texto dentro de una fila
export const ROW_PAD_Y = 1.6     // padding vertical de la fila
export const CELL_PAD_X = 1.5    // padding horizontal de cada celda
export const ROW_H_MIN = LINE_H + ROW_PAD_Y * 2 // 6.7 mm (fila de 1 línea)
export const COL_HEADER_H = 6    // alto del rótulo de columnas de cada lista

// Formato ANTERIOR (referencia para el criterio "más ítems por hoja que N")
export const LEGACY_ALTO_FILA = 22
export const LEGACY_TOP_CONTENT = 52
export const LEGACY_HEAD_H = 10
export const LEGACY_MARGIN_BOTTOM = 20

/** Cantidad de ítems por hoja del formato anterior (N). */
export function legacyItemsPorHoja() {
  const util = PAGE_H - LEGACY_TOP_CONTENT - LEGACY_MARGIN_BOTTOM - LEGACY_HEAD_H
  return Math.floor(util / LEGACY_ALTO_FILA)
}

/** Ancho útil de una lista (mitad de la hoja menos márgenes y medianil). */
export function anchoLista() {
  return (PAGE_W - MARGIN_X * 2 - GUTTER) / 2
}

/**
 * Definición de columnas de UNA lista. Código, Nombre y Medida son obligatorias;
 * Cantidad es opcional. El Nombre absorbe el ancho restante.
 * @param {boolean} listarCantidad
 * @returns {{key:string,label:string,width:number,align:'left'|'center'}[]}
 */
export function definirColumnas(listarCantidad) {
  const W = anchoLista()
  const cod = 13
  const medida = 20
  const cant = listarCantidad ? 11 : 0
  const nombre = W - cod - medida - cant
  const cols = [
    { key: 'codigo', label: 'Cód.',     width: cod,    align: 'left' },
    { key: 'nombre', label: 'Producto', width: nombre, align: 'left' },
    { key: 'medida', label: 'Medida',   width: medida, align: 'left' },
  ]
  if (listarCantidad) cols.push({ key: 'cantidad', label: 'Cant.', width: cant, align: 'center' })
  return cols
}

/**
 * Normaliza texto para fuentes estándar de PDF: quita caracteres de control y
 * colapsa espacios. Nunca devuelve null/undefined.
 */
export function sanitizarTexto(valor) {
  if (valor === null || valor === undefined) return ''
  // eslint-disable-next-line no-control-regex
  return String(valor).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Convierte un detalle de pedido en las celdas a imprimir (sólo los datos
 * habilitados por la configuración — nada de precios ni subtotales).
 */
export function celdasDeDetalle(detalle, listarCantidad) {
  const celdas = {
    codigo: sanitizarTexto(detalle.idProducto) || '—',
    nombre: sanitizarTexto(detalle.nombreProducto) || `#${sanitizarTexto(detalle.idProducto)}`,
    medida: sanitizarTexto(detalle.medida) || '—',
  }
  if (listarCantidad) celdas.cantidad = sanitizarTexto(detalle.cantidad) || '0'
  return celdas
}

/**
 * Alto de una fila según la celda con más líneas (envuelve, NO trunca).
 * @param {number} maxLineas
 */
export function altoFila(maxLineas) {
  return Math.max(1, maxLineas) * LINE_H + ROW_PAD_Y * 2
}

/**
 * Distribuye filas (en su orden original) en páginas de DOS listas:
 * llena la izquierda de arriba hacia abajo, luego la derecha y luego pasa
 * a una hoja nueva. Una fila nunca se parte entre listas/páginas.
 *
 * @param {number[]} alturas  Alto en mm de cada fila, en orden de pedido.
 * @param {number}   altoDisponible  Alto en mm de cada lista (ya sin el rótulo de columnas).
 * @returns {{izquierda:number[], derecha:number[]}[]} Índices de `alturas` por lista/página.
 */
export function distribuirEnPaginas(alturas, altoDisponible) {
  if (!Array.isArray(alturas) || alturas.length === 0) return []
  if (!(altoDisponible > 0)) throw new RangeError('altoDisponible debe ser > 0')

  const paginas = [{ izquierda: [], derecha: [] }]
  let lado = 'izquierda'
  let y = 0

  alturas.forEach((h, i) => {
    const pag = paginas[paginas.length - 1]
    const columnaVacia = pag[lado].length === 0

    // No entra y la columna ya tiene algo → avanzar. (Si la columna está vacía
    // la fila se coloca igual: evita bucles con una fila anómalamente alta.)
    if (y + h > altoDisponible && !columnaVacia) {
      if (lado === 'izquierda') {
        lado = 'derecha'
      } else {
        paginas.push({ izquierda: [], derecha: [] })
        lado = 'izquierda'
      }
      y = 0
    }
    paginas[paginas.length - 1][lado].push(i)
    y += h
  })

  return paginas
}
