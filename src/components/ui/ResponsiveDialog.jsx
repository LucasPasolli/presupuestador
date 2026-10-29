// src/components/ui/ResponsiveDialog.jsx
// Diálogo adaptable para listados/detalles largos:
//   · mobile y tablet (≤ 1024 px): pantalla completa (como FullScreenSheet).
//   · escritorio (> 1024 px)      : modal centrado con backdrop.
//
// DECISIÓN CLAVE: es UN solo árbol DOM; lo que cambia entre layouts son clases
// CSS (no el componente). Si alternáramos entre <FullScreenSheet> y un modal
// distinto según `useBreakpoint`, rotar el equipo con el diálogo abierto
// REMONTARÍA el contenido y se perdería página, orden y búsqueda (Escenario 6).
//
// Accesibilidad (WCAG 2.1 AA): role="dialog" + aria-modal + aria-labelledby,
// foco atrapado y devuelto al origen, Escape cierra, scroll de fondo bloqueado,
// cierre de 44×44 px, safe-areas (notch / barra de gestos).
//
// Slots:  toolbar → fijo bajo el encabezado (búsqueda).   children → scrollea.
//         footer  → fijo al pie (paginador). Aporta su propio borde/padding.

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {()=>void} props.onClose
 * @param {string} props.title
 * @param {React.ReactNode} [props.subtitle]
 * @param {React.ComponentType<{size?:number,className?:string}>} [props.icon]
 * @param {string} [props.iconClassName]
 * @param {React.RefObject<HTMLElement>} [props.bodyRef]  Ref del área scrolleable (para resetear scroll al paginar).
 * @param {React.ReactNode} [props.toolbar]
 * @param {React.ReactNode} [props.footer]
 * @param {boolean} [props.busy]  Marca el cuerpo como `aria-busy`.
 * @param {React.ReactNode} props.children
 */
export default function ResponsiveDialog({
  open, onClose, title, subtitle, icon: Icon, iconClassName = 'text-brand-500',
  bodyRef, toolbar, footer, busy = false, children,
}) {
  const titleId = useId()
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined

    const previo = document.activeElement
    const body = document.body
    const overflowPrevio = body.style.overflow
    const paddingPrevio = body.style.paddingRight
    // Compensa el ancho de la scrollbar (solo escritorio) para evitar el "salto" del fondo.
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`
    panelRef.current?.focus({ preventScroll: true })

    function onKeyDown(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current?.(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = [...panelRef.current.querySelectorAll(FOCUSABLE)]
      if (items.length === 0) { e.preventDefault(); return }
      const primero = items[0]
      const ultimo = items[items.length - 1]
      const activo = document.activeElement
      if (e.shiftKey && (activo === primero || activo === panelRef.current)) {
        e.preventDefault(); ultimo.focus()
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault(); primero.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      body.style.overflow = overflowPrevio
      body.style.paddingRight = paddingPrevio
      if (previo && typeof previo.focus === 'function') previo.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[9000] flex justify-center min-[1025px]:items-center min-[1025px]:p-4">
      {/* Backdrop: solo visible/clickeable en escritorio (en táctil el panel ocupa todo). */}
      <div aria-hidden="true" onClick={onClose}
        className="absolute inset-0 hidden min-[1025px]:block bg-black/75" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex flex-col w-full h-[100dvh] bg-surface-900 outline-none animate-slide-up
                   pt-[env(safe-area-inset-top)]
                   min-[1025px]:h-auto min-[1025px]:max-h-[90vh] min-[1025px]:max-w-3xl min-[1025px]:pt-0
                   min-[1025px]:bg-surface-800 min-[1025px]:border min-[1025px]:border-surface-700
                   min-[1025px]:rounded-2xl min-[1025px]:shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 px-4 sm:px-6 border-b border-surface-700 flex-shrink-0">
          <div className="min-w-0 py-3 min-[1025px]:py-4">
            <h2 id={titleId} className="font-body font-semibold text-white text-base flex items-center gap-2">
              {Icon && <Icon size={16} className={`flex-shrink-0 ${iconClassName}`} />}
              <span className="min-w-0 break-words">{title}</span>
            </h2>
            {subtitle && (
              <p className="text-surface-400 text-sm min-[1025px]:text-xs font-body mt-0.5 break-words">{subtitle}</p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar"
            className="flex items-center justify-center min-h-[44px] min-w-[44px] -mr-2 flex-shrink-0 rounded-xl
                       text-surface-300 hover:text-white hover:bg-surface-700 transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <X size={20} />
          </button>
        </header>

        {toolbar && (
          <div className="px-4 sm:px-6 py-3 border-b border-surface-700 flex-shrink-0">{toolbar}</div>
        )}

        <div ref={bodyRef} tabIndex={-1} aria-busy={busy}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain focus:outline-none">
          {children}
        </div>

        {footer && (
          <div className="flex-shrink-0 bg-surface-900 min-[1025px]:bg-surface-800
                          pb-[env(safe-area-inset-bottom)] min-[1025px]:pb-0 min-[1025px]:rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
