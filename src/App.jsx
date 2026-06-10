// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth }        from './lib/AuthContext'
import AppShell           from './components/layout/AppShell'
import SpecialAuthGate    from './components/auth/SpecialAuthGate'
import Login              from './pages/Login'
import Dashboard          from './pages/Dashboard'
import Presupuestador     from './pages/Presupuestador'
import Inventario         from './pages/Inventario'
import Historial          from './pages/Historial'
import Facturas           from './pages/Facturas'
import Estadisticas       from './pages/Estadisticas'
import PedidosCompra      from './pages/PedidosCompra'
import Saldos             from './pages/Saldos'
import ABMC               from './pages/ABMC'
import Promociones        from './pages/Promociones'

/**
 * Spinner de carga — se muestra mientras AuthContext resuelve
 * la sesión inicial (getSession). Evita el flash de /login
 * en usuarios ya autenticados, y evita el bypass de rutas
 * protegidas antes de que loading termine.
 */
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-surface-900 flex items-center justify-center">
      <span className="w-6 h-6 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
    </div>
  )
}

/**
 * CAPA 1: Protege rutas contra usuarios no autenticados.
 *
 * CRÍTICO: espera a que loading sea false antes de tomar cualquier
 * decisión. Sin esto, user=null (estado inicial) se interpreta como
 * "no autenticado" y redirige a /login antes de que getSession termine,
 * permitiendo el bypass inverso (acceso sin login) si la sesión
 * se resuelve tarde.
 */
function RequireAuth({ children }) {
  const { authed, loading } = useAuth()

  // Mientras resolvemos la sesión: no redirigir, no renderizar
  if (loading) return <LoadingScreen />

  // Sesión resuelta y no autenticado: ir a login
  if (!authed) return <Navigate to="/login" replace />

  // Autenticado: renderizar dentro del shell
  return <AppShell>{children}</AppShell>
}

/**
 * CAPA 2: Protege rutas que requieren segunda capa de autorización.
 * Se apila dentro de RequireAuth (el usuario ya pasó la capa 1).
 */
function RequireSpecialAuth({ pageKey, label, children }) {
  return (
    <SpecialAuthGate pageKey={pageKey} label={label}>
      {children}
    </SpecialAuthGate>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"          element={<Login />} />
        <Route path="/"               element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/presupuestador" element={<RequireAuth><Presupuestador /></RequireAuth>} />
        <Route path="/historial"      element={<RequireAuth><Historial /></RequireAuth>} />
        <Route path="/inventario"     element={<RequireAuth><Inventario /></RequireAuth>} />
        <Route path="/facturas"       element={<RequireAuth><Facturas /></RequireAuth>} />
        <Route path="/pedidos"        element={<RequireAuth><PedidosCompra /></RequireAuth>} />
        <Route path="/saldos"         element={<RequireAuth><Saldos /></RequireAuth>} />
        <Route path="/promociones"    element={<RequireAuth><Promociones /></RequireAuth>} />

        {/* ── Rutas con segunda capa de autorización ───────────────── */}
        <Route
          path="/estadisticas"
          element={
            <RequireAuth>
              <RequireSpecialAuth pageKey="estadisticas" label="Estadísticas">
                <Estadisticas />
              </RequireSpecialAuth>
            </RequireAuth>
          }
        />
        <Route
          path="/abmc"
          element={
            <RequireAuth>
              <RequireSpecialAuth pageKey="abmc" label="ABMC">
                <ABMC />
              </RequireSpecialAuth>
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
