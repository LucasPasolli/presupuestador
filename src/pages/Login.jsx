// src/pages/Login.jsx
import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { Lock, User, AlertCircle } from 'lucide-react'

// Límites defensivos: evitan payloads absurdos hacia el backend (mini-DoS)
// y no tienen impacto en usuarios legítimos.
const MAX_USERNAME_LENGTH = 150
const MAX_PASSWORD_LENGTH = 128

// Mitigación de fuerza bruta EN CLIENTE. Esto es solo una capa extra de UX:
// el rate-limiting real y autoritativo debe vivir en el backend, ya que
// cualquier lógica de este archivo puede ser evadida manipulando el DOM
// o llamando a la API directamente.
const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5
const COOLDOWN_SECONDS = 30

export default function Login() {
  const { login }               = useAuth()
  const navigate                = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [shaking,  setShaking]  = useState(false)
  const [cooldown, setCooldown] = useState(0) // segundos restantes de bloqueo

  const failedAttemptsRef = useRef(0)
  const cooldownTimerRef  = useRef(null)

  const startCooldown = useCallback(() => {
    setCooldown(COOLDOWN_SECONDS)
    clearInterval(cooldownTimerRef.current)
    cooldownTimerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownTimerRef.current)
          failedAttemptsRef.current = 0
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()

    // Guard adicional: nunca dispares un submit si ya hay uno en curso
    // o si el usuario está en cooldown (defensa en profundidad, más allá
    // del disabled del botón).
    if (loading || cooldown > 0) return

    const cleanUsername = username.trim()
    if (!cleanUsername || !password) {
      setError('Usuario y contraseña son obligatorios')
      return
    }

    setError('')
    setLoading(true)

    try {
      const result = await login(cleanUsername, password)

      if (result.ok) {
        failedAttemptsRef.current = 0
        navigate('/', { replace: true })
        return
      }

      // Mensaje genérico intencional: no reveles aquí si fue "usuario
      // inexistente" o "contraseña incorrecta". Esa decisión debe tomarse
      // en el backend (result.message) para evitar user enumeration
      // (OWASP A07). Si tu backend hoy distingue ambos casos, corregilo ahí.
      setError(result.message || 'Usuario o contraseña incorrectos')
      setShaking(true)
      setTimeout(() => setShaking(false), 500)
      setPassword('')

      failedAttemptsRef.current += 1
      if (failedAttemptsRef.current >= MAX_ATTEMPTS_BEFORE_COOLDOWN) {
        startCooldown()
      }
    } catch (err) {
      // Nunca expongas err.message crudo al usuario: puede filtrar
      // detalles de infraestructura (URLs internas, stack traces, etc.)
      setError('No se pudo conectar. Intentá nuevamente en unos segundos.')
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  const isDisabled = loading || cooldown > 0

  return (
    <div className="min-h-screen bg-surface-900 bg-grid-pattern bg-grid flex items-center justify-center p-4">
      {/* Glow de fondo */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-96 h-96 bg-brand-500/10 rounded-full blur-3xl" />
      </div>

      <div className={`relative w-full max-w-sm animate-slide-up ${shaking ? 'animate-[shake_0.5s_ease]' : ''}`}>

        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/30 mb-4">
            <span className="text-3xl">🏍</span>
          </div>
          <h1 className="font-display text-5xl text-white tracking-widest">POWDER</h1>
          <p className="text-surface-400 text-sm mt-1 font-body">Sistema de Gestión y Presupuestos</p>
        </div>

        {/* Card */}
        <div className="bg-surface-800 border border-surface-700 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center gap-2 mb-6">
            <Lock size={16} className="text-brand-500" />
            <span className="text-surface-300 text-sm font-body tracking-wider uppercase">Acceso</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>

            {/* Campo: Usuario */}
            <div>
              <label htmlFor="login-username" className="block text-surface-300 text-xs mb-2 tracking-widest uppercase font-body">
                Usuario
              </label>
              <div className="relative">
                <User
                  size={15}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-500 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="login-username"
                  name="username"
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError('') }}
                  placeholder="Nombre de usuario"
                  autoFocus
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={MAX_USERNAME_LENGTH}
                  disabled={isDisabled}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'login-error' : undefined}
                  className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-10 pr-4 py-3
                             text-white font-mono placeholder-surface-500
                             focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30
                             disabled:opacity-50 transition-all"
                />
              </div>
            </div>

            {/* Campo: Contraseña */}
            <div>
              <label htmlFor="login-password" className="block text-surface-300 text-xs mb-2 tracking-widest uppercase font-body">
                Contraseña
              </label>
              <div className="relative">
                <Lock
                  size={15}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-500 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError('') }}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  maxLength={MAX_PASSWORD_LENGTH}
                  disabled={isDisabled}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'login-error' : undefined}
                  className="w-full bg-surface-700 border border-surface-600 rounded-xl pl-10 pr-4 py-3
                             text-white font-mono placeholder-surface-500
                             focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30
                             disabled:opacity-50 transition-all"
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                id="login-error"
                role="alert"
                aria-live="polite"
                className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
              >
                <AlertCircle size={14} className="flex-shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {/* Cooldown tras varios intentos fallidos */}
            {cooldown > 0 && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 text-amber-400 text-sm bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2"
              >
                <AlertCircle size={14} className="flex-shrink-0" aria-hidden="true" />
                <span>Demasiados intentos. Probá de nuevo en {cooldown}s.</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isDisabled}
              aria-busy={loading}
              className="w-full bg-brand-500 hover:bg-brand-400 active:bg-brand-600
                         disabled:opacity-60 disabled:cursor-not-allowed
                         text-white font-body font-semibold py-3 rounded-xl transition-all tracking-wide
                         flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                  <span>Verificando...</span>
                </>
              ) : cooldown > 0 ? (
                `Esperá ${cooldown}s`
              ) : (
                'Ingresar'
              )}
            </button>
          </form>
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%      { transform: translateX(-8px); }
          40%      { transform: translateX(8px); }
          60%      { transform: translateX(-6px); }
          80%      { transform: translateX(6px); }
        }
      `}</style>
    </div>
  )
}
