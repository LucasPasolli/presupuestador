// src/services/clienteMontosService.js
// Todas las operaciones de montos Debe/Haber de Cliente pasan por aquí.
// Los componentes React NO deben importar supabase directamente.
//
// Lecturas : SELECT paginado en servidor (RLS: solo lectura).
// Escrituras: RPC SECURITY DEFINER (registrar_cliente_monto / confirmar_cliente_monto),
//             el usuario y la fecha de confirmación los fija la base de datos.

import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import { buscarClientes } from './clientesService'

/**
 * @typedef {'debe'|'haber'} TipoMonto
 * @typedef {'pendiente'|'confirmado'} EstadoMonto
 * @typedef {Object} ClienteMonto
 * @property {number} idMonto
 * @property {number} idCliente
 * @property {string} clienteEtiqueta     "Nombre Apellido"
 * @property {string} clienteSecundario   apodo / comercio (puede ser '')
 * @property {{idCliente:number,nombre?:string,apellido?:string,apodo?:string|null,nombreComercio?:string|null}} cliente
 * @property {number} monto
 * @property {TipoMonto} tipo
 * @property {EstadoMonto} estado
 * @property {string} fechaAlta           ISO 8601
 * @property {string|null} confirmadoAt
 *
 * @typedef {Object} FiltrosListado
 * @property {number} [page=1]
 * @property {number} [pageSize=20]
 * @property {''|TipoMonto} [tipo]
 * @property {''|EstadoMonto} [estado='pendiente']  '' = todos los estados
 * @property {'asc'|'desc'} [orden='desc']   por fecha de alta
 * @property {string} [busqueda]             texto libre de cliente
 */

export const PAGE_SIZE_DEFAULT = 20

// ─── Errores ──────────────────────────────────────────────────────────────────
// Los mensajes de la base (SQL, constraints, nombres de tabla) NUNCA llegan a la UI.
// Solo se traducen códigos funcionales conocidos; el resto se registra y se
// reemplaza por un mensaje genérico.

const MENSAJES = Object.freeze({
  MONTO_YA_CONFIRMADO:         'Este movimiento ya fue confirmado.',
  MONTO_NO_ENCONTRADO:         'El movimiento ya no existe.',
  MONTO_INVALIDO:              'El monto ingresado no es válido.',
  TIPO_INVALIDO:               'El tipo debe ser Debe o Haber.',
  CLIENTE_NO_DISPONIBLE:       'El cliente no existe o fue dado de baja.',
  NO_AUTORIZADO:               'No tenés permisos para realizar esta acción.',
  CLAVE_IDEMPOTENCIA_INVALIDA: 'No se pudo procesar la solicitud. Reintentá.',
})
// Algunos códigos se explican distinto según la operación.
const MENSAJES_POR_OPERACION = Object.freeze({
  editarMonto:   { MONTO_YA_CONFIRMADO: 'Este movimiento ya fue confirmado y no puede modificarse.' },
  eliminarMonto: { MONTO_YA_CONFIRMADO: 'Este movimiento ya fue confirmado y no puede eliminarse.' },
})
const MSG_GENERICO = 'No pudimos completar la operación. Intentá nuevamente.'
const MSG_SIN_CONEXION = 'No hay conexión. Revisá tu red e intentá nuevamente.'

export class ErrorMonto extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message)
    this.name = 'ErrorMonto'
    this.code = code
  }
}

function traducirError(operacion, error) {
  const crudo = String(error?.message ?? '')
  const code = Object.keys(MENSAJES).find(k => crudo.includes(k))
  const sinRed = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    /failed to fetch|networkerror|load failed/i.test(crudo)

  logger.error(`clienteMontos.${operacion}`, { code: code ?? error?.code ?? 'DESCONOCIDO', detalle: crudo })

  if (code) return new ErrorMonto(code, MENSAJES_POR_OPERACION[operacion]?.[code] ?? MENSAJES[code])
  if (sinRed) return new ErrorMonto('SIN_CONEXION', MSG_SIN_CONEXION)
  return new ErrorMonto('DESCONOCIDO', MSG_GENERICO)
}

// ─── Mapper snake_case → camelCase ───────────────────────────────────────────

/** @returns {ClienteMonto|null} */
function mapMonto(row) {
  if (!row) return null
  const c = row.cliente ?? null
  return {
    idMonto:           row.id_cliente_monto,
    idCliente:         row.id_cliente,
    clienteEtiqueta:   c ? [c.nombre, c.apellido].filter(Boolean).join(' ') || '—' : '—',
    cliente: {
      idCliente: row.id_cliente,
      nombre: c?.nombre, apellido: c?.apellido, apodo: c?.apodo, nombreComercio: c?.nombre_comercio,
    },
    clienteSecundario: c ? [c.apodo, c.nombre_comercio].filter(Boolean).join(' · ') : '',
    monto:             Number(row.monto),
    tipo:              row.tipo,
    estado:            row.estado,
    fechaAlta:         row.created_at,
    confirmadoAt:      row.confirmado_at ?? null,
  }
}

// ─── Búsqueda de cliente → ids ───────────────────────────────────────────────

// buscarClientes() interpola el texto dentro de un filtro .or() de PostgREST:
// comas, paréntesis, comodines y comillas alteran la sintaxis del filtro.
// Se neutralizan acá antes de delegar.
function sanitizarBusqueda(texto) {
  return String(texto ?? '').replace(/[,()%*\\"]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function resolverIdsCliente(busqueda) {
  const limpio = sanitizarBusqueda(busqueda)
  if (!limpio) return null // sin filtro por cliente
  const { porId, porNombre } = await buscarClientes(limpio)
  return [...new Set([...porId, ...porNombre].map(c => c.idCliente))]
}

/**
 * Clientes activos que coinciden con el texto (para elegir el cliente del alta).
 * @param {string} texto
 * @param {number} [limite=8]
 * @returns {Promise<Array<{idCliente:number,nombre:string,apellido:string,apodo:string|null,nombreComercio:string|null}>>}
 */
export async function buscarClientesParaMonto(texto, limite = 8) {
  const limpio = sanitizarBusqueda(texto)
  if (!limpio) return []
  try {
    const { porId, porNombre } = await buscarClientes(limpio)
    const vistos = new Set()
    return [...porId, ...porNombre]
      .filter(c => !vistos.has(c.idCliente) && vistos.add(c.idCliente))
      .slice(0, limite)
  } catch (e) {
    throw traducirError('buscarClientesParaMonto', e)
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

const SELECT_LISTADO =
  'id_cliente_monto,id_cliente,monto,tipo,estado,created_at,confirmado_at,' +
  'cliente(nombre,apellido,apodo,nombre_comercio)'

const aplicarFiltros = (q, { estado, tipo, ids }) => {
  let r = q
  if (estado === 'pendiente' || estado === 'confirmado') r = r.eq('estado', estado)
  if (tipo === 'debe' || tipo === 'haber') r = r.eq('tipo', tipo)
  if (ids) r = r.in('id_cliente', ids)
  return r
}

/**
 * Página de movimientos (por defecto, los pendientes). Filtros y paginación en servidor.
 * @param {FiltrosListado} [filtros]
 * @returns {Promise<{ rows: ClienteMonto[], total: number }>}
 */
export async function listarMontosPendientes(filtros = {}) {
  const {
    page = 1, pageSize = PAGE_SIZE_DEFAULT, estado = 'pendiente', tipo = '', orden = 'desc', busqueda = '',
  } = filtros
  const p = Math.max(1, Math.trunc(page))
  const size = Math.min(100, Math.max(1, Math.trunc(pageSize)))

  try {
    const ids = await resolverIdsCliente(busqueda)
    if (ids && ids.length === 0) return { rows: [], total: 0 } // nadie matchea

    const from = (p - 1) * size
    const { data, error, count } = await aplicarFiltros(
      supabase.from('cliente_monto').select(SELECT_LISTADO, { count: 'exact' }),
      { estado, tipo, ids },
    )
      .order('created_at', { ascending: orden === 'asc' })
      .order('id_cliente_monto', { ascending: orden === 'asc' }) // desempate estable
      .range(from, from + size - 1)

    if (error) {
      // 416 / PGRST103: la página pedida quedó fuera de rango (p. ej. se confirmó
      // el último registro de la última página). Devolvemos solo el total para que
      // el llamador retroceda de página.
      if (error.code === 'PGRST103') {
        const head = await aplicarFiltros(
          supabase.from('cliente_monto').select('id_cliente_monto', { count: 'exact', head: true }),
          { estado, tipo, ids },
        )
        if (head.error) throw head.error
        return { rows: [], total: head.count ?? 0 }
      }
      throw error
    }
    return { rows: (data ?? []).map(mapMonto), total: count ?? 0 }
  } catch (e) {
    throw traducirError('listarMontosPendientes', e)
  }
}

// ─── Mutaciones ───────────────────────────────────────────────────────────────

/**
 * Registra un movimiento Debe/Haber en estado Pendiente. Idempotente por clave:
 * reenviar la misma clave devuelve el mismo movimiento sin duplicarlo.
 * @param {{ idCliente: number, monto: number, tipo: TipoMonto, idempotencyKey: string }} datos
 * @returns {Promise<ClienteMonto>}
 */
export async function registrarMonto({ idCliente, monto, tipo, idempotencyKey }) {
  const { data, error } = await supabase.rpc('registrar_cliente_monto', {
    p_id_cliente:      idCliente,
    p_monto:           monto,
    p_tipo:            tipo,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw traducirError('registrarMonto', error)
  return mapMonto(data)
}

/**
 * Confirma un movimiento pendiente (irreversible). Usuario y fecha/hora los
 * registra la base de datos (auth.uid(), now()).
 * @param {number} idMonto
 * @returns {Promise<ClienteMonto>}
 */
export async function confirmarMonto(idMonto) {
  const { data, error } = await supabase.rpc('confirmar_cliente_monto', { p_id: idMonto })
  if (error) throw traducirError('confirmarMonto', error)
  return mapMonto(data)
}

/**
 * Edita un movimiento PENDIENTE (cliente, monto y tipo). La fecha de alta no cambia.
 * @param {{ idMonto: number, idCliente: number, monto: number, tipo: TipoMonto }} datos
 * @returns {Promise<ClienteMonto>}
 */
export async function editarMonto({ idMonto, idCliente, monto, tipo }) {
  const { data, error } = await supabase.rpc('editar_cliente_monto', {
    p_id: idMonto, p_id_cliente: idCliente, p_monto: monto, p_tipo: tipo,
  })
  if (error) throw traducirError('editarMonto', error)
  return mapMonto(data)
}

/**
 * Elimina un movimiento PENDIENTE. Los confirmados no se pueden eliminar.
 * @param {number} idMonto
 * @returns {Promise<void>}
 */
export async function eliminarMonto(idMonto) {
  const { error } = await supabase.rpc('eliminar_cliente_monto', { p_id: idMonto })
  if (error) throw traducirError('eliminarMonto', error)
}
