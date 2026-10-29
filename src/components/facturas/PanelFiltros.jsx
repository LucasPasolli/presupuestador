// src/components/facturas/PanelFiltros.jsx
// Período + filtros (cliente o CUIT, estado) en UN solo nivel visual: sin
// títulos ni contenedores anidados, los campos y las acciones son hermanos.
//   · desktop → una única fila (se parte en dos si el ancho no alcanza).
//   · mobile/tablet → una barra con el período y dos acciones; los filtros se
//     editan en un panel a pantalla completa con controles de 44 px y
//     tipografía de 16 px (evita el zoom automático de iOS).
// El borrador vive acá y se compromete sólo con "Ver período"/"Ver resultados"
// o Enter: no se dispara una consulta por cada tecla.
import { useEffect, useId, useState } from 'react'
import { AlertCircle, Calendar, Eye, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { Badge, Button, Card, Input, Select } from '../ui'
import FullScreenSheet from '../ui/FullScreenSheet'
import useBreakpoint from '../../hooks/useBreakpoint'
import { ESTADO_OPCIONES, FILTROS_VACIOS, contarFiltros, describirFiltros, fmtFecha } from '../../lib/facturas'
import { TOQUE } from './estilos'

function Alerta({ children, className = '' }) {
  return (
    <div role="alert" className={`flex items-start gap-2 text-red-400 text-base sm:text-sm bg-red-500/10
                                  border border-red-500/20 rounded-xl px-4 py-2.5 font-body ${className}`}>
      <AlertCircle size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

/**
 * Los cuatro campos, como hermanos directos del contenedor (fragmento).
 * `hoja`: dentro del panel táctil (alto de 44 px; cliente y estado a ancho completo).
 */
function Campos({ b, set, hoja }) {
  const alto = hoja ? 'min-h-[44px]' : ''
  const cliente = (
    <Input label="Cliente o CUIT" type="text" inputMode="search" enterKeyHint="search" autoComplete="off"
      maxLength={60} placeholder="Nombre, apellido o CUIT" value={b.cliente}
      onChange={(e) => set({ cliente: e.target.value })} className={alto} />
  )
  const estado = (
    <Select label="Estado" value={b.estado} onChange={(e) => set({ estado: e.target.value })} className={alto}>
      {ESTADO_OPCIONES.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
    </Select>
  )
  return (
    <>
      <Input label="Desde" type="date" value={b.desde} onChange={(e) => set({ desde: e.target.value })}
        className={`[color-scheme:dark] ${alto}`} required />
      <Input label="Hasta" type="date" value={b.hasta} onChange={(e) => set({ hasta: e.target.value })}
        className={`[color-scheme:dark] ${alto}`} required />
      {hoja ? <div className="col-span-2">{cliente}</div> : cliente}
      {hoja ? <div className="col-span-2">{estado}</div>  : estado}
    </>
  )
}

/**
 * @param {object} props
 * @param {string} props.desde               Período APLICADO.
 * @param {string} props.hasta
 * @param {import('../../lib/facturas').FiltrosFactura} props.filtros   Filtros APLICADOS.
 * @param {boolean} props.cargando
 * @param {string} props.error
 * @param {(v: {desde: string, hasta: string, filtros: import('../../lib/facturas').FiltrosFactura}) => Promise<boolean>} props.onAplicar
 *   Devuelve `true` si se aplicó (el panel se cierra) o `false` si hubo error (queda abierto).
 * @param {() => Promise<unknown>} props.onActualizar  Vuelve a consultar el período vigente.
 */
export default function PanelFiltros({ desde, hasta, filtros, cargando, error, onAplicar, onActualizar }) {
  const { isCompact } = useBreakpoint()
  const formId = useId()
  const aplicado = { desde, hasta, ...filtros }
  const [b, setB]             = useState(aplicado)
  const [abierto, setAbierto] = useState(false)

  // Si el padre cambia lo aplicado (p. ej. "Limpiar filtros" del listado vacío), el borrador lo sigue.
  useEffect(() => { setB({ desde, hasta, ...filtros }) }, [desde, hasta, filtros])

  const set     = (parcial) => setB((prev) => ({ ...prev, ...parcial }))
  const limpiar = () => set({ ...FILTROS_VACIOS })
  const abrir   = () => { setB(aplicado); setAbierto(true) }

  async function enviar(e) {
    e.preventDefault()
    const { desde: d, hasta: h, ...f } = b
    const ok = await onAplicar({ desde: d, hasta: h, filtros: f })
    if (ok) setAbierto(false)
  }

  // ── Desktop: una fila, todo hermano ──
  if (!isCompact) {
    return (
      <Card className="p-4">
        <form onSubmit={enviar} noValidate
          className="grid items-end gap-3 grid-cols-[9.5rem_9.5rem_minmax(0,1fr)_11rem_auto_auto]">
          <Campos b={b} set={set} />
          <Button variant="ghost" onClick={limpiar}>Limpiar</Button>
          <Button type="submit" icon={Eye} loading={cargando}>{cargando ? 'Cargando…' : 'Ver período'}</Button>
          {error && <Alerta className="col-span-full">{error}</Alerta>}
        </form>
      </Card>
    )
  }

  // ── Mobile / tablet: barra única ──
  const activos = describirFiltros(filtros)
  const n = contarFiltros(filtros)
  return (
    <>
      <Card className="p-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p className="flex items-center gap-2 text-surface-100 text-base font-mono tabular-nums">
          <Calendar size={16} className="text-brand-500 flex-shrink-0" aria-hidden="true" />
          <span className="sr-only">Período: </span>{fmtFecha(desde)} al {fmtFecha(hasta)}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" icon={RefreshCw} className={TOQUE} loading={cargando} onClick={onActualizar}>
            Actualizar
          </Button>
          <Button icon={SlidersHorizontal} className={TOQUE} onClick={abrir} aria-haspopup="dialog">
            Filtros{n > 0 ? ` (${n})` : ''}
          </Button>
        </div>
        {activos.length > 0 && (
          <ul className="flex flex-wrap gap-2 basis-full" aria-label="Filtros activos">
            {activos.map((a) => <li key={a}><Badge color="gray">{a}</Badge></li>)}
          </ul>
        )}
        {error && !abierto && <Alerta className="basis-full">{error}</Alerta>}
      </Card>

      <FullScreenSheet open={abierto} onClose={() => setAbierto(false)} title="Filtros"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className={TOQUE} onClick={limpiar}>Limpiar</Button>
            <Button type="submit" form={formId} className={TOQUE} loading={cargando}>Ver resultados</Button>
          </div>
        }>
        <form id={formId} onSubmit={enviar} noValidate className="grid grid-cols-2 gap-3">
          <Campos b={b} set={set} hoja />
          {error && <Alerta className="col-span-2">{error}</Alerta>}
        </form>
      </FullScreenSheet>
    </>
  )
}
