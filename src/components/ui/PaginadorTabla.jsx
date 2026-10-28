// src/components/ui/PaginadorTabla.jsx
// Paginador de listados. Reproduce EXACTAMENTE el pie de paginación de
// Inventario.jsx (mismo marcado, mismas clases, mismos rótulos) para que todas
// las pantallas paginadas se vean y se comporten igual.
//
// Debe renderizarse DENTRO del <Card> del listado: la línea divisoria
// (`border-t`) lo separa del contenido.
//   · mobile : contador centrado arriba + dos botones iguales (grid de 2 columnas).
//   · ≥ sm   : contador a la izquierda, botones a la derecha.
// Presentacional: no conoce el hook ni el scroll; avisa con `onChange(nuevaPagina)`
// y el padre decide qué más hacer (p. ej. `scrollToStart()`).

import { Button } from './index'

/** Área táctil de 44 px mientras el layout es táctil (mobile y tablet, ≤ 1024 px). */
const TOQUE = 'justify-center min-h-[44px] min-[1025px]:min-h-0'

/**
 * @param {object}   props
 * @param {number}   props.page         Página actual (1-based).
 * @param {number}   props.totalPages
 * @param {number}   props.pageSize
 * @param {number}   props.total        Total de elementos del listado ya filtrado.
 * @param {(pagina:number)=>void} props.onChange
 */
export default function PaginadorTabla({ page, totalPages, pageSize, total, onChange }) {
  if (totalPages <= 1) return null

  const desde = (page - 1) * pageSize + 1
  const hasta = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-col gap-3 px-4 sm:px-6 py-3 border-t border-surface-700 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-surface-400 text-sm min-[1025px]:text-xs font-body text-center sm:text-left"
        role="status" aria-live="polite">
        {desde}–{hasta} de {total}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button variant="secondary" className={TOQUE}
          onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1}>
          ← Anterior
        </Button>
        <Button variant="secondary" className={TOQUE}
          onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}>
          Siguiente →
        </Button>
      </div>
    </div>
  )
}
