// src/components/ui/index.jsx
// Shared primitive components used throughout the app.

// ─── Button ───────────────────────────────────────────────────────────────

const variants = {
  primary:   'bg-brand-500 hover:bg-brand-400 active:bg-brand-600 text-white',
  secondary: 'bg-surface-700 hover:bg-surface-600 text-surface-100 border border-surface-600',
  ghost:     'hover:bg-surface-700 text-surface-300 hover:text-white',
  danger:    'bg-red-600 hover:bg-red-500 text-white',
}

const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  icon: Icon,
  disabled,
  ...props
}) {
  return (
    <button
      disabled={disabled}
      className={`
        inline-flex items-center gap-2 font-body font-medium rounded-xl
        transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
        ${variants[variant]} ${sizes[size]} ${className}
      `}
      {...props}
    >
      {Icon && <Icon size={15} />}
      {children}
    </button>
  )
}

// ─── Input ────────────────────────────────────────────────────────────────

export function Input({ label, error, className = '', ...props }) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-surface-300 text-xs tracking-widest uppercase font-body">
          {label}
        </label>
      )}
      <input
        className={`
          w-full bg-surface-700 border rounded-xl px-4 py-2.5 text-white text-sm
          font-body placeholder-surface-500
          focus:outline-none focus:ring-1 transition-all duration-200
          ${error
            ? 'border-red-500 focus:border-red-500 focus:ring-red-500/30'
            : 'border-surface-600 focus:border-brand-500 focus:ring-brand-500/30'
          }
          ${className}
        `}
        {...props}
      />
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}

// ─── Select ───────────────────────────────────────────────────────────────

export function Select({ label, error, children, className = '', ...props }) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-surface-300 text-xs tracking-widest uppercase font-body">
          {label}
        </label>
      )}
      <select
        className={`
          w-full bg-surface-700 border rounded-xl px-4 py-2.5 text-white text-sm
          font-body focus:outline-none focus:ring-1 transition-all duration-200 cursor-pointer
          ${error
            ? 'border-red-500 focus:border-red-500 focus:ring-red-500/30'
            : 'border-surface-600 focus:border-brand-500 focus:ring-brand-500/30'
          }
          ${className}
        `}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────

const badgeColors = {
  orange:  'bg-brand-500/15 text-brand-400 border-brand-500/30',
  green:   'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  blue:    'bg-blue-500/15 text-blue-400 border-blue-500/30',
  red:     'bg-red-500/15 text-red-400 border-red-500/30',
  yellow:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  gray:    'bg-surface-600/30 text-surface-300 border-surface-600',
}

export function Badge({ children, color = 'gray' }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-body border ${badgeColors[color]}`}>
      {children}
    </span>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────

export function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface-800 border border-surface-700 rounded-2xl ${className}`}>
      {children}
    </div>
  )
}

// ─── PageHeader ───────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-8 animate-slide-up">
      <div>
        <p className="text-brand-500 text-xs font-mono tracking-[0.3em] uppercase mb-1">
          {subtitle}
        </p>
        <h1 className="font-display text-4xl text-white tracking-widest">
          {title.toUpperCase()}
        </h1>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────

export function Table({ headers, children, empty }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm font-body">
        <thead>
          <tr className="border-b border-surface-700">
            {headers.map((h) => (
              <th
                key={h}
                className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
        </tbody>
      </table>
      {empty && (
        <div className="text-center py-16 text-surface-500 font-body">
          {empty}
        </div>
      )}
    </div>
  )
}

export function Tr({ children, onClick, className = '' }) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-surface-700/50 transition-colors duration-150
                  ${onClick ? 'cursor-pointer hover:bg-surface-700/40' : ''}
                  ${className}`}
    >
      {children}
    </tr>
  )
}

export function Td({ children, className = '' }) {
  return (
    <td className={`py-3 px-4 text-surface-200 ${className}`}>{children}</td>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className={`relative bg-surface-800 border border-surface-700 rounded-2xl
                    shadow-2xl w-full ${width} animate-slide-up max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between p-6 border-b border-surface-700">
          <h2 className="font-body font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="text-surface-400 hover:text-white transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────

export function Spinner() {
  return (
    <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
  )
}
