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

/**
 * @typedef {object} ItemReintegro
 * @property {number}      idProducto
 * @property {string|null} nombreProducto
 * @property {string|null} medida
 * @property {number}      cantidad
 */

/**
 * @typedef {object} ItemNoReintegrado
 * @property {number|null} idProducto
 * @property {string|null} nombreProducto
 * @property {'sin_producto_asociado'|'producto_eliminado'} motivo
 */

/**
 * @typedef {object} ResultadoEliminacion
 * @property {number}               idPresupuesto
 * @property {string}               estadoAlEliminar    Estado que tenía el
 *   presupuesto en el momento de eliminarlo ('borrador'|'aprobado'|'pagado'|
 *   'rechazado').
 * @property {boolean}              reintegrado         `true` si correspondía
 *   reintegrar stock (el presupuesto ya había descontado — ver nota de
 *   diseño en la migración SQL sobre por qué esto incluye 'aprobado' además
 *   de 'pagado').
 * @property {ItemReintegro[]}      itemsReintegrados
 * @property {ItemNoReintegrado[]}  itemsNoReintegrados En 0 en el caso feliz;
 *   si trae elementos, hay productos que no se pudieron reponer (fueron
 *   eliminados del catálogo) y conviene loguearlo/revisarlo manualmente.
 * @property {boolean}              saldoEliminado      Si tenía Cuenta
 *   Corriente asociada y se borró junto con el presupuesto.
 * @property {number}               aplicacionesPagoEliminadas Cantidad de
 *   cobros parciales (`pago_aplicacion`) que se perdieron al borrar el saldo.
 *   Si es > 0, la UI debería mostrarlo con énfasis: son cobros reales que
 *   quedan sin respaldo en el historial de Cuenta Corriente.
 * @property {number}               montoAplicacionesEliminadas Suma de esos
 *   cobros, para el mismo aviso.
 * @property {boolean}              idempotente `true` si la respuesta vino
 *   de una solicitud anterior con la misma clave.
 */

/**
 * Elimina un presupuesto de forma atómica e idempotente, reintegrando al
 * stock las cantidades que ese presupuesto había descontado (si las hubo).
 *
 * Reemplaza a `eliminarPresupuesto(idPresupuesto)` del service actual para
 * cualquier flujo que pueda borrar un presupuesto 'aprobado' o 'pagado' —
 * es decir, para el botón de eliminar en Historial.jsx. `eliminarPresupuesto`
 * sigue siendo válida tal cual para casos donde el estado es 'borrador' o
 * 'rechazado' (nunca hubo descuento de stock), pero usar esta función
 * siempre es seguro y no tiene costo extra: si no correspondía reintegro,
 * la RPC lo detecta sola y no toca stock.
 *
 * @param {object} args
 * @param {string} args.clave          UUID generado una vez por intento de
 *   eliminación (ver patrón `idempotencyKey` de Inventario.jsx: se regenera
 *   al abrir el modal de confirmación, se conserva entre reintentos del
 *   mismo intento).
 * @param {number} args.idPresupuesto
 * @returns {Promise<ResultadoEliminacion>}
 * @throws {import('./idempotencia').ErrorOperacion} Error ya saneado para la UI.
 */
export async function eliminarPresupuestoConReintegro({ clave, idPresupuesto }) {
  if (!idPresupuesto) {
    throw new Error('idPresupuesto es requerido.')
  }
  if (!clave) {
    throw new Error('Falta la clave de idempotencia.')
  }

  const resultado = /** @type {ResultadoEliminacion} */ (
    await ejecutarIdempotente(
      'eliminar_presupuesto_con_reintegro',
      { p_id_presupuesto: idPresupuesto },
      { clave },
    )
  )

  if (resultado.idempotente) {
    logger.warn('presupuesto.eliminacion_duplicada_absorbida', {
      idPresupuesto: resultado.idPresupuesto,
      clave,
    })
  }

  if (resultado.itemsNoReintegrados?.length) {
    // Observabilidad: productos que no se pudieron reponer porque ya no
    // existen en el catálogo. No es un error bloqueante — el presupuesto
    // igual se eliminó — pero es una discrepancia de stock que alguien
    // debería revisar manualmente.
    logger.warn('presupuesto.reintegro_parcial', {
      idPresupuesto: resultado.idPresupuesto,
      itemsNoReintegrados: resultado.itemsNoReintegrados,
    })
  }

  if (resultado.aplicacionesPagoEliminadas > 0) {
    logger.warn('presupuesto.eliminado_con_cobros_cc_asociados', {
      idPresupuesto: resultado.idPresupuesto,
      aplicacionesPagoEliminadas: resultado.aplicacionesPagoEliminadas,
      montoAplicacionesEliminadas: resultado.montoAplicacionesEliminadas,
    })
  }

  return resultado
}

export default crearPresupuestoIdempotente
