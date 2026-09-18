// src/services/presupuestosIdempotente.js
/**
 * Alta de presupuesto idempotente y atómica.
 *
 * Reemplaza a `crearPresupuesto(cabecera, detalles)` del service actual, que
 * hace N+1 round-trips sin transacción: si el navegador se cierra entre la
 * cabecera y los detalles, queda un presupuesto huérfano en la base.
 *
 * Aquí todo ocurre dentro de una sola función de Postgres:
 *   · una transacción → atomicidad real
 *   · una clave de idempotencia → el reenvío no duplica
 *   · validación de totales en el servidor → el cliente deja de ser confiable
 *
 * @module services/presupuestosIdempotente
 */
import { ejecutarIdempotente } from './idempotencia'
import { logger } from '../lib/logger'

/**
 * @typedef {object} CabeceraPresupuesto
 * @property {number} idCliente
 * @property {string} nombreCliente
 * @property {string} apellidoCliente
 * @property {string} fecha            ISO `YYYY-MM-DD`
 * @property {string} metodoPago
 * @property {number} montoOriginal
 * @property {number} monto
 * @property {'borrador'|'aprobado'|'anulado'} estado
 * @property {0|1} esExcepcion
 */

/**
 * @typedef {object} DetallePresupuesto
 * @property {number}      idProducto
 * @property {string|null} nombreProducto
 * @property {string|null} medida
 * @property {number}      cantidad
 * @property {number}      precioUnitario
 * @property {number}      subtotal
 * @property {number|null} precioConPromo
 * @property {number|null} idPromocion
 */

/**
 * @typedef {object} ResultadoAlta
 * @property {number}  idPresupuesto
 * @property {number}  monto
 * @property {boolean} idempotente `true` si la respuesta vino de una
 *   solicitud anterior con la misma clave (el duplicado fue absorbido).
 */

/**
 * @param {object} args
 * @param {string}               args.clave     UUID de `useClaveIdempotencia()`.
 * @param {CabeceraPresupuesto}  args.cabecera
 * @param {DetallePresupuesto[]} args.detalles
 * @returns {Promise<ResultadoAlta>}
 * @throws {import('./idempotencia').ErrorOperacion} Error ya saneado para la UI.
 */
export async function crearPresupuestoIdempotente({ clave, cabecera, detalles }) {
  if (!Array.isArray(detalles) || detalles.length === 0) {
    throw new Error('El presupuesto debe tener al menos un ítem.')
  }

  const resultado = /** @type {ResultadoAlta} */ (
    await ejecutarIdempotente(
      'crear_presupuesto_idempotente',
      { p_cabecera: cabecera, p_detalles: detalles },
      { clave },
    )
  )

  if (resultado.idempotente) {
    // Observabilidad: si esta métrica sube, hay una fuente de duplicados que
    // vale la pena investigar (¿red inestable?, ¿un usuario con doble pestaña?).
    logger.warn('presupuesto.duplicado_absorbido', {
      idPresupuesto: resultado.idPresupuesto,
      clave,
    })
  }

  return resultado
}

export default crearPresupuestoIdempotente
