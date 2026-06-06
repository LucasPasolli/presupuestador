// src/pages/ABMC.jsx
// Página de administración: Alta / Baja / Modificación / Consulta de todas las entidades.

import { useState, useEffect, useCallback } from 'react'
import { query, run } from '../lib/database'
import {
  PageHeader, Button, Input, Select, Modal,
  Table, Tr, Td, Badge, Card,
} from '../components/ui'
import {
  Users, Truck, FileText, ShoppingCart,
  Wallet, TrendingDown, TrendingUp, Tag, Plus, Pencil, Trash2,
  AlertTriangle, Info, PiggyBank, ArrowDownCircle,
} from 'lucide-react'

// ─── Tabs config ─────────────────────────────────────────────────────────────

const TABS = [
  { key: 'clientes',       label: 'Clientes',      icon: Users,            color: 'from-brand-500 to-brand-600' },
  { key: 'proveedores',    label: 'Proveedores',    icon: Truck,            color: 'from-brand-500 to-brand-600' },
  { key: 'presupuestos',   label: 'Presupuestos',   icon: FileText,         color: 'from-brand-500 to-brand-600' },
  { key: 'pedidos',        label: 'Pedidos',        icon: ShoppingCart,     color: 'from-brand-500 to-brand-600' },
  { key: 'saldos',         label: 'Saldos',         icon: Wallet,           color: 'from-brand-500 to-brand-600' },
  { key: 'egresos',        label: 'Egresos',        icon: TrendingDown,     color: 'from-brand-500 to-brand-600' },
  { key: 'ingresos',       label: 'Ingresos',       icon: TrendingUp,       color: 'from-brand-500 to-brand-600' },
  { key: 'inversiones',    label: 'Inversiones',    icon: PiggyBank,        color: 'from-brand-500 to-brand-600' },
  { key: 'categorias',     label: 'Categorías',     icon: Tag,              color: 'from-brand-500 to-brand-600' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20

const fmt = (n) =>
  n != null
    ? Number(n).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 })
    : '—'

// Capitaliza la primera letra de un string
const cap = (s) => s ? s.trim().charAt(0).toUpperCase() + s.trim().slice(1) : ''

// ─── Pagination component ─────────────────────────────────────────────────────

function Pagination({ page, total, pageSize, onChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-surface-700">
      <p className="text-surface-400 text-xs font-body tabular-nums">
        {from}–{to} de {total}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1}>← Anterior</Button>
        <Button size="sm" variant="secondary" onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}>Siguiente →</Button>
      </div>
    </div>
  )
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({ search, onSearch, dateFrom, onDateFrom, dateTo, onDateTo, searchPlaceholder, children }) {
  return (
    <div className="flex flex-wrap gap-2 items-center w-full">
      <div className="flex-1 min-w-[160px]">
        <input
          type="text"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder={searchPlaceholder || 'Buscar…'}
          className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500"
        />
      </div>
      <div className="min-w-[130px]">
        <input
          type="date"
          value={dateFrom}
          onChange={e => onDateFrom(e.target.value)}
          className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500"
        />
      </div>
      <div className="min-w-[130px]">
        <input
          type="date"
          value={dateTo}
          onChange={e => onDateTo(e.target.value)}
          className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500"
        />
      </div>
      {children}
    </div>
  )
}

// ─── ConfirmModal ─────────────────────────────────────────────────────────────

function ConfirmModal({ open, onClose, onConfirm, details, message }) {
  return (
    <Modal open={open} onClose={onClose} title="Confirmar eliminación" width="max-w-sm">
      <div className="flex flex-col items-center gap-4 text-center">
        <AlertTriangle size={36} className="text-red-400" />
        {details && details.length > 0 && (
          <div className="w-full bg-surface-700 rounded-xl p-3 text-left space-y-1">
            {details.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 text-xs">
                <span className="text-surface-400">{label}</span>
                <span className="text-surface-200 font-mono truncate max-w-[160px]">{value}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-surface-200 font-body text-sm">{message || '¿Eliminar este registro?'}</p>
        <div className="flex gap-3 w-full">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" className="flex-1" onClick={onConfirm}>Eliminar</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── InfoBanner ───────────────────────────────────────────────────────────────

function InfoBanner({ message }) {
  return (
    <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3">
      <Info size={16} className="text-yellow-400 mt-0.5 shrink-0" />
      <p className="text-yellow-200 text-xs font-body leading-relaxed">{message}</p>
    </div>
  )
}

// ─── Shared dropdown style ────────────────────────────────────────────────────

const dropdownClass = "w-full bg-surface-700 border border-surface-600 rounded-xl pl-3 pr-6 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500"

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENTES
// ═══════════════════════════════════════════════════════════════════════════════

const CLIENTE_BLANK = { nombre: '', apellido: '', apodo: '', nombreComercio: '', cuit: '', domicilio: '', telefono: '', mail: '' }

function Clientes() {
  const [allRows, setAllRows] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(CLIENTE_BLANK)
  const [editId, setEditId] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(() => {
    setAllRows(query('SELECT * FROM Cliente WHERE activo = 1 ORDER BY apellido, nombre'))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search])

  function openCreate() { setForm(CLIENTE_BLANK); setEditId(null); setError(''); setModal(true) }
  function openEdit(r) { setForm({ ...r }); setEditId(r.idCliente); setError(''); setModal(true) }

  function save() {
    if (!form.nombre.trim() || !form.apellido.trim()) { setError('Nombre y Apellido son obligatorios.'); return }
    const nombre         = cap(form.nombre)
    const apellido       = cap(form.apellido)
    const apodo          = cap(form.apodo)
    const nombreComercio = cap(form.nombreComercio)
    const domicilio      = form.domicilio.replace(/\b\w/g, c => c.toUpperCase())
    if (editId) {
      run(`UPDATE Cliente SET nombre=?,apellido=?,apodo=?,nombreComercio=?,cuit=?,domicilio=?,telefono=?,mail=? WHERE idCliente=?`,
        [nombre, apellido, apodo, nombreComercio, form.cuit, domicilio, form.telefono, form.mail, editId])
    } else {
      run(`INSERT INTO Cliente(nombre,apellido,apodo,nombreComercio,cuit,domicilio,telefono,mail) VALUES(?,?,?,?,?,?,?,?)`,
        [nombre, apellido, apodo, nombreComercio, form.cuit, domicilio, form.telefono, form.mail])
    }
    setModal(false); load()
  }

  function del(id) {
    run(`UPDATE Cliente SET activo=0 WHERE idCliente=?`, [id])
    setConfirm(null); load()
  }

  const f = (k) => (e) => {
    let val = e.target.value
    if (k === 'cuit') {
      val = val.replace(/[^0-9-]/g, '')
    } else if (k === 'telefono') {
      val = val.replace(/[^0-9]/g, '')
    } else if (k === 'domicilio') {
      val = val.replace(/\b\w/g, c => c.toUpperCase())
    }
    setForm(p => ({ ...p, [k]: val }))
  }

  const filtered = allRows.filter(r => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    if (/^\d+$/.test(q)) return String(r.idCliente) === q
    const nombreApellido = `${r.nombre} ${r.apellido}`.toLowerCase()
    const apellidoNombre = `${r.apellido} ${r.nombre}`.toLowerCase()
    return nombreApellido.includes(q) || apellidoNombre.includes(q) ||
      r.nombre.toLowerCase().includes(q) || r.apellido.toLowerCase().includes(q)
  })
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const confirmRow = allRows.find(r => r.idCliente === confirm)

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center w-full">
        <div className="flex-1">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por ID, nombre o apellido…"
            className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500"
          />
        </div>
        <Button icon={Plus} onClick={openCreate}>Nuevo cliente</Button>
      </div>

      <Card>
        <Table headers={['ID', 'Apellido', 'Nombre', 'Apodo', 'Comercio', 'CUIT', 'Teléfono', '']}
          empty={paged.length === 0 ? 'Sin clientes registrados' : null}>
          {paged.map(r => (
            <Tr key={r.idCliente}>
              <Td className="text-surface-500 font-mono text-xs">#{r.idCliente}</Td>
              <Td>{r.apellido}</Td>
              <Td>{r.nombre}</Td>
              <Td className="text-surface-400">{r.apodo || '—'}</Td>
              <Td className="text-surface-400">{r.nombreComercio || '—'}</Td>
              <Td className="text-surface-400">{r.cuit || '—'}</Td>
              <Td className="text-surface-400">{r.telefono || '—'}</Td>
              <Td>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(r)} />
                  <Button variant="ghost" size="sm" icon={Trash2} className="hover:text-red-400" onClick={() => setConfirm(r.idCliente)} />
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
        <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar cliente' : 'Nuevo cliente'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Nombre *" value={form.nombre} onChange={f('nombre')} />
            <Input label="Apellido *" value={form.apellido} onChange={f('apellido')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Apodo" value={form.apodo} onChange={f('apodo')} />
            <Input label="Nombre de comercio" value={form.nombreComercio} onChange={f('nombreComercio')} />
          </div>
          <Input label="CUIT" value={form.cuit} onChange={f('cuit')} type="tel" inputMode="numeric" pattern="[0-9-]*" />
          <Input label="Domicilio" value={form.domicilio} onChange={f('domicilio')} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Teléfono" value={form.telefono} onChange={f('telefono')} type="tel" inputMode="numeric" pattern="[0-9+\-() ]*" />
            <Input label="Mail" value={form.mail} onChange={f('mail')} />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
            <Button className="flex-1" onClick={save}>Guardar</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => del(confirm)}
        details={confirmRow ? [
          ['ID', `#${confirmRow.idCliente}`],
          ['Apellido y nombre', `${confirmRow.apellido}, ${confirmRow.nombre}`],
          ['CUIT', confirmRow.cuit || '—'],
        ] : []}
        message="¿Estas seguro de ELIMINAR este cliente?"
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROVEEDORES
// ═══════════════════════════════════════════════════════════════════════════════

const PROV_BLANK = { nombreFiscal: '', nombreComercial: '', identificacionTributaria: '', telefono: '', email: '' }

function Proveedores() {
  const [allRows, setAllRows] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(PROV_BLANK)
  const [editId, setEditId] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(() => {
    setAllRows(query('SELECT * FROM Proveedor ORDER BY nombreFiscal'))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search])

  function openCreate() { setForm(PROV_BLANK); setEditId(null); setError(''); setModal(true) }
  function openEdit(r) { setForm({ ...r }); setEditId(r.idProveedor); setError(''); setModal(true) }

  function save() {
    if (!form.nombreFiscal.trim()) { setError('Nombre fiscal obligatorio.'); return }
    const nombreFiscal     = cap(form.nombreFiscal)
    const nombreComercial  = cap(form.nombreComercial)
    if (editId) {
      run(`UPDATE Proveedor SET nombreFiscal=?,nombreComercial=?,identificacionTributaria=?,telefono=?,email=? WHERE idProveedor=?`,
        [nombreFiscal, nombreComercial, form.identificacionTributaria, form.telefono, form.email, editId])
    } else {
      run(`INSERT INTO Proveedor(nombreFiscal,nombreComercial,identificacionTributaria,telefono,email) VALUES(?,?,?,?,?)`,
        [nombreFiscal, nombreComercial, form.identificacionTributaria, form.telefono, form.email])
    }
    setModal(false); load()
  }

  function del(id) {
    run(`DELETE FROM Proveedor WHERE idProveedor=?`, [id])
    setConfirm(null); load()
  }

  const f = (k) => (e) => {
    let val = e.target.value
    if (k === 'identificacionTributaria') {
      val = val.replace(/[^0-9-]/g, '')
    } else if (k === 'telefono') {
      val = val.replace(/[^0-9]/g, '')
    }
    setForm(p => ({ ...p, [k]: val }))
  }

  const filtered = allRows.filter(r => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    if (/^\d+$/.test(q)) return String(r.idProveedor) === q
    return (
      r.nombreFiscal.toLowerCase().includes(q) ||
      (r.nombreComercial || '').toLowerCase().includes(q)
    )
  })
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const confirmRow = allRows.find(r => r.idProveedor === confirm)

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center w-full">
        <div className="flex-1">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por ID, nombre fiscal o comercial…"
            className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500"
          />
        </div>
        <Button icon={Plus} onClick={openCreate}>Nuevo proveedor</Button>
      </div>

      <Card>
        <Table headers={['ID', 'Nombre fiscal', 'Nombre comercial', 'CUIT/RUT', 'Teléfono', 'Email', '']}
          empty={paged.length === 0 ? 'Sin proveedores' : null}>
          {paged.map(r => (
            <Tr key={r.idProveedor}>
              <Td className="text-surface-500 font-mono text-xs">#{r.idProveedor}</Td>
              <Td>{r.nombreFiscal}</Td>
              <Td className="text-surface-400">{r.nombreComercial || '—'}</Td>
              <Td className="text-surface-400">{r.identificacionTributaria || '—'}</Td>
              <Td className="text-surface-400">{r.telefono || '—'}</Td>
              <Td className="text-surface-400">{r.email || '—'}</Td>
              <Td>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(r)} />
                  <Button variant="ghost" size="sm" icon={Trash2} className="hover:text-red-400" onClick={() => setConfirm(r.idProveedor)} />
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
        <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar proveedor' : 'Nuevo proveedor'}>
        <div className="space-y-4">
          <Input label="Nombre fiscal *" value={form.nombreFiscal} onChange={f('nombreFiscal')} />
          <Input label="Nombre comercial" value={form.nombreComercial} onChange={f('nombreComercial')} />
          <Input label="CUIT / RUT" value={form.identificacionTributaria} onChange={f('identificacionTributaria')} type="tel" inputMode="numeric" pattern="[0-9-]*" />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Teléfono" value={form.telefono} onChange={f('telefono')} type="tel" inputMode="numeric" pattern="[0-9+\-() ]*" />
            <Input label="Email" value={form.email} onChange={f('email')} />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
            <Button className="flex-1" onClick={save}>Guardar</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => del(confirm)}
        details={confirmRow ? [
          ['ID', `#${confirmRow.idProveedor}`],
          ['Nombre fiscal', confirmRow.nombreFiscal],
          ['Nombre comercial', confirmRow.nombreComercial || '—'],
        ] : []}
        message="¿Estas seguro de ELIMINAR este proveedor?"
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRESUPUESTOS
// ═══════════════════════════════════════════════════════════════════════════════

const ESTADO_COLOR = { borrador: 'gray', aprobado: 'blue', pagado: 'green', rechazado: 'red' }
const METODO_LABEL = { efectivo: 'Efectivo', transferencia: 'Transferencia', cc30: 'CC 30d', cc15: 'CC 15d' }
const ES_CC = (m) => m === 'cc30' || m === 'cc15'

function Presupuestos() {
  const [allRows, setAllRows] = useState([])
  const [modal, setModal] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [originalEstado, setOriginalEstado] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(() => {
    setAllRows(query(`
      SELECT p.*, c.nombre || ' ' || c.apellido AS clienteNombre
      FROM Presupuesto p
      LEFT JOIN Cliente c ON c.idCliente = p.idCliente
      ORDER BY p.fecha DESC, p.idPresupuesto DESC
    `))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, dateFrom, dateTo, filtroEstado])

  function openEdit(r) {
    setEditRow({ ...r })
    setOriginalEstado(r.estado)
    setModal(true)
  }

  function save() {
    const isCC = ES_CC(editRow.metodoPago)
    const estadoCambia = editRow.estado !== originalEstado

    if (isCC && estadoCambia && editRow.estado === 'rechazado') {
      run(`DELETE FROM Saldo WHERE idPresupuesto=?`, [editRow.idPresupuesto])
    }

    run(`UPDATE Presupuesto SET estado=?,metodoPago=?,esExcepcion=? WHERE idPresupuesto=?`,
      [editRow.estado, editRow.metodoPago, editRow.esExcepcion, editRow.idPresupuesto])
    setModal(false); load()
  }

  function del(id) {
    run(`DELETE FROM Saldo WHERE idPresupuesto=?`, [id])
    run(`DELETE FROM Presupuesto WHERE idPresupuesto=?`, [id])
    setConfirm(null); load()
  }

  const filtered = allRows.filter(r => {
    const q = search.trim().toLowerCase()
    const matchEstado = !filtroEstado || r.estado === filtroEstado
    const matchFrom = !dateFrom || r.fecha >= dateFrom
    const matchTo = !dateTo || r.fecha <= dateTo
    if (!q) return matchEstado && matchFrom && matchTo
    // Búsqueda exacta por ID
    if (/^\d+$/.test(q)) return String(r.idPresupuesto) === q && matchEstado && matchFrom && matchTo
    const matchQ = (r.clienteNombre || '').toLowerCase().includes(q)
    return matchQ && matchEstado && matchFrom && matchTo
  })
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const confirmRow = allRows.find(r => r.idPresupuesto === confirm)

  const showCCWarning = editRow && ES_CC(editRow.metodoPago)
    && editRow.estado !== originalEstado && editRow.estado !== 'rechazado'
  const showCCRechazo = editRow && ES_CC(editRow.metodoPago)
    && editRow.estado !== originalEstado && editRow.estado === 'rechazado'

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center w-full">
        <div className="flex-1">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por ID o cliente…"
            className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
        </div>
        <div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
        </div>
        <div>
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} className={dropdownClass + ' w-auto'}>
            <option value="">Todos los estados</option>
            {['borrador','aprobado','pagado','rechazado'].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      <Card>
        <Table headers={['#', 'Fecha', 'Cliente', 'Método', 'Monto', 'Estado', '']}
          empty={paged.length === 0 ? 'Sin presupuestos' : null}>
          {paged.map(r => (
            <Tr key={r.idPresupuesto}>
              <Td className="text-surface-500 font-mono text-xs">#{r.idPresupuesto}</Td>
              <Td className="text-surface-400">{r.fecha}</Td>
              <Td>{r.clienteNombre}</Td>
              <Td className="text-surface-400">{METODO_LABEL[r.metodoPago] ?? r.metodoPago}</Td>
              <Td>{fmt(r.monto)}</Td>
              <Td><Badge color={ESTADO_COLOR[r.estado] ?? 'gray'}>{r.estado.charAt(0).toUpperCase() + r.estado.slice(1)}</Badge></Td>
              <Td>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(r)} />
                  <Button variant="ghost" size="sm" icon={Trash2} className="hover:text-red-400" onClick={() => setConfirm(r.idPresupuesto)} />
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
        <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="Editar presupuesto">
        {editRow && (
          <div className="space-y-4">
            <p className="text-surface-400 text-xs">Presupuesto #{editRow.idPresupuesto} — {editRow.clienteNombre}</p>

            {showCCWarning && (
              <InfoBanner message="Atención: estás modificando solo el estado del presupuesto. El saldo de cuenta corriente asociado NO se actualiza automáticamente — podés revisarlo y ajustarlo en la sección Saldos." />
            )}
            {showCCRechazo && (
              <InfoBanner message="Al rechazar este presupuesto de cuenta corriente, el saldo asociado será eliminado automáticamente." />
            )}

            <Select label="Estado" value={editRow.estado}
              onChange={e => setEditRow(p => ({ ...p, estado: e.target.value }))}>
              {['borrador','aprobado','pagado','rechazado'].map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </Select>
            <Select label="Método de pago" value={editRow.metodoPago}
              onChange={e => setEditRow(p => ({ ...p, metodoPago: e.target.value }))}>
              {Object.entries(METODO_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select label="Excepción" value={editRow.esExcepcion}
              onChange={e => setEditRow(p => ({ ...p, esExcepcion: Number(e.target.value) }))}>
              <option value={0}>No</option>
              <option value={1}>Sí</option>
            </Select>
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={save}>Guardar</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => del(confirm)}
        details={confirmRow ? [
          ['ID', `#${confirmRow.idPresupuesto}`],
          ['Cliente', confirmRow.clienteNombre],
          ['Fecha', confirmRow.fecha],
          ['Monto', fmt(confirmRow.monto)],
          ['Estado', confirmRow.estado],
        ] : []}
        message="¿Eliminar este presupuesto y todos sus detalles?"
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PEDIDOS DE COMPRA
// ═══════════════════════════════════════════════════════════════════════════════

const EPAGO_COLOR = { pendiente: 'yellow', pagado: 'green' }
const ELOGISTICO_COLOR = { encargado: 'blue', recibido: 'green' }

function Pedidos() {
  const [allRows, setAllRows] = useState([])
  const [modal, setModal] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(() => {
    setAllRows(query(`
      SELECT pc.*, p.nombreFiscal AS provNombre
      FROM PedidoCompra pc
      LEFT JOIN Proveedor p ON p.idProveedor = pc.idProveedor
      ORDER BY pc.fecha DESC, pc.idPedido DESC
    `))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, dateFrom, dateTo])

  function openEdit(r) { setEditRow({ ...r }); setModal(true) }

  function save() {
    const pedidoActual = query(`SELECT estadoLogistico FROM PedidoCompra WHERE idPedido=?`, [editRow.idPedido])[0]
    const estadoAnterior = pedidoActual?.estadoLogistico
    const revirtiendo = estadoAnterior === 'recibido' && editRow.estadoLogistico === 'encargado'
    const recibiendo  = estadoAnterior === 'encargado' && editRow.estadoLogistico === 'recibido'

    if (revirtiendo) {
      // Restar el stock que fue sumado cuando se marcó como recibido
      const detalles = query(`SELECT * FROM DetallePedidoCompra WHERE idPedido=?`, [editRow.idPedido])
      for (const d of detalles) {
        if (!d.idProducto) continue
        const prod = query(`SELECT tieneMedidas FROM Producto WHERE idProducto=?`, [d.idProducto])[0]
        if (!prod) continue
        if (prod.tieneMedidas && d.medida) {
          run(`UPDATE ProductoMedida SET cantidad = MAX(0, cantidad - ?) WHERE idProducto=? AND medida=?`,
            [d.cantidad, d.idProducto, d.medida])
          const total = query(`SELECT COALESCE(SUM(cantidad),0) AS t FROM ProductoMedida WHERE idProducto=?`, [d.idProducto])[0].t
          run(`UPDATE Producto SET cantidad=? WHERE idProducto=?`, [total, d.idProducto])
        } else {
          run(`UPDATE Producto SET cantidad = MAX(0, cantidad - ?) WHERE idProducto=?`,
            [d.cantidad, d.idProducto])
        }
      }
    }

    if (recibiendo) {
      // Sumar stock al inventario (mismo flujo que PedidosCompra.jsx)
      const detalles = query(`SELECT * FROM DetallePedidoCompra WHERE idPedido=?`, [editRow.idPedido])
      for (const d of detalles) {
        if (!d.idProducto) continue
        const prod = query(`SELECT tieneMedidas FROM Producto WHERE idProducto=?`, [d.idProducto])[0]
        if (!prod) continue
        if (prod.tieneMedidas && d.medida) {
          const existe = query(
            `SELECT idMedida FROM ProductoMedida WHERE idProducto=? AND medida=?`,
            [d.idProducto, d.medida]
          )[0]
          if (existe) {
            run(`UPDATE ProductoMedida SET cantidad = cantidad + ? WHERE idProducto=? AND medida=?`,
              [d.cantidad, d.idProducto, d.medida])
          } else {
            run(`INSERT INTO ProductoMedida (idProducto, medida, cantidad) VALUES (?,?,?)`,
              [d.idProducto, d.medida, d.cantidad])
          }
          const total = query(`SELECT COALESCE(SUM(cantidad),0) AS t FROM ProductoMedida WHERE idProducto=?`, [d.idProducto])[0].t
          run(`UPDATE Producto SET cantidad=? WHERE idProducto=?`, [total, d.idProducto])
        } else {
          run(`UPDATE Producto SET cantidad = cantidad + ? WHERE idProducto=?`,
            [d.cantidad, d.idProducto])
        }
      }
    }

    run(`UPDATE PedidoCompra SET estadoPago=?,estadoLogistico=?,metodoPago=?,fechaRecepcion=?,fechaPago=? WHERE idPedido=?`,
      [editRow.estadoPago, editRow.estadoLogistico, editRow.metodoPago,
       editRow.fechaRecepcion || null, editRow.fechaPago || null, editRow.idPedido])
    setModal(false); load()
  }

  function del(id) {
    run(`DELETE FROM PedidoCompra WHERE idPedido=?`, [id])
    setConfirm(null); load()
  }

  const fe = (k) => (e) => setEditRow(p => ({ ...p, [k]: e.target.value }))

  const filtered = allRows.filter(r => {
    const q = search.trim().toLowerCase()
    const matchFrom = !dateFrom || r.fecha >= dateFrom
    const matchTo = !dateTo || r.fecha <= dateTo
    if (!q) return matchFrom && matchTo
    if (/^\d+$/.test(q)) return String(r.idPedido) === q && matchFrom && matchTo
    const matchQ = (r.provNombre || '').toLowerCase().includes(q)
    return matchQ && matchFrom && matchTo
  })
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const confirmRow = allRows.find(r => r.idPedido === confirm)

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center w-full">
        <div className="flex-1">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por ID o proveedor…"
            className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
        </div>
        <div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
        </div>
      </div>

      <Card>
        <Table headers={['#', 'Fecha', 'Proveedor', 'Monto', 'Método', 'Pago', 'Logística', '']}
          empty={paged.length === 0 ? 'Sin pedidos' : null}>
          {paged.map(r => (
            <Tr key={r.idPedido}>
              <Td className="text-surface-500 font-mono text-xs">#{r.idPedido}</Td>
              <Td className="text-surface-400">{r.fecha}</Td>
              <Td>{r.provNombre || '—'}</Td>
              <Td>{fmt(r.monto)}</Td>
              <Td className="text-surface-400">{r.metodoPago ? r.metodoPago.charAt(0).toUpperCase() + r.metodoPago.slice(1) : '—'}</Td>
              <Td><Badge color={EPAGO_COLOR[r.estadoPago] ?? 'gray'}>{r.estadoPago.charAt(0).toUpperCase() + r.estadoPago.slice(1)}</Badge></Td>
              <Td><Badge color={ELOGISTICO_COLOR[r.estadoLogistico] ?? 'gray'}>{r.estadoLogistico.charAt(0).toUpperCase() + r.estadoLogistico.slice(1)}</Badge></Td>
              <Td>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(r)} />
                  <Button variant="ghost" size="sm" icon={Trash2} className="hover:text-red-400" onClick={() => setConfirm(r.idPedido)} />
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
        <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="Editar pedido de compra">
        {editRow && (
          <div className="space-y-4">
            <p className="text-surface-400 text-xs">Pedido #{editRow.idPedido} — {fmt(editRow.monto)}</p>
            <div className="grid grid-cols-2 gap-4">
              <Select label="Estado pago" value={editRow.estadoPago} onChange={fe('estadoPago')}>
                <option value="pendiente">Pendiente</option>
                <option value="pagado">Pagado</option>
              </Select>
              <Select label="Estado logístico" value={editRow.estadoLogistico} onChange={fe('estadoLogistico')}>
                <option value="encargado">Encargado</option>
                <option value="recibido">Recibido</option>
              </Select>
              <Select label="Método de pago" value={editRow.metodoPago || 'efectivo'} onChange={fe('metodoPago')}>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="echeck">E-check</option>
              </Select>
              <Input label="Fecha recepción" type="date" value={editRow.fechaRecepcion || ''} onChange={fe('fechaRecepcion')} />
              <Input label="Fecha pago" type="date" value={editRow.fechaPago || ''} onChange={fe('fechaPago')} />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={save}>Guardar</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => del(confirm)}
        details={confirmRow ? [
          ['ID', `#${confirmRow.idPedido}`],
          ['Fecha', confirmRow.fecha],
          ['Proveedor', confirmRow.provNombre || '—'],
          ['Monto', fmt(confirmRow.monto)],
        ] : []}
        message="¿Eliminar este pedido y todos sus detalles?"
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SALDOS
// ═══════════════════════════════════════════════════════════════════════════════

function Saldos() {
  const [allRows, setAllRows] = useState([])
  const [modal, setModal] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(() => {
    setAllRows(query(`
      SELECT s.*, c.nombre || ' ' || c.apellido AS clienteNombre
      FROM Saldo s
      LEFT JOIN Cliente c ON c.idCliente = s.idCliente
      ORDER BY s.fechaFin ASC
    `))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, dateFrom, dateTo, filtroEstado])

  function openEdit(r) { setEditRow({ ...r }); setModal(true) }

  function save() {
    run(`UPDATE Saldo SET estado=?,fechaPago=? WHERE idSaldo=?`,
      [editRow.estado, editRow.fechaPago || null, editRow.idSaldo])
    setModal(false); load()
  }

  function del(id) {
    run(`DELETE FROM Saldo WHERE idSaldo=?`, [id])
    setConfirm(null); load()
  }

  const fe = (k) => (e) => setEditRow(p => ({ ...p, [k]: e.target.value }))

  const filtered = allRows.filter(r => {
    const q = search.trim().toLowerCase()
    const matchEstado = !filtroEstado || r.estado === filtroEstado
    const matchFrom = !dateFrom || r.fechaFin >= dateFrom
    const matchTo = !dateTo || r.fechaFin <= dateTo
    if (!q) return matchEstado && matchFrom && matchTo
    if (/^\d+$/.test(q)) return String(r.idSaldo) === q && matchEstado && matchFrom && matchTo
    const matchQ = (r.clienteNombre || '').toLowerCase().includes(q)
    return matchQ && matchEstado && matchFrom && matchTo
  })
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const confirmRow = allRows.find(r => r.idSaldo === confirm)

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center w-full">
        <div className="flex-1">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por ID o nombre de cliente…"
            className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
        </div>
        <div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
        </div>
        <div>
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} className={dropdownClass + ' w-auto'}>
            <option value="">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="pagado">Pagado</option>
          </select>
        </div>
      </div>

      <Card>
        <Table headers={['#', 'Cliente', 'Presup.', 'Monto', 'Vence', 'Estado', '']}
          empty={paged.length === 0 ? 'Sin saldos' : null}>
          {paged.map(r => (
            <Tr key={r.idSaldo}>
              <Td className="text-surface-500 font-mono text-xs">#{r.idSaldo}</Td>
              <Td>{r.clienteNombre}</Td>
              <Td className="text-surface-400 font-mono text-xs">#{r.idPresupuesto}</Td>
              <Td>{fmt(r.monto)}</Td>
              <Td className="text-surface-400">{r.fechaFin}</Td>
              <Td><Badge color={r.estado === 'pagado' ? 'green' : 'yellow'}>{r.estado.charAt(0).toUpperCase() + r.estado.slice(1)}</Badge></Td>
              <Td>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(r)} />
                  <Button variant="ghost" size="sm" icon={Trash2} className="hover:text-red-400" onClick={() => setConfirm(r.idSaldo)} />
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
        <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="Editar saldo">
        {editRow && (
          <div className="space-y-4">
            <p className="text-surface-400 text-xs">Saldo #{editRow.idSaldo} — {editRow.clienteNombre} — {fmt(editRow.monto)}</p>
            <Select label="Estado" value={editRow.estado} onChange={fe('estado')}>
              <option value="pendiente">Pendiente</option>
              <option value="pagado">Pagado</option>
            </Select>
            <Input label="Fecha de pago" type="date" value={editRow.fechaPago || ''} onChange={fe('fechaPago')} />
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={save}>Guardar</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => del(confirm)}
        details={confirmRow ? [
          ['ID saldo', `#${confirmRow.idSaldo}`],
          ['Presupuesto', `#${confirmRow.idPresupuesto}`],
          ['Cliente', confirmRow.clienteNombre],
          ['Monto', fmt(confirmRow.monto)],
          ['Estado', confirmRow.estado],
        ] : []}
        message="¿Eliminar este saldo?"
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// EGRESOS
// ═══════════════════════════════════════════════════════════════════════════════

const CATEGORIAS_EGRESO = ['ART', 'Comida', 'Envíos', 'Flete', 'Impuesto a las ganancias', 'Ingresos Brutos', 'IVA', 'Seguro de vida', 'Servicios', 'Sueldo', 'Transporte', 'Otro']
const EGRESO_BLANK = { fecha: new Date().toISOString().slice(0, 10), categoria: 'Otro', descripcion: '', monto: '', metodoPago: 'efectivo' }

function Egresos() {
  const [allRows, setAllRows] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EGRESO_BLANK)
  const [editId, setEditId] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filtCat, setFiltCat] = useState('')
  const [filtMetodo, setFiltMetodo] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(() => {
    setAllRows(query('SELECT * FROM Egreso ORDER BY fecha DESC'))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, dateFrom, dateTo, filtCat, filtMetodo])

  function openCreate() { setForm({ ...EGRESO_BLANK }); setEditId(null); setError(''); setModal(true) }
  function openEdit(r) { setForm({ ...r }); setEditId(r.idEgreso); setError(''); setModal(true) }

  function save() {
    if (!form.descripcion.trim()) { setError('La descripción es obligatoria.'); return }
    if (!form.monto || Number(form.monto) <= 0) { setError('El monto debe ser mayor a 0.'); return }
    const descripcion = cap(form.descripcion)
    if (editId) {
      run(`UPDATE Egreso SET fecha=?,categoria=?,descripcion=?,monto=?,metodoPago=? WHERE idEgreso=?`,
        [form.fecha, form.categoria, descripcion, Number(form.monto), form.metodoPago, editId])
    } else {
      run(`INSERT INTO Egreso(fecha,categoria,descripcion,monto,metodoPago) VALUES(?,?,?,?,?)`,
        [form.fecha, form.categoria, descripcion, Number(form.monto), form.metodoPago])
    }
    setModal(false); load()
  }

  function del(id) {
    run(`DELETE FROM Egreso WHERE idEgreso=?`, [id])
    setConfirm(null); load()
  }

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))
  const fn = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value === '' ? '' : Number(e.target.value) }))

  const filtered = allRows.filter(r => {
    const q = search.trim().toLowerCase()
    const matchCat = !filtCat || r.categoria === filtCat
    const matchMetodo = !filtMetodo || r.metodoPago === filtMetodo
    const matchFrom = !dateFrom || r.fecha >= dateFrom
    const matchTo = !dateTo || r.fecha <= dateTo
    if (!q) return matchCat && matchMetodo && matchFrom && matchTo
    if (/^\d+$/.test(q)) return String(r.idEgreso) === q && matchCat && matchMetodo && matchFrom && matchTo
    const matchQ = r.descripcion.toLowerCase().includes(q) || r.categoria.toLowerCase().includes(q)
    return matchQ && matchCat && matchMetodo && matchFrom && matchTo
  })
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const confirmRow = allRows.find(r => r.idEgreso === confirm)

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center w-full flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por descripción…"
            className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
        </div>
        <div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
        </div>
        <div>
          <select value={filtCat} onChange={e => setFiltCat(e.target.value)} className={dropdownClass + ' w-auto'}>
            <option value="">Todas las categorías</option>
            {CATEGORIAS_EGRESO.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <select value={filtMetodo} onChange={e => setFiltMetodo(e.target.value)} className={dropdownClass + ' w-auto'}>
            <option value="">Todos los métodos</option>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
        <Button icon={Plus} onClick={openCreate}>Nuevo egreso</Button>
      </div>

      <Card>
        <Table headers={['Fecha', 'Categoría', 'Descripción', 'Método', 'Monto', '']}
          empty={paged.length === 0 ? 'Sin egresos' : null}>
          {paged.map(r => (
            <Tr key={r.idEgreso}>
              <Td className="text-surface-400">{r.fecha}</Td>
              <Td><Badge color="red">{r.categoria}</Badge></Td>
              <Td>{r.descripcion}</Td>
              <Td className="text-surface-400">{r.metodoPago.charAt(0).toUpperCase() + r.metodoPago.slice(1)}</Td>
              <Td className="text-red-300 font-semibold">{fmt(r.monto)}</Td>
              <Td>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(r)} />
                  <Button variant="ghost" size="sm" icon={Trash2} className="hover:text-red-400" onClick={() => setConfirm(r.idEgreso)} />
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
        <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar egreso' : 'Nuevo egreso'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Fecha *" type="date" value={form.fecha} onChange={f('fecha')} />
            <Select label="Categoría" value={form.categoria} onChange={f('categoria')}>
              {CATEGORIAS_EGRESO.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
          <Input label="Descripción *" value={form.descripcion} onChange={f('descripcion')}
            placeholder="Ej: Sueldo Marzo — Empleado X" />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Monto *" type="number" min="0" value={form.monto} onChange={fn('monto')}
              placeholder="Ej: 50000"
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            <Select label="Método de pago" value={form.metodoPago} onChange={f('metodoPago')}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
            </Select>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
            <Button className="flex-1" onClick={save}>Guardar</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => del(confirm)}
        details={confirmRow ? [
          ['ID', `#${confirmRow.idEgreso}`],
          ['Fecha', confirmRow.fecha],
          ['Categoría', confirmRow.categoria],
          ['Descripción', confirmRow.descripcion],
          ['Monto', fmt(confirmRow.monto)],
        ] : []}
        message="¿Eliminar este egreso?"
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// INGRESOS
// ═══════════════════════════════════════════════════════════════════════════════

const CATEGORIAS_INGRESO = ['FCI', 'Plazo fijo', 'Acciones', 'Otro']
const INGRESO_BLANK = { fecha: new Date().toISOString().slice(0, 10), categoria: 'Otro', descripcion: '', monto: '' }

function Ingresos() {
  const [allRows, setAllRows] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(INGRESO_BLANK)
  const [editId, setEditId] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filtCat, setFiltCat] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(() => {
    setAllRows(query('SELECT * FROM Ingreso ORDER BY fecha DESC, idIngreso DESC'))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, dateFrom, dateTo, filtCat])

  function openCreate() { setForm({ ...INGRESO_BLANK }); setEditId(null); setError(''); setModal(true) }
  function openEdit(r) { setForm({ ...r }); setEditId(r.idIngreso); setError(''); setModal(true) }

  function save() {
    if (!form.descripcion.trim()) { setError('La descripción es obligatoria.'); return }
    if (!form.monto || Number(form.monto) <= 0) { setError('El monto debe ser mayor a 0.'); return }
    const descripcion = cap(form.descripcion)
    if (editId) {
      run(`UPDATE Ingreso SET fecha=?,categoria=?,descripcion=?,monto=? WHERE idIngreso=?`,
        [form.fecha, form.categoria, descripcion, Number(form.monto), editId])
    } else {
      run(`INSERT INTO Ingreso(fecha,categoria,descripcion,monto) VALUES(?,?,?,?)`,
        [form.fecha, form.categoria, descripcion, Number(form.monto)])
    }
    setModal(false); load()
  }

  function del(id) {
    run(`DELETE FROM Ingreso WHERE idIngreso=?`, [id])
    setConfirm(null); load()
  }

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))
  const fn = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value === '' ? '' : Number(e.target.value) }))

  const filtered = allRows.filter(r => {
    const q = search.trim().toLowerCase()
    const matchCat = !filtCat || r.categoria === filtCat
    const matchFrom = !dateFrom || r.fecha >= dateFrom
    const matchTo = !dateTo || r.fecha <= dateTo
    if (!q) return matchCat && matchFrom && matchTo
    if (/^\d+$/.test(q)) return String(r.idIngreso) === q && matchCat && matchFrom && matchTo
    const matchQ = r.descripcion.toLowerCase().includes(q) || (r.categoria || '').toLowerCase().includes(q)
    return matchQ && matchCat && matchFrom && matchTo
  })
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const confirmRow = allRows.find(r => r.idIngreso === confirm)

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center w-full flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por ID o descripción…"
            className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
        </div>
        <div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
        </div>
        <div>
          <select value={filtCat} onChange={e => setFiltCat(e.target.value)} className={dropdownClass + ' w-auto'}>
            <option value="">Todas las categorías</option>
            {CATEGORIAS_INGRESO.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Button icon={Plus} onClick={openCreate}>Nuevo ingreso</Button>
      </div>

      <Card>
        <Table headers={['#', 'Fecha', 'Categoría', 'Descripción', 'Monto', '']}
          empty={paged.length === 0 ? 'Sin ingresos registrados' : null}>
          {paged.map(r => (
            <Tr key={r.idIngreso}>
              <Td className="text-surface-500 font-mono text-xs">#{r.idIngreso}</Td>
              <Td className="text-surface-400">{r.fecha}</Td>
              <Td><Badge color="blue">{r.categoria ?? 'Otro'}</Badge></Td>
              <Td>{r.descripcion}</Td>
              <Td className="text-green-300 font-semibold">{fmt(r.monto)}</Td>
              <Td>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(r)} />
                  <Button variant="ghost" size="sm" icon={Trash2} className="hover:text-red-400" onClick={() => setConfirm(r.idIngreso)} />
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
        <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar ingreso' : 'Nuevo ingreso'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Fecha *" type="date" value={form.fecha} onChange={f('fecha')} />
            <Select label="Categoría" value={form.categoria} onChange={f('categoria')}>
              {CATEGORIAS_INGRESO.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
          <Input label="Descripción *" value={form.descripcion} onChange={f('descripcion')}
            placeholder="Ej: Ingreso de FCI — Renta Variable" />
          <Input label="Monto *" type="number" min="0" value={form.monto} onChange={fn('monto')}
            placeholder="Ej: 120000"
            className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
            <Button className="flex-1" onClick={save}>Guardar</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => del(confirm)}
        details={confirmRow ? [
          ['ID', `#${confirmRow.idIngreso}`],
          ['Fecha', confirmRow.fecha],
          ['Categoría', confirmRow.categoria ?? '—'],
          ['Descripción', confirmRow.descripcion],
          ['Monto', fmt(confirmRow.monto)],
        ] : []}
        message="¿Eliminar este ingreso?"
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVERSIONES
// ═══════════════════════════════════════════════════════════════════════════════

const CATEGORIAS_INV = ['FCI', 'Plazo fijo', 'Acciones', 'Otro']
const INV_BLANK = { fecha: new Date().toISOString().slice(0, 10), categoria: 'FCI', descripcion: '', monto: '' }

function Inversiones() {
  const [allRows, setAllRows] = useState([])
  const [modal, setModal] = useState(false)
  const [modalRetiro, setModalRetiro] = useState(false)
  const [form, setForm] = useState(INV_BLANK)
  const [editId, setEditId] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filtCat, setFiltCat] = useState('')
  const [page, setPage] = useState(1)
  // Para retiro: categoría seleccionada y monto
  const [retirarCat, setRetirarCat] = useState('FCI')
  const [retirarMonto, setRetirarMonto] = useState('')
  const [retirarFecha, setRetirarFecha] = useState(new Date().toISOString().slice(0, 10))
  const [errorRetiro, setErrorRetiro] = useState('')

  const load = useCallback(() => {
    setAllRows(query('SELECT * FROM Inversion ORDER BY fecha DESC, idInversion DESC'))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, dateFrom, dateTo, filtCat])

  function openCreate() { setForm({ ...INV_BLANK }); setEditId(null); setError(''); setModal(true) }
  function openEdit(r) { setForm({ ...r }); setEditId(r.idInversion); setError(''); setModal(true) }

  function save() {
    if (!form.descripcion.trim()) { setError('La descripción es obligatoria.'); return }
    if (!form.monto || Number(form.monto) <= 0) { setError('El monto debe ser mayor a 0.'); return }
    const descripcion = cap(form.descripcion)
    if (editId) {
      const original = allRows.find(r => r.idInversion === editId)
      if (original?.estado === 'retirado') {
        // Para retiros: calcular cuánto hay disponible SIN contar este retiro
        const disponibleSinEste = allRows
          .filter(r => r.categoria === original.categoria && r.idInversion !== editId)
          .reduce((a, r) => a + (r.estado === 'invertido' ? r.monto : -r.monto), 0)
        if (Number(form.monto) > disponibleSinEste) {
          setError(`El retiro no puede superar el disponible de ${fmt(disponibleSinEste)}.`); return
        }
        // Solo actualizar fecha y monto — categoría y estado se preservan del original
        run(`UPDATE Inversion SET fecha=?,monto=? WHERE idInversion=?`,
          [form.fecha, Number(form.monto), editId])
      } else {
        run(`UPDATE Inversion SET fecha=?,categoria=?,descripcion=?,monto=?,estado=? WHERE idInversion=?`,
          [form.fecha, form.categoria, descripcion, Number(form.monto), form.estado ?? 'invertido', editId])
      }
    } else {
      run(`INSERT INTO Inversion(fecha,categoria,descripcion,monto,estado) VALUES(?,?,?,?,?)`,
        [form.fecha, form.categoria, descripcion, Number(form.monto), 'invertido'])
    }
    setModal(false); load()
  }

  function del(id) {
    run(`DELETE FROM Inversion WHERE idInversion=?`, [id])
    setConfirm(null); load()
  }

  function abrirRetiro() {
    setRetirarCat('FCI'); setRetirarMonto('')
    setRetirarFecha(new Date().toISOString().slice(0, 10))
    setErrorRetiro(''); setModalRetiro(true)
  }

  function guardarRetiro() {
    const monto = Number(retirarMonto)
    if (!retirarMonto || monto <= 0) { setErrorRetiro('El monto debe ser mayor a 0.'); return }
    const disponible = allRows
      .filter(r => r.categoria === retirarCat)
      .reduce((a, r) => a + (r.estado === 'invertido' ? r.monto : -Math.abs(r.monto)), 0)
    if (monto > disponible) {
      setErrorRetiro(`El monto supera el disponible de ${fmt(disponible)} en ${retirarCat}.`); return
    }
    run(`INSERT INTO Inversion(fecha,categoria,descripcion,monto,estado) VALUES(?,?,?,?,?)`,
      [retirarFecha, retirarCat, `Retiro ${retirarCat}`, monto, 'retirado'])
    setModalRetiro(false); load()
  }

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))
  const fn = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value === '' ? '' : Number(e.target.value) }))

  // Totales por categoría (invertido - retirado)
  const totalesPorCat = CATEGORIAS_INV.map(cat => {
    const rows = allRows.filter(r => r.categoria === cat)
    const invertido = rows.filter(r => r.estado === 'invertido').reduce((a, r) => a + r.monto, 0)
    const retirado  = rows.filter(r => r.estado === 'retirado').reduce((a, r) => a + r.monto, 0)
    return { cat, neto: invertido - retirado, invertido, retirado }
  }).filter(t => t.invertido > 0 || t.retirado > 0)

  const totalGeneral = totalesPorCat.reduce((a, t) => a + t.neto, 0)

  const filtered = allRows.filter(r => {
    const q = search.trim().toLowerCase()
    const matchCat = !filtCat || r.categoria === filtCat
    const matchFrom = !dateFrom || r.fecha >= dateFrom
    const matchTo = !dateTo || r.fecha <= dateTo
    if (!q) return matchCat && matchFrom && matchTo
    if (/^\d+$/.test(q)) return String(r.idInversion) === q && matchCat && matchFrom && matchTo
    return (r.descripcion.toLowerCase().includes(q) || r.categoria.toLowerCase().includes(q)) && matchCat && matchFrom && matchTo
  })
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const confirmRow = allRows.find(r => r.idInversion === confirm)

  return (
    <div className="space-y-4">
      {/* Resumen por categoría — siempre visible */}
      <div className="border-t border-surface-700/60" />
      <div className="space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {CATEGORIAS_INV.map(cat => {
            const t = totalesPorCat.find(t => t.cat === cat)
            const neto = t?.neto ?? 0
            const invertido = t?.invertido ?? 0
            const retirado = t?.retirado ?? 0
            return (
              <div key={cat} className="rounded-2xl p-4" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)' }}>
                <p className="text-xs uppercase tracking-widest font-body" style={{ color: '#a5b4fc' }}>{cat}</p>
                <p className={`font-mono font-bold text-2xl mt-1`} style={{ color: neto > 0 ? '#c7d2fe' : neto < 0 ? '#f87171' : '#6b7280' }}>
                  {fmt(neto)}
                </p>
              </div>
            )
          })}
        </div>
        <div className="rounded-2xl px-5 py-4 flex items-center justify-between" style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)' }}>
          <div>
            <p className="text-xs uppercase tracking-widest font-body" style={{ color: '#c4b5fd' }}>Total invertido neto</p>
          </div>
          <p className="font-mono font-bold text-2xl" style={{ color: totalGeneral > 0 ? '#ddd6fe' : totalGeneral < 0 ? '#f87171' : '#6b7280' }}>
            {fmt(totalGeneral)}
          </p>
        </div>
      </div>

      {/* Separador sutil entre resumen de inversiones y controles */}
      <div className="border-t border-surface-700/60" />

      <div className="flex gap-2 items-center w-full flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por ID o descripción…"
            className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500" />
        </div>
        <div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
        </div>
        <div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 [color-scheme:dark]" />
        </div>
        <div>
          <select value={filtCat} onChange={e => setFiltCat(e.target.value)} className={dropdownClass + ' w-auto'}>
            <option value="">Todas las categorías</option>
            {CATEGORIAS_INV.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Button icon={ArrowDownCircle} variant="secondary" onClick={abrirRetiro}>Registrar retiro</Button>
        <Button icon={Plus} onClick={openCreate} className="bg-teal-600/80 hover:bg-teal-500/90 border-teal-500/50 text-white">Nueva inversión</Button>
      </div>

      <Card>
        <Table headers={['#', 'Fecha', 'Categoría', 'Descripción', 'Estado', 'Monto', '']}
          empty={paged.length === 0 ? 'Sin inversiones registradas' : null}>
          {paged.map(r => (
            <Tr key={r.idInversion}>
              <Td className="text-surface-500 font-mono text-xs">#{r.idInversion}</Td>
              <Td className="text-surface-400">{r.fecha}</Td>
              <Td><Badge color="violet">{r.categoria}</Badge></Td>
              <Td>{r.descripcion}</Td>
              <Td><Badge color={r.estado === 'invertido' ? 'green' : 'red'}>{r.estado.charAt(0).toUpperCase() + r.estado.slice(1)}</Badge></Td>
              <Td className={`font-semibold ${r.estado === 'invertido' ? 'text-emerald-300' : 'text-red-300'}`}>
                {r.estado === 'retirado' ? '−' : ''}{fmt(r.monto)}
              </Td>
              <Td>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(r)} />
                  <Button variant="ghost" size="sm" icon={Trash2} className="hover:text-red-400" onClick={() => setConfirm(r.idInversion)} />
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
        <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </Card>

      {/* Modal nueva inversión / editar */}
      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar inversión' : 'Nueva inversión'}>
        <div className="space-y-4">
          {(() => {
            const original = allRows.find(r => r.idInversion === editId)
            const esRetiro = original?.estado === 'retirado'
            const disponibleSinEste = esRetiro
              ? allRows.filter(r => r.categoria === original.categoria && r.idInversion !== editId)
                  .reduce((a, r) => a + (r.estado === 'invertido' ? r.monto : -r.monto), 0)
              : null
            return (
              <>
                {editId ? (
                  /* Edición: mostrar categoría y estado como solo lectura */
                  <>
                    <div className="grid grid-cols-2 gap-3 bg-surface-700/40 rounded-xl p-3">
                      <div>
                        <p className="text-surface-500 text-xs font-body mb-0.5">Categoría</p>
                        <p className="text-surface-300 text-sm font-body">{form.categoria}</p>
                      </div>
                      <div>
                        <p className="text-surface-500 text-xs font-body mb-0.5">Estado</p>
                        <Badge color={form.estado === 'invertido' ? 'green' : 'red'}>{form.estado}</Badge>
                      </div>
                    </div>
                    <Input label="Fecha *" type="date" value={form.fecha} onChange={f('fecha')} />
                    {!esRetiro && (
                      <Input label="Descripción *" value={form.descripcion} onChange={f('descripcion')}
                        placeholder="Ej: FCI Renta Variable — Apertura" />
                    )}
                    <div>
                      <Input
                        label={esRetiro ? `Monto a retirar * (máx. ${fmt(disponibleSinEste)})` : 'Monto *'}
                        type="number" min="0"
                        placeholder="Ej: 100000"
                        value={form.monto === '' ? '' : form.monto}
                        onChange={e => setForm(p => ({ ...p, monto: e.target.value === '' ? '' : Number(e.target.value) }))}
                        className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                      {esRetiro && Number(form.monto) > disponibleSinEste && form.monto !== '' && (
                        <p className="text-red-400 text-xs mt-1">Supera el disponible de {fmt(disponibleSinEste)}</p>
                      )}
                    </div>
                  </>
                ) : (
                  /* Creación: todos los campos */
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <Input label="Fecha *" type="date" value={form.fecha} onChange={f('fecha')} />
                      <Select label="Categoría" value={form.categoria} onChange={f('categoria')}>
                        {CATEGORIAS_INV.map(c => <option key={c} value={c}>{c}</option>)}
                      </Select>
                    </div>
                    <Input label="Descripción *" value={form.descripcion} onChange={f('descripcion')}
                      placeholder="Ej: FCI Renta Variable — Apertura" />
                    <Input label="Monto *" type="number" min="0"
                      placeholder="Ej: 100000"
                      value={form.monto === '' ? '' : form.monto}
                      onChange={e => setForm(p => ({ ...p, monto: e.target.value === '' ? '' : Number(e.target.value) }))}
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  </>
                )}
              </>
            )
          })()}
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
            <Button className="flex-1" onClick={save}>Guardar</Button>
          </div>
        </div>
      </Modal>

      {/* Modal retiro */}
      <Modal open={modalRetiro} onClose={() => setModalRetiro(false)} title="Registrar retiro de inversión">
        <div className="space-y-4">
          <Select label="Categoría a retirar" value={retirarCat} onChange={e => { setRetirarCat(e.target.value); setRetirarMonto(0); setErrorRetiro('') }}>
            {CATEGORIAS_INV.map(c => {
              const t = totalesPorCat.find(t => t.cat === c)
              return <option key={c} value={c}>{c}{t ? ` — disponible ${fmt(t.neto)}` : ' — sin fondos'}</option>
            })}
          </Select>
          <Input label="Fecha *" type="date" value={retirarFecha} onChange={e => setRetirarFecha(e.target.value)} />
          <div>
            {(() => {
              const disponible = totalesPorCat.find(t => t.cat === retirarCat)?.neto ?? 0
              const excede = Number(retirarMonto) > disponible
              return (
                <>
                  <Input
                    label={`Monto a retirar * (máx. ${fmt(disponible)})`}
                    type="number" min="0" max={disponible}
                    placeholder="Ej: 50000"
                    value={retirarMonto}
                    onChange={e => { setRetirarMonto(e.target.value); setErrorRetiro('') }}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  {excede && retirarMonto !== '' && (
                    <p className="text-red-400 text-xs mt-1">Supera el disponible de {fmt(disponible)}</p>
                  )}
                </>
              )
            })()}
          </div>
          {errorRetiro && <p className="text-red-400 text-xs">{errorRetiro}</p>}
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setModalRetiro(false)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" onClick={guardarRetiro}>Confirmar retiro</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => del(confirm)}
        details={confirmRow ? [
          ['ID', `#${confirmRow.idInversion}`],
          ['Fecha', confirmRow.fecha],
          ['Categoría', confirmRow.categoria],
          ['Descripción', confirmRow.descripcion],
          ['Monto', fmt(confirmRow.monto)],
          ['Estado', confirmRow.estado],
        ] : []}
        message="¿Eliminar este registro de inversión?"
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORÍAS DE PRODUCTO
// ═══════════════════════════════════════════════════════════════════════════════

const CAT_BLANK = { nombre: '' }

function Categorias() {
  const [allRows, setAllRows] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(CAT_BLANK)
  const [editId, setEditId] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(() => {
    setAllRows(query(`
      SELECT c.*, COUNT(p.idProducto) AS cantProductos
      FROM Categoria c
      LEFT JOIN Producto p ON p.idCategoria = c.idCategoria
      GROUP BY c.idCategoria
      ORDER BY c.nombre
    `))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search])

  function openCreate() { setForm(CAT_BLANK); setEditId(null); setError(''); setModal(true) }
  function openEdit(r) { setForm({ nombre: r.nombre }); setEditId(r.idCategoria); setError(''); setModal(true) }

  function save() {
    if (!form.nombre.trim()) { setError('El nombre es obligatorio.'); return }
    const nombre = cap(form.nombre)
    if (editId) {
      run(`UPDATE Categoria SET nombre=? WHERE idCategoria=?`, [nombre, editId])
    } else {
      run(`INSERT INTO Categoria(nombre) VALUES(?)`, [nombre])
    }
    setModal(false); load()
  }

  function del(id) {
    try { run(`DELETE FROM Categoria WHERE idCategoria=?`, [id]) }
    catch { alert('No se puede eliminar: tiene productos asociados.') }
    setConfirm(null); load()
  }

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))

  const filtered = allRows.filter(r => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    if (/^\d+$/.test(q)) return String(r.idCategoria) === q
    return r.nombre.toLowerCase().includes(q)
  })
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const confirmRow = allRows.find(r => r.idCategoria === confirm)

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center w-full">
        <div className="flex-1">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por ID o nombre…"
            className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500"
          />
        </div>
        <Button icon={Plus} onClick={openCreate}>Nueva categoría</Button>
      </div>

      <Card>
        <Table headers={['ID', 'Nombre', 'Productos', '']}
          empty={paged.length === 0 ? 'Sin categorías' : null}>
          {paged.map(r => (
            <Tr key={r.idCategoria}>
              <Td className="text-surface-500 font-mono text-xs">#{r.idCategoria}</Td>
              <Td>{r.nombre}</Td>
              <Td className="text-surface-400">{r.cantProductos}</Td>
              <Td>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(r)} />
                  <Button variant="ghost" size="sm" icon={Trash2} className="hover:text-red-400" onClick={() => setConfirm(r.idCategoria)} />
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
        <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar categoría' : 'Nueva categoría'}>
        <div className="space-y-4">
          <Input label="Nombre *" value={form.nombre} onChange={f('nombre')}
            placeholder="Ej: Filtros, Frenos, Eléctrico…" />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
            <Button className="flex-1" onClick={save}>Guardar</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => del(confirm)}
        details={confirmRow ? [
          ['ID', `#${confirmRow.idCategoria}`],
          ['Nombre', confirmRow.nombre],
          ['Productos asociados', confirmRow.cantProductos],
        ] : []}
        message="¿Eliminar esta categoría? Solo es posible si no tiene productos asociados."
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL ABMC
// ═══════════════════════════════════════════════════════════════════════════════

const PANEL = {
  clientes:     Clientes,
  proveedores:  Proveedores,
  presupuestos: Presupuestos,
  pedidos:      Pedidos,
  saldos:       Saldos,
  egresos:      Egresos,
  ingresos:     Ingresos,
  inversiones:  Inversiones,
  categorias:   Categorias,
}

export default function ABMC() {
  const [active, setActive] = useState('clientes')
  const ActivePanel = PANEL[active]

  const TabBtn = ({ tab }) => {
    const { key, label, icon: Icon, color } = tab
    return (
      <button
        key={key}
        onClick={() => setActive(key)}
        className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-body border transition-all duration-200 flex-1 min-w-0
          ${active === key
            ? 'bg-surface-700 border-surface-500 text-white shadow-lg'
            : 'bg-surface-800 border-surface-700 text-surface-400 hover:text-white hover:border-surface-600'
          }`}
      >
        <div className={`w-5 h-5 rounded-md bg-gradient-to-br ${color} flex items-center justify-center shrink-0`}>
          <Icon size={11} className="text-white" />
        </div>
        <span className="truncate hidden sm:inline">{label}</span>
      </button>
    )
  }

  const row1 = TABS.slice(0, 5)
  const row2 = TABS.slice(5)

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader title="ABMC" subtitle="Administración" />

      <div className="space-y-2">
        <div className="flex gap-2 w-full">
          {row1.map(tab => <TabBtn key={tab.key} tab={tab} />)}
        </div>
        <div className="flex gap-2 w-full">
          {row2.map(tab => <TabBtn key={tab.key} tab={tab} />)}
        </div>
      </div>

      <div className="animate-fade-in" key={active}>
        <ActivePanel />
      </div>
    </div>
  )
}
