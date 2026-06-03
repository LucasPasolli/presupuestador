// src/components/layout/AppShell.jsx
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import {
  FileText, Clock, Package, Receipt,
  BarChart2, ShoppingCart, Wallet, LogOut, Menu, Home, Settings2
} from 'lucide-react'
import { useState } from 'react'

const NAV = [
  { to: '/presupuestador', label: 'Presupuestador',   icon: FileText },
  { to: '/historial',      label: 'Historial',         icon: Clock },
  { to: '/inventario',     label: 'Inventario',        icon: Package },
  { to: '/facturas',       label: 'Facturas',          icon: Receipt },
  { to: '/estadisticas',   label: 'Estadísticas',      icon: BarChart2 },
  { to: '/pedidos',        label: 'Pedidos de Compra', icon: ShoppingCart },
  { to: '/saldos',         label: 'Saldos',            icon: Wallet },
  { to: '/abmc',           label: 'ABMC',              icon: Settings2 },
]

export default function AppShell({ children }) {
  const { logout } = useAuth()
  const navigate   = useNavigate()
  const [open, setOpen] = useState(false)

  function handleLogout() { logout(); navigate('/login') }

  return (
    <div className="flex min-h-screen bg-surface-900">
      {open && (
        <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setOpen(false)} />
      )}

      <aside className={`fixed top-0 left-0 h-full z-30 w-64 bg-surface-800 border-r border-surface-700
                         flex flex-col transition-transform duration-300
                         ${open ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0`}>

        <NavLink to="/" onClick={() => setOpen(false)}
          className="p-6 border-b border-surface-700 flex items-center gap-3 hover:bg-surface-700/40 transition-colors">
          <span className="text-2xl">🏍</span>
          <div>
            <p className="font-display text-2xl text-white tracking-widest leading-none">POWDER</p>
            <p className="text-surface-500 text-xs font-body">Gestión</p>
          </div>
        </NavLink>

        <div className="px-4 pt-3">
          <NavLink to="/" onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-body transition-all duration-200
               ${isActive
                 ? 'bg-brand-500/15 text-brand-400 border border-brand-500/25'
                 : 'text-surface-300 hover:text-white hover:bg-surface-700'}`
            }>
            <Home size={17} />
            Inicio
          </NavLink>
        </div>

        <div className="mx-4 mt-2 border-t border-surface-700/60" />

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-body transition-all duration-200
                 ${isActive
                   ? 'bg-brand-500/15 text-brand-400 border border-brand-500/25'
                   : 'text-surface-300 hover:text-white hover:bg-surface-700'}`
              }>
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-surface-700">
          <button onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-sm
                       text-surface-400 hover:text-red-400 hover:bg-red-500/10 transition-all font-body">
            <LogOut size={17} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden flex items-center gap-4 px-4 py-3 bg-surface-800 border-b border-surface-700">
          <button onClick={() => setOpen(true)} className="text-surface-300 hover:text-white transition-colors">
            <Menu size={22} />
          </button>
          <NavLink to="/" className="font-display text-xl text-white tracking-widest">POWDER</NavLink>
        </header>

        <main className="flex-1 p-6 overflow-auto animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  )
}
