// src/lib/calculoPresupuesto.js
/**
 * Cálculo de importes de un presupuesto — ÚNICA fuente de verdad.
 *
 * REGLA DE NEGOCIO
 * ────────────────
 * El descuento/recargo del método de pago se aplica SOLO a los ítems SIN
 * promoción vigente. Los ítems con promoción conservan su precio promocional
 * tal cual (no se acumulan beneficios ni cargos).
 *
 *   subtotalPromo      = Σ cant × precioConPromo      (ítems con promoción)
 *   subtotalAjustable  = Σ cant × precioUnitario      (ítems sin promoción)
 *   ajuste             = round2(subtotalAjustable × factor − subtotalAjustable)
 *   total              = round2(subtotalPromo + subtotalAjustable + ajuste)
 *
 * PATRÓN
 * ──────
 * Módulo de funciones puras (sin React, sin red, sin Date): el mismo código
 * alimenta la pantalla del Presupuestador, la carga en edición, el detalle del
 * Historial, el PDF y las Facturas. Antes cada pantalla re-derivaba el factor
 * a su manera (`monto / subtotalConPromo`), y esa divergencia era la raíz del
 * bug: el factor se aplicaba sobre TODO el subtotal.
 *
 * CRITERIO "TIENE PROMOCIÓN"
 * ──────────────────────────
 * Un ítem tiene promoción si `precioConPromo != null` (hay una promoción
 * aplicada, aunque su ahorro efectivo sea 0, p. ej. un 2x1 con cantidad 1).
 * Si negocio decide que "sin ahorro real = sin promoción", se cambia en UN
 * solo lugar: `tienePromocion()`.
 *
 * Los importes se redondean a 2 decimales en cada paso para que lo mostrado,
 * lo persistido y lo validado en el servidor coincidan al centavo.
 *
 * @module lib/calculoPresupuesto
 */

/** Factor multiplicativo por método de pago (espejo de METODOS_BASE de la UI). */
export const FACTOR_POR_METODO = Object.freeze({
  efectivo: 0.95,
  transferencia: 0.95,
  cc15: 1.0,
  cc30: 1.105,
})

/** @param {unknown} n */
export const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100

/**
 * Un factor inválido (NaN, negativo) nunca debe producir un total negativo ni
 * NaN: se normaliza. `0` es válido (100 % de descuento sobre los ítems sin promo).
 * @param {unknown} factor
 * @returns {number}
 */
export function normalizarFactor(factor) {
  const f = Number(factor)
  if (!Number.isFinite(f)) return 1
  return f < 0 ? 0 : f
}

/**
 * ¿El ítem/detalle tiene una promoción aplicada?
 * @param {{ precioConPromo?: number|string|null }} item
 */
export function tienePromocion(item) {
  return item?.precioConPromo != null
}

/**
 * @typedef {object} ItemCalculo
 * @property {number|string} cantidad
 * @property {number|string} precioUnitario      Precio de lista.
 * @property {number|null}   [precioConPromo]    `null`/ausente = sin promoción.
 * @property {boolean}       [noDisponible]      Producto dado de baja: no suma.
 */

/**
 * @typedef {object} TotalesPresupuesto
 * @property {number} subtotalSinPromo     Todo a precio de lista.
 * @property {number} subtotalPromo        Ítems con promoción, a precio promo.
 * @property {number} subtotalAjustable    Ítems sin promoción, a precio de lista.
 * @property {number} subtotalConPromo     subtotalPromo + subtotalAjustable.
 * @property {number} ahorro               Ahorro por promociones.
 * @property {number} ajuste               Ajuste por método de pago (− descuento, + recargo).
 * @property {number} totalFinal
 * @property {number} cantItemsConPromo
 * @property {number} cantItemsAjustables
 */

/**
 * Totales del carrito. Recalcula todo desde cero en cada llamada, así que no
 * puede "arrastrar" el ajuste de un método anterior (escenarios 5 y 6).
 *
 * @param {ItemCalculo[]} items
 * @param {number} factor Factor del método de pago (0.95, 1, 1.105, …).
 * @returns {TotalesPresupuesto}
 */
export function calcularTotales(items, factor) {
  const f = normalizarFactor(factor)

  let subtotalSinPromo = 0
  let subtotalPromo = 0
  let subtotalAjustable = 0
  let cantItemsConPromo = 0
  let cantItemsAjustables = 0

  for (const it of items ?? []) {
    if (it?.noDisponible) continue
    const cant = parseInt(it.cantidad, 10) || 0
    if (cant <= 0) continue
    const precio = parseFloat(it.precioUnitario) || 0

    subtotalSinPromo += round2(cant * precio)

    if (tienePromocion(it)) {
      subtotalPromo += round2(cant * (Number(it.precioConPromo) || 0))
      cantItemsConPromo += 1
    } else {
      subtotalAjustable += round2(cant * precio)
      cantItemsAjustables += 1
    }
  }

  subtotalSinPromo = round2(subtotalSinPromo)
  subtotalPromo = round2(subtotalPromo)
  subtotalAjustable = round2(subtotalAjustable)

  const subtotalConPromo = round2(subtotalPromo + subtotalAjustable)
  const ajuste = round2(subtotalAjustable * f - subtotalAjustable)
  const totalFinal = round2(subtotalConPromo + ajuste)

  return {
    subtotalSinPromo,
    subtotalPromo,
    subtotalAjustable,
    subtotalConPromo,
    ahorro: round2(subtotalSinPromo - subtotalConPromo),
    ajuste,
    totalFinal,
    cantItemsConPromo,
    cantItemsAjustables,
  }
}

/**
 * @typedef {object} DetalleGuardado
 * @property {number|string}      subtotal
 * @property {number|string|null} [precioConPromo]
 * @property {number|string}      [cantidad]
 */

/**
 * @param {DetalleGuardado[]} detalles
 * @returns {{ subtotalPromo: number, subtotalAjustable: number }}
 */
export function separarSubtotales(detalles) {
  let subtotalPromo = 0
  let subtotalAjustable = 0
  for (const d of detalles ?? []) {
    const s = Number(d?.subtotal) || 0
    if (tienePromocion(d)) subtotalPromo += s
    else subtotalAjustable += s
  }
  return { subtotalPromo: round2(subtotalPromo), subtotalAjustable: round2(subtotalAjustable) }
}

/**
 * Reconstruye el factor aplicado a los ítems SIN promoción a partir de lo
 * persistido (`monto` + detalles). Se usa para:
 *   · reabrir una "Excepción" en el Presupuestador (de ahí sale el % editable),
 *   · rotular el % en Historial y PDF.
 *
 *   factor = (monto − subtotalPromo) / subtotalAjustable
 *
 * Si no hay ítems ajustables (todo en promoción) el factor no se puede ni
 * necesita inferir: devuelve 1.
 *
 * LIMITACIÓN: presupuestos guardados ANTES de este fix aplicaron el factor a
 * todo el subtotal; para ellos esta inferencia atribuye todo el ajuste a los
 * ítems sin promoción. El total nunca cambia (sigue cerrando con `monto`).
 *
 * @param {{ monto: number|string, detalles: DetalleGuardado[] }} args
 * @returns {number}
 */
export function derivarFactorAjustable({ monto, detalles }) {
  const { subtotalPromo, subtotalAjustable } = separarSubtotales(detalles)
  if (subtotalAjustable <= 0) return 1
  return normalizarFactor(((Number(monto) || 0) - subtotalPromo) / subtotalAjustable)
}

/**
 * Factor "efectivo" sobre el total del detalle: monto / Σ subtotal.
 *
 * COMPATIBILIDAD CON EL RPC ACTUAL: `crear_presupuesto_idempotente` valida
 * `monto ≈ round(Σ detalle.subtotal × cabecera.factor, 2)`. Con la regla nueva
 * el factor del método ya no es uniforme, así que se envía este factor
 * mezclado, que hace cumplir esa igualdad. Mientras el RPC no se actualice
 * (ver sql/calcular_total_presupuesto.sql) es lo que evita rechazar altas
 * válidas.
 *
 * @param {number} monto
 * @param {DetalleGuardado[]} detalles
 * @returns {number}
 */
export function factorCompatibleRpc(monto, detalles) {
  const suma = (detalles ?? []).reduce((a, d) => a + (Number(d?.subtotal) || 0), 0)
  return suma > 0 ? (Number(monto) || 0) / suma : 1
}

/**
 * Reparte `monto` entre los detalles respetando la regla: los ítems con
 * promoción quedan intactos y los demás absorben el ajuste. La suma de los
 * `subtotalAjustado` es EXACTAMENTE `monto` (requisito de Facturas).
 *
 * @template {DetalleGuardado} T
 * @param {T[]} detalles
 * @param {number|string} monto
 * @returns {Array<T & { subtotalAjustado: number }>}
 */
export function ajustarDetallesAlMonto(detalles, monto) {
  const f = derivarFactorAjustable({ monto, detalles })
  return (detalles ?? []).map((d) => {
    const s = Number(d?.subtotal) || 0
    return { ...d, subtotalAjustado: tienePromocion(d) ? s : s * f }
  })
}

/**
 * Porcentaje de ajuste legible ("5% descuento", "10.5% recargo") o `null`.
 * @param {number} factor
 * @returns {string|null}
 */
export function describirFactor(factor) {
  const diff = (normalizarFactor(factor) - 1) * 100
  if (Math.abs(diff) < 0.005) return null
  const txt = Number.isInteger(diff) ? String(Math.abs(diff)) : Math.abs(diff).toFixed(2).replace(/\.?0+$/, '')
  return diff < 0 ? `${txt}% descuento` : `${txt}% recargo`
}
