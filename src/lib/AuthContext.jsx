// src/lib/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

const SESSION_KEY  = 'motoparts_session'
const PASSWORD_KEY = 'motoparts_password'
const DEFAULT_PASS = 'moto1234'

export function AuthProvider({ children }) {
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    const session = sessionStorage.getItem(SESSION_KEY)
    if (session === 'ok') setAuthed(true)
  }, [])

  function login(password) {
    const stored = localStorage.getItem(PASSWORD_KEY) || DEFAULT_PASS
    if (password === stored) {
      sessionStorage.setItem(SESSION_KEY, 'ok')
      setAuthed(true)
      return true
    }
    return false
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY)
    setAuthed(false)
  }

  function changePassword(current, next) {
    const stored = localStorage.getItem(PASSWORD_KEY) || DEFAULT_PASS
    if (current !== stored) return false
    localStorage.setItem(PASSWORD_KEY, next)
    return true
  }

  return (
    <AuthContext.Provider value={{ authed, login, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
