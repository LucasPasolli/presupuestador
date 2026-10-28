// Criterios de aceptación 1, 2, 3, 6 y 7 sobre los componentes presentacionales.
import { useState } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PedidosListado from './PedidosListado'
import FiltrosPedidos, { FILTROS_INICIALES } from './FiltrosPedidos'

let ancho = 390
const listeners = new Set()
beforeEach(() => {
  listeners.clear()
  window.matchMedia = (q) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(q)[1])
    return { get matches() { return ancho >= min },
      addEventListener: (_, f) => listeners.add(f), removeEventListener: (_, f) => listeners.delete(f) }
  }
})
afterEach(() => { delete window.matchMedia })
const rotar = (px) => act(() => { ancho = px; listeners.forEach((f) => f()) })

const pedidos = [
  { idPedido: 7, fecha: '2026-10-01', nombreProveedor: 'Ferretería Sur', monto: 150000, metodoPago: 'efectivo', estadoPago: 'pendiente', estadoLogistico: 'encargado' },
  { idPedido: 8, fecha: '2026-10-02', nombreProveedor: 'Corralón Norte', monto: 90000, metodoPago: 'cuenta_corriente', tieneCuotas: true, estadoPago: 'pendiente', estadoLogistico: 'recibido' },
]
const listado = (extra = {}) => (
  <PedidosListado pedidos={pedidos} cuotasResumen={{ 8: { cuotasPendientes: 2 } }} totalSinFiltrar={2}
    loading={false} error={null} onRetry={() => {}} onAbrir={extra.onAbrir ?? (() => {})} />
)

describe('PedidosListado', () => {
  it('E1 mobile: tarjetas con número, proveedor, estado y total; sin <table>', () => {
    ancho = 390
    render(listado())
    expect(document.querySelector('table')).toBeNull()
    const card = screen.getByRole('button', { name: /Abrir pedido 7 de Ferretería Sur/ })
    expect(card).toHaveTextContent('#7'); expect(card).toHaveTextContent('Encargado'); expect(card).toHaveTextContent('150.000')
  })

  it('E2 tablet: 5 columnas prioritarias y secundarias en detalle expandible', async () => {
    ancho = 800
    render(listado())
    expect(screen.getAllByRole('columnheader')).toHaveLength(5)
    expect(screen.queryByText('Fecha pedido', { selector: 'dt' })).toBeNull()
    const abrir = vi.fn()
    await userEvent.click(screen.getByRole('button', { name: /Ver más datos del pedido 7/ }))
    expect(screen.getByText("Fecha pedido", { selector: "dt" })).toBeTruthy()
    expect(screen.getAllByText('01/10/2026').length).toBeGreaterThan(0)
  })

  it('E2 el chevron expande SIN navegar al detalle', async () => {
    ancho = 800
    const onAbrir = vi.fn()
    render(listado({ onAbrir }))
    await userEvent.click(screen.getByRole('button', { name: /Ver más datos del pedido 7/ }))
    expect(onAbrir).not.toHaveBeenCalled()
    await userEvent.click(screen.getByText('Ferretería Sur'))
    expect(onAbrir).toHaveBeenCalledWith(pedidos[0])
  })

  it('desktop: tabla completa de 8 columnas', () => {
    ancho = 1400
    render(listado())
    expect(screen.getAllByRole('columnheader')).toHaveLength(8)
  })

  it('E6 rotar mantiene la fila expandida (tablet portrait ↔ landscape)', async () => {
    ancho = 800
    render(listado())
    await userEvent.click(screen.getByRole('button', { name: /Ver más datos del pedido 7/ }))
    rotar(1024)
    expect(screen.getByRole('button', { name: /Ocultar más datos del pedido 7/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('estados límite: vacío, cargando y error con reintento', async () => {
    ancho = 390
    const { rerender } = render(<PedidosListado pedidos={[]} cuotasResumen={{}} totalSinFiltrar={0} loading={false} error={null} onRetry={() => {}} onAbrir={() => {}} />)
    expect(screen.getByText('Sin pedidos registrados.')).toBeTruthy()
    rerender(<PedidosListado pedidos={[]} cuotasResumen={{}} totalSinFiltrar={0} loading error={null} onRetry={() => {}} onAbrir={() => {}} />)
    expect(screen.getByText(/Cargando pedidos/)).toBeTruthy()
    const retry = vi.fn()
    rerender(<PedidosListado pedidos={[]} cuotasResumen={{}} totalSinFiltrar={0} loading={false} error={new Error('x')} onRetry={retry} onAbrir={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(retry).toHaveBeenCalled()
  })
})

function Host({ compact }) {
  const [v, setV] = useState(FILTROS_INICIALES)
  return (<><FiltrosPedidos value={v} onChange={setV} compact={compact} /><output data-testid="v">{JSON.stringify(v)}</output></>)
}
const estado = () => JSON.parse(screen.getByTestId('v').textContent)

describe('FiltrosPedidos', () => {
  it('E3 mobile: panel a pantalla completa; aplica y limpia', async () => {
    render(<Host compact />)
    await userEvent.click(screen.getByRole('button', { name: /Filtros/ }))
    const dlg = screen.getByRole('dialog')
    await userEvent.selectOptions(within(dlg).getByLabelText('Estado logístico'), 'recibido')
    expect(estado().filterLog).toBe('all')                       // borrador: aún no aplicado
    await userEvent.click(within(dlg).getByRole('button', { name: 'Aplicar' }))
    expect(estado().filterLog).toBe('recibido')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: /Filtros \(1\)/ })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /Filtros/ }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Limpiar' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aplicar' }))
    expect(estado()).toEqual(FILTROS_INICIALES)
  })

  it('cerrar con Escape descarta el borrador', async () => {
    render(<Host compact />)
    await userEvent.click(screen.getByRole('button', { name: /Filtros/ }))
    await userEvent.selectOptions(screen.getByLabelText('Estado de pago'), 'pagado')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(estado().filterEst).toBe('all')
  })

  it('rango de fechas incoherente bloquea "Aplicar"', async () => {
    render(<Host compact />)
    await userEvent.click(screen.getByRole('button', { name: /Filtros/ }))
    const dlg = screen.getByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText('Hasta'), '2026-01-01')
    await userEvent.type(within(dlg).getByLabelText('Desde'), '2026-02-01')
    expect(within(dlg).getByRole('button', { name: 'Aplicar' })).toBeDisabled()
  })

  it('E6 rotar a escritorio conserva filtros y cierra el panel', async () => {
    const { rerender } = render(<Host compact />)
    await userEvent.type(screen.getByRole('searchbox'), 'sur')
    await userEvent.click(screen.getByRole('button', { name: /Filtros/ }))
    await userEvent.selectOptions(screen.getByLabelText('Estado de pago'), 'pagado')
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    rerender(<Host compact={false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('searchbox')).toHaveValue('sur')
    expect(screen.getByLabelText('Estado de pago')).toHaveValue('pagado')
  })
})

describe('con el ui real (Card sólo reenvía className)', () => {
  it('el error del listado conserva role="alert" (no se pierde en Card)', () => {
    ancho = 390
    render(<PedidosListado pedidos={[]} cuotasResumen={{}} totalSinFiltrar={0} loading={false} error={new Error('x')} onRetry={() => {}} onAbrir={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/No se pudieron cargar/)
  })
  it('la carga conserva role="status"', () => {
    ancho = 390
    render(<PedidosListado pedidos={[]} cuotasResumen={{}} totalSinFiltrar={0} loading error={null} onRetry={() => {}} onAbrir={() => {}} />)
    expect(screen.getAllByRole('status').some(n => /Cargando pedidos/.test(n.textContent))).toBe(true)
  })
  it('E5: el Badge ya no fija 12 px en táctil', () => {
    ancho = 390
    render(listado())
    const badge = document.querySelector('span.rounded-full')
    expect(badge.className).toMatch(/\btext-sm\b/)
    expect(badge.className).toContain('min-[1025px]:text-xs')
  })
})
