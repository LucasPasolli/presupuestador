// src/components/layout/AppShell.jsx
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, FileText, Clock, Package, Receipt,
  BarChart2, ShoppingCart, Wallet, Settings2, LogOut, Tag, Lock,
} from 'lucide-react'
import { useAuth }        from '../../lib/AuthContext'
import { useSpecialAuth } from '../../lib/SpecialAuthContext'

// Páginas que requieren segunda capa de autorización
const SPECIAL_AUTH_PAGES = new Set(['/estadisticas', '/abmc'])

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
  const { logout }    = useAuth()
  const { hasAccess } = useSpecialAuth()
  const navigate      = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  /**
   * Determina si un link protegido ya tiene acceso activo en memoria.
   * Usado únicamente para mostrar/ocultar el ícono de candado.
   * NO es una decisión de seguridad — eso lo hace SpecialAuthGate.
   */
  function isUnlocked(path) {
    // Extraer la pageKey del path (ej: '/estadisticas' → 'estadisticas')
    const pageKey = path.replace('/', '')
    return hasAccess(pageKey)
  }

  return (
    <div className="flex min-h-screen bg-surface-900">

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="fixed top-0 left-0 h-screen w-56 bg-surface-800 border-r border-surface-700 flex flex-col z-40">

        {/* Logo */}
        <div className="px-6 py-6 border-b border-surface-700">
          <span className="font-display text-3xl tracking-widest text-white leading-none">
            POWDER
          </span>
          <p className="text-brand-500 text-[10px] font-mono tracking-[0.25em] uppercase mt-0.5">
            Sistema de gestión
          </p>
        </div>

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

                    {/* Indicador de candado para páginas protegidas */}
                    {isProtected && (
                      <Lock
                        size={11}
                        className={`
                          flex-shrink-0 transition-all duration-300
                          ${isActive
                            ? 'text-white/60'
                            : isUnlocked(to)
                              ? 'text-brand-400/60'   // desbloqueada: tenue color acento
                              : 'text-surface-600'    // bloqueada: gris sutil
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

        {/* Cerrar sesión — aislado en el bottom */}
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
      </aside>

      {/* ── Main content ────────────────────────────────────────── */}
      <main className="flex-1 ml-56 min-h-screen">
        <div className="p-8">
          {children}
        </div>
      </main>

    </div>
  )
}
