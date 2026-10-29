// src/hooks/useEntregaPdf.js
// Orquesta "generar PDF → descargar" con:
//   · latch anti doble-toque (reutiliza useAsyncAction),
//   · mensajes de estado para lectores de pantalla (aria-live) sin filtrar
//     detalles internos del error al usuario.
import { useCallback, useEffect, useState } from 'react'
import { useAsyncAction } from './useAsyncAction'
import { construirPDF, descargarBlob } from '../lib/facturasPdf'

const AVISO_MS = 8_000

/**
 * @typedef {{grupos: import('../lib/facturas').GrupoCliente[], titulo: string, desde: string, hasta: string}} PayloadPdf
 * @typedef {{tipo: 'ok'|'error', texto: string}} Aviso
 */

export function useEntregaPdf() {
  const [aviso, setAviso] = useState(/** @type {Aviso|null} */ (null))

  const accion = useCallback(async (/** @type {PayloadPdf} */ p) => {
    setAviso(null)
    const { blob, nombre } = await construirPDF(p.grupos, p.titulo, p.desde, p.hasta)
    descargarBlob(blob, nombre)
    setAviso({ tipo: 'ok', texto: 'PDF generado. Buscalo en tus descargas.' })
  }, [])

  const { run, pending } = useAsyncAction(accion, {
    nombre:  'facturas.pdf',
    // El detalle técnico va al logger (lo hace useAsyncAction); al usuario, un mensaje genérico.
    onError: () => setAviso({ tipo: 'error', texto: 'No se pudo generar el PDF. Reintentá en unos segundos.' }),
  })

  useEffect(() => {
    if (!aviso) return undefined
    const t = setTimeout(() => setAviso(null), AVISO_MS)
    return () => clearTimeout(t)
  }, [aviso])

  return {
    /** @param {PayloadPdf} p */ descargar: (p) => run(p),
    generando: pending,
    aviso,
  }
}

export default useEntregaPdf
