// src/components/estadisticas/GraficoDona.jsx
// Dona SVG genérica (reemplaza GraficoDona + GraficoDonaGenerico, que eran casi
// idénticas). Responsive sin JS: el SVG usa `viewBox`, así que se redibuja al
// ancho disponible y al rotar el dispositivo. Leyenda y gráfico se reacomodan
// con flex-wrap según el ANCHO DEL CONTENEDOR (no del viewport).
//
// Mejoras sobre la versión previa:
//  · Un único segmento al 100 % se dibuja como círculo (el arco de 360° con
//    punto inicial = final no renderiza nada en SVG).
//  · Se descartan los valores ≤ 0 (no generan segmentos ni entradas de leyenda).
//  · role="img" + aria-label con el detalle; la leyenda es la alternativa textual.

import { useMemo } from 'react'

export const PALETA = ['#f97316', '#3b82f6', '#eab308', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e']

const R = 50, CX = 65, CY = 65

/**
 * @param {object} props
 * @param {{label:string, valor:number}[]} props.datos
 * @param {string[]} [props.colores]
 * @param {string} [props.unidad]          Texto bajo el número central ("métodos", "items").
 * @param {(v:number)=>string} [props.formatoValor]  Si se pasa, la leyenda muestra además el monto.
 */
export default function GraficoDona({ datos, colores = PALETA, unidad = 'items', formatoValor }) {
  const { slices, total } = useMemo(() => {
    const validos = datos.filter((d) => d.valor > 0)
    const suma = validos.reduce((a, d) => a + d.valor, 0)
    let angulo = -Math.PI / 2
    const partes = validos.map((d, i) => {
      const frac = d.valor / suma
      const ini = angulo
      angulo += frac * 2 * Math.PI
      const x1 = CX + R * Math.cos(ini),    y1 = CY + R * Math.sin(ini)
      const x2 = CX + R * Math.cos(angulo), y2 = CY + R * Math.sin(angulo)
      return {
        ...d, frac, color: colores[i % colores.length],
        completo: frac >= 0.9999,
        path: `M${CX},${CY} L${x1},${y1} A${R},${R} 0 ${frac > 0.5 ? 1 : 0},1 ${x2},${y2} Z`,
      }
    })
    return { slices: partes, total: suma }
  }, [datos, colores])

  if (slices.length === 0) {
    return <div className="flex items-center justify-center h-32 text-surface-500 text-sm font-body">Sin datos.</div>
  }

  const descripcion = slices.map((s) => `${s.label}: ${(s.frac * 100).toFixed(1)}%`).join(', ')

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
      <svg viewBox="0 0 130 130" role="img" aria-label={`Gráfico de dona. ${descripcion}`}
        className="w-40 h-40 sm:w-36 sm:h-36 flex-shrink-0">
        {slices.map((s) => (s.completo
          ? <circle key={s.label} cx={CX} cy={CY} r={R} fill={s.color} fillOpacity="0.9" stroke="#1a1a1a" strokeWidth="1.5" />
          : <path key={s.label} d={s.path} fill={s.color} fillOpacity="0.9" stroke="#1a1a1a" strokeWidth="1.5" />))}
        <circle cx={CX} cy={CY} r={R * 0.55} fill="#1a1a1a" />
        <text x={CX} y={CY + 4} textAnchor="middle" fontSize="9" fill="#a3a3a3" fontFamily="DM Sans">
          {slices.length} {unidad}
        </text>
      </svg>

      <ul className="flex-1 min-w-[12rem] space-y-2 text-sm min-[1025px]:text-xs font-body">
        {slices.map((s) => (
          <li key={s.label} className="flex items-start justify-between gap-3">
            <span className="flex items-start gap-2 min-w-0 text-surface-300">
              <span aria-hidden="true" className="w-2.5 h-2.5 mt-1 rounded-full flex-shrink-0" style={{ background: s.color }} />
              <span className="break-words">{s.label}</span>
            </span>
            <span className="text-right flex-shrink-0">
              <span className="block text-white font-mono">{(s.frac * 100).toFixed(1)}%</span>
              {formatoValor && <span className="block text-surface-400 font-mono">{formatoValor(s.valor)}</span>}
            </span>
          </li>
        ))}
      </ul>
      <span className="sr-only">Total: {formatoValor ? formatoValor(total) : total}</span>
    </div>
  )
}
