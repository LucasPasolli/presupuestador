// src/services/specialAccessService.js
//
// Servicio de comunicación con las RPCs de segunda capa de autorización.
// NUNCA llama directamente a tablas de Supabase — todo pasa por funciones
// SECURITY DEFINER que corren en el servidor.
//
// CAMBIO vs versión anterior:
//   Las RPCs ahora reciben p_user_id explícitamente porque auth.uid()
//   devuelve NULL dentro de funciones SECURITY DEFINER en Supabase Cloud.
//   El user_id no es un secreto: está en el JWT que el cliente ya posee.
//   Supabase valida el JWT antes de ejecutar cualquier RPC.

import { supabase } from '../lib/supabase'

export const PROTECTED_PAGES = /** @type {const} */ (['estadisticas', 'abmc'])

/**
 * Obtiene el user_id de la sesión activa.
 * Retorna null si no hay sesión.
 * @returns {Promise<string|null>}
 */
async function getCurrentUserId() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.id ?? null
}

/**
 * Verifica la contraseña especial para una página.
 *
 * @param {'estadisticas'|'abmc'} pageKey
 * @param {string} password
 * @returns {Promise<{
 *   granted: true,  token: string, expiresAt: string, pageKey: string
 * } | {
 *   granted: false, reason: string
 * }>}
 */
export async function verifySpecialAccess(pageKey, password) {
  if (!PROTECTED_PAGES.includes(pageKey)) {
    return { granted: false, reason: 'invalid_page' }
  }
  if (!password || password.trim() === '') {
    return { granted: false, reason: 'empty_password' }
  }

  const userId = await getCurrentUserId()
  if (!userId) {
    return { granted: false, reason: 'not_authenticated' }
  }

  try {
    const { data, error } = await supabase.rpc('verify_special_access', {
      p_page_key:           pageKey,
      p_candidate_password: password,
      p_user_id:            userId,
    })

    if (error) {
      console.error('[specialAccessService] RPC error:', error.message)
      return { granted: false, reason: 'rpc_error' }
    }

    if (data?.granted === true) {
      return {
        granted:   true,
        token:     data.token,
        expiresAt: data.expires_at,
        pageKey:   data.page_key,
      }
    }

    return { granted: false, reason: data?.reason ?? 'unknown' }

  } catch (err) {
    console.error('[specialAccessService] Unexpected error:', err)
    return { granted: false, reason: 'unexpected_error' }
  }
}

/**
 * Valida si un token en memoria sigue siendo válido en el servidor.
 *
 * @param {'estadisticas'|'abmc'} pageKey
 * @param {string} token
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
export async function validateSpecialToken(pageKey, token) {
  if (!pageKey || !token) {
    return { valid: false, reason: 'missing_params' }
  }

  const userId = await getCurrentUserId()
  if (!userId) {
    return { valid: false, reason: 'not_authenticated' }
  }

  try {
    const { data, error } = await supabase.rpc('validate_special_token', {
      p_page_key: pageKey,
      p_token:    token,
      p_user_id:  userId,
    })

    if (error) {
      console.error('[specialAccessService] Validate RPC error:', error.message)
      return { valid: false, reason: 'rpc_error' }
    }

    return { valid: data?.valid === true, reason: data?.reason }

  } catch (err) {
    console.error('[specialAccessService] Unexpected error:', err)
    return { valid: false, reason: 'unexpected_error' }
  }
}

/**
 * Limpieza de tokens expirados en servidor.
 * Best-effort — no bloquea, no lanza errores.
 */
export async function cleanupExpiredTokens() {
  try {
    await supabase.rpc('cleanup_expired_tokens')
  } catch {
    // Silencioso — operación de mantenimiento, no crítica
  }
}
