// src/components/layout/AppShell.jsx
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, FileText, Clock, Package, Receipt,
  BarChart2, ShoppingCart, Wallet, Settings2, LogOut, Tag, Lock, Menu, X,
} from 'lucide-react'
import { useAuth }        from '../../lib/AuthContext'
import { useSpecialAuth } from '../../lib/SpecialAuthContext'
import { useState, useEffect } from 'react'

// Páginas que requieren segunda capa de autorización
const SPECIAL_AUTH_PAGES = new Set(['/estadisticas', '/abmc', '/facturas'])

const NAV_ITEMS = [
  { to: '/',               icon: LayoutDashboard, label: 'Dashboard'       },
  { to: '/presupuestador', icon: FileText,         label: 'Presupuestador' },
  { to: '/historial',      icon: Clock,            label: 'Historial'      },
  { to: '/inventario',     icon: Package,          label: 'Inventario'     },
  { to: '/pedidos',        icon: ShoppingCart,     label: 'Pedidos'        },
  { to: '/saldos',         icon: Wallet,           label: 'Saldos'         },
  { to: '/promociones',    icon: Tag,              label: 'Promociones'    },
  { to: '/facturas',       icon: Receipt,          label: 'Facturas'       },
  { to: '/estadisticas',   icon: BarChart2,        label: 'Estadísticas'   },
  { to: '/abmc',           icon: Settings2,        label: 'ABMC'           },
]

export default function AppShell({ children }) {
  const { logout }      = useAuth()
  const { hasAccess }   = useSpecialAuth()
  const navigate        = useNavigate()
  const location        = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  // Cerrar el menú al cambiar de ruta
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  // Bloquear scroll del body cuando el menú está abierto en mobile
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  function handleLogout() {
    logout()
    navigate('/login')
  }

  function isUnlocked(path) {
    const pageKey = path.replace('/', '')
    return hasAccess(pageKey)
  }

  const navContent = (
    <>
      {/* Nav principal */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          const isProtected = SPECIAL_AUTH_PAGES.has(to)

          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-body font-medium
                transition-all duration-150 group
                ${isActive
                  ? 'bg-brand-500 text-white'
                  : 'text-surface-300 hover:bg-surface-700 hover:text-white'
                }
              `}
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={16}
                    className={`flex-shrink-0 transition-colors ${
                      isActive ? 'text-white' : 'text-surface-500 group-hover:text-brand-400'
                    }`}
                  />
                  <span className="flex-1">{label}</span>

                  {isProtected && (
                    <Lock
                      size={11}
                      className={`
                        flex-shrink-0 transition-all duration-300
                        ${isActive
                          ? 'text-white/60'
                          : isUnlocked(to)
                            ? 'text-brand-400/60'
                            : 'text-surface-600'
                        }
                        ${isUnlocked(to) ? 'opacity-0' : 'opacity-100'}
                      `}
                      aria-label="Requiere autorización adicional"
                    />
                  )}
                </>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Cerrar sesión */}
      <div className="px-3 py-4 border-t border-surface-700">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm
                     font-body font-medium text-surface-400
                     hover:bg-red-500/10 hover:text-red-400
                     transition-all duration-150 group"
        >
          <LogOut size={16} className="flex-shrink-0 text-surface-500 group-hover:text-red-400 transition-colors" />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </>
  )

  return (
    <div className="flex min-h-screen bg-surface-900">

      {/* ── Sidebar desktop (≥ lg) ──────────────────────────────── */}
      <aside className="hidden lg:flex fixed top-0 left-0 h-screen w-56 bg-surface-800 border-r border-surface-700 flex-col z-40">
        {/* Logo */}
        <div className="px-6 py-6 border-b border-surface-700">
          <span className="font-display text-3xl tracking-widest text-white leading-none">
            POWDER
          </span>
          <p className="text-brand-500 text-[10px] font-mono tracking-[0.25em] uppercase mt-0.5">
            Sistema de gestión
          </p>
        </div>

        {navContent}
      </aside>

      {/* ── Topbar mobile (< lg) ────────────────────────────────── */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-surface-800 border-b border-surface-700 flex items-center justify-between px-4 z-50">
        <span className="font-display text-2xl tracking-widest text-white leading-none">
          POWDER
        </span>
        <button
          onClick={() => setMenuOpen(v => !v)}
          className="p-2 rounded-xl text-surface-400 hover:text-white hover:bg-surface-700 transition-all"
          aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      {/* ── Drawer mobile ───────────────────────────────────────── */}
      {/* Backdrop */}
      <div
        className={`lg:hidden fixed inset-0 z-40 bg-black/60 transition-opacity duration-300
                    ${menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setMenuOpen(false)}
      />

      {/* Panel */}
      <div
        className={`lg:hidden fixed top-0 left-0 h-screen w-64 bg-surface-800 border-r border-surface-700
                    flex flex-col z-50 transition-transform duration-300 ease-in-out
                    ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Logo dentro del drawer */}
        <div className="px-6 py-5 border-b border-surface-700 flex items-center justify-between">
          <div>
            <span className="font-display text-2xl tracking-widest text-white leading-none">
              POWDER
            </span>
            <p className="text-brand-500 text-[10px] font-mono tracking-[0.25em] uppercase mt-0.5">
              Sistema de gestión
            </p>
          </div>
          <button
            onClick={() => setMenuOpen(false)}
            className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700 transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {navContent}
      </div>

      {/* ── Main content ────────────────────────────────────────── */}
      <main className="flex-1 lg:ml-56 min-h-screen">
        {/* Spacer para el topbar en mobile */}
        <div className="lg:hidden h-14" />
        <div className="p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>

    </div>
  )
}
