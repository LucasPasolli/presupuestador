// src/components/estadisticas/KpiCard.jsx
// Tarjeta de indicador (Escenario 3). Valores y títulos NUNCA se truncan: el
// texto hace wrap (`break-words` + overflow-wrap:anywhere como red de seguridad).
// Con `onClick` se renderiza como <button> real (teclado + lectores de pantalla).

const COLORES = {
  brand:  'text-brand-400  bg-brand-500/10  border-brand-500/20',
  green:  'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  yellow: 'text-yellow-400  bg-yellow-500/10  border-yellow-500/20',
  red:    'text-red-400     bg-red-500/10     border-red-500/20',
  blue:   'text-blue-400    bg-blue-500/10    border-blue-500/20',
  violet: 'text-violet-400  bg-violet-500/10  border-violet-500/20',
}

const TONOS = {
  positivo: 'bg-emerald-500/10 border-emerald-500/40 shadow-[0_0_25px_rgba(16,185,129,0.18)]',
  negativo: 'bg-red-500/10 border-red-500/40 shadow-[0_0_25px_rgba(239,68,68,0.15)]',
}

/**
 * @param {object} props
 * @param {React.ComponentType<{size?:number}>} props.icon
 * @param {string} props.label
 * @param {React.ReactNode} props.value
 * @param {React.ReactNode} [props.sub]
 * @param {keyof typeof COLORES} [props.color]
 * @param {number} [props.trend]
 * @param {()=>void} [props.onClick]          Drill-down: renderiza un <button>.
 * @param {string} [props.drillDownLabel]
 * @param {'positivo'|'negativo'} [props.tono] Resalta la tarjeta (antes se deducía buscando '-' en el texto).
 */
export default function KpiCard({
  icon: Icon, label, value, sub, color = 'brand', trend, onClick, drillDownLabel, tono,
}) {
  const clickeable = typeof onClick === 'function'
  const Wrapper = clickeable ? 'button' : 'div'
  const texto = COLORES[color].split(' ')[0]

  return (
    <Wrapper
      {...(clickeable ? { type: 'button', onClick } : {})}
      aria-label={clickeable ? `${label}: ${value}. ${drillDownLabel ?? 'Ver detalle'}.` : undefined}
      className={`w-full min-w-0 text-left rounded-2xl p-4 sm:p-5 flex flex-col gap-3 border transition-all
        ${clickeable
          ? 'cursor-pointer min-h-[44px] hover:border-brand-500/40 hover:bg-surface-700/50 active:scale-[0.98] ' +
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60'
          : ''}
        ${tono ? TONOS[tono] : 'bg-surface-800 border-surface-700'}`}
    >
      <span className="flex items-center justify-between">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center border ${COLORES[color]}`}>
          <Icon size={17} />
        </span>
        {trend !== undefined && (
          <span className={`text-xs font-mono ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </span>
      <span className="block min-w-0">
        <span className="block text-surface-400 text-xs uppercase tracking-widest font-body mb-1 break-words">{label}</span>
        <span className={`block font-display text-2xl min-[1400px]:text-3xl tracking-wider sm:tracking-widest
                          break-words [overflow-wrap:anywhere] ${texto}`}>
          {value}
        </span>
        {sub && <span className="block text-surface-500 text-xs font-body mt-1 break-words">{sub}</span>}
        {clickeable && (
          <span className="flex items-center gap-1 text-brand-400/80 text-xs font-body mt-2" aria-hidden="true">
            {drillDownLabel ?? 'Ver detalle'} <span>→</span>
          </span>
        )}
      </span>
    </Wrapper>
  )
}

/** Grilla de KPIs: 1 columna en mobile, 2 en tablet, 4 en escritorio. */
export function KpiGrid({ children, label }) {
  return (
    <section aria-label={label}
      className="grid grid-cols-1 md:grid-cols-2 min-[1025px]:grid-cols-4 gap-3 sm:gap-4">
      {children}
    </section>
  )
}
