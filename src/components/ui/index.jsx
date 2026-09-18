// src/components/ui/index.jsx
// Shared primitive components used throughout the app.
//
// ⚠️  REEMPLAZO DIRECTO del archivo actual. La API pública NO cambia:
//     todos los exports previos (Button, Input, Select, Badge, Card,
//     PageHeader, Table, Tr, Td, Modal, Spinner) se mantienen con la misma
//     firma. Los 125 usos de <Button> del proyecto quedan protegidos contra
//     doble clic sin tocar una sola página.
//
// Decisión de arquitectura: el control de concurrencia vive en el componente
// (Decorator sobre `onClick`), no en cada página. Es el único punto del árbol
// por el que pasan todas las acciones destructivas/creadoras del sistema, así
// que es el lugar correcto según DRY y el principio Open/Closed: las páginas
// no se modifican, el comportamiento se extiende desde afuera.
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { esPromesa, MIN_PENDING_MS, DEFAULT_TIMEOUT_MS } from '../../hooks/useAsyncAction'
import { logger } from '../../lib/logger'

// ─── Button ───────────────────────────────────────────────────────────────

const variants = {
  primary:   'bg-brand-500 hover:bg-brand-400 active:bg-brand-600 text-white',
  secondary: 'bg-surface-700 hover:bg-surface-600 text-surface-100 border border-surface-600',
  ghost:     'hover:bg-surface-700 text-surface-300 hover:text-white',
  danger:    'bg-red-600 hover:bg-red-500 text-white',
}

const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
}

const spinnerSizes = { sm: 'w-3 h-3', md: 'w-3.5 h-3.5', lg: 'w-4 h-4' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Botón con protección de re-entrada incorporada.
 *
 * COMPORTAMIENTO
 * --------------
 * • Si `onClick` devuelve una promesa (toda `async function` lo hace), el botón
 *   entra en estado "ocupado": muestra spinner, marca `aria-busy` e IGNORA
 *   cualquier clic posterior hasta que la promesa se resuelva o rechace.
 * • Si `onClick` es síncrono (`() => setModal(true)`), el comportamiento es
 *   idéntico al actual: cero regresiones en paginadores, filtros o toggles.
 *
 * POR QUÉ UN `useRef` Y NO SOLO `useState`
 * ----------------------------------------
 * `setState` es asíncrono. Entre el primer clic y el re-render que aplica
 * `disabled` hay una ventana de ~1 frame en la que el navegador puede entregar
 * un segundo `click`. El ref se escribe en el mismo tick del evento, así que
 * la ventana es cero. Esta es la diferencia entre "casi nunca duplica" y
 * "no puede duplicar".
 *
 * ACCESIBILIDAD (WCAG 2.1 AA)
 * ---------------------------
 * Mientras está ocupado se usa `aria-disabled` en lugar del atributo nativo
 * `disabled`. Un botón nativamente deshabilitado pierde el foco y desaparece
 * del árbol de accesibilidad: el usuario de lector de pantalla queda sin
 * contexto justo en el momento crítico. Con `aria-disabled` el foco se
 * conserva y la región `role="status"` anuncia el progreso (4.1.3 Status
 * Messages). El clic igualmente se bloquea por código.
 *
 * @param {import('./index').ButtonProps} props
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  icon: Icon,
  disabled = false,
  /** Fuerza el estado de carga desde afuera (compatible con `disabled={loading}`). */
  loading = false,
  /** Texto accesible anunciado mientras se procesa. */
  loadingText = 'Procesando, aguardá un momento',
  /** `button` por defecto: evita submits accidentales de formularios ancestros. */
  type = 'button',
  /** Escotilla de escape: `guard={false}` restaura el comportamiento crudo. */
  guard = true,
  /** Duración mínima del spinner (ms). Evita el parpadeo en respuestas veloces. */
  minPendingMs = MIN_PENDING_MS,
  /** Watchdog: libera el bloqueo si el backend nunca responde. */
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onClick,
  onError,
  ...props
}) {
  const [pending, setPending] = useState(false)
  const enVueloRef = useRef(false)   // latch síncrono (fuente de verdad)
  const montadoRef = useRef(true)
  const statusId   = useId()

  useEffect(() => {
    montadoRef.current = true
    return () => { montadoRef.current = false }
  }, [])

  const ocupado   = guard ? (loading || pending) : loading
  const bloqueado = ocupado || disabled

  const handleClick = useCallback(
    (evento) => {
      // ── Escenario 2: clic adicional durante el procesamiento → se descarta.
      if (enVueloRef.current || bloqueado) {
        evento.preventDefault()
        evento.stopPropagation()
        logger.debug('boton.clic_ignorado', { motivo: enVueloRef.current ? 'en_vuelo' : 'deshabilitado' })
        return
      }
      if (typeof onClick !== 'function') return

      if (!guard) { onClick(evento); return }

      // ── Escenario 1: se toma el latch ANTES de ejecutar nada.
      enVueloRef.current = true

      let salida
      try {
        salida = onClick(evento)
      } catch (err) {
        enVueloRef.current = false
        logger.error('boton.error_sincrono', { error: err })
        if (onError) { onError(err); return }
        throw err
      }

      // Handler síncrono → se libera de inmediato, sin spinner.
      if (!esPromesa(salida)) {
        enVueloRef.current = false
        return
      }

      const iniciadoEn = Date.now()
      if (montadoRef.current) setPending(true)

      const liberar = async () => {
        const restante = minPendingMs - (Date.now() - iniciadoEn)
        if (restante > 0) await sleep(restante)
        enVueloRef.current = false
        // El componente puede haberse desmontado (modal cerrado tras éxito):
        // actualizar el estado en ese caso genera un warning y una fuga.
        if (montadoRef.current) setPending(false)
      }

      Promise.race([
        salida,
        sleep(timeoutMs).then(() => {
          throw Object.assign(new Error('TIEMPO_AGOTADO'), { codigo: 'TIMEOUT' })
        }),
      ])
        .catch((err) => {
          // Los handlers del proyecto ya capturan sus propios errores; esto
          // cubre los que se escapen y evita un `unhandledrejection` silencioso.
          logger.error('boton.error_asincrono', { error: err })
          onError?.(err)
        })
        .finally(liberar)
    },
    [onClick, onError, bloqueado, guard, minPendingMs, timeoutMs],
  )

  return (
    <>
      <button
        type={type}
        onClick={handleClick}
        // `disabled` nativo solo cuando el llamador lo pide explícitamente.
        // Durante la carga se usa aria-disabled para no perder el foco.
        disabled={disabled}
        aria-disabled={bloqueado || undefined}
        aria-busy={ocupado || undefined}
        aria-describedby={ocupado ? statusId : props['aria-describedby']}
        data-busy={ocupado ? 'true' : undefined}
        className={`
          inline-flex items-center gap-2 font-body font-medium rounded-xl
          transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900
          ${ocupado ? 'opacity-60 cursor-progress pointer-events-auto' : ''}
          ${variants[variant]} ${sizes[size]} ${className}
        `}
        {...props}
      >
        {ocupado ? (
          <span
            aria-hidden="true"
            className={`${spinnerSizes[size]} border-2 border-current/30 border-t-current
                        rounded-full animate-spin motion-reduce:animate-none flex-shrink-0`}
          />
        ) : (
          Icon && <Icon size={15} aria-hidden="true" />
        )}
        {children}
      </button>

      {/* Región viva: anuncia el progreso sin mover el foco (WCAG 4.1.3). */}
      <span id={statusId} role="status" aria-live="polite" className="sr-only">
        {ocupado ? loadingText : ''}
      </span>
    </>
  )
}

// ─── Input ────────────────────────────────────────────────────────────────

export function Input({ label, error, id, className = '', ...props }) {
  const autoId  = useId()
  const inputId = id ?? autoId
  const errorId = `${inputId}-error`

  return (
    <div className="space-y-1">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-surface-300 text-xs tracking-widest uppercase font-body"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`
          w-full bg-surface-700 border rounded-xl px-4 py-2.5 text-white text-sm
          font-body placeholder-surface-500
          focus:outline-none focus:ring-1 transition-all duration-200
          ${error
            ? 'border-red-500 focus:border-red-500 focus:ring-red-500/30'
            : 'border-surface-600 focus:border-brand-500 focus:ring-brand-500/30'
          }
          ${className}
        `}
        {...props}
      />
      {error && <p id={errorId} role="alert" className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}

// ─── Select ───────────────────────────────────────────────────────────────

export function Select({ label, error, children, id, className = '', ...props }) {
  const autoId   = useId()
  const selectId = id ?? autoId
  const errorId  = `${selectId}-error`

  return (
    <div className="space-y-1">
      {label && (
        <label
          htmlFor={selectId}
          className="block text-surface-300 text-xs tracking-widest uppercase font-body"
        >
          {label}
        </label>
      )}
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`
          w-full bg-surface-700 border rounded-xl px-4 py-2.5 text-white text-sm
          font-body focus:outline-none focus:ring-1 transition-all duration-200 cursor-pointer
          ${error
            ? 'border-red-500 focus:border-red-500 focus:ring-red-500/30'
            : 'border-surface-600 focus:border-brand-500 focus:ring-brand-500/30'
          }
          ${className}
        `}
        {...props}
      >
        {children}
      </select>
      {error && <p id={errorId} role="alert" className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────

const badgeColors = {
  orange:  'bg-brand-500/15 text-brand-400 border-brand-500/30',
  green:   'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  blue:    'bg-blue-500/15 text-blue-400 border-blue-500/30',
  red:     'bg-red-500/15 text-red-400 border-red-500/30',
  yellow:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  gray:    'bg-surface-600/30 text-surface-300 border-surface-600',
  violet:  'bg-violet-500/15 text-violet-400 border-violet-500/30',
}

export function Badge({ children, color = 'gray' }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-body border ${badgeColors[color]}`}>
      {children}
    </span>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────

export function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface-800 border border-surface-700 rounded-2xl ${className}`}>
      {children}
    </div>
  )
}

// ─── PageHeader ───────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-8 animate-slide-up">
      <div>
        <p className="text-brand-500 text-xs font-mono tracking-[0.3em] uppercase mb-1">
          {subtitle}
        </p>
        <h1 className="font-display text-4xl text-white tracking-widest">
          {title.toUpperCase()}
        </h1>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────

export function Table({ headers, children, empty }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm font-body">
        <thead>
          <tr className="border-b border-surface-700">
            {headers.map((h) => (
              <th
                key={h}
                scope="col"
                className="text-left text-surface-400 text-xs tracking-widest uppercase py-3 px-4 font-body"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
        </tbody>
      </table>
      {empty && (
        <div className="text-center py-16 text-surface-500 font-body">
          {empty}
        </div>
      )}
    </div>
  )
}

export function Tr({ children, onClick, className = '' }) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-surface-700/50 transition-colors duration-150
                  ${onClick ? 'cursor-pointer hover:bg-surface-700/40' : ''}
                  ${className}`}
    >
      {children}
    </tr>
  )
}

export function Td({ children, className = '' }) {
  return (
    <td className={`py-3 px-4 text-surface-200 ${className}`}>{children}</td>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} props.title
 * @param {React.ReactNode} props.children
 * @param {string} [props.width]
 * @param {boolean} [props.busy] Si hay una operación en curso, bloquea el
 *   cierre por backdrop/Escape. Cerrar el modal a mitad de un INSERT deja al
 *   usuario sin saber si el registro se creó, y suele terminar en un reintento
 *   manual: exactamente el duplicado que estamos evitando.
 */
export function Modal({ open, onClose, title, children, width = 'max-w-lg', busy = false }) {
  const contenedorRef = useRef(/** @type {HTMLDivElement | null} */ (null))

  // Cierre con Escape (WCAG 2.1.2 — sin trampas de teclado).
  useEffect(() => {
    if (!open) return
    const alPresionar = (e) => {
      if (e.key === 'Escape' && !busy) onClose?.()
    }
    document.addEventListener('keydown', alPresionar)
    return () => document.removeEventListener('keydown', alPresionar)
  }, [open, busy, onClose])

  // Foco inicial dentro del diálogo.
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      const foco = contenedorRef.current?.querySelector(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      /** @type {HTMLElement | null} */ (foco)?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70"
        onClick={busy ? undefined : onClose}
        aria-hidden="true"
      />
      <div
        ref={contenedorRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative bg-surface-800 border border-surface-700 rounded-2xl
                    shadow-2xl w-full ${width} animate-slide-up max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between p-6 border-b border-surface-700">
          <h2 className="font-body font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar"
            className="text-surface-400 hover:text-white transition-colors text-xl leading-none
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ×
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────

export function Spinner({ label = 'Cargando' }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin motion-reduce:animate-none"
    />
  )
}
