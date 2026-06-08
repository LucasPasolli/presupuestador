// src/lib/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react'
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
      }
    )

    return () => subscription.unsubscribe()
  }, [])

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
      // Supabase devuelve "Invalid login credentials" para usuario o pass incorrectos.
      // Devolvemos un mensaje genérico para no revelar cuál de los dos falló.
      return { ok: false, message: 'Usuario o contraseña incorrectos.' }
    }

    return { ok: true }
  }

  /**
   * logout()
   * Limpia la sesión en Supabase y en el estado local.
   */
  async function logout() {
    await supabase.auth.signOut()
    // onAuthStateChange se dispara solo y setea user a false
  }

  // authed es true solo cuando user es un objeto (no null ni false)
  const authed = !!user && user !== false

  return (
    <AuthContext.Provider value={{ authed, loading, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}


