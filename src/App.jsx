// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/AuthContext'
import AppShell from './components/layout/AppShell'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Presupuestador from './pages/Presupuestador'
import Inventario from './pages/Inventario'
import Historial from './pages/Historial'
import Facturas from './pages/Facturas'
import Estadisticas from './pages/Estadisticas'
import PedidosCompra from './pages/PedidosCompra'
import Saldos from './pages/Saldos'
import ABMC from './pages/ABMC'
import Promociones from './pages/Promociones'

/**
 * Mientras AuthContext resuelve la sesión inicial (getSession),
 * mostramos una pantalla en negro para evitar el flash de /login
 * que vería un usuario que YA está autenticado al hacer F5.
 */
function AuthGate({ children }) {
  const { loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        <span className="w-6 h-6 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
      </div>
    )
  }
  return children
}

/**
 * Protege rutas: si no hay sesión, redirige a /login.
 * Si hay sesión, envuelve en AppShell.
 */
function RequireAuth({ children }) {
  const { authed } = useAuth()
  if (!authed) return <Navigate to="/login" replace />
  return <AppShell>{children}</AppShell>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <Routes>
          <Route path="/login"          element={<Login />} />
          <Route path="/"               element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/presupuestador" element={<RequireAuth><Presupuestador /></RequireAuth>} />
          <Route path="/historial"      element={<RequireAuth><Historial /></RequireAuth>} />
          <Route path="/inventario"     element={<RequireAuth><Inventario /></RequireAuth>} />
          <Route path="/facturas"       element={<RequireAuth><Facturas /></RequireAuth>} />
          <Route path="/estadisticas"   element={<RequireAuth><Estadisticas /></RequireAuth>} />
          <Route path="/pedidos"        element={<RequireAuth><PedidosCompra /></RequireAuth>} />
          <Route path="/saldos"         element={<RequireAuth><Saldos /></RequireAuth>} />
          <Route path="/abmc"           element={<RequireAuth><ABMC /></RequireAuth>} />
          <Route path="/promociones"    element={<RequireAuth><Promociones /></RequireAuth>} />
          <Route path="*"               element={<Navigate to="/" replace />} />
        </Routes>
      </AuthGate>
    </BrowserRouter>
  )
}
