// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { AuthProvider } from './lib/AuthContext'
import { DbProvider } from './lib/DbContext'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <DbProvider>
        <App />
      </DbProvider>
    </AuthProvider>
  </React.StrictMode>
)
