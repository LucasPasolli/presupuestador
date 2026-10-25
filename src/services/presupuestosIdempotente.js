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

/**
 * @typedef {object} ResultadoEdicion
 * @property {number}  idPresupuesto
 * @property {number}  monto
 * @property {boolean} idempotente `true` si la respuesta vino de una
 *   solicitud anterior con la misma clave.
 */

/**
 * Edita un presupuesto en BORRADOR de forma atómica e idempotente.
 *
 * Reemplaza a `actualizarPresupuesto(id, cabecera, detalles)` del service, que
 * escribía directo a las tablas (update + delete + insert sin transacción) y por lo
 * tanto: (1) podía dejar un presupuesto sin ítems si la secuencia se cortaba y
 * (2) nunca pasaba por la validación de totales del servidor.
 *
 * La RPC valida con las MISMAS reglas que el alta (app.validar_presupuesto), bloquea
 * la fila y rechaza si el estado ya no es 'borrador'.
 * `cabecera.estado` se ignora: los cambios de estado siguen su propio camino.
 *
 * @param {object} args
 * @param {string} args.clave          UUID de `useClaveIdempotencia()`. Una clave
 *   por intento de guardado; rotar tras éxito (y tras CLAVE_REUTILIZADA, ver
 *   Presupuestador.jsx: como la edición REEMPLAZA el estado, rotar es seguro).
 * @param {number} args.idPresupuesto
 * @param {CabeceraPresupuesto}  args.cabecera
 * @param {DetallePresupuesto[]} args.detalles
 * @returns {Promise<ResultadoEdicion>}
 * @throws {import('./idempotencia').ErrorOperacion} Error ya saneado para la UI.
 */
export async function actualizarPresupuestoIdempotente({ clave, idPresupuesto, cabecera, detalles }) {
  if (!idPresupuesto) {
    throw new Error('idPresupuesto es requerido.')
  }
  if (!clave) {
    throw new Error('Falta la clave de idempotencia.')
  }
  if (!Array.isArray(detalles) || detalles.length === 0) {
    throw new Error('El presupuesto debe tener al menos un ítem.')
  }

  const resultado = /** @type {ResultadoEdicion} */ (
    await ejecutarIdempotente(
      'actualizar_presupuesto_idempotente',
      { p_id_presupuesto: Number(idPresupuesto), p_cabecera: cabecera, p_detalles: detalles },
      { clave },
    )
  )

  if (resultado.idempotente) {
    logger.warn('presupuesto.edicion_duplicada_absorbida', {
      idPresupuesto: resultado.idPresupuesto,
      clave,
    })
  }

  return resultado
}

/**
 * @typedef {'aprobado'|'pagado'|'rechazado'} EstadoDestino
 */

/**
 * @typedef {object} ItemSinStock
 * @property {number}      idProducto
 * @property {string|null} nombreProducto
 * @property {string|null} medida
 * @property {'medida_inexistente'} motivo
 */

/**
 * @typedef {object} ResultadoCambioEstado
 * @property {number}          idPresupuesto
 * @property {string}          estadoAnterior
 * @property {EstadoDestino}   estadoNuevo
 * @property {boolean}         yaAplicado       `true` si el presupuesto YA estaba en
 *   `estadoNuevo` (otra pestaña, o reintento con clave nueva): éxito sin efectos.
 * @property {string|null}     fechaPago        'YYYY-MM-DD' (solo al pagar Efectivo/Transferencia).
 * @property {boolean}         stockDescontado  `true` si en ESTA operación se descontó stock.
 * @property {boolean}         stockReintegrado `true` si en ESTA operación se devolvió stock
 *   (rechazo de un presupuesto 'aprobado', que ya había descontado).
 * @property {number}          productosActualizados
 * @property {ItemSinStock[]}  itemsSinStock    Ítems con medida que ya no existe en el
 *   catálogo: no bloquean la operación pero dejan una discrepancia de stock a revisar.
 * @property {boolean}         saldoCreado      Se generó el saldo de Cuenta Corriente.
 * @property {boolean}         saldoEliminado   Se eliminó el saldo (rechazo).
 * @property {boolean}         idempotente      `true` si la respuesta vino de una
 *   solicitud anterior con la misma clave.
 */

/**
 * Cambia el estado de un presupuesto (aprobar / pagar / rechazar) en UNA llamada.
 *
 * Reemplaza la secuencia que vivía en Historial.jsx:
 * `actualizarEstadoPresupuesto` → `descontarStock` × N (2–5 queries por ítem) →
 * `regenerarSaldoDePresupuesto` / `eliminarSaldoPorPresupuesto`. Esa secuencia
 * crecía linealmente con la cantidad de ítems y no era atómica. Aquí estado,
 * fecha de pago, stock y saldo ocurren dentro de la misma transacción de
 * Postgres (`cambiar_estado_presupuesto`): o se aplica todo o no se aplica nada.
 *
 * @param {object} args
 * @param {string}        args.clave          UUID de `useClaveIdempotencia()`. Una por
 *   intento de confirmación (rotar al abrir el modal y tras éxito).
 * @param {number}        args.idPresupuesto
 * @param {EstadoDestino} args.nuevoEstado
 * @param {string|null}   [args.fechaPago]    'YYYY-MM-DD'. Obligatoria al pagar un
 *   presupuesto Efectivo/Transferencia; se ignora en el resto.
 * @returns {Promise<ResultadoCambioEstado>}
 * @throws {import('./idempotencia').ErrorOperacion} Error ya saneado para la UI.
 */
export async function cambiarEstadoPresupuestoIdempotente({ clave, idPresupuesto, nuevoEstado, fechaPago = null }) {
  if (!idPresupuesto) {
    throw new Error('idPresupuesto es requerido.')
  }
  if (!clave) {
    throw new Error('Falta la clave de idempotencia.')
  }
  if (!ESTADOS_DESTINO.includes(nuevoEstado)) {
    throw new Error(`Estado destino inválido: ${nuevoEstado}`)
  }

  const resultado = /** @type {ResultadoCambioEstado} */ (
    await ejecutarIdempotente(
      'cambiar_estado_presupuesto',
      {
        p_id_presupuesto: Number(idPresupuesto),
        p_nuevo_estado:   nuevoEstado,
        // `null` explícito (no `undefined`): la huella del payload debe ser
        // estable entre el intento original y sus reintentos.
        p_fecha_pago:     nuevoEstado === 'pagado' ? (fechaPago ?? null) : null,
      },
      { clave },
    )
  )

  if (resultado.idempotente) {
    logger.warn('presupuesto.cambio_estado_duplicado_absorbido', {
      idPresupuesto: resultado.idPresupuesto,
      estadoNuevo:   resultado.estadoNuevo,
      clave,
    })
  }

  if (resultado.itemsSinStock?.length) {
    // Observabilidad: la operación se completó, pero hay ítems cuya medida ya
    // no existe en `producto_medida`; su stock NO se descontó. Revisar a mano.
    logger.warn('presupuesto.stock_parcial', {
      idPresupuesto: resultado.idPresupuesto,
      itemsSinStock: resultado.itemsSinStock,
    })
  }

  return resultado
}

/** Estados a los que se puede transicionar con `cambiarEstadoPresupuestoIdempotente`. */
const ESTADOS_DESTINO = /** @type {const} */ (['aprobado', 'pagado', 'rechazado'])

export default crearPresupuestoIdempotente
