// src/lib/SpecialAuthContext.jsx

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

// Período de gracia en milisegundos
const GRACE_PERIOD_MS = 15 * 1000 // 

const SpecialAuthContext = createContext(null)

export function SpecialAuthProvider({ children }) {

  const tokenMapRef = useRef({})
  const [, forceRender] = useState(0)

  const pendingRef = useRef({})
  const { registerLogoutCallback, authed } = useAuth()

  // -------------------------------------------------------------------------
  // clearAllTokens — logout o sesión cerrada
  // -------------------------------------------------------------------------
  const clearAllTokens = useCallback(() => {
    tokenMapRef.current = {}
    forceRender(n => n + 1)
  }, [])

  useEffect(() => {
    registerLogoutCallback(clearAllTokens)
  }, [registerLogoutCallback, clearAllTokens])

  useEffect(() => {
    if (!authed) clearAllTokens()
  }, [authed, clearAllTokens])

  useEffect(() => {
    if (authed) cleanupExpiredTokens()
  }, [authed])

  // -------------------------------------------------------------------------
  // checkAccess — llamado al montar SpecialAuthGate
  // -------------------------------------------------------------------------
  const checkAccess = useCallback(async (pageKey) => {
    const entry = tokenMapRef.current[pageKey]
    // Sin token: bloquear
    if (!entry) return false

    // Token expirado en servidor (2 horas)
    if (Date.now() >= new Date(entry.expiresAt).getTime()) {
      delete tokenMapRef.current[pageKey]
      forceRender(n => n + 1)
      return false
    }

    // Token revocado: verificar período de gracia
    if (entry.revokedAt !== null) {
      const elapsed = Date.now() - entry.revokedAt

      if (elapsed > GRACE_PERIOD_MS) {
        // Superó el período de gracia → bloquear
        delete tokenMapRef.current[pageKey]
        forceRender(n => n + 1)
        return false
      }


      return true
    }

    // Token activo: revalidar contra servidor
    const result = await validateSpecialToken(pageKey, entry.token)
    if (!result.valid) {
      delete tokenMapRef.current[pageKey]
      forceRender(n => n + 1)
      return false
    }

    return true
  }, []) // sin dependencias — lee tokenMapRef.current directamente

  // -------------------------------------------------------------------------
  // verifyAccess — envía contraseña al servidor
  // -------------------------------------------------------------------------
  const verifyAccess = useCallback(async (pageKey, password) => {
    if (pendingRef.current[pageKey]) {
      return { ok: false, message: 'Verificación en progreso...' }
    }
    pendingRef.current[pageKey] = true

    try {
      const result = await verifySpecialAccess(pageKey, password)

      if (result.granted) {
        tokenMapRef.current[pageKey] = {
          token:     result.token,
          expiresAt: result.expiresAt,
          grantedAt: Date.now(),
          revokedAt: null,
        }
        forceRender(n => n + 1)
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
  // revokeAccess — marca revokedAt al salir de la página (desde SpecialAuthGate)
  // Escribe directo al ref sin forceRender para evitar re-renders que
  // interfieran con el doble cleanup de React Strict Mode.
  // -------------------------------------------------------------------------
  const revokeAccess = useCallback((pageKey) => {
    const entry = tokenMapRef.current[pageKey]
    console.log('[revokeAccess] called at', Date.now(), 'entry:', JSON.stringify(entry))

    // Solo marcar si hay un token activo (revokedAt === null)
    if (!entry || entry.revokedAt !== null) return
    tokenMapRef.current[pageKey] = { ...entry, revokedAt: Date.now() }

  }, [])

  // -------------------------------------------------------------------------
  // hasAccess — helper síncrono para UI (candado en sidebar)
  // -------------------------------------------------------------------------
  const hasAccess = useCallback((pageKey) => {
    const entry = tokenMapRef.current[pageKey]
    if (!entry) return false
    if (Date.now() >= new Date(entry.expiresAt).getTime()) return false
    if (entry.revokedAt !== null) {
      return (Date.now() - entry.revokedAt) <= GRACE_PERIOD_MS
    }
    return true
  }, [])

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
