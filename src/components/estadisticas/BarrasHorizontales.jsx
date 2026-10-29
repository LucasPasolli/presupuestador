// src/components/estadisticas/BarrasHorizontales.jsx
// Gráfico de barras horizontales sin librería. Reemplaza el <BarraH> que se
// repetía 5 veces. Las etiquetas NO se truncan: en mobile ocupan su propia línea
// y hacen wrap; desde `sm` se ubican a la izquierda del valor. La barra escala
// con el ancho disponible (width en %), así que rotar el equipo la redibuja sola.

import { fmt } from './formatters'

/**
 * @param {object} props
 * @param {{label:string, value:number, sublabel?:string}[]} props.items
 * @param {(v:number)=>string} [props.fmtFn]
 * @param {[string,string]} [props.colores]  [1.er puesto, puestos 2–3]; el resto en gris.
 */
export default function BarrasHorizontales({ items, fmtFn = fmt, colores = ['#f97316', '#fb923c'] }) {
  const max = items.reduce((a, it) => Math.max(a, it.value), 0)
  return (
    <ul className="space-y-3">
      {items.map((it, i) => {
        const ancho = max > 0 ? Math.max(2, (it.value / max) * 100) : 0
        const color = i === 0 ? colores[0] : i < 3 ? colores[1] : '#6b7280'
        return (
          <li key={`${it.label}-${i}`} className="space-y-1">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3
                            text-sm min-[1025px]:text-xs font-body">
              <span className="min-w-0 sm:flex-1 text-surface-200 break-words">{it.label}</span>
              <span className="sm:text-right sm:flex-shrink-0">
                <span className="text-white font-mono">{fmtFn(it.value)}</span>
                {it.sublabel && <span className="text-surface-500 ml-2">{it.sublabel}</span>}
              </span>
            </div>
            <div className="h-2 bg-surface-700 rounded-full overflow-hidden" aria-hidden="true">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${ancho}%`, backgroundColor: color }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
