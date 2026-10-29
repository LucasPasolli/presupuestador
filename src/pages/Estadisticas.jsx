// src/pages/Estadisticas.jsx
// Pantalla de estadísticas: orquesta filtros, carga de datos y secciones.
// Toda la lógica visual vive en src/components/estadisticas/*.
//
// Garantías de la historia "Optimizar mobile/tablet":
//  · Gráficos, KPIs y tablas se adaptan por CSS (sin JS de medición) → se
//    redibujan solos al rotar (Esc. 1, 3, 4, 6).
//  · Filtros y modales viven en estado del padre/propio y NUNCA se desmontan por
//    una recarga ni por cruzar un breakpoint (Esc. 5, 6).
//  · Un solo origen de datos y de formato (obtenerMetricas + formatters) para
//    todos los dispositivos (Esc. 7). Las respuestas obsoletas se descartan.

import { useCallback, useState } from 'react'
import {
  TrendingUp, TrendingDown, Wallet, Clock, Users, Package, BarChart2, CreditCard, Tag,
  AlertTriangle, RefreshCw, Layers, Repeat, Truck, PieChart, PiggyBank, Boxes, WifiOff,
} from 'lucide-react'
import { PageHeader, Button, Card } from '../components/ui'
import KpiCard, { KpiGrid } from '../components/estadisticas/KpiCard'
import SeccionCard from '../components/estadisticas/SeccionCard'
import BarrasHorizontales from '../components/estadisticas/BarrasHorizontales'
import GraficoDona from '../components/estadisticas/GraficoDona'
import PanelFiltros from '../components/estadisticas/PanelFiltros'
import RankingProductosIngresos from '../components/estadisticas/RankingProductosIngresos'
import {
  ModalTopProductos, ModalProductosIncompletos, ModalDemoraClientes, ModalTicketPromedioClientes,
} from '../components/estadisticas/ModalesEstadisticas'
import { colorDemora, fmt, fmtCompacto, fmtDemora, pct } from '../components/estadisticas/formatters'
import { useFiltrosEstadisticas } from '../hooks/useFiltrosEstadisticas'
import { useMetricasEstadisticas } from '../hooks/useMetricasEstadisticas'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

const TOQUE = 'justify-center min-h-[44px] min-[1025px]:min-h-0'
const GRID_2 = 'grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4'
const SIN_DATOS = (t) => <p className="text-surface-500 text-sm font-body">{t}</p>

export default function Estadisticas() {
  const [mostrarExacto, setMostrarExacto] = useState(false)
  const { filtros, desde, hasta, aplicar, limpiar } = useFiltrosEstadisticas()
  const { metricas: m, periodo, cargando, error, recargar } = useMetricasEstadisticas(desde, hasta)
  const online = useOnlineStatus()

  const [modal, setModal] = useState(null) // 'productos' | 'incompletos' | 'demora' | 'ticket' | null
  // Cada apertura del modal de ticket usa una `key` nueva → instancia limpia (búsqueda vacía).
  const [instanciaTicket, setInstanciaTicket] = useState(0)
  const cerrar = useCallback(() => setModal(null), [])
  const abrirTicket = () => { setInstanciaTicket((v) => v + 1); setModal('ticket') }

  const formatoMonto = mostrarExacto ? fmt : fmtCompacto

  // ── Estados límite: primera carga y error sin datos ───────────────────────
  if (!m) {
    return (
      <div className="max-w-6xl mx-auto space-y-4">
        <PageHeader title="Estadísticas" subtitle="Panel de métricas" />
        {error ? (
          <Card className="p-6 text-center" >
            <div role="alert">
              <AlertTriangle size={28} className="mx-auto mb-3 text-red-400" aria-hidden="true" />
              <p className="text-surface-200 text-sm font-body mb-4">{error}</p>
            </div>
            <Button onClick={recargar} icon={RefreshCw} className={TOQUE}>Reintentar</Button>
          </Card>
        ) : (
          <div className="flex items-center justify-center h-64" role="status">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <span className="sr-only">Cargando estadísticas…</span>
          </div>
        )}
      </div>
    )
  }

  // Los títulos muestran el período de los DATOS que se ven (no el pedido), así nunca se desfasan.
  const pDesde = periodo?.desde ?? desde
  const pHasta = periodo?.hasta ?? hasta
  const listaPrecio = m.facturadoTotal + m.descuentosOtorgados - m.recargosCC
  const topProductos = m.topProductos.map((p, i) => ({ label: `${i + 1}. ${p.nombre}`, value: p.unidades, sublabel: fmt(p.monto) }))

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 min-w-0" aria-busy={cargando}>
      <PageHeader title="Estadísticas" subtitle="Panel de métricas"
        actions={(
          <Button variant="secondary" aria-pressed={mostrarExacto} className={TOQUE}
            onClick={() => setMostrarExacto((v) => !v)}>
            {mostrarExacto ? 'Ver montos resumidos' : 'Ver montos exactos'}
          </Button>
        )} />

      <PanelFiltros filtros={filtros} desde={desde} hasta={hasta} onAplicar={aplicar} onLimpiar={limpiar} />

      {/* Estados de red: offline y error de recarga (se conservan los últimos datos). */}
      {!online && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-yellow-400 text-sm font-body">
          <WifiOff size={16} className="flex-shrink-0" aria-hidden="true" />
          Sin conexión. Los datos mostrados pueden estar desactualizados.
        </div>
      )}
      {error && (
        <div role="alert" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="text-red-400 text-sm font-body">{error}</p>
          <Button variant="secondary" onClick={recargar} icon={RefreshCw} className={TOQUE}>Reintentar</Button>
        </div>
      )}
      {cargando && <p role="status" className="text-brand-400/80 text-xs font-body">Actualizando…</p>}

      <div className={`space-y-4 sm:space-y-6 transition-opacity ${cargando ? 'opacity-60' : ''}`}>
        {/* ── KPIs ── */}
        <KpiGrid label="Indicadores principales">
          <KpiCard icon={TrendingUp} label="Presupuestado" value={formatoMonto(m.totalCotizado)} color="brand"
            sub={`${m.cantidadCotizaciones} presupuesto${m.cantidadCotizaciones !== 1 ? 's' : ''}${m.totalRechazados ? ` · ${m.totalRechazados} rechazado${m.totalRechazados !== 1 ? 's' : ''}` : ''}`} />
          <KpiCard icon={Wallet} label="Cobrado" value={formatoMonto(m.cobradoReal)} color="green"
            sub="efectivo + transferencia + saldos" />
          <KpiCard icon={TrendingDown} label="Egresos pagados" value={formatoMonto(m.egresosTotal)} color="red"
            sub={`pedidos ${formatoMonto(m.egresosPedidos)} · extra ${formatoMonto(m.egresosExtra)}`} />
          <KpiCard icon={m.resultadoEstimado >= 0 ? TrendingUp : TrendingDown} label="Resultado operativo"
            value={formatoMonto(m.resultadoEstimado)} color={m.resultadoEstimado >= 0 ? 'green' : 'red'}
            tono={m.resultadoEstimado >= 0 ? 'positivo' : 'negativo'} sub="ventas + ingresos − egresos" />
        </KpiGrid>

        <KpiGrid label="Pendientes y alertas">
          <KpiCard icon={Clock} label="Pedidos pendientes" color="yellow" value={formatoMonto(m.pedidosPendientes)} sub="deuda con proveedores" />
          <KpiCard icon={Clock} label="Saldos Pendientes CC" color="yellow" value={formatoMonto(m.pendienteCC)} sub="Saldos sin cobrar" />
          <KpiCard icon={Tag} label="Descuentos dados" color="yellow" value={formatoMonto(m.descuentosOtorgados)}
            sub={`${pct(m.descuentosOtorgados, listaPrecio)} del precio de lista`} />
          <KpiCard icon={AlertTriangle} label="Stock crítico" color="yellow" value={m.cantidadStockCritico}
            sub="productos bajo punto de repo." />
        </KpiGrid>

        <KpiGrid label="Inversión y clientes">
          <KpiCard icon={PiggyBank} label="Dinero invertido" color="violet" value={formatoMonto(m.dineroInvertido)} sub="neto activo (global)" />
          <KpiCard icon={TrendingUp} label="Ingresos extra" color="green" value={formatoMonto(m.ingresosExtra)} sub="FCI, plazo fijo, etc." />
          <KpiCard icon={BarChart2} label="Ticket promedio" color="blue" value={formatoMonto(m.ticketPromedio)} sub="por presupuesto"
            onClick={abrirTicket} drillDownLabel="Ver por cliente" />
          <KpiCard icon={Users} label="Clientes únicos" color="blue" value={m.clientesUnicos} sub="en el período" />
        </KpiGrid>

        {/* ── Valor actual del inventario ── */}
        <SeccionCard icon={Boxes} titulo="Valor Actual del Inventario"
          descripcion="Stock activo al día de hoy · no depende del rango de fechas seleccionado arriba">
          <div className={GRID_2}>
            <div className="bg-surface-700/40 border border-surface-600 rounded-xl p-4 sm:p-5 min-w-0">
              <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Valor a Costo (Proveedor)</p>
              <p className="font-mono font-bold text-white text-xl sm:text-2xl break-words">{formatoMonto(m.valorInventarioCosto)}</p>
              <p className="text-surface-500 text-xs font-body mt-1">Capital invertido en stock</p>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 sm:p-5 min-w-0">
              <p className="text-emerald-400 text-xs uppercase tracking-widest font-body mb-1">Valor a Precio de Venta</p>
              <p className="font-mono font-bold text-emerald-400 text-xl sm:text-2xl break-words">{formatoMonto(m.valorInventarioVenta)}</p>
              <p className="text-surface-500 text-xs font-body mt-1">Potencial de ingresos si se vendiera todo el stock</p>
            </div>
          </div>

          {m.cantidadProductosValorIncompleto > 0 && (
            <button type="button" onClick={() => setModal('incompletos')}
              className="mt-4 w-full min-h-[44px] flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between
                         bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 hover:bg-yellow-500/15
                         transition-all text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500/60">
              <span className="flex items-start gap-2 text-yellow-400 text-xs font-body">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                {m.cantidadProductosValorIncompleto} producto{m.cantidadProductosValorIncompleto !== 1 ? 's' : ''} con
                stock y precio incompleto — {m.cantidadProductosValorIncompleto !== 1 ? 'se calcularon' : 'se calculó'} como $0 en esa valorización
              </span>
              <span className="text-yellow-400/70 text-xs font-body whitespace-nowrap">Ver detalle →</span>
            </button>
          )}
        </SeccionCard>

        {/* ── Métodos de pago + egresos por categoría ── */}
        <div className={GRID_2}>
          <SeccionCard icon={CreditCard} titulo="Métodos de Pago">
            <GraficoDona unidad="métodos" formatoValor={fmt}
              datos={m.mixMetodos.map((mp) => ({ label: mp.label, valor: mp.monto }))} />
          </SeccionCard>

          <SeccionCard icon={PieChart} titulo="Egresos por categoría">
            {m.egresosPorCategoria.length === 0 ? SIN_DATOS('Sin egresos en el período.') : (
              <GraficoDona unidad="items" formatoValor={formatoMonto}
                datos={m.egresosPorCategoria.map((e) => ({ label: e.label, valor: e.monto }))} />
            )}
          </SeccionCard>
        </div>

        {/* ── Top artículos + top clientes ── */}
        <div className={GRID_2}>
          <SeccionCard icon={Package} titulo="Top artículos más vendidos"
            descripcion={`Top 10 · ${m.todosProductosVendidos?.length ?? 0} artículos en total`}
            accion={{ label: 'Ver todos', onClick: () => setModal('productos') }}>
            {m.topProductos.length === 0 ? SIN_DATOS('Sin ventas en el período.')
              : <BarrasHorizontales items={topProductos} fmtFn={(v) => `${v} u.`} />}
          </SeccionCard>

          <SeccionCard icon={Users} titulo="Top 10 clientes por volumen">
            {m.topClientes.length === 0 ? SIN_DATOS('Sin datos en el período.') : (
              <BarrasHorizontales
                items={m.topClientes.map((c, i) => ({ label: `${i + 1}. ${c.nombre}`, value: c.monto, sublabel: `${c.presupuestos} pres.` }))} />
            )}
          </SeccionCard>
        </div>

        <RankingProductosIngresos productos={m.productosPorIngresos ?? []} desde={pDesde} hasta={pHasta} />

        {/* ── Saldos pendientes + clientes recurrentes ── */}
        <div className={GRID_2}>
          <SeccionCard icon={AlertTriangle} iconClassName="text-yellow-500" titulo="Saldos pendientes globales">
            <div className="space-y-1">
              {[
                { label: 'Vencidos',             value: m.saldosVencidos,    color: 'text-red-400' },
                { label: 'Vencen en 1–15 días',  value: m.saldosPorVencer15, color: 'text-yellow-400' },
                { label: 'Vencen en 16–30 días', value: m.saldosPorVencer30, color: 'text-brand-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex justify-between items-center gap-3 py-2 border-b border-surface-700/50 last:border-0">
                  <span className="text-surface-300 text-sm font-body">{label}</span>
                  <span className={`font-mono font-bold text-sm ${color}`}>{fmt(value)}</span>
                </div>
              ))}
            </div>
            {m.proxSaldos.length > 0 && (
              <div className="mt-4">
                <p className="text-surface-500 text-xs uppercase tracking-widest font-body mb-2">Próximos vencimientos</p>
                <ul className="space-y-1.5">
                  {m.proxSaldos.map((s, i) => (
                    <li key={i} className="flex justify-between gap-3 text-sm min-[1025px]:text-xs font-body">
                      <span className="text-surface-400 min-w-0 break-words">{s.nombre} {s.apellido}</span>
                      <span className="text-white font-mono flex-shrink-0">{fmt(s.montoPendiente)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SeccionCard>

          <SeccionCard icon={Repeat} titulo="Clientes recurrentes vs. nuevos">
            {m.clientesUnicos === 0 ? SIN_DATOS('Sin datos en el período.') : (
              <>
                <GraficoDona unidad="grupos" colores={['#10b981', '#3b82f6']}
                  datos={[{ label: 'Recurrentes', valor: m.clientesRecurrentes }, { label: 'Nuevos', valor: m.clientesNuevos }]} />
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
                    <p className="text-emerald-400 font-mono font-bold text-2xl">{m.clientesRecurrentes}</p>
                    <p className="text-surface-400 text-xs font-body mt-1">Recurrentes</p>
                  </div>
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-center">
                    <p className="text-blue-400 font-mono font-bold text-2xl">{m.clientesNuevos}</p>
                    <p className="text-surface-400 text-xs font-body mt-1">Nuevos</p>
                  </div>
                </div>
              </>
            )}
          </SeccionCard>
        </div>

        {/* ── Categorías + proveedores ── */}
        <div className={GRID_2}>
          <SeccionCard icon={Layers} titulo="Ventas por categoría de producto">
            {m.topCategorias.length === 0 ? SIN_DATOS('Sin ventas en el período.') : (
              <BarrasHorizontales colores={['#8b5cf6', '#a78bfa']}
                items={m.topCategorias.map((c, i) => ({ label: `${i + 1}. ${c.nombre}`, value: c.monto, sublabel: `${c.unidades} u.` }))} />
            )}
          </SeccionCard>

          <SeccionCard icon={Truck} titulo="Top proveedores por compras">
            {m.topProveedores.length === 0 ? SIN_DATOS('Sin pedidos en el período.') : (
              <BarrasHorizontales colores={['#ec4899', '#f472b6']}
                items={m.topProveedores.map((p, i) => ({ label: `${i + 1}. ${p.nombre}`, value: p.monto, sublabel: `${p.pedidos} ped.` }))} />
            )}
          </SeccionCard>
        </div>

        {/* ── Demora de pago por cliente ── */}
        <SeccionCard icon={Clock} iconClassName="text-yellow-500" titulo="Demora de pago por cliente"
          descripcion={`Promedio de días entre vencimiento y pago real en Cuenta Corriente · histórico completo del cliente (${m.demoraPagoPorCliente?.length ?? 0} con pagos registrados) · mayor a menor demora`}
          accion={{ label: 'Ver todos', onClick: () => setModal('demora') }}>
          {!m.demoraPagoPorCliente?.length
            ? SIN_DATOS('Todavía no hay saldos de Cuenta Corriente cobrados con fecha de vencimiento registrada.')
            : (
              <ul className="space-y-1">
                {m.demoraPagoPorCliente.slice(0, 8).map((c, i) => (
                  <li key={c.idCliente}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 border-b border-surface-700/50 last:border-0">
                    <span className="flex items-start gap-2 min-w-0 flex-1">
                      <span className="text-surface-600 font-mono text-xs w-5 flex-shrink-0 pt-0.5">{i + 1}.</span>
                      <span className="text-surface-200 text-sm font-body break-words">{c.nombre}</span>
                    </span>
                    <span className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-surface-500 text-xs font-body whitespace-nowrap">
                        {c.cantPagos} pago{c.cantPagos !== 1 ? 's' : ''}
                      </span>
                      <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded-lg border whitespace-nowrap ${colorDemora(c.demoraPromedioDias)}`}>
                        {fmtDemora(c.demoraPromedioDias)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </SeccionCard>

        {/* ── Impacto de descuentos y recargos ── */}
        <SeccionCard icon={Tag} titulo="Impacto de descuentos y recargos">
          <div className="grid grid-cols-1 sm:grid-cols-2 min-[1025px]:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-surface-700/40 rounded-xl p-4 text-center min-w-0">
              <p className="text-surface-400 text-xs uppercase tracking-widest font-body mb-1">Precio de lista total</p>
              <p className="font-mono font-bold text-white text-lg sm:text-xl break-words">{fmt(listaPrecio)}</p>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center min-w-0">
              <p className="text-emerald-400 text-xs uppercase tracking-widest font-body mb-1">Desc. por promociones</p>
              <p className="font-mono font-bold text-emerald-400 text-lg sm:text-xl break-words">- {fmt(m.descuentosPromos)}</p>
              <p className="text-surface-500 text-xs mt-1 font-body">Promos de producto</p>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center min-w-0">
              <p className="text-emerald-400 text-xs uppercase tracking-widest font-body mb-1">Desc. por método de pago</p>
              <p className="font-mono font-bold text-emerald-400 text-lg sm:text-xl break-words">- {fmt(m.descuentosMetodoPago)}</p>
              <p className="text-surface-500 text-xs mt-1 font-body">Efectivo · Transferencia</p>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center min-w-0">
              <p className="text-red-400 text-xs uppercase tracking-widest font-body mb-1">Recargos CC cobrados</p>
              <p className="font-mono font-bold text-red-400 text-lg sm:text-xl break-words">+ {fmt(m.recargosCC)}</p>
              <p className="text-surface-500 text-xs mt-1 font-body">Cuenta corriente 30d</p>
            </div>
          </div>
        </SeccionCard>
      </div>

      {/* ── Diálogos (estado `modal` en el padre: sobreviven a la rotación) ── */}
      <ModalTopProductos open={modal === 'productos'} onClose={cerrar}
        productos={m.todosProductosVendidos ?? undefined} desde={pDesde} hasta={pHasta} />
      <ModalProductosIncompletos open={modal === 'incompletos'} onClose={cerrar}
        productos={m.productosValorIncompleto ?? undefined} />
      <ModalDemoraClientes open={modal === 'demora'} onClose={cerrar}
        clientes={m.demoraPagoPorCliente ?? undefined} />
      <ModalTicketPromedioClientes key={instanciaTicket} open={modal === 'ticket'} onClose={cerrar}
        desde={desde} hasta={hasta} formatoMonto={formatoMonto} />
    </div>
  )
}
