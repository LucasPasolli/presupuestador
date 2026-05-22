// src/lib/database.js
// sql.js cargado como <script> clásico en index.html → window.initSqlJs disponible.

import { PRODUCTOS_SEED } from './seedData.js'

let db = null

// Cambiar la key cuando el schema cambia para forzar re-creación de la BD.
const DB_STORAGE_KEY = 'motoparts_db_v2'

export function persistDB() {
  if (!db) return
  const data = db.export()
  localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(Array.from(data)))
}

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

function runSchema() {
  db.run(`PRAGMA foreign_keys = ON;`)

  db.run(`
    CREATE TABLE IF NOT EXISTS Categoria (
      idCategoria  INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre       TEXT NOT NULL UNIQUE
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS Cliente (
      idCliente   INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre      TEXT NOT NULL,
      apellido    TEXT NOT NULL,
      cuit        TEXT,
      domicilio   TEXT,
      telefono    TEXT,
      mail        TEXT
    );
  `)

  // Producto: tieneMedidas=1 significa que el stock se gestiona por medida en ProductoMedida.
  // tieneMedidas=0 significa stock único en columna "cantidad".
  db.run(`
    CREATE TABLE IF NOT EXISTS Producto (
      idProducto     INTEGER PRIMARY KEY AUTOINCREMENT,
      idCategoria    INTEGER NOT NULL DEFAULT 1,
      nombre         TEXT NOT NULL,
      precioUnitario REAL NOT NULL DEFAULT 0,
      cantidad       INTEGER NOT NULL DEFAULT 0,
      tieneMedidas   INTEGER NOT NULL DEFAULT 0 CHECK(tieneMedidas IN (0,1)),
      FOREIGN KEY (idCategoria) REFERENCES Categoria(idCategoria) ON DELETE RESTRICT
    );
  `)

  // Stock por medida. Solo se usa cuando Producto.tieneMedidas = 1.
  // Las medidas válidas: standard, 0.25, 0.50, 0.75, 1.00, 1.25, 1.50, 1.75, 2.00
  db.run(`
    CREATE TABLE IF NOT EXISTS ProductoMedida (
      idMedida    INTEGER PRIMARY KEY AUTOINCREMENT,
      idProducto  INTEGER NOT NULL,
      medida      TEXT NOT NULL CHECK(medida IN ('standard','0.25','0.50','0.75','1.00','1.25','1.50','1.75','2.00')),
      cantidad    INTEGER NOT NULL DEFAULT 0,
      UNIQUE(idProducto, medida),
      FOREIGN KEY (idProducto) REFERENCES Producto(idProducto) ON DELETE CASCADE
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS Presupuesto (
      idPresupuesto  INTEGER PRIMARY KEY AUTOINCREMENT,
      idCliente      INTEGER NOT NULL,
      fecha          TEXT NOT NULL,
      metodoPago     TEXT NOT NULL CHECK(metodoPago IN ('efectivo','transferencia','cc30','cc15')),
      montoOriginal  REAL NOT NULL DEFAULT 0,
      monto          REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (idCliente) REFERENCES Cliente(idCliente) ON DELETE RESTRICT
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS DetallePresupuesto (
      idDetalle      INTEGER PRIMARY KEY AUTOINCREMENT,
      idPresupuesto  INTEGER NOT NULL,
      idProducto     INTEGER NOT NULL,
      medida         TEXT,
      cantidad       INTEGER NOT NULL,
      precioUnitario REAL NOT NULL,
      subtotal       REAL NOT NULL,
      FOREIGN KEY (idPresupuesto) REFERENCES Presupuesto(idPresupuesto) ON DELETE CASCADE,
      FOREIGN KEY (idProducto)   REFERENCES Producto(idProducto) ON DELETE RESTRICT
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS Saldo (
      idSaldo        INTEGER PRIMARY KEY AUTOINCREMENT,
      idPresupuesto  INTEGER NOT NULL UNIQUE,
      idCliente      INTEGER NOT NULL,
      fechaInicio    TEXT NOT NULL,
      fechaFin       TEXT NOT NULL,
      monto          REAL NOT NULL,
      estado         TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','pagado')),
      FOREIGN KEY (idPresupuesto) REFERENCES Presupuesto(idPresupuesto) ON DELETE CASCADE,
      FOREIGN KEY (idCliente)     REFERENCES Cliente(idCliente) ON DELETE RESTRICT
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS PedidoCompra (
      idPedido  INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha     TEXT NOT NULL,
      monto     REAL NOT NULL DEFAULT 0,
      estado    TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','revisado'))
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS DetallePedidoCompra (
      idDetallePedido INTEGER PRIMARY KEY AUTOINCREMENT,
      idPedido        INTEGER NOT NULL,
      idProducto      INTEGER NOT NULL,
      medida          TEXT,
      cantidad        INTEGER NOT NULL,
      precioUnitario  REAL NOT NULL,
      subtotal        REAL NOT NULL,
      FOREIGN KEY (idPedido)   REFERENCES PedidoCompra(idPedido) ON DELETE CASCADE,
      FOREIGN KEY (idProducto) REFERENCES Producto(idProducto) ON DELETE RESTRICT
    );
  `)

  // ── Seed inicial ──────────────────────────────────────────────────────────
  const catCount = db.exec(`SELECT COUNT(*) FROM Categoria`)[0].values[0][0]
  if (catCount === 0) {
    // Insertar categoría General
    db.run(`INSERT INTO Categoria (nombre) VALUES ('General')`)

    // Insertar todos los productos del CSV en bloque usando una transacción
    db.run(`BEGIN TRANSACTION`)
    for (const nombre of PRODUCTOS_SEED) {
      db.run(
        `INSERT INTO Producto (idCategoria, nombre, precioUnitario, cantidad, tieneMedidas)
         VALUES (1, ?, 0, 0, 0)`,
        [nombre]
      )
    }
    db.run(`COMMIT`)

    persistDB()
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function query(sql, params = []) {
  if (!db) throw new Error('DB no inicializada')
  const result = db.exec(sql, params)
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]]))
  )
}

export function run(sql, params = []) {
  if (!db) throw new Error('DB no inicializada')
  db.run(sql, params)
  persistDB()
  return db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]
}

export function getDB() { return db }
