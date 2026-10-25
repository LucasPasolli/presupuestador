// src/components/presupuestos/BorradorBanner.jsx
import { Info, AlertTriangle } from 'lucide-react'
import { Button } from '../ui'
import { formatearAntiguedad } from '../../lib/borradorPresupuesto'

const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)

/**
 * @param {import('../../lib/borradorPresupuesto').CambioBorrador} c
 * @returns {{ texto: string, grave: boolean }}
 */
function describirCambio(c) {
  switch (c.tipo) {
    case 'precio':
      return { grave: false, texto: `${c.nombre}: el precio pasó de ${fmt(c.anterior)} a ${fmt(c.actual)}.` }
    case 'no_disponible':
      return { grave: true, texto: `${c.nombre}: ya no está disponible. Quitalo para poder guardar.` }
    case 'cliente_no_disponible':
      return { grave: true, texto: `El cliente ${c.nombre} ya no está disponible. Elegí otro cliente.` }
    default:
      return { grave: false, texto: '' }
  }
}

/**
 * Aviso persistente (no es un toast: el usuario necesita tiempo para leer qué
 * cambió) que informa que se restauró un borrador y detalla las diferencias
 * con el catálogo vigente.
 *
 * Accesibilidad: `role="status"` + `aria-live="polite"` → los lectores de
 * pantalla anuncian el resultado de la verificación sin robar el foco.
 *
 * @param {object} props
 * @param {{ guardadoEn: number, cambios: import('../../lib/borradorPresupuesto').CambioBorrador[], noVerificados: number, totalAnterior: number|null, totalActual: number|null }} props.aviso
 * @param {boolean}  props.verificando   `true` mientras se contrasta con el catálogo.
 * @param {() => void} props.onCerrar
 * @param {() => void} props.onDescartar
 */
export default function BorradorBanner({ aviso, verificando, onCerrar, onDescartar }) {
  const cambios = aviso.cambios.map(describirCambio).filter((c) => c.texto)
  const hayGraves = cambios.some((c) => c.grave)
  const Icono = hayGraves ? AlertTriangle : Info

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-2xl border px-5 py-4 space-y-3 animate-slide-up motion-reduce:animate-none
        ${hayGraves ? 'bg-yellow-900/20 border-yellow-500/40' : 'bg-brand-500/10 border-brand-500/30'}`}
    >
      <div className="flex items-start gap-3">
        <Icono size={18} className={`mt-0.5 flex-shrink-0 ${hayGraves ? 'text-yellow-400' : 'text-brand-400'}`} aria-hidden="true" />
        <div className="flex-1 min-w-0 space-y-2">
          <p className="text-white text-sm font-body font-medium">
            Recuperamos tu borrador
            <span className="text-surface-400 font-normal"> · guardado {formatearAntiguedad(aviso.guardadoEn)}</span>
          </p>

          {verificando && (
            <p className="flex items-center gap-2 text-surface-300 text-xs font-body">
              <span className="w-3 h-3 border-2 border-brand-500/30 border-t-brand-400 rounded-full animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Verificando precios y disponibilidad…
            </p>
          )}

          {!verificando && cambios.length === 0 && aviso.noVerificados === 0 && aviso.totalAnterior == null && (
            <p className="text-surface-300 text-xs font-body">Precios y productos verificados: no hubo cambios.</p>
          )}

          {cambios.length > 0 && (
            <ul className="space-y-1">
              {cambios.map((c, i) => (
                <li key={i} className={`text-xs font-body ${c.grave ? 'text-yellow-300' : 'text-surface-200'}`}>
                  • {c.texto}
                </li>
              ))}
            </ul>
          )}

          {aviso.totalAnterior != null && aviso.totalActual != null && (
            <p className="text-surface-200 text-xs font-body">
              El total cambió de <span className="font-mono">{fmt(aviso.totalAnterior)}</span> a{' '}
              <span className="font-mono">{fmt(aviso.totalActual)}</span> por la actualización de precios o promociones.
            </p>
          )}

          {aviso.noVerificados > 0 && (
            <p className="text-yellow-300 text-xs font-body">
              No pudimos verificar {aviso.noVerificados === 1 ? '1 elemento' : `${aviso.noVerificados} elementos`} (¿sin
              conexión?). Los precios podrían estar desactualizados; revisalos antes de guardar.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onDescartar}
          className="px-3 py-1.5 rounded-lg text-xs font-body text-red-400 hover:text-red-300 hover:bg-red-500/10
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors"
        >
          Descartar borrador
        </button>
        {!verificando && (
          <Button size="sm" variant="secondary" onClick={onCerrar}>Entendido</Button>
        )}
      </div>
    </div>
  )
}
