// src/components/pedidos/PlanCuotasCC.jsx
// Editor dinámico del plan de cuotas de Cuenta Corriente para un Pedido de
// Compra. Componente controlado: no persiste nada por su cuenta — recibe
// `cuotas`/`onChange` (borrador de cuotas PENDIENTES) y le entrega al padre
// (NuevoPedido) un array listo para pasarle a calcularPlanCuotas() /
// crearPedidoConCuotas() / actualizarPlanCuotas().
//
// Soporta dos modos:
//   - Creación: bloqueadas=[] → todo el plan es editable, debe sumar 100%.
//   - Edición:  bloqueadas=[cuotas ya pagadas] → esas filas se muestran
//     sólo-lectura con candado, y el borrador editable (`cuotas`) representa
//     únicamente las PENDIENTES. La suma válida pasa a ser
//     100% - (% ya bloqueado).

import { useMemo } from 'react'
import { Plus, Trash2, AlertCircle, CheckCircle2, Lock } from 'lucide-react'
import { calcularPlanCuotas, validarPlanCuotas } from '../../services/pedidosCuotasService'

function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)
}

function fmtFecha(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export const CUOTA_EMPTY = () => ({ porcentaje: '', diasVencimiento: '' })

/**
 * @param {object}   props
 * @param {number}   props.total        total del pedido, para previsualizar montos
 * @param {object[]} props.cuotas       borrador EDITABLE de cuotas pendientes: [{ porcentaje, diasVencimiento }]
 * @param {Function} props.onChange     (nuevasCuotasPendientes) => void
 * @param {object[]} [props.bloqueadas] cuotas ya PAGADAS, sólo lectura. Shape completo
 *   (viene de obtenerCuotasDePedido): { idCuota, numeroCuota, porcentaje,
 *   diasVencimiento, monto, fechaVencimiento, fechaPago }. Nunca se pasan a onChange.
 */
export default function PlanCuotasCC({ total, cuotas, onChange, bloqueadas = [] }) {
  const hayBloqueadas = bloqueadas.length > 0

  function update(idx, key, val) {
    onChange(cuotas.map((c, i) => (i === idx ? { ...c, [key]: val } : c)))
  }
  function add()       { onChange([...cuotas, CUOTA_EMPTY()]) }
  function remove(idx) { onChange(cuotas.filter((_, i) => i !== idx)) }

  const pctBloqueado   = useMemo(() => bloqueadas.reduce((a, c) => a + Number(c.porcentaje), 0), [bloqueadas])
  const montoBloqueado = useMemo(() => bloqueadas.reduce((a, c) => a + Number(c.monto), 0), [bloqueadas])

  // "Restante" es la base sobre la que se calculan los montos de las cuotas
  // PENDIENTES — nunca el total bruto del pedido, para no pisar plata que
  // ya se cobró bajo otra base de cálculo.
  const restante = total - montoBloqueado

  const sumaPctPendiente = useMemo(
    () => cuotas.reduce((a, c) => a + (Number(c.porcentaje) || 0), 0),
    [cuotas]
  )
  const error = useMemo(() => validarPlanCuotas(cuotas, pctBloqueado), [cuotas, pctBloqueado])
  const preview = useMemo(
    () => (error ? [] : calcularPlanCuotas(
        restante,
        cuotas.map(c => ({ ...c, porcentaje: Number(c.porcentaje), diasVencimiento: Number(c.diasVencimiento) }))
      )),
    [restante, cuotas, error]
  )

  const cell = `bg-surface-700 border border-surface-600 rounded-lg px-2 py-1.5 text-white text-sm
                font-mono focus:outline-none focus:border-brand-500 transition-all
                [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`

  return (
    <div className="space-y-3">
      <p className="text-surface-300 text-xs tracking-widest uppercase font-body">Plan de cuotas</p>

      {/* Cuotas ya pagadas — inmutables, sólo lectura. No pasan por onChange
          bajo ninguna circunstancia: representan dinero ya entregado. */}
      {hayBloqueadas && (
        <div className="space-y-2">
          {bloqueadas.map((c) => (
            <div key={c.idCuota ?? c.numeroCuota}
              className="flex items-center gap-2 bg-surface-900/50 rounded-xl p-2 opacity-70">
              <span className="text-surface-500 text-xs font-mono w-14 flex-shrink-0 text-center">
                Cuota {c.numeroCuota}
              </span>
              <span className="flex-1 text-surface-400 text-sm font-mono text-right pr-2">
                {c.porcentaje}%
              </span>
              <span className="flex-1 text-surface-400 text-sm font-mono text-right pr-2">
                {fmtFecha(c.fechaVencimiento)}
              </span>
              <span className="text-surface-300 text-xs font-mono w-24 text-right flex-shrink-0">
                {fmt(c.monto)}
              </span>
              <span className="flex items-center gap-1 text-emerald-500 text-xs flex-shrink-0 w-24 justify-end">
                <Lock size={12} /> Pagada
              </span>
            </div>
          ))}
          <p className="text-surface-500 text-xs font-body pl-1">
            Estas cuotas ya fueron cobradas y no pueden modificarse. Sólo se editan las pendientes de abajo.
          </p>
        </div>
      )}

      {/* Cuotas pendientes — editables */}
      <div className="space-y-2">
        {cuotas.map((c, idx) => {
          const montoPreview = preview[idx]?.monto
          return (
            <div key={idx} className="flex items-center gap-2 bg-surface-800/60 rounded-xl p-2">
              <span className="text-surface-500 text-xs font-mono w-14 flex-shrink-0 text-center">
                Cuota {bloqueadas.length + idx + 1}
              </span>

              <div className="flex-1">
                <label className="sr-only">Porcentaje</label>
                <div className="relative">
                  <input
                    type="text" inputMode="decimal"
                    value={c.porcentaje}
                    onChange={e => {
                      const v = e.target.value.replace(',', '.')
                      if (/^\d*\.?\d*$/.test(v)) update(idx, 'porcentaje', v)
                    }}
                    placeholder="0"
                    className={cell + ' w-full pr-6 text-right'}
                    aria-label={`Porcentaje cuota pendiente ${idx + 1}`}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 text-xs pointer-events-none">%</span>
                </div>
              </div>

              <div className="flex-1">
                <label className="sr-only">Días de vencimiento</label>
                <div className="relative">
                  <input
                    type="text" inputMode="numeric"
                    value={c.diasVencimiento}
                    onChange={e => update(idx, 'diasVencimiento', e.target.value.replace(/\D/g, ''))}
                    placeholder="30"
                    className={cell + ' w-full pr-10 text-right'}
                    aria-label={`Días de vencimiento cuota pendiente ${idx + 1}`}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 text-xs pointer-events-none">días</span>
                </div>
              </div>

              <span className="text-surface-300 text-xs font-mono w-24 text-right flex-shrink-0">
                {montoPreview !== undefined ? fmt(montoPreview) : '—'}
              </span>

              <button type="button" onClick={() => remove(idx)}
                disabled={cuotas.length <= 1}
                className="text-surface-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-1 rounded flex-shrink-0"
                aria-label={`Eliminar cuota pendiente ${idx + 1}`}>
                <Trash2 size={14} />
              </button>
            </div>
          )
        })}
      </div>

      <button type="button" onClick={add}
        className="flex items-center gap-2 text-brand-400 hover:text-brand-300 text-sm font-body transition-colors">
        <Plus size={14} /> Agregar cuota pendiente
      </button>

      {/* Estado de validación en tiempo real */}
      <div
        role="status"
        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-body border
          ${error
            ? 'bg-red-500/10 border-red-500/30 text-red-400'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'}`}>
        {error ? <AlertCircle size={13} className="flex-shrink-0" /> : <CheckCircle2 size={13} className="flex-shrink-0" />}
        <span>
          {error ?? (hayBloqueadas
            ? `Plan completo: ${pctBloqueado.toFixed(2)}% pagado + ${sumaPctPendiente.toFixed(2)}% pendiente = 100%.`
            : `Plan completo: ${sumaPctPendiente.toFixed(2)}% del total (${fmt(total)}).`)}
        </span>
      </div>
    </div>
  )
}
