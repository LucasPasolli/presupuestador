// src/pages/Login.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { Lock, AlertCircle } from 'lucide-react'

export default function Login() {
  const { login }                   = useAuth()
  const navigate                    = useNavigate()
  const [password, setPassword]     = useState('')
  const [error,    setError]        = useState('')
  const [shaking,  setShaking]      = useState(false)

  function handleSubmit(e) {
    e.preventDefault()
    const ok = login(password)
    if (ok) {
      navigate('/', { replace: true })   // ← redirige al dashboard tras login correcto
    } else {
      setError('Contraseña incorrecta')
      setShaking(true)
      setTimeout(() => setShaking(false), 500)
      setPassword('')
    }
  }

  return (
    <div className="min-h-screen bg-surface-900 bg-grid-pattern bg-grid flex items-center justify-center p-4">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-96 h-96 bg-brand-500/10 rounded-full blur-3xl" />
      </div>

      <div className={`relative w-full max-w-sm animate-slide-up ${shaking ? 'animate-[shake_0.5s_ease]' : ''}`}>
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/30 mb-4">
            <span className="text-3xl">🏍</span>
          </div>
          <h1 className="font-display text-5xl text-white tracking-widest">POWDER</h1>
          <p className="text-surface-400 text-sm mt-1 font-body">Sistema de Gestión y Presupuestos</p>
        </div>

        <div className="bg-surface-800 border border-surface-700 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center gap-2 mb-6">
            <Lock size={16} className="text-brand-500" />
            <span className="text-surface-300 text-sm font-body tracking-wider uppercase">Acceso</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-surface-300 text-xs mb-2 tracking-widest uppercase font-body">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError('') }}
                placeholder="••••••••"
                autoFocus
                className="w-full bg-surface-700 border border-surface-600 rounded-xl px-4 py-3
                           text-white font-mono placeholder-surface-500
                           focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 transition-all"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={14} /><span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-brand-500 hover:bg-brand-400 active:bg-brand-600
                         text-white font-body font-semibold py-3 rounded-xl transition-all tracking-wide"
            >
              Ingresar
            </button>
          </form>

          <p className="text-surface-500 text-xs text-center mt-6 font-mono">
            contraseña por defecto: moto1234
          </p>
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
