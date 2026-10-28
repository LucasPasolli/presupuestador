// src/components/pedidos/pedidosPresentacion.jsx
// Helpers de PRESENTACIÓN compartidos por listado, tarjetas y detalle (DRY).
// Antes vivían dentro de PedidosCompra.jsx y el badge de pago estaba duplicado.

import { CheckCircle2, Clock, Layers, Truck } from 'lucide-react'
import { Badge } from '../ui'

/** Área táctil mínima de 44 px en mobile/tablet; en escritorio no altera el diseño. */
export const TOUCH = 'min-h-[44px] min-[1025px]:min-h-0 justify-center'

export function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)
}

export function fmtFecha(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** Capitaliza la primera letra. */
export const cap = (s) => (s ? s.trim().charAt(0).toUpperCase() + s.trim().slice(1) : '')

/** Label legible del método de pago (único punto de verdad). */
export function metodoPagoLabel(pedido) {
  if (pedido.metodoPago === 'echeck') return 'E-Check (CC30)'
  if (pedido.metodoPago === 'cuenta_corriente') return pedido.tieneCuotas ? 'CC Cuotas' : 'CC'
  return pedido.metodoPago ? cap(pedido.metodoPago) : '—'
}

export const ESTADO_CONFIG = {
  encargado: { label: 'Encargado', color: 'blue',   icon: Clock },
  recibido:  { label: 'Recibido',  color: 'purple', icon: Truck },
}

export function EstadoLogisticoBadge({ pedido }) {
  const cfg = ESTADO_CONFIG[pedido.estadoLogistico ?? 'encargado'] ?? ESTADO_CONFIG.encargado
  return (
    <Badge color={cfg.color}>
      <cfg.icon size={11} className="inline mr-1" />{cfg.label}
    </Badge>
  )
}

/**
 * Badge de estado de pago. Para CC en cuotas usa el resumen batcheado; mientras
 * carga cae en `estadoPago` (nunca muestra "Pagado" a ciegas).
 */
export function PagoBadge({ pedido, resumen }) {
  const pagado    = <Badge color="green"><CheckCircle2 size={11} className="inline mr-1" />Pagado</Badge>
  const pendiente = <Badge color="yellow"><Clock size={11} className="inline mr-1" />Pendiente</Badge>

  if (pedido.tieneCuotas) {
    if (!resumen) return pedido.estadoPago === 'pagado' ? pagado : pendiente
    const n = resumen.cuotasPendientes
    return n > 0 ? (
      <Badge color="blue">
        <Layers size={11} className="inline mr-1" />
        {n} cuota{n !== 1 ? 's' : ''} pendiente{n !== 1 ? 's' : ''}
      </Badge>
    ) : pagado
  }
  return pedido.estadoPago === 'pendiente' ? pendiente : pagado
}
