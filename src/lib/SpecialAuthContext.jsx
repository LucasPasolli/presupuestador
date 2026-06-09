// src/lib/SpecialAuthContext.jsx
//
// Contexto de segunda capa de autorización.
//
// Comportamiento de bloqueo:
//   - Al salir de una página protegida: el token se marca con revokedAt
//   - Si volvés dentro de GRACE_PERIOD_MS (60s): entrás sin contraseña
//   - Si pasan más de 60s: el token se considera expirado y pide contraseña
//   - F5, logout, o expiración de las 2 horas: siempre bloquea

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react'
import { useAuth } from './AuthContext'
import {
  verifySpecialAccess,
  validateSpecialToken,
  cleanupExpiredTokens,
} from '../services/specialAccessService'

// Período de gracia en milisegundos (60 segundos)
const GRACE_PERIOD_MS = 60 * 1000

const SpecialAuthContext = createContext(null)

export function SpecialAuthProvider({ children }) {
  /**
   * Mapa en memoria: pageKey → {
   *   token:     string,
   *   expiresAt: string,    // ISO — expiración del token en servidor (2h)
   *   grantedAt: number,    // Date.now() cuando se otorgó
   *   revokedAt: number|null // Date.now() cuando se salió de la página, null si está activo
   * }
   */
  const [tokenMap, setTokenMap] = useState({})
  const pendingRef = useRef({})
  const { registerLogoutCallback, authed } = useAuth()

  const clearAllTokens = useCallback(() => {
    setTokenMap({})
  }, [])

  useEffect(() => {
    registerLogoutCallback(clearAllTokens)
  }, [registerLogoutCallback, clearAllTokens])

  useEffect(() => {
    if (!authed) setTokenMap({})
  }, [authed])

  useEffect(() => {
    if (authed) cleanupExpiredTokens()
  }, [authed])

  // -------------------------------------------------------------------------
  // checkAccess — verifica si el acceso está vigente (incluyendo gracia)
  // -------------------------------------------------------------------------
  const checkAccess = useCallback(async (pageKey) => {
    const entry = tokenMap[pageKey]
    if (!entry) return false

    // Token expirado en servidor (2 horas)
    if (Date.now() >= new Date(entry.expiresAt).getTime()) {
      setTokenMap(prev => { const n = { ...prev }; delete n[pageKey]; return n })
      return false
    }

    // Token revocado: verificar si está dentro del período de gracia
    if (entry.revokedAt !== null) {
      const elapsed = Date.now() - entry.revokedAt
      if (elapsed > GRACE_PERIOD_MS) {
        // Pasó el período de gracia → bloquear definitivamente
        setTokenMap(prev => { const n = { ...prev }; delete n[pageKey]; return n })
        return false
      }
      // Dentro del período de gracia → restaurar token (quitar revokedAt)
      setTokenMap(prev => ({
        ...prev,
        [pageKey]: { ...prev[pageKey], revokedAt: null },
      }))
      return true
    }

    // Token activo: revalidar contra servidor
    const result = await validateSpecialToken(pageKey, entry.token)
    if (!result.valid) {
      setTokenMap(prev => { const n = { ...prev }; delete n[pageKey]; return n })
      return false
    }

    return true
  }, [tokenMap])

  // -------------------------------------------------------------------------
  // verifyAccess — envía contraseña y guarda token
  // -------------------------------------------------------------------------
  const verifyAccess = useCallback(async (pageKey, password) => {
    if (pendingRef.current[pageKey]) {
      return { ok: false, message: 'Verificación en progreso...' }
    }
    pendingRef.current[pageKey] = true

    try {
      const result = await verifySpecialAccess(pageKey, password)

      if (result.granted) {
        setTokenMap(prev => ({
          ...prev,
          [pageKey]: {
            token:     result.token,
            expiresAt: result.expiresAt,
            grantedAt: Date.now(),
            revokedAt: null,
          },
        }))
        return { ok: true, message: 'Acceso concedido.' }
      }

      const messages = {
        wrong_password:    'Contraseña incorrecta.',
        not_configured:    'Esta sección no está configurada.',
        not_authenticated: 'Sesión expirada. Volvé a iniciar sesión.',
        invalid_page:      'Página inválida.',
        rpc_error:         'Error de conexión. Intentá de nuevo.',
        empty_password:    'Ingresá una contraseña.',
        unexpected_error:  'Error inesperado. Intentá de nuevo.',
      }

      return {
        ok:      false,
        message: messages[result.reason] ?? 'Error inesperado. Intentá de nuevo.',
      }
    } finally {
      pendingRef.current[pageKey] = false
    }
  }, [])

  // -------------------------------------------------------------------------
  // revokeAccess — marca el token con revokedAt (inicia período de gracia)
  // -------------------------------------------------------------------------
  const revokeAccess = useCallback((pageKey) => {
    setTokenMap(prev => {
      // Solo marcar si el token existe y está activo (no ya revocado)
      if (!prev[pageKey] || prev[pageKey].revokedAt !== null) return prev
      return {
        ...prev,
        [pageKey]: { ...prev[pageKey], revokedAt: Date.now() },
      }
    })
  }, [])

  // -------------------------------------------------------------------------
  // hasAccess — helper síncrono para UI
  // -------------------------------------------------------------------------
  const hasAccess = useCallback((pageKey) => {
    const entry = tokenMap[pageKey]
    if (!entry) return false
    if (Date.now() >= new Date(entry.expiresAt).getTime()) return false
    // Considera "con acceso" si está activo o dentro del período de gracia
    if (entry.revokedAt !== null) {
      return (Date.now() - entry.revokedAt) <= GRACE_PERIOD_MS
    }
    return true
  }, [tokenMap])

  return (
    <SpecialAuthContext.Provider value={{
      checkAccess,
      verifyAccess,
      revokeAccess,
      clearAllTokens,
      hasAccess,
    }}>
      {children}
    </SpecialAuthContext.Provider>
  )
}

export function useSpecialAuth() {
  const ctx = useContext(SpecialAuthContext)
  if (!ctx) throw new Error('useSpecialAuth debe usarse dentro de <SpecialAuthProvider>')
  return ctx
}
