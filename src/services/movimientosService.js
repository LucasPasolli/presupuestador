// src/services/movimientosService.js
// Todas las operaciones de Egreso, Ingreso e Inversion pasan por aquí.
// Estas tres entidades se agrupan en un solo service porque son estructuralmente
// similares, ninguna tiene relaciones entre sí, y siempre se consumen juntas
// en Estadisticas.jsx para calcular el flujo de caja.

import { supabase } from '../lib/supabase'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function manejarError(operacion, error) {
  console.error(`[movimientosService] ${operacion}:`, error.message)
  throw new Error(error.message)
}

function mapEgreso(row) {
  if (!row) return null
  return {
    idEgreso:    row.id_egreso,
    fecha:       row.fecha,
    categoria:   row.categoria,
    descripcion: row.descripcion,
    monto:       Number(row.monto),
    metodoPago:  row.metodo_pago,
  }
}

function mapIngreso(row) {
  if (!row) return null
  return {
    idIngreso:   row.id_ingreso,
    fecha:       row.fecha,
    categoria:   row.categoria,
    descripcion: row.descripcion,
    monto:       Number(row.monto),
  }
}

function mapInversion(row) {
  if (!row) return null
  return {
    idInversion: row.id_inversion,
    fecha:       row.fecha,
    categoria:   row.categoria,
    descripcion: row.descripcion,
    monto:       Number(row.monto),
    estado:      row.estado,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EGRESOS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Devuelve egresos con filtros opcionales.
 * Mueve al servidor el filtrado que antes hacía Estadisticas.jsx en React.
 * Equivale a las queries dinámicas de Estadisticas.jsx sobre Egreso.
 */
export async function obtenerEgresos({
  fechaDesde = null,   // 'YYYY-MM-DD'
  fechaHasta = null,   // 'YYYY-MM-DD'
  categoria  = null,
  metodoPago = null,
  orden      = 'desc',
  limite     = 1000,
} = {}) {
  let q = supabase
    .from('egreso')
    .select('*')
    .order('fecha', { ascending: orden === 'asc' })
    .limit(limite)

  if (fechaDesde) q = q.gte('fecha', fechaDesde)
  if (fechaHasta) q = q.lte('fecha', fechaHasta)
  if (categoria)  q = q.eq('categoria', categoria)
  if (metodoPago) q = q.eq('metodo_pago', metodoPago)

  const { data, error } = await q
  if (error) manejarError('obtenerEgresos', error)
  return data.map(mapEgreso)
}

/**
 * Devuelve egresos agrupados por categoría con su total.
 * Mueve al servidor la agregación que antes hacía Estadisticas.jsx con reduce().
 * Equivale a:
 *   SELECT categoria, SUM(monto) as total
 *   FROM Egreso
 *   WHERE fecha BETWEEN ? AND ?
 *   GROUP BY categoria
 *   ORDER BY total DESC
 */
export async function obtenerEgresosPorCategoria({
  fechaDesde = null,
  fechaHasta = null,
} = {}) {
  // Supabase no soporta GROUP BY directamente en el cliente,
  // usamos una función RPC para esta agregación específica.
  const { data, error } = await supabase.rpc('egresos_por_categoria', {
    p_fecha_desde: fechaDesde ?? null,
    p_fecha_hasta: fechaHasta ?? null,
  })

  if (error) manejarError('obtenerEgresosPorCategoria', error)
  return data.map(row => ({
    categoria: row.categoria,
    total:     Number(row.total),
  }))
}

/**
 * Crea un nuevo egreso.
 * Equivale a: INSERT INTO Egreso (...) VALUES (...)
 */
export async function crearEgreso(egreso) {
  const { data, error } = await supabase
    .from('egreso')
    .insert({
      fecha:       egreso.fecha,
      categoria:   egreso.categoria,
      descripcion: egreso.descripcion,
      monto:       egreso.monto,
      metodo_pago: egreso.metodoPago ?? 'efectivo',
    })
    .select()
    .single()

  if (error) manejarError('crearEgreso', error)
  return mapEgreso(data)
}

/**
 * Actualiza un egreso existente.
 * Equivale a: UPDATE Egreso SET ... WHERE idEgreso = ?
 */
export async function actualizarEgreso(idEgreso, egreso) {
  const { error } = await supabase
    .from('egreso')
    .update({
      fecha:       egreso.fecha,
      categoria:   egreso.categoria,
      descripcion: egreso.descripcion,
      monto:       egreso.monto,
      metodo_pago: egreso.metodoPago ?? 'efectivo',
    })
    .eq('id_egreso', idEgreso)

  if (error) manejarError('actualizarEgreso', error)
}

/**
 * Elimina un egreso.
 * Equivale a: DELETE FROM Egreso WHERE idEgreso = ?
 */
export async function eliminarEgreso(idEgreso) {
  const { error } = await supabase
    .from('egreso')
    .delete()
    .eq('id_egreso', idEgreso)

  if (error) manejarError('eliminarEgreso', error)
}

// ═══════════════════════════════════════════════════════════════════════════════
// INGRESOS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Devuelve ingresos con filtros opcionales.
 * Equivale a las queries dinámicas de Estadisticas.jsx sobre Ingreso.
 */
export async function obtenerIngresos({
  fechaDesde = null,
  fechaHasta = null,
  categoria  = null,
  orden      = 'desc',
  limite     = 1000,
} = {}) {
  let q = supabase
    .from('ingreso')
    .select('*')
    .order('fecha', { ascending: orden === 'asc' })
    .limit(limite)

  if (fechaDesde) q = q.gte('fecha', fechaDesde)
  if (fechaHasta) q = q.lte('fecha', fechaHasta)
  if (categoria)  q = q.eq('categoria', categoria)

  const { data, error } = await q
  if (error) manejarError('obtenerIngresos', error)
  return data.map(mapIngreso)
}

/**
 * Crea un nuevo ingreso.
 * Equivale a: INSERT INTO Ingreso (...) VALUES (...)
 */
export async function crearIngreso(ingreso) {
  const { data, error } = await supabase
    .from('ingreso')
    .insert({
      fecha:       ingreso.fecha,
      categoria:   ingreso.categoria   ?? 'Otro',
      descripcion: ingreso.descripcion,
      monto:       ingreso.monto,
    })
    .select()
    .single()

  if (error) manejarError('crearIngreso', error)
  return mapIngreso(data)
}

/**
 * Actualiza un ingreso existente.
 * Equivale a: UPDATE Ingreso SET ... WHERE idIngreso = ?
 */
export async function actualizarIngreso(idIngreso, ingreso) {
  const { error } = await supabase
    .from('ingreso')
    .update({
      fecha:       ingreso.fecha,
      categoria:   ingreso.categoria ?? 'Otro',
      descripcion: ingreso.descripcion,
      monto:       ingreso.monto,
    })
    .eq('id_ingreso', idIngreso)

  if (error) manejarError('actualizarIngreso', error)
}

/**
 * Elimina un ingreso.
 * Equivale a: DELETE FROM Ingreso WHERE idIngreso = ?
 */
export async function eliminarIngreso(idIngreso) {
  const { error } = await supabase
    .from('ingreso')
    .delete()
    .eq('id_ingreso', idIngreso)

  if (error) manejarError('eliminarIngreso', error)
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVERSIONES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Devuelve inversiones con filtros opcionales.
 * Equivale a las queries de Estadisticas.jsx sobre Inversion.
 */
export async function obtenerInversiones({
  fechaDesde = null,
  fechaHasta = null,
  categoria  = null,
  estado     = null,  // 'invertido' | 'retirado'
  orden      = 'desc',
  limite     = 1000,
} = {}) {
  let q = supabase
    .from('inversion')
    .select('*')
    .order('fecha', { ascending: orden === 'asc' })
    .limit(limite)

  if (fechaDesde) q = q.gte('fecha', fechaDesde)
  if (fechaHasta) q = q.lte('fecha', fechaHasta)
  if (categoria)  q = q.eq('categoria', categoria)
  if (estado)     q = q.eq('estado', estado)

  const { data, error } = await q
  if (error) manejarError('obtenerInversiones', error)
  return data.map(mapInversion)
}

/**
 * Crea una nueva inversión.
 * Equivale a: INSERT INTO Inversion (...) VALUES (...)
 */
export async function crearInversion(inversion) {
  const { data, error } = await supabase
    .from('inversion')
    .insert({
      fecha:       inversion.fecha,
      categoria:   inversion.categoria,
      descripcion: inversion.descripcion,
      monto:       inversion.monto,
      estado:      inversion.estado ?? 'invertido',
    })
    .select()
    .single()

  if (error) manejarError('crearInversion', error)
  return mapInversion(data)
}

/**
 * Actualiza una inversión existente.
 * Equivale a: UPDATE Inversion SET ... WHERE idInversion = ?
 */
export async function actualizarInversion(idInversion, inversion) {
  const { error } = await supabase
    .from('inversion')
    .update({
      fecha:       inversion.fecha,
      categoria:   inversion.categoria,
      descripcion: inversion.descripcion,
      monto:       inversion.monto,
      estado:      inversion.estado ?? 'invertido',
    })
    .eq('id_inversion', idInversion)

  if (error) manejarError('actualizarInversion', error)
}

/**
 * Marca una inversión como retirada.
 * Equivale a: UPDATE Inversion SET estado='retirado' WHERE idInversion = ?
 * Usado en: Estadisticas.jsx al registrar el retiro de una inversión.
 */
export async function retirarInversion(idInversion) {
  const { error } = await supabase
    .from('inversion')
    .update({ estado: 'retirado' })
    .eq('id_inversion', idInversion)

  if (error) manejarError('retirarInversion', error)
}

/**
 * Elimina una inversión.
 * Equivale a: DELETE FROM Inversion WHERE idInversion = ?
 */
export async function eliminarInversion(idInversion) {
  const { error } = await supabase
    .from('inversion')
    .delete()
    .eq('id_inversion', idInversion)

  if (error) manejarError('eliminarInversion', error)
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLUJO DE CAJA COMBINADO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Devuelve el resumen de flujo de caja para un rango de fechas.
 * Carga los tres tipos en paralelo para minimizar latencia.
 * Usado en: Estadisticas.jsx para el panel de resumen financiero.
 *
 * Equivale a las tres queries separadas que Estadisticas.jsx ejecutaba
 * en secuencia y luego combinaba con reduce() en el cliente.
 */
export async function obtenerResumenFlujoCaja({
  fechaDesde = null,
  fechaHasta = null,
} = {}) {
  const filtro = { fechaDesde, fechaHasta }

  const [egresos, ingresos, inversiones] = await Promise.all([
    obtenerEgresos(filtro),
    obtenerIngresos(filtro),
    obtenerInversiones(filtro),
  ])

  const totalEgresos    = egresos.reduce((acc, e) => acc + e.monto, 0)
  const totalIngresos   = ingresos.reduce((acc, i) => acc + i.monto, 0)
  const totalInvertido  = inversiones
    .filter(i => i.estado === 'invertido')
    .reduce((acc, i) => acc + i.monto, 0)
  const totalRetirado   = inversiones
    .filter(i => i.estado === 'retirado')
    .reduce((acc, i) => acc + i.monto, 0)

  return {
    egresos,
    ingresos,
    inversiones,
    totalEgresos,
    totalIngresos,
    totalInvertido,
    totalRetirado,
    balance: totalIngresos - totalEgresos,
  }
}