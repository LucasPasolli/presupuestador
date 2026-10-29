// src/components/facturas/ResumenPeriodo.jsx
// Dos tarjetas-resumen (Transferencia+CC / Efectivo). Cada una tiene DOS
// controles hermanos —seleccionar y descargar—, no uno dentro del otro: un
// botón anidado en un div clickeable no es operable con teclado ni lector de
// pantalla.
import { Download } from 'lucide-react'
import { Button } from '../ui'
import { fmt, totalesGrupos } from '../../lib/facturas'
import { FOCO, TOQUE } from './estilos'

const TIPOS = [
  { tipo: 'noEfectivo', label: 'Transferencia + CC' },
  { tipo: 'efectivo',   label: 'Efectivo' },
]

/**
 * @param {object} props
 * @param {{noEfectivo: import('../../lib/facturas').GrupoCliente[], efectivo: import('../../lib/facturas').GrupoCliente[]}} props.datos
 * @param {'noEfectivo'|'efectivo'} props.activo
 * @param {(tipo: 'noEfectivo'|'efectivo') => void} props.onSeleccionar
 * @param {(tipo: 'noEfectivo'|'efectivo') => Promise<unknown>} props.onDescargar
 * @param {boolean} props.generando
 * @param {boolean} props.filtrado  Hay filtros activos: los importes son parciales.
 */
export default function ResumenPeriodo({ datos, activo, onSeleccionar, onDescargar, generando, filtrado }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4" role="group" aria-label="Resumen del período">
      {TIPOS.map(({ tipo, label }) => {
        const grupos = datos[tipo]
        const { total, clientes, comprobantes } = totalesGrupos(grupos)
        const activa = activo === tipo
        return (
          <div key={tipo}
            className={`flex items-start gap-3 bg-surface-800 border rounded-2xl p-3 sm:p-5 transition-colors duration-200
              ${activa ? 'border-brand-500/50 bg-brand-500/5' : 'border-surface-700'}`}>
            <button type="button" aria-pressed={activa} onClick={() => onSeleccionar(tipo)}
              className={`flex-1 min-w-0 min-h-[44px] text-left rounded-xl p-1 -m-1 ${FOCO}`}>
              <span className="block text-surface-400 text-sm min-[1025px]:text-xs uppercase tracking-widest font-body">
                {label}
              </span>
              <span className="block text-brand-400 font-mono font-bold text-xl mt-1 tabular-nums break-words">
                {fmt(total)}
              </span>
              <span className="block mt-2 text-surface-400 text-sm min-[1025px]:text-xs font-body">
                {clientes} cliente{clientes !== 1 ? 's' : ''} · {comprobantes} presupuesto{comprobantes !== 1 ? 's' : ''}
                {filtrado && ' · filtrado'}
              </span>
            </button>
            <Button size="sm" icon={Download} className={`${TOQUE} flex-shrink-0`}
              loading={generando} disabled={grupos.length === 0}
              aria-label={`Descargar PDF de ${label}`}
              onClick={() => onDescargar(tipo)}>
              PDF
            </Button>
          </div>
        )
      })}
    </div>
  )
}
