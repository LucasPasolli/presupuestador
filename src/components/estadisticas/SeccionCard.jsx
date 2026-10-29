// src/components/estadisticas/SeccionCard.jsx
// Card con encabezado estándar (ícono + título + acción opcional). Unifica el
// bloque <h3> que se copiaba en ~12 tarjetas. La acción es un <Button> real
// (antes la tarjeta entera era un <div onClick> inaccesible por teclado).

import { Card, Button } from '../ui'

/**
 * @param {object} props
 * @param {React.ComponentType<{size?:number,className?:string}>} [props.icon]
 * @param {string} [props.iconClassName]
 * @param {string} props.titulo
 * @param {React.ReactNode} [props.descripcion]
 * @param {{label:string, onClick:()=>void}} [props.accion]
 */
export default function SeccionCard({ icon: Icon, iconClassName = 'text-brand-500', titulo, descripcion, accion, className = '', children }) {
  return (
    <Card className={`p-4 sm:p-6 min-w-0 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="font-body font-semibold text-white text-sm flex items-center gap-2">
            {Icon && <Icon size={15} className={`flex-shrink-0 ${iconClassName}`} />}
            <span className="min-w-0 break-words">{titulo}</span>
          </h3>
          {descripcion && <p className="text-surface-500 text-xs font-body mt-1 break-words">{descripcion}</p>}
        </div>
        {accion && (
          <Button variant="ghost" onClick={accion.onClick}
            className="flex-shrink-0 justify-center min-h-[44px] min-[1025px]:min-h-0">
            {accion.label} →
          </Button>
        )}
      </div>
      {children}
    </Card>
  )
}
