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
  runMigrations()   // ← migraciones aditivas sobre BDs ya existentes
  return db
}

// ─── Schema completo ─────────────────────────────────────────────────────────

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
  db.run(`
    CREATE TABLE IF NOT EXISTS Saldo (
      idSaldo       INTEGER PRIMARY KEY AUTOINCREMENT,
      idPresupuesto INTEGER NOT NULL UNIQUE,
      idCliente     INTEGER NOT NULL,
      fechaInicio   TEXT    NOT NULL,
      fechaVto      TEXT,
      monto         REAL    NOT NULL DEFAULT 0,
      pagado        INTEGER NOT NULL DEFAULT 0 CHECK(pagado IN (0,1)),
      FOREIGN KEY (idPresupuesto) REFERENCES Presupuesto(idPresupuesto) ON DELETE CASCADE,
      FOREIGN KEY (idCliente)     REFERENCES Cliente(idCliente)         ON DELETE RESTRICT
    );
  `)

  // ── PedidoCompra ─────────────────────────────────────────────────────────
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

    for (const p of PROVEEDORES_SEED) {
      db.run(
        `INSERT INTO Proveedor (nombreFiscal, nombreComercial, identificacionTributaria, telefono, email)
         VALUES (?, ?, ?, ?, ?)`,
        [p.nombreFiscal, p.nombreComercio ?? null, p.cuit ?? null, p.telefono ?? null, p.email ?? null]
      )
    }

    const categorias = ['General', ...new Set(PRODUCTOS_SEED.map(p => p.categoria).filter(Boolean))]
    for (const nombre of categorias) {
      db.run(`INSERT OR IGNORE INTO Categoria (nombre) VALUES (?)`, [nombre])
    }

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

// ─── Migraciones aditivas ─────────────────────────────────────────────────────
// Se ejecutan después del schema base, sobre BDs ya existentes.
// Cada bloque es idempotente: usa IF NOT EXISTS o verifica columnas antes de alterar.

function runMigrations() {

  // ── M1: Tabla Promocion ────────────────────────────────────────────────────
  // Soporta tres tipos de promo y tres alcances distintos.
  // Las columnas idProducto e idCategoria son nullable según el alcance elegido.
  db.run(`
    CREATE TABLE IF NOT EXISTS Promocion (
      idPromocion  INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre       TEXT    NOT NULL,
      descripcion  TEXT,
      tipo         TEXT    NOT NULL CHECK(tipo IN ('porcentaje_producto','2x1','precio_fijo')),
      alcance      TEXT    NOT NULL CHECK(alcance IN ('producto','categoria','global')),
      idProducto   INTEGER,
      idCategoria  INTEGER,
      fechaInicio  TEXT    NOT NULL,
      fechaFin     TEXT    NOT NULL,
      valor        REAL,
      activo       INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1)),
      FOREIGN KEY (idProducto)  REFERENCES Producto(idProducto)   ON DELETE SET NULL,
      FOREIGN KEY (idCategoria) REFERENCES Categoria(idCategoria) ON DELETE SET NULL
    );
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_promocion_activo      ON Promocion(activo);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_promocion_fechas      ON Promocion(fechaInicio, fechaFin);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_promocion_producto    ON Promocion(idProducto);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_promocion_categoria   ON Promocion(idCategoria);`)

  // ── M2: Columnas nuevas en DetallePresupuesto ─────────────────────────────
  // SQLite no soporta ALTER TABLE ADD COLUMN IF NOT EXISTS directamente,
  // pero sí ignora el error si la columna ya existe con el patrón try/catch implícito
  // de sql.js. Usamos un SAVEPOINT para que el fallo no rompa la transacción externa.

  _addColumnIfMissing('DetallePresupuesto', 'precioConPromo', 'REAL')
  _addColumnIfMissing('DetallePresupuesto', 'idPromocion',    'INTEGER')
}

/**
 * Agrega una columna a una tabla si todavía no existe.
 * Usa SAVEPOINT para que el fallo (columna duplicada) sea silencioso.
 */
function _addColumnIfMissing(tabla, columna, tipo) {
  try {
    db.run(`SAVEPOINT add_col`)
    db.run(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${tipo}`)
    db.run(`RELEASE SAVEPOINT add_col`)
  } catch (_) {
    // La columna ya existe → rollback del savepoint, continuar normalmente
    db.run(`ROLLBACK TO SAVEPOINT add_col`)
    db.run(`RELEASE SAVEPOINT add_col`)
  }
}

// ─── Helpers de acceso ───────────────────────────────────────────────────────

export function query(sql, params = []) {
  if (!db) throw new Error('BD no inicializada')
  const result = db.exec(sql, params)
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]]))
  )
}

export function run(sql, params = []) {
  if (!db) throw new Error('BD no inicializada')
  db.run(sql, params)
  const lastId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]
  persistDB()
  return lastId
}

export function getDB() { return db }
