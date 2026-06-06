// src/services/clientesService.js
// Todas las operaciones de Cliente pasan por aquí.
// Los componentes React NO deben importar supabase directamente.

import { supabase } from '../lib/supabase'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function manejarError(operacion, error) {
  console.error(`[clientesService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

// Convierte snake_case de PostgreSQL → camelCase que ya usan los componentes
function mapCliente(row) {
  if (!row) return null
  return {
    idCliente:      row.id_cliente,
    nombre:         row.nombre,
    apellido:       row.apellido,
    cuit:           row.cuit,
    domicilio:      row.domicilio,
    telefono:       row.telefono,
    mail:           row.mail,
    apodo:          row.apodo,
    nombreComercio: row.nombre_comercio,
    activo:         row.activo,
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Devuelve todos los clientes activos, ordenados por apellido y nombre.
 * Equivale a: SELECT * FROM Cliente WHERE activo = 1 ORDER BY apellido, nombre
 */
export async function obtenerClientesActivos() {
  const { data, error } = await supabase
    .from('cliente')
    .select('*')
    .eq('activo', true)
    .order('apellido')
    .order('nombre')

  if (error) manejarError('obtenerClientesActivos', error)
  return data.map(mapCliente)
}

/**
 * Busca un cliente por ID exacto o por nombre/apellido/apodo (búsqueda parcial).
 * Equivale a las dos queries de Presupuestador: byId + byName con LIMIT 300.
 * Retorna { porId, porNombre } para que el componente decida cuál usar.
 */
export async function buscarClientes(texto) {
  const textoLimpio = texto?.trim() ?? ''

  // Búsqueda por ID exacto
  const porIdPromise = supabase
    .from('cliente')
    .select('*')
    .eq('activo', true)
    .eq('id_cliente', textoLimpio)
    .limit(1)

  // Búsqueda por nombre, apellido o apodo (ilike = case-insensitive)
  const porNombrePromise = supabase
    .from('cliente')
    .select('*')
    .eq('activo', true)
    .or(
      `nombre.ilike.%${textoLimpio}%,` +
      `apellido.ilike.%${textoLimpio}%,` +
      `apodo.ilike.%${textoLimpio}%,` +
      `nombre_comercio.ilike.%${textoLimpio}%`
    )
    .order('apellido')
    .limit(100)

  const [resId, resNombre] = await Promise.all([porIdPromise, porNombrePromise])

  if (resId.error)     manejarError('buscarClientes(id)', resId.error)
  if (resNombre.error) manejarError('buscarClientes(nombre)', resNombre.error)

  return {
    porId:     resId.data.map(mapCliente),
    porNombre: resNombre.data.map(mapCliente),
  }
}

/**
 * Devuelve un cliente por su ID.
 * Equivale a: SELECT * FROM Cliente WHERE idCliente = ?
 */
export async function obtenerClientePorId(idCliente) {
  const { data, error } = await supabase
    .from('cliente')
    .select('*')
    .eq('id_cliente', idCliente)
    .single()

  if (error) manejarError('obtenerClientePorId', error)
  return mapCliente(data)
}

// ─── Mutaciones ───────────────────────────────────────────────────────────────

/**
 * Crea un nuevo cliente. Devuelve el cliente creado con su ID asignado.
 * Equivale a: INSERT INTO Cliente (...) VALUES (...)
 */
export async function crearCliente(cliente) {
  const { data, error } = await supabase
    .from('cliente')
    .insert({
      nombre:          cliente.nombre,
      apellido:        cliente.apellido,
      apodo:           cliente.apodo           ?? null,
      nombre_comercio: cliente.nombreComercio  ?? null,
      cuit:            cliente.cuit            ?? null,
      domicilio:       cliente.domicilio       ?? null,
      telefono:        cliente.telefono        ?? null,
      mail:            cliente.mail            ?? null,
      activo:          true,
    })
    .select()
    .single()

  if (error) manejarError('crearCliente', error)
  return mapCliente(data)
}

/**
 * Actualiza los datos de un cliente existente.
 * Equivale a: UPDATE Cliente SET ... WHERE idCliente = ?
 */
export async function actualizarCliente(idCliente, cliente) {
  const { error } = await supabase
    .from('cliente')
    .update({
      nombre:          cliente.nombre,
      apellido:        cliente.apellido,
      apodo:           cliente.apodo           ?? null,
      nombre_comercio: cliente.nombreComercio  ?? null,
      cuit:            cliente.cuit            ?? null,
      domicilio:       cliente.domicilio       ?? null,
      telefono:        cliente.telefono        ?? null,
      mail:            cliente.mail            ?? null,
    })
    .eq('id_cliente', idCliente)

  if (error) manejarError('actualizarCliente', error)
}

/**
 * Baja lógica: marca el cliente como inactivo en lugar de borrarlo.
 * Equivale a: UPDATE Cliente SET activo = 0 WHERE idCliente = ?
 * Se usa baja lógica para preservar el historial de presupuestos.
 */
export async function desactivarCliente(idCliente) {
  const { error } = await supabase
    .from('cliente')
    .update({ activo: false })
    .eq('id_cliente', idCliente)

  if (error) manejarError('desactivarCliente', error)
}