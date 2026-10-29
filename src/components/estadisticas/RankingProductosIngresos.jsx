// src/components/estadisticas/RankingProductosIngresos.jsx
// Ranking de productos por ingresos, paginado (20 por página). Usa TablaResponsive
// y el PaginadorTabla compartido; el scroll vuelve al inicio de la tabla solo
// como consecuencia de un clic real (useScrollAnchor, imperativo).

import { useMemo } from 'react'
import { DollarSign } from 'lucide-react'
import { Card } from '../ui'
import PaginadorTabla from '../ui/PaginadorTabla'
import TablaResponsive from './TablaResponsive'
import { useOrdenYPagina } from '../../hooks/useOrdenYPagina'
import { useScrollAnchor } from '../../hooks/useScrollToTopOnChange'
import { fmt, fmtFecha } from './formatters'

const PAGE_SIZE = 20

const colorRank = (n) => (n === 1 ? 'text-yellow-400' : n === 2 ? 'text-surface-300' : n === 3 ? 'text-brand-400' : 'text-surface-600')

export default function RankingProductosIngresos({ productos, desde, hasta }) {
  const { anchorRef, scrollToStart } = useScrollAnchor()
  // `productos` cambia de referencia solo al cambiar el período → el hook vuelve a la página 1 por clamp/orden.
  const tabla = useOrdenYPagina(productos, { pageSize: PAGE_SIZE })

  const columnas = useMemo(() => [
    { key: 'rank', label: '#', rol: 'rank', thClassName: 'w-10',
      render: (_, { rank }) => <span className={`font-mono text-xs font-bold ${colorRank(rank)}`}>{rank}</span> },
    { key: 'nombre', label: 'Producto', rol: 'titulo',
      render: (p, { rank }) => <span className={`${rank <= 3 ? 'text-white font-medium' : 'text-surface-200'} break-words`}>{p.nombre}</span> },
    { key: 'unidades', label: 'Unidades', align: 'right', rol: 'clave',
      render: (p) => <span className="font-mono text-surface-300">{p.unidades} u.</span> },
    { key: 'monto', label: 'Ingresos', align: 'right', rol: 'clave',
      render: (p, { rank }) => <span className={`font-mono font-bold ${rank <= 3 ? 'text-brand-400' : 'text-surface-200'}`}>{fmt(p.monto)}</span> },
  ], [])

  const n = productos.length
  return (
    <div ref={anchorRef}>
      <Card className="min-w-0 overflow-hidden">
        <div className="p-4 sm:p-6 pb-2 sm:pb-3">
          <h3 className="font-body font-semibold text-white text-sm mb-1 flex items-center gap-2">
            <DollarSign size={15} className="text-brand-500 flex-shrink-0" />
            Productos con más ingresos
          </h3>
          <p className="text-surface-500 text-xs font-body break-words">
            {fmtFecha(desde)} → {fmtFecha(hasta)} · ordenado por monto facturado (cantidad × precio de venta)
            {n > 0 && ` · ${n} producto${n !== 1 ? 's' : ''} con ventas`}
          </p>
        </div>

        {n === 0 ? (
          <p className="text-surface-500 text-sm font-body py-8 px-4 text-center">
            No hay datos disponibles para el período seleccionado.
          </p>
        ) : (
          <>
            <TablaResponsive caption="Productos con más ingresos" columnas={columnas} filas={tabla.pageItems}
              offset={tabla.offset} getKey={(p, i) => `${p.idProducto ?? p.nombre}-${tabla.offset + i}`} />
            <PaginadorTabla page={tabla.page} totalPages={tabla.totalPages} pageSize={tabla.pageSize}
              total={tabla.total} onChange={(p) => { tabla.setPage(p); scrollToStart() }} />
          </>
        )}
      </Card>
    </div>
  )
}
