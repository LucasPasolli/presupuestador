// src/lib/promociones.js
// Lógica de negocio para el sistema de promociones.
// Sin JSX, sin queries al DOM, sin efectos secundarios.
// Open/Closed: agregar un nuevo tipo → agregar una clave a `estrategias`.

import { query } from './database'

// ─── Estrategias ────────────────────────────────────────────────────────────
// Cada estrategia recibe (items, promo) y devuelve NUEVOS objetos item
// (inmutabilidad: nunca muta el array original).
//
// Cada item de entrada tiene al menos:
//   { idProducto, idCategoria?, precioUnitario, cantidad, ... }
// Cada item de salida puede incluir además:
//   { precioConPromo: number, promoAplicada: string }

const estrategias = {
  /**
   * Descuenta promo.valor % del precio unitario.
   * Ej: valor = 15 → precio * 0.85
   */
  porcentaje_producto: (items, promo) =>
    items.map(item => {
      if (!itemAplica(item, promo)) return item
      const factor = 1 - (promo.valor || 0) / 100
      const precioConPromo = parseFloat((parseFloat(item.precioUnitario) * factor).toFixed(2))
      return { ...item, precioConPromo, promoAplicada: promo.nombre }
    }),

  /**
   * Reemplaza el precio unitario por promo.valor (precio fijo especial).
   * Solo aplica si el precio fijo es menor al precio de lista.
   */
  precio_fijo: (items, promo) =>
    items.map(item => {
      if (!itemAplica(item, promo)) return item
      const precioConPromo = parseFloat(promo.valor || 0)
      // Solo aplicar si el precio fijo es menor al precio de lista
      if (precioConPromo >= parseFloat(item.precioUnitario)) return item
      return { ...item, precioConPromo, promoAplicada: promo.nombre }
    }),

  /**
   * 2x1: por cada 2 unidades, cobra solo 1.
   * El descuento se aplica distribuyendo el costo de las unidades gratis
   * entre todas las unidades → precio efectivo por unidad = precioUnitario / 2.
   * Para cantidad impar, la unidad "suelta" paga precio completo.
   *
   * Ejemplo: 3 unidades a $100 → paga 2 × $100 = $200 → precio efectivo $66.67
   * Se modela como precioConPromo = precioUnitario * ceil(cant/2) / cant
   */
  '2x1': (items, promo) =>
    items.map(item => {
      if (!itemAplica(item, promo)) return item
      const cant = parseInt(item.cantidad) || 1
      if (cant < 2) return item // con 1 unidad no hay beneficio
      const unidadesACobrar = Math.ceil(cant / 2)
      const precioConPromo = parseFloat(
        ((parseFloat(item.precioUnitario) * unidadesACobrar) / cant).toFixed(2)
      )
      return { ...item, precioConPromo, promoAplicada: promo.nombre }
    }),
}

// ─── Helpers de filtrado por alcance ────────────────────────────────────────

/**
 * Determina si un item es afectado por una promoción según su alcance.
 * @param {object} item
 * @param {object} promo
 * @returns {boolean}
 */
function itemAplica(item, promo) {
  switch (promo.alcance) {
    case 'global':
      return true
    case 'producto':
      return promo.idProducto !== null &&
             parseInt(item.idProducto) === parseInt(promo.idProducto)
    case 'categoria':
      return promo.idCategoria !== null &&
             parseInt(item.idCategoria) === parseInt(promo.idCategoria)
    default:
      return false
  }
}

// ─── Función principal ───────────────────────────────────────────────────────

/**
 * Enriquece los items del carrito con información de promociones vigentes.
 *
 * 1. Obtiene todas las promociones activas y vigentes para la fecha de hoy.
 * 2. Para cada promo, aplica la estrategia correspondiente sobre los items.
 * 3. Si un item recibe múltiples promos, gana la que resulte en el precio final menor.
 * 4. Retorna un nuevo array de items con los campos:
 *      - precioConPromo {number|undefined}  precio efectivo por unidad con promo
 *      - promoAplicada  {string|undefined}   nombre de la promo ganadora
 *      - idPromocion    {number|undefined}   id de la promo ganadora
 *
 * @param {Array<object>} items  – ítems del carrito (sin mutar)
 * @returns {Array<object>}      – nuevos objetos item
 */
export function aplicarPromociones(items) {
  if (!items || items.length === 0) return items

  // Enriquecer items con idCategoria si no lo tienen
  const itemsConCat = items.map(item => {
    if (item.idCategoria || !item.idProducto) return item
    const prod = query(
      'SELECT idCategoria FROM Producto WHERE idProducto = ?',
      [parseInt(item.idProducto)]
    )[0]
    return prod ? { ...item, idCategoria: prod.idCategoria } : item
  })

  // Obtener promociones vigentes
  const hoy = new Date().toISOString().slice(0, 10) // 'YYYY-MM-DD'
  const promos = query(
    `SELECT * FROM Promocion
     WHERE activo = 1
       AND fechaInicio <= ?
       AND fechaFin    >= ?
     ORDER BY idPromocion`,
    [hoy, hoy]
  )

  if (!promos.length) return itemsConCat

  // Aplicar cada promo; conservar la que genera el precio más bajo por item
  let resultado = itemsConCat.map(item => ({ ...item }))

  for (const promo of promos) {
    const estrategia = estrategias[promo.tipo]
    if (!estrategia) continue // tipo desconocido → saltar

    const itemsAplicados = estrategia(resultado, promo)

    // Para cada item, comparar el precio resultante y conservar el menor
    resultado = resultado.map((itemActual, idx) => {
      const itemNuevo = itemsAplicados[idx]
      const precioActual = itemActual.precioConPromo ?? parseFloat(itemActual.precioUnitario)
      const precioNuevo  = itemNuevo.precioConPromo  ?? parseFloat(itemNuevo.precioUnitario)

      if (precioNuevo < precioActual) {
        return { ...itemNuevo, idPromocion: promo.idPromocion }
      }
      return itemActual
    })
  }

  return resultado
}

/**
 * Calcula los totales del presupuesto considerando promociones.
 *
 * @param {Array<object>} itemsConPromo  – resultado de aplicarPromociones()
 * @param {number}        factorReal     – factor del método de pago
 * @returns {{ subtotalSinPromo, subtotalConPromo, ahorro, totalFinal }}
 */
export function calcularTotales(itemsConPromo, factorReal) {
  const subtotalSinPromo = itemsConPromo.reduce((acc, it) => {
    const cant   = parseInt(it.cantidad)  || 0
    const precio = parseFloat(it.precioUnitario) || 0
    return acc + cant * precio
  }, 0)

  const subtotalConPromo = itemsConPromo.reduce((acc, it) => {
    const cant   = parseInt(it.cantidad) || 0
    const precio = it.precioConPromo != null
      ? it.precioConPromo
      : (parseFloat(it.precioUnitario) || 0)
    return acc + cant * precio
  }, 0)

  const ahorro     = subtotalSinPromo - subtotalConPromo
  const totalFinal = subtotalConPromo * factorReal

  return { subtotalSinPromo, subtotalConPromo, ahorro, totalFinal }
}
