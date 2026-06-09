// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { AuthProvider }        from './lib/AuthContext'
import { SpecialAuthProvider } from './lib/SpecialAuthContext'
import { DbProvider }          from './lib/DbContext'

// Árbol de providers (el orden importa):
//
//  AuthProvider        → identidad: quién sos (sesión Supabase)
//    SpecialAuthProvider → autorización: a qué páginas podés entrar
//      DbProvider        → conectividad: verifica que Supabase sea alcanzable
//        App             → rutas
//
// SpecialAuthProvider debe estar dentro de AuthProvider (necesita useAuth)
// y fuera de DbProvider (no depende de la verificación de conexión).

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <SpecialAuthProvider>
        <DbProvider>
          <App />
        </DbProvider>
      </SpecialAuthProvider>
    </AuthProvider>
  </React.StrictMode>
)
