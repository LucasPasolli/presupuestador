// src/pages/Facturas.jsx
import { useState, useEffect, useCallback } from 'react'
import { obtenerFacturasConDetalles } from '../services/presupuestosService'
import { Card, PageHeader, Button, Badge } from '../components/ui'
import { FileText, Download, Eye, Calendar, AlertCircle } from 'lucide-react'

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n ?? 0)
}

function fmtFecha(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function today() { return new Date().toISOString().slice(0, 10) }

function firstOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// Métodos que van al documento "No efectivo" (transferencia + CC)
const METODOS_NO_EFECTIVO = ['transferencia', 'cc15', 'cc30']
const METODOS_EFECTIVO    = ['efectivo']

// ─── Lógica de agrupación (pure, sin BD) ──────────────────────────────────

/**
 * Recibe los presupuestos ya cargados desde el service y los agrupa
 * por cliente y tipo de método de pago, calculando los ajustes de IVA.
 *
 * Reemplaza a la función cargarDatos() original que era síncrona y
 * accedía a la BD directamente.
 */
function agruparPresupuestos(presupuestos, metodos) {
  const porCliente = {}

  for (const p of presupuestos) {
    if (!metodos.includes(p.metodoPago)) continue

    const key = p.idCliente
    if (!porCliente[key]) {
      porCliente[key] = {
        idCliente:    p.idCliente,
        nombre:       `${p.nombreCliente} ${p.apellidoCliente}`,
        cuit:         p.cuit,
        presupuestos: [],
        totalCliente: 0,
      }
    }

    // Agrupar detalles por producto (sumar cantidad y subtotal)
    const agrupados = {}
    for (const d of p.detalles ?? []) {
      const pid = d.idProducto
      if (!agrupados[pid]) {
        agrupados[pid] = { ...d, cantidad: 0, subtotal: 0 }
      }
      agrupados[pid].cantidad += d.cantidad
      agrupados[pid].subtotal += d.subtotal
    }

    // Detectar factor de ajuste aplicado al presupuesto (ej: redondeo, excepción)
    const subtotalBase = Object.values(agrupados).reduce((acc, d) => acc + d.subtotal, 0)
    const factorAjuste = subtotalBase > 0 ? p.monto / subtotalBase : 1

    const items = Object.values(agrupados).map(d => {
      const subtotalAjustado        = d.subtotal * factorAjuste
      const precioUnitarioAjustado  = d.cantidad > 0 ? subtotalAjustado / d.cantidad : 0

      return {
        ...d,
        precioUnitario: precioUnitarioAjustado,
        precioNeto:     precioUnitarioAjustado / 1.21,
        subtotalNeto:   subtotalAjustado / 1.21,
        subtotal:       subtotalAjustado,
        medida:         '—',
      }
    })

    porCliente[key].presupuestos.push({ ...p, items })
    porCliente[key].totalCliente += p.monto
  }

  return Object.values(porCliente).sort((a, b) => a.nombre.localeCompare(b.nombre))
}

// ─── Generador de PDF ──────────────────────────────────────────────────────

async function generarPDF(grupos, titulo, desde, hasta) {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const PW   = 210
  const ML   = 14
  const MR   = 14
  const CW   = PW - ML - MR

  const NARANJA = [234, 88, 12]
  const GRIS    = [50, 50, 50]
  const CLARO   = [245, 245, 245]
  const BORDE   = [220, 220, 220]

  function header() {
    doc.setFillColor(...NARANJA)
    doc.rect(0, 0, PW, 18, 'F')

    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(255, 255, 255)
    doc.text('CLAUDIO RER GROUP', ML, 12)

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(`Pág. ${doc.getNumberOfPages()}`, PW - MR, 12, { align: 'right' })

    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GRIS)
    doc.text(titulo, ML, 26)

    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 100, 100)
    doc.text(`Período: ${fmtFecha(desde)} al ${fmtFecha(hasta)}`, ML, 32)

    return 38
  }

  let y = header()

  function checkPage(needed = 30) {
    if (y + needed > 280) {
      doc.addPage()
      y = header()
    }
  }

  if (grupos.length === 0) {
    doc.setFontSize(10)
    doc.setTextColor(150, 150, 150)
    doc.text('Sin movimientos en el período seleccionado.', ML, y + 10)
    doc.save(`${titulo.replace(/\s+/g, '_')}_${desde}_${hasta}.pdf`)
    return
  }

  let totalGeneral = 0

  for (const cliente of grupos) {
    checkPage(40)

    doc.setFillColor(...CLARO)
    doc.roundedRect(ML, y, CW, 12, 2, 2, 'F')
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GRIS)
    doc.text(cliente.nombre, ML + 4, y + 8)

    if (cliente.cuit) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(120, 120, 120)
      doc.text(`CUIT: ${cliente.cuit}`, PW - MR - 4, y + 8, { align: 'right' })
    }
    y += 15

    for (const pres of cliente.presupuestos) {
      checkPage(20)

      doc.setFontSize(8)
      doc.setFont('helvetica', 'italic')
      doc.setTextColor(120, 120, 120)
      const metodoLabel = { efectivo: 'Efectivo', transferencia: 'Transferencia', cc15: 'CC 15d', cc30: 'CC 30d' }
      doc.text(
        `Presupuesto #${pres.idPresupuesto} — ${fmtFecha(pres.fechaFacturacion)} — ${metodoLabel[pres.metodoPago] ?? pres.metodoPago}`,
        ML + 4, y
      )
      y += 5

      if (!pres.items || pres.items.length === 0) {
        doc.setFontSize(8)
        doc.setTextColor(180, 180, 180)
        doc.text('Sin ítems registrados.', ML + 4, y)
        y += 6
        continue
      }

      autoTable(doc, {
        startY: y,
        margin: { left: ML, right: MR },
        head: [['Producto', 'Cant.', 'P. Unit. (sin IVA)', 'Subtotal (sin IVA)']],
        body: pres.items.map(it => [
          it.nombreProducto ?? `#${it.idProducto}`,
          it.cantidad,
          fmt(it.precioNeto),
          fmt(it.subtotalNeto),
        ]),
        foot: [[
          { content: 'Total con IVA', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } },
          { content: fmt(pres.monto), styles: { fontStyle: 'bold', textColor: NARANJA } },
        ]],
        styles:     { fontSize: 7.5, cellPadding: 2.5, textColor: GRIS },
        headStyles: { fillColor: NARANJA, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
        footStyles: { fillColor: [255, 248, 235], fontSize: 7.5 },
        alternateRowStyles: { fillColor: [252, 252, 252] },
        columnStyles: {
          0: { cellWidth: 'auto' },
          1: { cellWidth: 14, halign: 'center' },
          2: { cellWidth: 36, halign: 'right' },
          3: { cellWidth: 36, halign: 'right' },
        },
      })

      y = doc.lastAutoTable.finalY + 5
    }

    checkPage(12)
    doc.setDrawColor(...BORDE)
    doc.line(ML, y, PW - MR, y)
    y += 4

    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...NARANJA)
    doc.text(`Total ${cliente.nombre}: ${fmt(cliente.totalCliente)}`, PW - MR, y, { align: 'right' })
    y += 12

    totalGeneral += cliente.totalCliente
  }

  checkPage(20)
  doc.setFillColor(...NARANJA)
  doc.roundedRect(ML, y, CW, 14, 3, 3, 'F')
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(255, 255, 255)
  doc.text('TOTAL GENERAL', ML + 6, y + 9.5)
  doc.text(fmt(totalGeneral), PW - MR - 6, y + 9.5, { align: 'right' })

  doc.save(`${titulo.replace(/\s+/g, '_')}_${desde}_${hasta}.pdf`)
}

// ─── Vista previa en pantalla ──────────────────────────────────────────────

function VistaPrevia({ grupos, titulo }) {
  if (grupos.length === 0) {
    return (
      <div className="text-center py-10 text-surface-500 font-body text-sm">
        Sin movimientos en este período para este tipo de documento.
      </div>
    )
  }

  const totalGeneral = grupos.reduce((acc, c) => acc + c.totalCliente, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-surface-300 text-xs uppercase tracking-widest font-body">{titulo}</p>
        <p className="text-brand-400 font-mono font-bold text-sm">{fmt(totalGeneral)}</p>
      </div>

      {grupos.map((cliente) => (
        <div key={cliente.idCliente} className="bg-surface-800 border border-surface-700 rounded-xl overflow-hidden">
          {/* Cabecera cliente */}
          <div className="flex items-center justify-between px-4 py-3 bg-surface-700/50 border-b border-surface-700">
            <div>
              <p className="text-white text-sm font-body font-medium">{cliente.nombre}</p>
              {cliente.cuit && <p className="text-surface-400 text-xs font-mono">CUIT: {cliente.cuit}</p>}
            </div>
            <p className="text-brand-400 font-mono text-sm font-bold">{fmt(cliente.totalCliente)}</p>
          </div>

          {/* Presupuestos */}
          {cliente.presupuestos.map((pres) => (
            <div key={pres.idPresupuesto} className="border-b border-surface-700/50 last:border-0">
              <div className="px-4 py-2 bg-surface-800/60 flex items-center gap-3">
                <span className="text-surface-400 text-xs font-mono">#{pres.idPresupuesto}</span>
                <span className="text-surface-400 text-xs font-body">{fmtFecha(pres.fechaFacturacion)}</span>
                <Badge color={
                  pres.metodoPago === 'efectivo'      ? 'green' :
                  pres.metodoPago === 'transferencia' ? 'blue'  : 'yellow'
                }>
                  {{ efectivo: 'Efectivo', transferencia: 'Transferencia', cc15: 'CC 15d', cc30: 'CC 30d' }[pres.metodoPago]}
                </Badge>
              </div>

              {pres.items && pres.items.length > 0 && (
                <table className="w-full text-xs font-body">
                  <thead>
                    <tr className="border-b border-surface-700/30">
                      <th className="text-left text-surface-500 py-1.5 px-4 font-body">Producto</th>
                      <th className="text-center text-surface-500 py-1.5 px-2 font-body">Cant.</th>
                      <th className="text-right text-surface-500 py-1.5 px-2 font-body">P.Unit s/IVA</th>
                      <th className="text-right text-surface-500 py-1.5 px-4 font-body">Subtotal s/IVA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pres.items.map((it, i) => (
                      <tr key={i} className="border-b border-surface-700/20 last:border-0">
                        <td className="py-1.5 px-4 text-surface-200">{it.nombreProducto ?? `#${it.idProducto}`}</td>
                        <td className="py-1.5 px-2 text-center text-surface-200 font-mono">{it.cantidad}</td>
                        <td className="py-1.5 px-2 text-right text-surface-200 font-mono">{fmt(it.precioNeto)}</td>
                        <td className="py-1.5 px-4 text-right text-surface-200 font-mono">{fmt(it.subtotalNeto)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-700/20">
                      <td colSpan={3} className="py-1.5 px-4 text-right text-surface-400 text-xs">Total c/IVA:</td>
                      <td className="py-1.5 px-4 text-right text-brand-400 font-mono font-bold">{fmt(pres.monto)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          ))}
        </div>
      ))}

      {/* Total general */}
      <div className="flex justify-between items-center bg-brand-500/10 border border-brand-500/30 rounded-xl px-5 py-3">
        <span className="text-white font-body font-semibold text-sm">Total General — {titulo}</span>
        <span className="text-brand-400 font-mono font-bold text-lg">{fmt(totalGeneral)}</span>
      </div>
    </div>
  )
}

// ─── Componente principal ──────────────────────────────────────────────────

export default function Facturas() {
  const [desde,      setDesde]      = useState(firstOfMonth())
  const [hasta,      setHasta]      = useState(today())
  const [datos,      setDatos]      = useState(null)
  const [activeTab,  setActiveTab]  = useState('noEfectivo')   // 'noEfectivo' | 'efectivo'
  const [cargando,   setCargando]   = useState(false)
  const [generando,  setGenerando]  = useState(false)
  const [error,      setError]      = useState('')

  const buscar = useCallback(async (d = desde, h = hasta) => {
    setError('')
    if (!d || !h)  { setError('Seleccioná ambas fechas.'); return }
    if (d > h)     { setError('La fecha de inicio no puede ser posterior a la de fin.'); return }

    setCargando(true)
    try {
      // Una sola llamada al service; la lógica de BD vive en presupuestosService
      const presupuestos = await obtenerFacturasConDetalles(d, h)

      setDatos({
        noEfectivo: agruparPresupuestos(presupuestos, METODOS_NO_EFECTIVO),
        efectivo:   agruparPresupuestos(presupuestos, METODOS_EFECTIVO),
      })
    } catch (e) {
      setError(`Error al cargar datos: ${e.message}`)
    } finally {
      setCargando(false)
    }
  }, [desde, hasta])

  // Cargar al montar con el período por defecto (mes actual)
  useEffect(() => { buscar(firstOfMonth(), today()) }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  async function descargarPDF(tipo) {
    if (!datos) return
    setGenerando(true)
    try {
      const grupos = tipo === 'noEfectivo' ? datos.noEfectivo : datos.efectivo
      const titulo = tipo === 'noEfectivo'
        ? 'Factura — Transferencia y Cuenta Corriente'
        : 'Factura — Efectivo'
      await generarPDF(grupos, titulo, desde, hasta)
    } catch (e) {
      setError(`Error al generar PDF: ${e.message}`)
    } finally {
      setGenerando(false)
    }
  }

  const tabActiva = datos ? (activeTab === 'noEfectivo' ? datos.noEfectivo : datos.efectivo) : []
  const tituloTab = activeTab === 'noEfectivo'
    ? 'Transferencia y Cuenta Corriente'
    : 'Efectivo'

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader title="Facturas" subtitle="Generar documento" />

      {/* Selector de período */}
      <Card className="p-6">
        <h2 className="font-body font-semibold text-white text-sm mb-4 flex items-center gap-2">
          <Calendar size={16} className="text-brand-500" />
          Seleccionar período
        </h2>

        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-surface-400 text-xs uppercase tracking-widest font-body">Desde</label>
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
              className="bg-surface-700 border border-surface-600 rounded-xl px-4 py-2.5 text-white text-sm
                         font-body focus:outline-none focus:border-brand-500 transition-all [color-scheme:dark]" />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-surface-400 text-xs uppercase tracking-widest font-body">Hasta</label>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
              className="bg-surface-700 border border-surface-600 rounded-xl px-4 py-2.5 text-white text-sm
                         font-body focus:outline-none focus:border-brand-500 transition-all [color-scheme:dark]" />
          </div>

          <Button onClick={() => buscar()} icon={Eye} disabled={cargando}>
            {cargando ? 'Cargando…' : 'Ver período'}
          </Button>
        </div>

        {error && (
          <div className="flex items-center gap-2 mt-4 text-red-400 text-sm bg-red-500/10 border border-red-500/20
                          rounded-xl px-4 py-2.5 font-body">
            <AlertCircle size={15} className="flex-shrink-0" />{error}
          </div>
        )}
      </Card>

      {/* Resumen del período */}
      {datos && (
        <div className="grid grid-cols-2 gap-4">
          {[
            { tipo: 'noEfectivo', label: 'Transferencia + CC', grupos: datos.noEfectivo, color: 'blue' },
            { tipo: 'efectivo',   label: 'Efectivo',           grupos: datos.efectivo,   color: 'green' },
          ].map(({ tipo, label, grupos }) => {
            const total   = grupos.reduce((acc, c) => acc + c.totalCliente, 0)
            const clientes = grupos.length
            const presups  = grupos.reduce((acc, c) => acc + c.presupuestos.length, 0)
            return (
              <div key={tipo}
                className={`bg-surface-800 border rounded-2xl p-5 cursor-pointer transition-all duration-200
                  ${activeTab === tipo
                    ? 'border-brand-500/50 bg-brand-500/5'
                    : 'border-surface-700 hover:border-surface-600'}`}
                onClick={() => setActiveTab(tipo)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-surface-400 text-xs uppercase tracking-widest font-body">{label}</p>
                    <p className="text-brand-400 font-mono font-bold text-xl mt-1">{fmt(total)}</p>
                  </div>
                  <Button
                    size="sm"
                    icon={Download}
                    disabled={generando || grupos.length === 0}
                    onClick={e => { e.stopPropagation(); descargarPDF(tipo) }}
                  >
                    PDF
                  </Button>
                </div>
                <div className="flex gap-4 text-xs font-body text-surface-400">
                  <span>{clientes} cliente{clientes !== 1 ? 's' : ''}</span>
                  <span>·</span>
                  <span>{presups} presupuesto{presups !== 1 ? 's' : ''}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Vista previa del documento activo */}
      {datos && (
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-surface-700 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText size={16} className="text-brand-500" />
              <h3 className="font-body font-semibold text-white text-sm">
                Vista previa — {tituloTab}
              </h3>
            </div>
            <Button
              size="sm"
              icon={Download}
              disabled={generando || tabActiva.length === 0}
              onClick={() => descargarPDF(activeTab)}
            >
              {generando ? 'Generando…' : 'Descargar PDF'}
            </Button>
          </div>

          <div className="p-6">
            <VistaPrevia grupos={tabActiva} titulo={tituloTab} />
          </div>
        </Card>
      )}
    </div>
  )
}
