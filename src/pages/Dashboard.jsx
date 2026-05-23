// src/pages/Dashboard.jsx
import { Link } from 'react-router-dom'
import {
  FileText, Clock, Package, Receipt,
  BarChart2, ShoppingCart, Wallet, ArrowRight
} from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
import { query } from '../lib/database'

const SECTIONS = [
  {
    to:          '/presupuestador',
    icon:        FileText,
    label:       'Presupuestador',
    description: 'Creá nuevos presupuestos con cálculo automático de descuentos y recargos.',
    accent:      'from-brand-500 to-brand-600',
    glow:        'brand-500',
  },
  {
    to:          '/historial',
    icon:        Clock,
    label:       'Historial',
    description: 'Consultá todos los presupuestos emitidos en modo lectura.',
    accent:      'from-blue-500 to-blue-600',
    glow:        'blue-500',
  },
  {
    to:          '/inventario',
    icon:        Package,
    label:       'Inventario',
    description: 'Alta, baja, modificación y consulta del catálogo de productos.',
    accent:      'from-emerald-500 to-emerald-600',
    glow:        'emerald-500',
  },
  {
    to:          '/facturas',
    icon:        Receipt,
    label:       'Facturas',
    description: 'Generá y exportá documentos de factura en PDF por período.',
    accent:      'from-violet-500 to-violet-600',
    glow:        'violet-500',
  },
  {
    to:          '/estadisticas',
    icon:        BarChart2,
    label:       'Estadísticas',
    description: 'Ingresos, egresos y métricas clave del negocio.',
    accent:      'from-yellow-500 to-yellow-600',
    glow:        'yellow-500',
  },
  {
    to:          '/pedidos',
    icon:        ShoppingCart,
    label:       'Pedidos de Compra',
    description: 'Armá pedidos a proveedores con precios y cantidades.',
    accent:      'from-pink-500 to-pink-600',
    glow:        'pink-500',
  },
  {
    to:          '/saldos',
    icon:        Wallet,
    label:       'Saldos',
    description: 'Seguimiento de cobros pendientes por cuenta corriente.',
    accent:      'from-cyan-500 to-cyan-600',
    glow:        'cyan-500',
  },
]

export default function Dashboard() {
  const [stats, setStats] = useState({ presupuestos: 0, pendientes: 0, productos: 0 })

  const loadStats = useCallback(() => {
    try {
      const p  = query('SELECT COUNT(*) as c FROM Presupuesto')[0]?.c ?? 0
      // Saldos pendientes = presupuestos CC aún no pagados
      const s  = query('SELECT COUNT(*) as c FROM Saldo WHERE estado = ?', ['pendiente'])[0]?.c ?? 0
      const pr = query('SELECT COUNT(*) as c FROM Producto')[0]?.c ?? 0
      setStats({ presupuestos: p, pendientes: s, productos: pr })
    } catch {
      // db might not be ready yet on first load
    }
  }, [])

  useEffect(() => {
    loadStats()
    // Re-carga cuando el usuario vuelve a esta pestaña (ej: creó un presupuesto y volvió)
    window.addEventListener('focus', loadStats)
    return () => window.removeEventListener('focus', loadStats)
  }, [loadStats])

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      {/* Header */}
      <div className="animate-slide-up">
        <p className="text-brand-500 text-xs font-mono tracking-[0.3em] uppercase mb-2">
          Panel Principal
        </p>
        <h1 className="font-display text-6xl text-white tracking-widest leading-none">
          POWDER
        </h1>
        <p className="text-surface-400 mt-2 font-body">
          Sistema de gestión y presupuestos para repuestos de motos
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: '0.05s' }}>
        {[
          { label: 'Presupuestos', value: stats.presupuestos },
          { label: 'Saldos pendientes', value: stats.pendientes },
          { label: 'Productos', value: stats.productos },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="bg-surface-800 border border-surface-700 rounded-2xl p-5"
          >
            <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">
              {label}
            </p>
            <p className="font-display text-4xl text-white tracking-wider">{value}</p>
          </div>
        ))}
      </div>

      {/* Section grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {SECTIONS.map(({ to, icon: Icon, label, description, accent }, i) => (
          <Link
            key={to}
            to={to}
            className="group relative bg-surface-800 border border-surface-700 rounded-2xl p-6
                       hover:border-surface-600 hover:-translate-y-1
                       transition-all duration-300 animate-slide-up overflow-hidden"
            style={{ animationDelay: `${0.08 + i * 0.06}s` }}
          >
            {/* Icon */}
            <div
              className={`inline-flex items-center justify-center w-12 h-12 rounded-xl
                          bg-gradient-to-br ${accent} mb-4 shadow-lg`}
            >
              <Icon size={22} className="text-white" />
            </div>

            <h2 className="font-body font-semibold text-white text-base mb-1 group-hover:text-brand-300 transition-colors">
              {label}
            </h2>
            <p className="text-surface-400 text-sm font-body leading-relaxed">
              {description}
            </p>

            <div className="flex items-center gap-1 mt-4 text-surface-500 group-hover:text-brand-400 text-xs font-body transition-colors">
              <span>Abrir</span>
              <ArrowRight size={13} className="group-hover:translate-x-1 transition-transform" />
            </div>

            {/* Hover glow strip */}
            <div
              className={`absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r ${accent}
                          opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
            />
          </Link>
        ))}
      </div>
    </div>
  )
}
