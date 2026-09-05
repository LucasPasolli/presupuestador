// src/lib/AuthContext.jsx
import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'

// Dominio ficticio interno — el usuario nunca lo ve
const INTERNAL_DOMAIN = 'presupuestador.internal'

// Allowlist estricta para el username visible: letras, números, punto,
// guion y guion bajo, entre 3 y 32 caracteres. Evita construir emails
// malformados (que generan un error de Supabase distinto al de
// "credenciales incorrectas" y terminan siendo una fuga de información
// sutil) y cierra la puerta a cualquier caracter inesperado antes de
// tocar la red.
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/

/**
 * Convierte un username visible ("admin") en el email interno que
 * Supabase Auth requiere ("admin@presupuestador.internal").
 * Devuelve null si el username no cumple el formato esperado.
 */
function toInternalEmail(username) {
  const clean = username.trim().toLowerCase()
  if (!USERNAME_PATTERN.test(clean)) return null
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

    // Username con formato inválido: respondemos EXACTAMENTE el mismo
    // mensaje genérico que ante credenciales incorrectas, y ni siquiera
    // llamamos a Supabase. Así el mensaje nunca delata si el formato
    // era el problema o si la cuenta no existe (previene enumeración
    // y reduce ruido/carga innecesaria sobre el endpoint de auth).
    if (!email) {
      return { ok: false, message: 'Usuario o contraseña incorrectos.' }
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        return { ok: false, message: 'Usuario o contraseña incorrectos.' }
      }

      return { ok: true }
    } catch {
      // Error de red/infra: no exponemos detalles internos al usuario.
      return { ok: false, message: 'No se pudo conectar. Intentá nuevamente.' }
    }
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
    try {
      await supabase.auth.signOut()
      // onAuthStateChange se dispara solo y setea user a false
    } catch (err) {
      // Si falla el signOut remoto (ej. red caída), igual dejamos al
      // usuario deslogueado localmente para no bloquearlo en la app.
      // El token remoto puede seguir vivo hasta expirar solo.
      console.error('Error al cerrar sesión en el servidor:', err)
      setUser(false)
    }
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
