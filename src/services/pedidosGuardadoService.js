// src/services/pedidosGuardadoService.js
// Caso de uso "Guardar / Cargar Pedido de Compra" — transaccional y en lote.
//
// Reemplaza, para el FORMULARIO de pedidos, a:
//   pedidosService.crearPedido / actualizarPedido
//   pedidosCuotasService.crearPedidoConCuotas / actualizarPlanCuotas
// (siguen existiendo para otros consumidores — ABMC, etc.; no se tocan).
//
// Patrón: Transaction Script en el servidor (RPC `guardar_pedido_compra`) +
// Facade en el cliente. El cliente NUNCA orquesta varias escrituras: una sola
// llamada, una sola transacción → el número de requests no depende de N ítems.
//
// Ver sql/20261024_guardar_pedido_compra.sql.

import { supabase } from '../lib/supabase'
import { mapPedido, mapDetallePedido } from './pedidosService'
import { mapCuota } from './pedidosCuotasService'

/**
 * @typedef {Object} ItemPedidoUI
 * @property {number|string|null} [idDetallePedido]  presente = ítem existente; ausente = nuevo
 * @property {number|string} idProducto
 * @property {string|null}   [nombreProducto]
 * @property {string|null}   [medida]
 * @property {number|string} cantidad
 * @property {number|string} precioUnitario
 *
 * @typedef {Object} CuotaDraft
 * @property {number|string} porcentaje
 * @property {number|string} diasVencimiento
 *
 * @typedef {Object} GuardarPedidoParams
 * @property {number|null} [idPedido]        null/undefined = alta
 * @property {{metodoPago:string, idProveedor:number, diasVencimientoCC?:number|null}} pedido
 * @property {ItemPedidoUI[]} detalles
 * @property {CuotaDraft[]|null} [cuotas]    alta: plan completo · edición: sólo pendientes
 * @property {string} idempotencyKey
 */

// ─── Errores de dominio ───────────────────────────────────────────────────────
// El RPC devuelve CÓDIGOS cortos en `error.message` (+ contexto mínimo en
// `error.details`). Acá se traducen a texto para el usuario: nunca se filtra
// nombre de constraint, tabla ni función hacia la UI.

const MSG_GENERICO =
  'No se pudo guardar el pedido. Tus datos siguen cargados: revisá la conexión y volvé a intentar.'

const MSG_RED =
  'No pudimos conectar con el servidor. Tus datos siguen cargados: volvé a intentar en unos segundos.'

/** @type {Record<string, (detalle?: string) => string>} */
const MENSAJES = {
  no_autorizado:                    () => 'No tenés permisos para guardar pedidos.',
  idempotency_key_requerida:        () => MSG_GENERICO,
  idempotency_key_reutilizada:      () => MSG_GENERICO,
  pedido_invalido:                  () => MSG_GENERICO,
  detalles_vacios:                  () => 'Agregá al menos un producto con ID válido.',
  demasiados_items:                 (n) => `El pedido supera el máximo de ${n ?? 500} ítems.`,
  item_invalido:                    () => 'Hay un ítem con cantidad o precio inválido. Revisá la tabla de productos.',
  producto_inexistente:             (id) => `El producto ID ${id} no existe en el inventario.`,
  medida_requerida:                 (id) => `Seleccioná una medida para el producto ID ${id}.`,
  metodo_pago_invalido:             () => 'El método de pago seleccionado no es válido.',
  proveedor_requerido:              () => 'Seleccioná un proveedor antes de guardar el pedido.',
  proveedor_inexistente:            () => 'El proveedor seleccionado ya no existe. Elegí otro.',
  dias_vencimiento_invalido:        () => 'Los días de vencimiento deben estar entre 0 y 3650.',
  cuotas_requieren_cuenta_corriente:() => 'El plan de cuotas sólo aplica a Cuenta Corriente.',
  plan_cuotas_invalido:             () => 'El plan de cuotas es inválido. Revisá porcentajes y días.',
  plan_cuotas_suma_invalida:        () => 'Los porcentajes del plan de cuotas deben sumar exactamente 100%.',
  plan_cuotas_requerido:            () => 'Este pedido tiene plan de cuotas: tiene que incluir las cuotas pendientes.',
  pedido_sin_cuotas:                () => 'Este pedido no tiene plan de cuotas.',
  modalidad_inmutable:              () => 'La modalidad de pago (pago único / cuotas) no puede cambiarse.',
  monto_congelado:                  () => 'El pedido tiene cuotas pagadas: el monto total no puede modificarse.',
  pedido_no_encontrado:             () => 'El pedido no existe o fue eliminado por otro usuario.',
  detalle_invalido:                 () => 'El pedido cambió desde que lo abriste (ítems modificados por otro usuario). Volvé a abrirlo.',
}

export class GuardadoPedidoError extends Error {
  /**
   * @param {string} message  mensaje SEGURO para mostrar al usuario
   * @param {{code?:string, detalle?:string, reintentable?:boolean}} [meta]
   */
  constructor(message, { code = 'desconocido', detalle, reintentable = false } = {}) {
    super(message)
    this.name = 'GuardadoPedidoError'
    this.code = code
    this.detalle = detalle
    this.reintentable = reintentable
  }
}

/**
 * Traduce un error de supabase-js/PostgREST a un GuardadoPedidoError seguro.
 * Pura y exportada para poder testearla.
 * @param {{message?:string, details?:string, code?:string}|null|undefined} error
 */
export function traducirErrorGuardado(error) {
  const code = (error?.message ?? '').trim()

  const fn = MENSAJES[code]
  if (fn) return new GuardadoPedidoError(fn(error?.details ?? undefined), { code, detalle: error?.details })

  // Fallas de transporte: la transacción puede o no haberse confirmado. El
  // reintento con la MISMA clave de idempotencia es seguro en ambos casos.
  if (/fetch|network|timeout|failed to|load failed|abort/i.test(code)) {
    return new GuardadoPedidoError(MSG_RED, { code: 'red', reintentable: true })
  }

  return new GuardadoPedidoError(MSG_GENERICO, { code: 'desconocido', reintentable: true })
}

// ─── Idempotencia por intento ─────────────────────────────────────────────────

/**
 * Gestor de clave de idempotencia ligado a la "huella" del contenido a guardar.
 *   - Mismo contenido (reintento tras error de red / doble envío)  → MISMA clave.
 *   - Contenido distinto (el usuario corrigió algo)                → clave NUEVA.
 * Así un reintento nunca duplica el pedido, y una edición posterior nunca
 * recibe por error la respuesta cacheada de un guardado anterior.
 */
export function crearGestorIdempotencia(generar = () => crypto.randomUUID()) {
  let actual = null
  return {
    /** @param {string} huella */
    obtener(huella) {
      if (!actual || actual.huella !== huella) actual = { huella, key: generar() }
      return actual.key
    },
    reiniciar() { actual = null },
  }
}

// ─── Serialización UI → RPC ───────────────────────────────────────────────────

const aNumero = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

/**
 * Construye los argumentos del RPC. Pura (testeable).
 * NOTA: no se envían `monto`, `subtotal` ni `nombre_proveedor`: los calcula el
 * servidor (fuente de verdad) — el cliente sólo muestra el total.
 */
export function construirArgumentosRpc({ idPedido = null, pedido, detalles, cuotas = null, idempotencyKey }) {
  return {
    p_id_pedido: idPedido ?? null,
    p_pedido: {
      metodo_pago:         pedido.metodoPago ?? 'efectivo',
      id_proveedor:        pedido.idProveedor ?? null,
      dias_vencimiento_cc: pedido.diasVencimientoCC ?? null,
    },
    p_detalles: detalles.map((d) => ({
      id_detalle_pedido: d.idDetallePedido ?? null,
      id_producto:       aNumero(d.idProducto),
      nombre_producto:   d.nombreProducto || null,
      medida:            d.medida || null,
      cantidad:          aNumero(d.cantidad),
      precio_unitario:   aNumero(d.precioUnitario),
    })),
    p_cuotas: cuotas && cuotas.length
      ? cuotas.map((c) => ({
          porcentaje:       aNumero(c.porcentaje),
          dias_vencimiento: aNumero(c.diasVencimiento),
        }))
      : null,
    p_idempotency_key: idempotencyKey,
  }
}

// ─── Escritura ────────────────────────────────────────────────────────────────

/**
 * Guarda (alta o edición) un pedido completo en UNA llamada y UNA transacción.
 *
 * Alta     → idPedido null. Cabecera + ítems (+ cuotas) en lote.
 * Edición  → idPedido dado. Diff de ítems (altas/bajas/modificaciones en lote;
 *            los ítems sin cambios NO se recrean), stock neto, precio proveedor
 *            y plan de cuotas pendientes — todo en la misma transacción.
 *
 * Es seguro reintentar con la MISMA `idempotencyKey` (ver crearGestorIdempotencia).
 *
 * @param {GuardarPedidoParams} params
 * @returns {Promise<ReturnType<typeof mapPedido> & {detalles:any[], cambios:{insertados:number,actualizados:number,eliminados:number}, reutilizado:boolean}>}
 * @throws {GuardadoPedidoError} con mensaje seguro para mostrar al usuario.
 */
export async function guardarPedido(params) {
  if (!params?.idempotencyKey) {
    throw new GuardadoPedidoError(MSG_GENERICO, { code: 'idempotency_key_requerida' })
  }

  const { data, error } = await supabase.rpc('guardar_pedido_compra', construirArgumentosRpc(params))

  if (error) {
    // Log técnico sólo en consola del desarrollador (sin datos del pedido).
    console.error('[pedidosGuardadoService] guardarPedido:', error.message, error.code ?? '')
    throw traducirErrorGuardado(error)
  }

  return {
    ...mapPedido(data),
    detalles:    (data.detalles ?? []).map(mapDetallePedido),
    cambios:     data.cambios ?? { insertados: 0, actualizados: 0, eliminados: 0 },
    reutilizado: Boolean(data.reutilizado),
  }
}

// ─── Lectura (Escenario 8) ────────────────────────────────────────────────────

const SELECT_PEDIDO_PARA_EDICION = `
  *,
  proveedor ( id_proveedor, nombre_fiscal, nombre_comercial ),
  detalle_pedido_compra (
    *,
    producto ( id_producto, tiene_medidas, producto_medida ( medida ) )
  ),
  pedido_compra_cuota ( * )
`

/**
 * Carga TODO lo que necesita el formulario de edición en UNA sola consulta
 * con relaciones (join): pedido + proveedor + ítems (con las medidas
 * disponibles de cada producto) + plan de cuotas.
 *
 * Antes: 1 (detalles) + 1 (proveedor) + 1 (cuotas) + 2 por ítem (medidas).
 * Ahora: 1.
 */
export async function obtenerPedidoParaEdicion(idPedido) {
  const { data, error } = await supabase
    .from('pedido_compra')
    .select(SELECT_PEDIDO_PARA_EDICION)
    .eq('id_pedido', idPedido)
    .single()

  if (error) {
    console.error('[pedidosGuardadoService] obtenerPedidoParaEdicion:', error.message)
    throw new Error('No se pudo cargar el pedido. Volvé a intentar.')
  }

  const prov = data.proveedor
  const detalles = [...(data.detalle_pedido_compra ?? [])]
    .sort((a, b) => a.id_detalle_pedido - b.id_detalle_pedido)
    .map((row) => {
      const medidas = (row.producto?.producto_medida ?? []).map((m) => m.medida).sort()
      return {
        ...mapDetallePedido(row),
        tieneMedidas:       Boolean(row.producto?.tiene_medidas),
        medidasDisponibles: row.producto?.tiene_medidas ? medidas : [],
      }
    })

  const cuotas = [...(data.pedido_compra_cuota ?? [])]
    .sort((a, b) => a.numero_cuota - b.numero_cuota)
    .map(mapCuota)

  return {
    pedido: mapPedido(data),
    proveedor: prov
      ? { idProveedor: prov.id_proveedor, nombreFiscal: prov.nombre_fiscal, nombreComercial: prov.nombre_comercial }
      : null,
    detalles,
    cuotas,
  }
}
