// src/lib/DbContext.jsx
// Con Supabase no hay inicialización asíncrona de BD local.
// Este contexto ahora verifica que las variables de entorno estén presentes
// y que la conexión con Supabase sea alcanzable antes de renderizar la app.

import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const DbContext = createContext(null)

export function DbProvider({ children }) {
  const [dbReady, setDbReady]   = useState(false)
  const [dbError, setDbError]   = useState(null)

  useEffect(() => {
    // Verificación liviana: hace un SELECT 1 para confirmar
    // que Supabase es alcanzable y las credenciales son válidas.
    // Si falla, muestra el error antes de intentar cargar cualquier página.
    supabase
      .from('cliente')
      .select('id_cliente', { count: 'exact', head: true })
      .then(({ error }) => {
        if (error) {
          console.error('[DbContext] Error de conexión con Supabase:', error.message)
          setDbError(error.message)
        } else {
          setDbReady(true)
        }
      })
  }, [])

  if (dbError) {
    return (
      <div style={{ padding: 32, color: 'red' }}>
        <h2>Error al conectar con la base de datos</h2>
        <pre>{dbError}</pre>
        <p style={{ marginTop: 16, color: '#555', fontSize: 14 }}>
          Verificá que VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
          estén correctamente definidas en .env.local
        </p>
      </div>
    )
  }

  if (!dbReady) {
    return (
      <div style={{ padding: 32 }}>
        Conectando con la base de datos...
      </div>
    )
  }

  return (
    <DbContext.Provider value={{ dbReady }}>
      {children}
    </DbContext.Provider>
  )
}

export function useDb() {
  return useContext(DbContext)
}