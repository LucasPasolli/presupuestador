// src/lib/DbContext.jsx
import { createContext, useContext, useEffect, useState } from 'react'
import { initDB } from './database'

const DbContext = createContext(null)

export function DbProvider({ children }) {
  const [ready, setReady] = useState(false)
  const [error, setError]  = useState(null)

  useEffect(() => {
    initDB()
      .then(() => setReady(true))
      .catch((err) => {
        console.error('DB init failed', err)
        setError(err.message)
      })
  }, [])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-900 text-red-400 font-mono text-sm p-8">
        <div className="max-w-md text-center space-y-3">
          <p className="text-2xl">⚠ Error al inicializar la base de datos</p>
          <p className="text-surface-400">{error}</p>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-900">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-surface-400 font-body text-sm tracking-widest uppercase">
            Iniciando base de datos…
          </p>
        </div>
      </div>
    )
  }

  return <DbContext.Provider value={{ ready }}>{children}</DbContext.Provider>
}

export function useDb() {
  return useContext(DbContext)
}
