// src/lib/AuthContext.jsx
import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'

// Dominio ficticio interno — el usuario nunca lo ve
const INTERNAL_DOMAIN = 'presupuestador.internal'

/**
 * Convierte un username visible ("admin") en el email interno que
 * Supabase Auth requiere ("admin@presupuestador.internal").
 */
function toInternalEmail(username) {
  const clean = username.trim().toLowerCase()
  return `${clean}@${INTERNAL_DOMAIN}`
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // null  → todavía no sabemos (cargando sesión inicial)
  // false → sabemos que no hay sesión
  // obj   → usuario autenticado
  const [user,    setUser]    = useState(null)
  const [loading, setLoading] = useState(true)

  /**
   * Ref para el callback de limpieza de tokens especiales.
   * SpecialAuthProvider lo registra llamando a registerLogoutCallback().
   * Usamos un ref para evitar dependencia circular entre contextos:
   *   AuthContext no importa SpecialAuthContext, solo guarda una función.
   */
  const onLogoutCallbackRef = useRef(null)

  useEffect(() => {
    // 1. Recuperar sesión existente al montar (F5 / regreso al tab)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? false)
      setLoading(false)
    })

    // 2. Suscribirse a cambios de sesión (login / logout / token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? false)

        // Si la sesión se cerró (por expiración, logout externo, etc.)
        // también limpiamos los tokens especiales
        if (!session && onLogoutCallbackRef.current) {
          onLogoutCallbackRef.current()
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  /**
   * Permite a SpecialAuthProvider registrar su función clearAllTokens
   * para que AuthContext la llame al hacer logout.
   * No crea dependencia de importación circular.
   *
   * @param {() => void} callback
   */
  function registerLogoutCallback(callback) {
    onLogoutCallbackRef.current = callback
  }

  /**
   * login(username, password)
   * Retorna { ok: true } o { ok: false, message: string }
   */
  async function login(username, password) {
    if (!username || !password) {
      return { ok: false, message: 'Completá usuario y contraseña.' }
    }

    const email = toInternalEmail(username)
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      return { ok: false, message: 'Usuario o contraseña incorrectos.' }
    }

    return { ok: true }
  }

  /**
   * logout()
   * Limpia tokens especiales, luego cierra sesión en Supabase.
   */
  async function logout() {
    // Primero limpiamos los tokens especiales de memoria
    if (onLogoutCallbackRef.current) {
      onLogoutCallbackRef.current()
    }
    await supabase.auth.signOut()
    // onAuthStateChange se dispara solo y setea user a false
  }

  // authed es true solo cuando user es un objeto (no null ni false)
  const authed = !!user && user !== false

  return (
    <AuthContext.Provider value={{
      authed,
      loading,
      user,
      login,
      logout,
      registerLogoutCallback,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
