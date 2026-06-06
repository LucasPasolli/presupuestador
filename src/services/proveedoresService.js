// src/services/proveedoresService.js
// Todas las operaciones de Proveedor pasan por aquí.

import { supabase } from '../lib/supabase'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function manejarError(operacion, error) {
  console.error(`[proveedoresService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

function mapProveedor(row) {
  if (!row) return null
  return {
    idProveedor:              row.id_proveedor,
    nombreFiscal:             row.nombre_fiscal,
    nombreComercial:          row.nombre_comercial,
    identificacionTributaria: row.identificacion_tributaria,
    telefono:                 row.telefono,
    email:                    row.email,
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Devuelve todos los proveedores ordenados por nombre fiscal.
 * Equivale a: SELECT * FROM Proveedor ORDER BY nombreFiscal
 */
export async function obtenerProveedores() {
  const { data, error } = await supabase
    .from('proveedor')
    .select('*')
    .order('nombre_fiscal')

  if (error) manejarError('obtenerProveedores', error)
  return data.map(mapProveedor)
}

/**
 * Devuelve un proveedor por su ID.
 * Equivale a: SELECT * FROM Proveedor WHERE idProveedor = ?
 */
export async function obtenerProveedorPorId(idProveedor) {
  const { data, error } = await supabase
    .from('proveedor')
    .select('*')
    .eq('id_proveedor', idProveedor)
    .single()

  if (error) manejarError('obtenerProveedorPorId', error)
  return mapProveedor(data)
}

// ─── Mutaciones ───────────────────────────────────────────────────────────────

/**
 * Crea un nuevo proveedor. Devuelve el proveedor creado con su ID asignado.
 * Equivale a: INSERT INTO Proveedor (...) VALUES (...)
 */
export async function crearProveedor(proveedor) {
  const { data, error } = await supabase
    .from('proveedor')
    .insert({
      nombre_fiscal:             proveedor.nombreFiscal,
      nombre_comercial:          proveedor.nombreComercial          ?? null,
      identificacion_tributaria: proveedor.identificacionTributaria ?? null,
      telefono:                  proveedor.telefono                 ?? null,
      email:                     proveedor.email                    ?? null,
    })
    .select()
    .single()

  if (error) manejarError('crearProveedor', error)
  return mapProveedor(data)
}

/**
 * Actualiza los datos de un proveedor existente.
 * Equivale a: UPDATE Proveedor SET ... WHERE idProveedor = ?
 */
export async function actualizarProveedor(idProveedor, proveedor) {
  const { error } = await supabase
    .from('proveedor')
    .update({
      nombre_fiscal:             proveedor.nombreFiscal,
      nombre_comercial:          proveedor.nombreComercial          ?? null,
      identificacion_tributaria: proveedor.identificacionTributaria ?? null,
      telefono:                  proveedor.telefono                 ?? null,
      email:                     proveedor.email                    ?? null,
    })
    .eq('id_proveedor', idProveedor)

  if (error) manejarError('actualizarProveedor', error)
}

/**
 * Elimina un proveedor. A diferencia de Cliente, Proveedor sí admite
 * borrado físico porque PedidoCompra usa ON DELETE SET NULL —
 * los pedidos históricos conservan el nombre en la columna nombre_proveedor.
 * Equivale a: DELETE FROM Proveedor WHERE idProveedor = ?
 */
export async function eliminarProveedor(idProveedor) {
  const { error } = await supabase
    .from('proveedor')
    .delete()
    .eq('id_proveedor', idProveedor)

  if (error) manejarError('eliminarProveedor', error)
}