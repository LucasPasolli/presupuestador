// src/components/ui/FullScreenSheet.jsx
// Panel a pantalla completa para mobile/tablet (filtros, selectores largos…).
// Presentacional y genérico: no conoce pedidos.
//
// Accesibilidad (WCAG 2.1 AA)
//  • role="dialog" + aria-modal + aria-labelledby.
//  • Foco: entra al panel al abrir, queda atrapado (Tab / Shift+Tab) y vuelve
//    al elemento que lo abrió al cerrar.
//  • Escape cierra. El botón de cerrar mide 44×44 px.
//  • El scroll de la página de fondo se bloquea mientras está abierto.
//  • Respeta las safe-areas (notch / barra de gestos).

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * @param {object}     props
 * @param {boolean}    props.open
 * @param {()=>void}   props.onClose
 * @param {string}     props.title
 * @param {React.ReactNode} props.children   Contenido scrolleable.
 * @param {React.ReactNode} [props.footer]   Acciones fijas al pie (siempre visibles).
 */
export default function FullScreenSheet({ open, onClose, title, children, footer }) {
  const titleId   = useId()
  const panelRef  = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined

    const previo = document.activeElement
    const overflowPrevio = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()

    function onKeyDown(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current?.(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = [...panelRef.current.querySelectorAll(FOCUSABLE)]
      if (items.length === 0) { e.preventDefault(); return }
      const primero = items[0]
      const ultimo  = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === primero || document.activeElement === panelRef.current)) {
        e.preventDefault(); ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault(); primero.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflowPrevio
      if (previo && typeof previo.focus === 'function') previo.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 z-[9000] flex flex-col bg-surface-900 outline-none animate-slide-up
                 h-[100dvh] pt-[env(safe-area-inset-top)]"
    >
      <header className="flex items-center justify-between gap-3 px-4 border-b border-surface-700 flex-shrink-0">
        <h2 id={titleId} className="font-body font-semibold text-white text-base py-3">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="flex items-center justify-center min-h-[44px] min-w-[44px] -mr-2 rounded-xl
                     text-surface-300 hover:text-white focus-visible:outline-none
                     focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <X size={20} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>

      {footer && (
        <footer className="flex-shrink-0 border-t border-surface-700 bg-surface-900 px-4 pt-3
                           pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {footer}
        </footer>
      )}
    </div>,
    document.body,
  )
}
