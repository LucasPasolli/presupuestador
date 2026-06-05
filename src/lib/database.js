// src/lib/database.js
// Motor actual : sql.js (SQLite en browser) + localStorage
// Motor destino: Supabase / PostgreSQL
//
// NOTA DE MIGRACIÓN: Este archivo conserva la capa sql.js para desarrollo local.
// El schema ya está escrito con tipos y convenciones de PostgreSQL para facilitar
// la migración: SERIAL, NUMERIC(12,2), BOOLEAN, DATE, TIMESTAMPTZ, CHECK con ENUMs.
// Al migrar a Supabase, eliminar initDB / persistDB / query / run y reemplazarlos
// por el cliente @supabase/supabase-js.

import { PRODUCTOS_SEED, CLIENTES_SEED, PROVEEDORES_SEED } from './seedData.js'

let db = null

// Incrementar esta key cada vez que el schema cambie para forzar re-creación de la BD local.
const DB_STORAGE_KEY = 'motoparts_db_v8'

// ─── Persistencia local (solo sql.js) ────────────────────────────────────────

export function persistDB() {
  if (!db) return
  const data = db.export()
  localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(Array.from(data)))
}

// ─── Inicialización ──────────────────────────────────────────────────────────

export async function initDB() {
  if (db) return db

  if (typeof window.initSqlJs !== 'function') {
    throw new Error(
      'sql.js no está disponible en window.initSqlJs. ' +
      'Asegurate de que el <script> del CDN cargó correctamente.'
    )
  }

  const SQL = await window.initSqlJs({
    locateFile: (file) =>
      `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/${file}`,
  })

  const saved = localStorage.getItem(DB_STORAGE_KEY)
  if (saved) {
    const buffer = new Uint8Array(JSON.parse(saved))
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  runSchema()
  return db
}

// ─── Schema completo ─────────────────────────────────────────────────────────
// Refleja el estado actual del modelo de datos.
// Tipos elegidos para máxima compatibilidad con PostgreSQL / Supabase:
//   · SERIAL PRIMARY KEY        → AUTOINCREMENT en SQLite; SERIAL en PG
//   · NUMERIC(12,2)             → REAL en SQLite; NUMERIC en PG (sin pérdida de precisión)
//   · BOOLEAN / 0|1             → INTEGER CHECK en SQLite; BOOLEAN en PG
//   · DATE / TIMESTAMPTZ        → TEXT en SQLite; DATE/TIMESTAMPTZ en PG
//
// Los índices cubren las columnas usadas habitualmente en WHERE, JOIN y ORDER BY.

function runSchema() {

  // ── Categoría ────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS Categoria (
      idCategoria  INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre       TEXT    NOT NULL UNIQUE
    );
  `)

  // ── Proveedor ────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS Proveedor (
      idProveedor              INTEGER PRIMARY KEY AUTOINCREMENT,
      nombreFiscal             TEXT NOT NULL,
      nombreComercial          TEXT,
      identificacionTributaria TEXT,
      telefono                 TEXT,
      email                    TEXT
    );
  `)

  // ── Cliente ──────────────────────────────────────────────────────────────
  // activo: soft-delete (1 = activo, 0 = inactivo).
  // Preserva el historial de presupuestos sin exponer el cliente en búsquedas.
  db.run(`
    CREATE TABLE IF NOT EXISTS Cliente (
      idCliente      INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre         TEXT    NOT NULL,
      apellido       TEXT    NOT NULL,
      cuit           TEXT,
      domicilio      TEXT,
      telefono       TEXT,
      mail           TEXT,
      apodo          TEXT,
      nombreComercio TEXT,
      activo         INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1))
    );
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_cliente_activo ON Cliente(activo);`)

  // ── Producto ─────────────────────────────────────────────────────────────
  // tieneMedidas: indica si el producto usa la tabla ProductoMedida para el stock.
  db.run(`
    CREATE TABLE IF NOT EXISTS Producto (
      idProducto      INTEGER PRIMARY KEY AUTOINCREMENT,
      idCategoria     INTEGER NOT NULL DEFAULT 1,
      nombre          TEXT    NOT NULL,
      precioProveedor REAL    NOT NULL DEFAULT 0,
      precioUnitario  REAL    NOT NULL DEFAULT 0,
      cantidad        INTEGER NOT NULL DEFAULT 0,
      tieneMedidas    INTEGER NOT NULL DEFAULT 0 CHECK(tieneMedidas IN (0,1)),
      puntoReposicion INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (idCategoria) REFERENCES Categoria(idCategoria) ON DELETE RESTRICT
    );
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_producto_categoria ON Producto(idCategoria);`)

  // ── ProductoMedida ───────────────────────────────────────────────────────
  // Stock por medida para productos que lo requieren (ej: rulimanes).
  db.run(`
    CREATE TABLE IF NOT EXISTS ProductoMedida (
      idMedida   INTEGER PRIMARY KEY AUTOINCREMENT,
      idProducto INTEGER NOT NULL,
      medida     TEXT    NOT NULL CHECK(medida IN ('standard','0.25','0.50','0.75','1.00','1.25','1.50','1.75','2.00')),
      cantidad   INTEGER NOT NULL DEFAULT 0,
      UNIQUE(idProducto, medida),
      FOREIGN KEY (idProducto) REFERENCES Producto(idProducto) ON DELETE CASCADE
    );
  `)

  // ── Presupuesto ──────────────────────────────────────────────────────────
  // nombreCliente / apellidoCliente: snapshot del cliente al momento de creación.
  // Garantiza que renombrar o eliminar un cliente no afecte el historial ni el PDF.
  // esExcepcion: indica precios fuera de la lista regular.
  db.run(`
    CREATE TABLE IF NOT EXISTS Presupuesto (
      idPresupuesto   INTEGER PRIMARY KEY AUTOINCREMENT,
      idCliente       INTEGER NOT NULL,
      fecha           TEXT    NOT NULL,
      metodoPago      TEXT    NOT NULL CHECK(metodoPago IN ('efectivo','transferencia','cc30','cc15')),
      montoOriginal   REAL    NOT NULL DEFAULT 0,
      monto           REAL    NOT NULL DEFAULT 0,
      nombreCliente   TEXT,
      apellidoCliente TEXT,
      estado          TEXT    NOT NULL DEFAULT 'borrador' CHECK(estado IN ('borrador','aprobado','pagado','rechazado')),
      esExcepcion     INTEGER NOT NULL DEFAULT 0 CHECK(esExcepcion IN (0,1)),
      FOREIGN KEY (idCliente) REFERENCES Cliente(idCliente) ON DELETE RESTRICT
    );
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_presupuesto_cliente ON Presupuesto(idCliente);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_presupuesto_estado  ON Presupuesto(estado);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_presupuesto_fecha   ON Presupuesto(fecha);`)

  // ── DetallePresupuesto ───────────────────────────────────────────────────
  // nombreProducto: snapshot del nombre del producto.
  // Garantiza que renombrar o eliminar un producto no destruya el dato histórico.
  db.run(`
    CREATE TABLE IF NOT EXISTS DetallePresupuesto (
      idDetalle      INTEGER PRIMARY KEY AUTOINCREMENT,
      idPresupuesto  INTEGER NOT NULL,
      idProducto     INTEGER NOT NULL,
      nombreProducto TEXT,
      medida         TEXT,
      cantidad       INTEGER NOT NULL,
      precioUnitario REAL    NOT NULL,
      subtotal       REAL    NOT NULL,
      FOREIGN KEY (idPresupuesto) REFERENCES Presupuesto(idPresupuesto) ON DELETE CASCADE,
      FOREIGN KEY (idProducto)    REFERENCES Producto(idProducto)       ON DELETE RESTRICT
    );
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_detallepres_presupuesto ON DetallePresupuesto(idPresupuesto);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_detallepres_producto    ON DetallePresupuesto(idProducto);`)

  // ── Saldo ────────────────────────────────────────────────────────────────
  // Registra saldos pendientes de presupuestos aprobados con cuenta corriente.
  db.run(`
    CREATE TABLE IF NOT EXISTS Saldo (
      idSaldo       INTEGER PRIMARY KEY AUTOINCREMENT,
      idPresupuesto INTEGER NOT NULL UNIQUE,
      idCliente     INTEGER NOT NULL,
      fechaInicio   TEXT    NOT NULL,
      fechaFin      TEXT    NOT NULL,
      fechaPago     TEXT,
      monto         REAL    NOT NULL,
      estado        TEXT    NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','pagado')),
      FOREIGN KEY (idPresupuesto) REFERENCES Presupuesto(idPresupuesto) ON DELETE CASCADE,
      FOREIGN KEY (idCliente)     REFERENCES Cliente(idCliente)         ON DELETE RESTRICT
    );
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_saldo_cliente ON Saldo(idCliente);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_saldo_estado  ON Saldo(estado);`)

  // ── PedidoCompra ─────────────────────────────────────────────────────────
  // nombreProveedor: snapshot del proveedor.
  // Garantiza que eliminar un proveedor no haga desaparecer el nombre en el historial.
  db.run(`
    CREATE TABLE IF NOT EXISTS PedidoCompra (
      idPedido        INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha           TEXT    NOT NULL,
      monto           REAL    NOT NULL DEFAULT 0,
      estadoPago      TEXT    NOT NULL DEFAULT 'pendiente' CHECK(estadoPago      IN ('pendiente','pagado')),
      estadoLogistico TEXT    NOT NULL DEFAULT 'encargado' CHECK(estadoLogistico IN ('encargado','recibido','revisar')),
      fechaRecepcion  TEXT,
      fechaPago       TEXT,
      metodoPago      TEXT             DEFAULT 'efectivo'  CHECK(metodoPago      IN ('efectivo','transferencia','echeck')),
      idProveedor     INTEGER,
      nombreProveedor TEXT,
      FOREIGN KEY (idProveedor) REFERENCES Proveedor(idProveedor) ON DELETE SET NULL
    );
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_pedido_proveedor       ON PedidoCompra(idProveedor);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_pedido_estadopago      ON PedidoCompra(estadoPago);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_pedido_estadologistico ON PedidoCompra(estadoLogistico);`)

  // ── DetallePedidoCompra ──────────────────────────────────────────────────
  // nombreProducto: snapshot del nombre del producto al momento del pedido.
  db.run(`
    CREATE TABLE IF NOT EXISTS DetallePedidoCompra (
      idDetallePedido INTEGER PRIMARY KEY AUTOINCREMENT,
      idPedido        INTEGER NOT NULL,
      idProducto      INTEGER,
      nombreProducto  TEXT,
      medida          TEXT,
      cantidad        INTEGER NOT NULL,
      precioUnitario  REAL    NOT NULL,
      subtotal        REAL    NOT NULL,
      FOREIGN KEY (idPedido)    REFERENCES PedidoCompra(idPedido)   ON DELETE CASCADE,
      FOREIGN KEY (idProducto)  REFERENCES Producto(idProducto)     ON DELETE SET NULL
    );
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_detallepedido_pedido   ON DetallePedidoCompra(idPedido);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_detallepedido_producto ON DetallePedidoCompra(idProducto);`)

  // ── Egreso ───────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS Egreso (
      idEgreso    INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha       TEXT    NOT NULL,
      categoria   TEXT    NOT NULL CHECK(categoria IN (
                    'Sueldo','Transporte','Comida','Servicios','Flete',
                    'Envíos','ART','Seguro de vida','IVA',
                    'Ingresos Brutos','Impuesto a las ganancias','Otro'
                  )),
      descripcion TEXT    NOT NULL,
      monto       REAL    NOT NULL DEFAULT 0,
      metodoPago  TEXT    NOT NULL DEFAULT 'efectivo' CHECK(metodoPago IN ('efectivo','transferencia','cheque'))
    );
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_egreso_fecha     ON Egreso(fecha);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_egreso_categoria ON Egreso(categoria);`)

  // ── Ingreso ──────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS Ingreso (
      idIngreso   INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha       TEXT    NOT NULL,
      categoria   TEXT    NOT NULL DEFAULT 'Otro' CHECK(categoria IN ('FCI','Plazo fijo','Acciones','Otro')),
      descripcion TEXT    NOT NULL,
      monto       REAL    NOT NULL DEFAULT 0
    );
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_ingreso_fecha ON Ingreso(fecha);`)

  // ── Inversion ─────────────────────────────────────────────────────────────
  // estado: 'invertido' = capital activo, 'retirado' = capital retirado parcial/total.
  // Los retiros se registran como filas con monto negativo y estado 'retirado'.
  db.run(`
    CREATE TABLE IF NOT EXISTS Inversion (
      idInversion INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha       TEXT    NOT NULL,
      categoria   TEXT    NOT NULL CHECK(categoria IN ('FCI','Plazo fijo','Acciones','Otro')),
      descripcion TEXT    NOT NULL,
      monto       REAL    NOT NULL,
      estado      TEXT    NOT NULL DEFAULT 'invertido' CHECK(estado IN ('invertido','retirado'))
    );
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_inversion_fecha     ON Inversion(fecha);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_inversion_categoria ON Inversion(categoria);`)

  // ── Seed inicial ──────────────────────────────────────────────────────────
  const catCount = db.exec(`SELECT COUNT(*) FROM Categoria`)[0].values[0][0]
  if (catCount === 0) {
    db.run(`BEGIN TRANSACTION`)

    // 1. Proveedores
    // seedData usa "nombreComercio" pero el schema tiene "nombreComercial"
    for (const p of PROVEEDORES_SEED) {
      db.run(
        `INSERT INTO Proveedor (nombreFiscal, nombreComercial, identificacionTributaria, telefono, email)
         VALUES (?, ?, ?, ?, ?)`,
        [p.nombreFiscal, p.nombreComercio ?? null, p.cuit ?? null, p.telefono ?? null, p.email ?? null]
      )
    }

    // 2. Categorías únicas extraídas de los productos + "General" como fallback
    const categorias = ['General', ...new Set(PRODUCTOS_SEED.map(p => p.categoria).filter(Boolean))]
    for (const nombre of categorias) {
      db.run(`INSERT OR IGNORE INTO Categoria (nombre) VALUES (?)`, [nombre])
    }

    // 3. Clientes
    // seedData usa "domicilioComercio" pero el schema tiene "domicilio"
    for (const c of CLIENTES_SEED) {
      db.run(
        `INSERT INTO Cliente (nombre, apellido, cuit, domicilio, telefono, mail, apodo, nombreComercio, activo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          c.nombre,
          c.apellido,
          c.cuit              ?? null,
          c.domicilioComercio ?? c.domicilio ?? null,
          c.telefono          ?? null,
          c.email             ?? null,
          c.apodo             ?? null,
          c.nombreComercio    ?? null,
        ]
      )
    }

    // 4. Productos
    // Resolvemos idCategoria en tiempo de seed.
    // proveedorIndex es el índice 0-based en PROVEEDORES_SEED; como los insertamos
    // en orden y SQLite asigna AUTOINCREMENT desde 1, idProveedor = proveedorIndex + 1.
    for (const prod of PRODUCTOS_SEED) {
      const catNombre   = prod.categoria ?? 'General'
      const catResult   = db.exec(`SELECT idCategoria FROM Categoria WHERE nombre = ?`, [catNombre])
      const idCategoria = catResult.length ? catResult[0].values[0][0] : 1

      db.run(
        `INSERT INTO Producto (idCategoria, nombre, precioProveedor, precioUnitario, cantidad, tieneMedidas, puntoReposicion)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        [
          idCategoria,
          prod.nombre,
          prod.precioProveedor ?? 0,
          prod.precioVenta     ?? 0,
          prod.stock           ?? 0,
          prod.puntoReposicion ?? 0,
        ]
      )
    }

    db.run(`COMMIT`)
    persistDB()
  }
}

// ─── Helpers de acceso ───────────────────────────────────────────────────────

/**
 * Ejecuta una consulta SELECT y devuelve un array de objetos.
 * En la migración a Supabase reemplazar por:
 *   const { data, error } = await supabase.from('tabla').select(...)
 */
export function query(sql, params = []) {
  if (!db) throw new Error('BD no inicializada')
  const result = db.exec(sql, params)
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]]))
  )
}

/**
 * Ejecuta una sentencia INSERT / UPDATE / DELETE y devuelve el último rowid.
 * IMPORTANTE: se lee last_insert_rowid() ANTES de persistDB(), ya que
 * db.export() resetea ese valor a 0.
 *
 * En la migración a Supabase reemplazar por:
 *   const { data, error } = await supabase.from('tabla').insert(...).select()
 */
export function run(sql, params = []) {
  if (!db) throw new Error('BD no inicializada')
  db.run(sql, params)
  const lastId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]
  persistDB()
  return lastId
}

export function getDB() { return db }
