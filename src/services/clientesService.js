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
 *
 * CAMBIO: cuando el texto contiene espacios (ej. "Juan G"), se ejecutan
 * queries adicionales cruzando las partes contra nombre y apellido por
 * separado, y luego se deduplican los resultados en el cliente.
 * Esto soluciona que "Juan G" no matcheara nada porque el ilike buscaba
 * la cadena completa dentro de un único campo.
 */
export async function buscarClientes(texto) {
  const textoLimpio = texto?.trim() ?? ''

  // Palabras individuales (sin vacías) para búsqueda cruzada
  const partes = textoLimpio.split(/\s+/).filter(Boolean)
  const tieneEspacios = partes.length > 1

  // ── Query 1: búsqueda sobre el texto completo (campo único que lo contiene)
  // Cubre: apodo, nombre_comercio, y nombres/apellidos compuestos con espacio.
  const q1 = supabase
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

  // ── Query 2 (solo si hay espacios): cruce nombre × apellido con las partes.
  // Ejemplo "Juan G" → busca clientes donde nombre contiene "Juan" Y apellido
  // contiene "G", O al revés (apellido "Juan" Y nombre "G").
  // Se lanza en paralelo con q1 y los resultados se deduplicam por id_cliente.
  let q2Promise = Promise.resolve({ data: [], error: null })
  if (tieneEspacios) {
    const primera = partes[0]
    const resto   = partes.slice(1).join(' ')
    // Directo: primera parte → nombre, resto → apellido
    // Inverso:  primera parte → apellido, resto → nombre
    q2Promise = supabase
      .from('cliente')
      .select('*')
      .eq('activo', true)
      .or(
        `and(nombre.ilike.%${primera}%,apellido.ilike.%${resto}%),` +
        `and(apellido.ilike.%${primera}%,nombre.ilike.%${resto}%)`
      )
      .order('apellido')
      .limit(100)
  }

  const porNombrePromise = Promise.all([q1, q2Promise]).then(([res1, res2]) => {
    if (res1.error) return res1          // propaga el error del primer query
    if (res2.error) return res1          // si el cruce falla, usamos solo q1
    // Deduplicar por id_cliente (q1 ya viene primero → tiene prioridad de orden)
    const seen  = new Set((res1.data ?? []).map(r => r.id_cliente))
    const extra = (res2.data ?? []).filter(r => !seen.has(r.id_cliente))
    return { data: [...(res1.data ?? []), ...extra], error: null }
  })

  // Búsqueda por ID exacto: solo si el texto es un entero positivo válido
  const esId = /^\d+$/.test(textoLimpio)
  const porIdPromise = esId
    ? supabase
        .from('cliente')
        .select('*')
        .eq('activo', true)
        .eq('id_cliente', parseInt(textoLimpio, 10))
        .limit(1)
    : Promise.resolve({ data: [], error: null })

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