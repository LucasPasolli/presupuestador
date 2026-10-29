// src/components/facturas/DetalleFactura.jsx
// Piezas del detalle de un comprobante, compartidas por las tres variantes de
// layout. Mismos datos en todos los anchos (paridad funcional): sólo cambia la
// disposición.
import { Badge } from '../ui'
import {
  ESTADO_COLOR, ESTADO_LABEL, estadoDe, fechaDe, fmt, fmtFecha, totalesComprobante,
} from '../../lib/facturas'

/** @param {{comprobante: import('../../lib/facturas').Comprobante}} props */
export function EstadoBadge({ comprobante }) {
  const e = estadoDe(comprobante)
  return <Badge color={ESTADO_COLOR[e] ?? 'gray'}>{ESTADO_LABEL[e] ?? e}</Badge>
}

const nombreItem = (it) => it.nombreProducto ?? `#${it.idProducto}`

/**
 * @param {object} props
 * @param {import('../../lib/facturas').ItemFactura[]} props.items
 * @param {'lista'|'tabla'|'escritorio'} props.variante
 *   lista      → mobile: filas apiladas, sin ningún scroll horizontal.
 *   tabla      → tablet: tabla con tipografía legible al tacto.
 *   escritorio → tabla compacta original.
 */
export function ItemsFactura({ items, variante }) {
  if (variante === 'lista') {
    return (
      <ul className="font-body">
        {items.map((it, i) => (
          <li key={i} className="py-3 border-b border-surface-700/50 last:border-0">
            <p className="text-white text-base break-words">{nombreItem(it)}</p>
            <p className="mt-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="text-surface-400 font-mono tabular-nums">
                {it.cantidad} × {fmt(it.precioNeto)}
              </span>
              <span className="text-surface-100 font-mono font-semibold tabular-nums">{fmt(it.subtotalNeto)}</span>
            </p>
          </li>
        ))}
      </ul>
    )
  }

  const esc = variante === 'escritorio'
  const celda = esc ? 'py-1.5' : 'py-3'
  return (
    <div className="overflow-x-auto">
      <table className={`w-full font-body ${esc ? 'text-xs' : 'text-sm'}`}>
        <thead>
          <tr className="border-b border-surface-700/30 text-surface-400">
            <th scope="col" className={`text-left ${celda} px-4 font-body font-normal`}>Producto</th>
            <th scope="col" className={`text-center ${celda} px-2 font-body font-normal`}>Cant.</th>
            <th scope="col" className={`text-right ${celda} px-2 font-body font-normal`}>P.Unit s/IVA</th>
            <th scope="col" className={`text-right ${celda} px-4 font-body font-normal`}>Subtotal s/IVA</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-b border-surface-700/20 last:border-0 text-surface-200">
              <td className={`${celda} px-4`}>{nombreItem(it)}</td>
              <td className={`${celda} px-2 text-center font-mono tabular-nums`}>{it.cantidad}</td>
              <td className={`${celda} px-2 text-right font-mono tabular-nums`}>{fmt(it.precioNeto)}</td>
              <td className={`${celda} px-4 text-right font-mono tabular-nums`}>{fmt(it.subtotalNeto)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Neto, IVA y total. En un pago parcial sólo se muestra el total. */
export function TotalesFactura({ comprobante }) {
  const { neto, iva, total } = totalesComprobante(comprobante)
  const Fila = ({ label, valor, fuerte }) => (
    <div className={`flex items-baseline justify-between gap-4 ${fuerte ? 'pt-2 mt-1 border-t border-surface-700' : ''}`}>
      <dt className={fuerte ? 'text-surface-100 font-semibold' : 'text-surface-400'}>{label}</dt>
      <dd className={`font-mono tabular-nums ${fuerte ? 'text-brand-400 font-bold text-base' : 'text-surface-200'}`}>
        {fmt(valor)}
      </dd>
    </div>
  )
  return (
    <dl className="ml-auto w-full max-w-xs space-y-1 text-sm font-body px-4 py-2">
      {neto !== null && <Fila label="Subtotal sin IVA" valor={neto} />}
      {iva  !== null && <Fila label="IVA 21%" valor={iva} />}
      <Fila label="Total con IVA" valor={total} fuerte />
    </dl>
  )
}

function Dato({ label, children, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-surface-400 text-sm font-body">{label}</dt>
      <dd className="mt-0.5 text-white text-base font-body break-words">{children}</dd>
    </div>
  )
}

/**
 * Contenido del panel de detalle (mobile / tablet): cabecera, ítems, impuestos
 * y totales.
 * @param {object} props
 * @param {import('../../lib/facturas').GrupoCliente} props.cliente
 * @param {import('../../lib/facturas').Comprobante} props.comprobante
 * @param {boolean} props.esMobile
 */
export default function DetalleFactura({ cliente, comprobante, esMobile }) {
  const items = comprobante.items ?? []
  return (
    <div className="space-y-6 pb-2">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
        <Dato label="Número"><span className="font-mono tabular-nums">#{comprobante.idPresupuesto}</span></Dato>
        <Dato label="Fecha">{fmtFecha(fechaDe(comprobante))}</Dato>
        <Dato label="Estado"><EstadoBadge comprobante={comprobante} /></Dato>
        <Dato label="Cliente" className="col-span-2">{cliente.nombre}</Dato>
        <Dato label="CUIT"><span className="font-mono tabular-nums">{cliente.cuit || '—'}</span></Dato>
      </dl>

      <section aria-label="Ítems">
        <h3 className="text-surface-100 font-body font-semibold text-base mb-1">Ítems</h3>
        {comprobante.tipo === 'pago_parcial' ? (
          <p className="text-surface-400 text-sm font-body py-2">
            Cobro puntual: los ítems figuran en el presupuesto original.
          </p>
        ) : items.length === 0 ? (
          <p className="text-surface-500 text-sm font-body py-2">Sin ítems registrados.</p>
        ) : (
          <ItemsFactura items={items} variante={esMobile ? 'lista' : 'tabla'} />
        )}
      </section>

      <section aria-label="Totales" className="rounded-xl bg-surface-800 border border-surface-700">
        <TotalesFactura comprobante={comprobante} />
      </section>
    </div>
  )
}
