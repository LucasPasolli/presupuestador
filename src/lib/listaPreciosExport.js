// src/lib/listaPreciosExport.js
//
// Exportación de la lista de precios a Excel con precios promocionales.
//
// Arquitectura (separación de responsabilidades):
//   1. construirFilasListaPrecios()  → PURA. Producto[] + Promoción[] → Fila[].
//                                      Sin red, sin DOM, sin fecha implícita: 100% testeable.
//   2. generarListaPreciosXlsx()     → Presentación. Fila[] → ArrayBuffer (.xlsx).
//   3. descargarArchivo()            → Único punto con side-effects de navegador.
//
// La regla de negocio de "qué promoción gana y cuánto descuenta" NO se duplica:
// se reutiliza calcularPromocionParaItem() de promocionesService, la misma que
// usa el Presupuestador. Así la lista exportada y el cobro real no pueden divergir.

import { calcularPromocionParaItem } from '../services/promocionesService'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * @typedef {Object} FilaListaPrecios
 * @property {number}  codigo
 * @property {string}  producto
 * @property {number}  precioOriginal   Precio de venta regular.
 * @property {number}  precioFinal      Precio que efectivamente se cobra (promo o regular).
 * @property {boolean} enPromo          true si precioFinal < precioOriginal (se tacha el original).
 * @property {string}  etiqueta         Tag textual ('' si no hay promoción informable).
 */

// ─── Fechas ───────────────────────────────────────────────────────────────────

/**
 * Fecha LOCAL en formato 'YYYY-MM-DD'.
 *
 * No usar `new Date().toISOString().slice(0, 10)`: devuelve la fecha en UTC, y en
 * Argentina (UTC-3) pasadas las 21:00 ya es "mañana". Eso haría exportar una lista
 * con promociones que todavía no empezaron (o ignorar una que vence hoy).
 */
export function fechaLocalISO(fecha = new Date()) {
  const y = fecha.getFullYear()
  const m = String(fecha.getMonth() + 1).padStart(2, '0')
  const d = String(fecha.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ─── Saneamiento ──────────────────────────────────────────────────────────────

/**
 * Mitigación de "Formula Injection": si el texto empieza con =, +, -, @, TAB o CR,
 * Excel podría interpretarlo como fórmula. Se antepone un apóstrofo.
 */
export function sanitizarTexto(valor) {
  const texto = String(valor ?? '').trim()
  return /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto
}

// ─── Lógica pura ──────────────────────────────────────────────────────────────

const redondear2 = (n) => Math.round(n * 100) / 100

/**
 * Una promoción solo participa de la lista si su `valor` es coherente.
 * calcularPromocionParaItem usa Math.max(0, valor): un `precio_fijo` con valor
 * null/inválido terminaría publicando precio $0. Se filtra ANTES de elegir
 * ganadora para que una promo corrupta no tape a una válida de menor alcance.
 */
function promoEsCalculable(promo) {
  switch (promo.tipo) {
    case 'porcentaje_producto':
      return Number.isFinite(promo.valor) && promo.valor > 0 && promo.valor <= 100
    case 'precio_fijo':
      return Number.isFinite(promo.valor) && promo.valor > 0
    case '2x1':
      return true
    default:
      return false // tipo desconocido: no se aplica (fail-safe → precio regular)
  }
}

function construirEtiqueta(promo) {
  switch (promo.tipo) {
    case 'porcentaje_producto':
      return `EN PROMO −${Number(promo.valor).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`
    case '2x1':
      return 'EN PROMO 2×1'
    default:
      return 'EN PROMO'
  }
}

/**
 * Construye las filas de la lista de precios.
 *
 * Decisiones de negocio:
 *  - Se evalúa con cantidad = 1: una lista de precios es por unidad.
 *  - `precio_fijo`: solo cuenta como promoción si BAJA el precio. Un "precio fijo"
 *    mayor al regular nunca debe publicarse como si fuera una oferta.
 *  - `2x1`: depende de la cantidad comprada, no hay precio unitario promocional.
 *    Se informa con el tag, pero el precio queda en el regular y NO se tacha.
 *  - El nombre interno de la promoción no se exporta (dato interno, no pensado
 *    para el cliente final).
 *
 * @param {Array<{idProducto:number,idCategoria:number,nombre:string,precioUnitario:number}>} productos
 * @param {Array<Object>} promosVigentes  Resultado de obtenerPromocionesVigentes(fecha).
 * @returns {FilaListaPrecios[]}
 */
export function construirFilasListaPrecios(productos, promosVigentes = []) {
  const promos = (promosVigentes ?? []).filter(promoEsCalculable)

  return productos.map((p) => {
    const precioOriginal = redondear2(Number(p.precioUnitario) || 0)

    const { promoAplicada, precioFinal } = calcularPromocionParaItem(
      {
        idProducto: p.idProducto,
        idCategoria: p.idCategoria,
        precioUnitario: precioOriginal,
        cantidad: 1,
      },
      promos,
    )

    const baja = Boolean(promoAplicada) && precioFinal < precioOriginal
    const esDosPorUno = promoAplicada?.tipo === '2x1'

    return {
      codigo: p.idProducto,
      producto: sanitizarTexto(p.nombre),
      precioOriginal,
      precioFinal: baja ? precioFinal : precioOriginal,
      enPromo: baja,
      etiqueta: baja || esDosPorUno ? construirEtiqueta(promoAplicada) : '',
    }
  })
}

// ─── Generación del .xlsx ─────────────────────────────────────────────────────

const COLOR = {
  headerBg: 'FF1F2937',
  headerFg: 'FFFFFFFF',
  borde: 'FFD1D5DB',
  bordeSuave: 'FFE5E7EB',
  tachado: 'FF6B7280',
  promoFg: 'FF047857',
  tagBg: 'FFFEF3C7',
  tagFg: 'FF92400E',
}

function anchoAutomatico(valores, min, max) {
  const largoMax = Math.max(...valores.map((v) => String(v ?? '').length))
  return Math.min(Math.max(largoMax + 2, min), max)
}

/**
 * Genera el workbook. exceljs se importa de forma dinámica (code-splitting):
 * solo se descarga cuando el usuario realmente exporta.
 *
 * Seguridad: solo ESCRIBE un workbook nuevo con datos propios; nunca lee .xlsx
 * externos ni usa addImage()/notas de celda (vectores de CVEs conocidas de exceljs).
 *
 * Accesibilidad: la promoción no depende solo del color o del tachado; siempre hay
 * un tag textual en la columna "Promoción" (apto lectores de pantalla / impresión B/N).
 *
 * @param {FilaListaPrecios[]} filas
 * @returns {Promise<ArrayBuffer>}
 */
export async function generarListaPreciosXlsx(filas) {
  const { default: ExcelJS } = await import('exceljs')

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Sistema de Inventario'
  workbook.created = new Date()

  const ws = workbook.addWorksheet('Lista Productos', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  ws.columns = [
    { header: 'Código',          key: 'codigo',         width: anchoAutomatico([6, ...filas.map((f) => f.codigo)], 8, 14) },
    { header: 'Producto',        key: 'producto',       width: anchoAutomatico(['Producto', ...filas.map((f) => f.producto)], 20, 60) },
    { header: 'Precio original', key: 'precioOriginal', width: 16 },
    { header: 'Precio final',    key: 'precioFinal',    width: 16 },
    { header: 'Promoción',       key: 'etiqueta',       width: anchoAutomatico(['Promoción', ...filas.map((f) => f.etiqueta)], 14, 26) },
  ]
  ws.addRows(filas)
  ws.autoFilter = { from: 'A1', to: 'E1' } // permite filtrar solo los artículos en promoción

  // Encabezado
  const header = ws.getRow(1)
  header.height = 20
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: COLOR.headerFg } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.headerBg } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = {
      top:    { style: 'thin', color: { argb: COLOR.borde } },
      bottom: { style: 'thin', color: { argb: COLOR.borde } },
    }
  })

  // Columnas de precio: numéricas reales (ordenables/sumables), no texto.
  for (const key of ['precioOriginal', 'precioFinal']) {
    ws.getColumn(key).numFmt = '$ #,##0.00'
    ws.getColumn(key).alignment = { horizontal: 'right' }
  }

  // Filas de datos
  filas.forEach((fila, i) => {
    const row = ws.getRow(i + 2)
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { bottom: { style: 'hair', color: { argb: COLOR.bordeSuave } } }
    })

    if (fila.enPromo) {
      // Precio original TACHADO + precio final destacado
      row.getCell('precioOriginal').font = { strike: true, color: { argb: COLOR.tachado } }
      row.getCell('precioFinal').font = { bold: true, color: { argb: COLOR.promoFg } }
    }

    if (fila.etiqueta) {
      const tag = row.getCell('etiqueta')
      tag.font = { bold: true, color: { argb: COLOR.tagFg } }
      tag.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.tagBg } }
      tag.alignment = { horizontal: 'center' }
    }
  })

  return workbook.xlsx.writeBuffer()
}

// ─── Descarga (side-effect de navegador, aislado) ─────────────────────────────

export function descargarArchivo(buffer, nombreArchivo, mime = XLSX_MIME) {
  const url = URL.createObjectURL(new Blob([buffer], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = nombreArchivo
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
