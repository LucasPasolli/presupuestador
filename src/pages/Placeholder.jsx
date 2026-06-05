// src/pages/Placeholder.jsx

export function Presupuestador() {
  return <PageShell title="Presupuestador" emoji="📝" description="Aquí se cargará el módulo de presupuestación." />
}

export function Historial() {
  return <PageShell title="Historial de Presupuestos" emoji="🕐" description="Lista y detalle de presupuestos emitidos." />
}

export function Inventario() {
  return <PageShell title="Gestión de Inventario" emoji="📦" description="Alta, baja y modificación de productos y categorías." />
}

export function Facturas() {
  return <PageShell title="Generar Factura" emoji="🧾" description="Generación y exportación de documentos de factura en PDF." />
}

export function Estadisticas() {
  return <PageShell title="Estadísticas" emoji="📊" description="Ingresos, egresos y métricas del negocio." />
}

export function PedidosCompra() {
  return <PageShell title="Pedidos de Compra" emoji="🛒" description="Armado de pedidos a proveedores." />
}

export function Saldos() {
  return <PageShell title="Saldos" emoji="💰" description="Cobros pendientes por cuenta corriente." />
}

function PageShell({ title, emoji, description }) {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-surface-800 border border-surface-700 rounded-2xl p-10 text-center animate-slide-up">
        <div className="text-5xl mb-4">{emoji}</div>
        <h1 className="font-display text-4xl text-white tracking-widest mb-3">{title.toUpperCase()}</h1>
        <p className="text-surface-400 font-body">{description}</p>
        <div className="mt-6 inline-flex items-center gap-2 bg-surface-700 border border-surface-600 rounded-full px-4 py-2">
          <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
          <span className="text-surface-300 text-xs font-mono">En construcción</span>
        </div>
      </div>
    </div>
  )
}
