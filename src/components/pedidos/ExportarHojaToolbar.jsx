// src/components/pedidos/ExportarHojaToolbar.jsx
// Barra de configuración de la exportación "Hoja de recepción" (PDF).
// Componente presentacional: no conoce el servicio ni el estado del pedido;
// recibe todo por props (fácil de testear y reutilizar).

import { AlertCircle, ListChecks, Printer } from 'lucide-react'
import { Button } from '../ui'

/**
 * @param {Object}   props
 * @param {number}   props.total             Ítems del pedido.
 * @param {number}   props.seleccionados     Ítems marcados.
 * @param {boolean}  props.todos             Todos marcados (define el rótulo del botón global).
 * @param {boolean}  props.listarCantidad    Opción "Listar cantidad".
 * @param {boolean}  props.generando         PDF en proceso (bloquea doble clic).
 * @param {string}   [props.error]           Mensaje a mostrar (sin selección / fallo).
 * @param {()=>void} props.onToggleTodos
 * @param {(v:boolean)=>void} props.onCambiarCantidad
 * @param {()=>void} props.onExportar
 */
export default function ExportarHojaToolbar({
  total, seleccionados, todos, listarCantidad, generando, error,
  onToggleTodos, onCambiarCantidad, onExportar,
}) {
  return (
    <div className="px-6 py-4 border-b border-surface-700 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Button size="sm" variant="secondary" icon={ListChecks} onClick={onToggleTodos}
            aria-pressed={todos}>
            {todos ? 'Deseleccionar todos' : 'Seleccionar todos'}
          </Button>

          {/* aria-live: los lectores de pantalla anuncian el cambio del contador */}
          <span className="text-surface-300 text-xs font-mono" role="status" aria-live="polite">
            {seleccionados} de {total} seleccionado{seleccionados !== 1 ? 's' : ''}
          </span>

          <label className="flex items-center gap-2 text-surface-200 text-sm font-body cursor-pointer select-none">
            <input
              type="checkbox"
              checked={listarCantidad}
              onChange={(e) => onCambiarCantidad(e.target.checked)}
              className="h-4 w-4 rounded accent-brand-500 focus-visible:outline-none
                         focus-visible:ring-2 focus-visible:ring-brand-400"
            />
            Listar cantidad
          </label>
        </div>

        <Button size="sm" variant="secondary" icon={Printer} onClick={onExportar}
          disabled={generando} aria-busy={generando}>
          {generando ? 'Generando…' : 'Exportar PDF'}
        </Button>
      </div>

      <p className="text-surface-500 text-xs font-body">
        Datos por ítem: Código, Producto y Medida{listarCantidad ? ' y Cantidad' : ''}.
      </p>

      {error && (
        <div role="alert"
          className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20
                     rounded-xl px-4 py-2.5 font-body">
          <AlertCircle size={15} className="flex-shrink-0" />{error}
        </div>
      )}
    </div>
  )
}
