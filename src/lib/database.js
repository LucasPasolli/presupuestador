// src/lib/database.js
// sql.js cargado como <script> clásico en index.html → window.initSqlJs disponible.

import { PRODUCTOS_SEED } from './seedData.js'

let db = null

// Cambiar la key cuando el schema cambia para forzar re-creación de la BD.
const DB_STORAGE_KEY = 'motoparts_db_v5'

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
  runMigrations()
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
    CREATE TABLE IF NOT EXISTS Proveedor (
      idProveedor              INTEGER PRIMARY KEY AUTOINCREMENT,
      nombreFiscal             TEXT NOT NULL,
      nombreComercial          TEXT,
      identificacionTributaria TEXT,
      telefono                 TEXT,
      email                    TEXT
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS Cliente (
      idCliente      INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre         TEXT NOT NULL,
      apellido       TEXT NOT NULL,
      cuit           TEXT,
      domicilio      TEXT,
      telefono       TEXT,
      mail           TEXT,
      apodo          TEXT,
      nombreComercio TEXT,
      activo         INTEGER NOT NULL DEFAULT 1
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS Producto (
      idProducto      INTEGER PRIMARY KEY AUTOINCREMENT,
      idCategoria     INTEGER NOT NULL DEFAULT 1,
      nombre          TEXT NOT NULL,
      precioProveedor REAL NOT NULL DEFAULT 0,
      precioUnitario  REAL NOT NULL DEFAULT 0,
      cantidad        INTEGER NOT NULL DEFAULT 0,
      tieneMedidas    INTEGER NOT NULL DEFAULT 0 CHECK(tieneMedidas IN (0,1)),
      puntoReposicion INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (idCategoria) REFERENCES Categoria(idCategoria) ON DELETE RESTRICT
    );
  `)

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
      nombreCliente   TEXT,
      apellidoCliente TEXT,
      estado         TEXT NOT NULL DEFAULT 'borrador' CHECK(estado IN ('borrador','aprobado','pagado','rechazado')),
      esExcepcion    INTEGER NOT NULL DEFAULT 0 CHECK(esExcepcion IN (0,1)),
      FOREIGN KEY (idCliente) REFERENCES Cliente(idCliente) ON DELETE RESTRICT
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS DetallePresupuesto (
      idDetalle      INTEGER PRIMARY KEY AUTOINCREMENT,
      idPresupuesto  INTEGER NOT NULL,
      idProducto     INTEGER NOT NULL,
      nombreProducto TEXT,
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
      fechaPago      TEXT,
      monto          REAL NOT NULL,
      estado         TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','pagado')),
      FOREIGN KEY (idPresupuesto) REFERENCES Presupuesto(idPresupuesto) ON DELETE CASCADE,
      FOREIGN KEY (idCliente)     REFERENCES Cliente(idCliente) ON DELETE RESTRICT
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS PedidoCompra (
      idPedido        INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha           TEXT NOT NULL,
      monto           REAL NOT NULL DEFAULT 0,
      estadoPago      TEXT NOT NULL DEFAULT 'pendiente' CHECK(estadoPago IN ('pendiente','pagado')),
      estadoLogistico TEXT NOT NULL DEFAULT 'encargado' CHECK(estadoLogistico IN ('encargado','recibido','revisar')),
      fechaRecepcion  TEXT,
      fechaPago       TEXT,
      metodoPago      TEXT DEFAULT 'efectivo' CHECK(metodoPago IN ('efectivo','transferencia','echeck')),
      idProveedor     INTEGER,
      nombreProveedor TEXT,
      FOREIGN KEY (idProveedor) REFERENCES Proveedor(idProveedor) ON DELETE SET NULL
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS DetallePedidoCompra (
      idDetallePedido INTEGER PRIMARY KEY AUTOINCREMENT,
      idPedido        INTEGER NOT NULL,
      idProducto      INTEGER,
      nombreProducto  TEXT,
      medida          TEXT,
      cantidad        INTEGER NOT NULL,
      precioUnitario  REAL NOT NULL,
      subtotal        REAL NOT NULL,
      FOREIGN KEY (idPedido)   REFERENCES PedidoCompra(idPedido) ON DELETE CASCADE,
      FOREIGN KEY (idProducto) REFERENCES Producto(idProducto) ON DELETE SET NULL
    );
  `)

  // ── NUEVA: tabla Egreso ───────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS Egreso (
      idEgreso    INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha       TEXT NOT NULL,
      categoria   TEXT NOT NULL CHECK(categoria IN ('Sueldo','Transporte','Comida','Servicios','Flete','Envíos','ART','Seguro de vida','IVA','Ingresos Brutos','Impuesto a las ganancias','Otro')),
      descripcion TEXT NOT NULL,
      monto       REAL NOT NULL DEFAULT 0,
      metodoPago  TEXT NOT NULL DEFAULT 'efectivo' CHECK(metodoPago IN ('efectivo','transferencia','cheque'))
    );
  `)

  // ── NUEVA: tabla Ingreso ──────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS Ingreso (
      idIngreso   INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha       TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      monto       REAL NOT NULL DEFAULT 0
    );
  `)

  // ── Seed inicial ──────────────────────────────────────────────────────────
  const catCount = db.exec(`SELECT COUNT(*) FROM Categoria`)[0].values[0][0]
  if (catCount === 0) {
    db.run(`INSERT INTO Categoria (nombre) VALUES ('General')`)

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

// ─── Migraciones ────────────────────────────────────────────────────────────

function runMigrations() {
  // v5 → v6: agrega esExcepcion a Presupuesto.
  const cols = db.exec(`PRAGMA table_info(Presupuesto)`)[0]?.values ?? []
  const yaExiste = cols.some(row => row[1] === 'esExcepcion')
  if (!yaExiste) {
    db.run(`ALTER TABLE Presupuesto ADD COLUMN esExcepcion INTEGER DEFAULT 0`)
    db.run(`UPDATE Presupuesto SET esExcepcion = 0 WHERE esExcepcion IS NULL`)
    persistDB()
  }

  // v6 → v7: agrega precioProveedor a Producto.
  const colsProd = db.exec(`PRAGMA table_info(Producto)`)[0]?.values ?? []
  const yaExistePP = colsProd.some(row => row[1] === 'precioProveedor')
  if (!yaExistePP) {
    db.run(`ALTER TABLE Producto ADD COLUMN precioProveedor REAL DEFAULT 0`)
    db.run(`UPDATE Producto SET precioProveedor = 0 WHERE precioProveedor IS NULL`)
    persistDB()
  }

  // v11 → v12: agrega puntoReposicion a Producto.
  const colsProd2 = db.exec(`PRAGMA table_info(Producto)`)[0]?.values ?? []
  const yaExistePR = colsProd2.some(row => row[1] === 'puntoReposicion')
  if (!yaExistePR) {
    db.run(`ALTER TABLE Producto ADD COLUMN puntoReposicion INTEGER DEFAULT 0`)
    db.run(`UPDATE Producto SET puntoReposicion = 0 WHERE puntoReposicion IS NULL`)
    persistDB()
  }

  // v7 → v8: agrega fechaPago a Saldo
  const colsSaldo = db.exec(`PRAGMA table_info(Saldo)`)[0]?.values ?? []
  const yaExisteFP = colsSaldo.some(row => row[1] === 'fechaPago')
  if (!yaExisteFP) {
    db.run(`ALTER TABLE Saldo ADD COLUMN fechaPago TEXT`)
    persistDB()
  }

  // v9 → v10: columnas nuevas en PedidoCompra
  const colsPedido = db.exec(`PRAGMA table_info(PedidoCompra)`)[0]?.values ?? []
  const colNamesPedido = colsPedido.map(r => r[1])

  if (colNamesPedido.includes('estado') && !colNamesPedido.includes('estadoPago')) {
    db.run(`ALTER TABLE PedidoCompra ADD COLUMN estadoPago TEXT DEFAULT 'pendiente'`)
    db.run(`UPDATE PedidoCompra SET estadoPago = estado`)
    persistDB()
  }
  if (!colNamesPedido.includes('estadoLogistico')) {
    db.run(`ALTER TABLE PedidoCompra ADD COLUMN estadoLogistico TEXT DEFAULT 'encargado'`)
    persistDB()
  }
  if (!colNamesPedido.includes('fechaRecepcion')) {
    db.run(`ALTER TABLE PedidoCompra ADD COLUMN fechaRecepcion TEXT`)
    persistDB()
  }
  if (!colNamesPedido.includes('metodoPago')) {
    db.run(`ALTER TABLE PedidoCompra ADD COLUMN metodoPago TEXT DEFAULT 'efectivo'`)
    persistDB()
  }
  if (!colNamesPedido.includes('idProveedor')) {
    db.run(`ALTER TABLE PedidoCompra ADD COLUMN idProveedor INTEGER`)
    persistDB()
  }
  if (!colNamesPedido.includes('fechaPago')) {
    db.run(`ALTER TABLE PedidoCompra ADD COLUMN fechaPago TEXT`)
    persistDB()
  }

  // v13 → v14: agrega apodo y nombreComercio a Cliente
  const colsCliente = db.exec(`PRAGMA table_info(Cliente)`)[0]?.values ?? []
  const colNamesCliente = colsCliente.map(r => r[1])
  if (!colNamesCliente.includes('apodo')) {
    db.run(`ALTER TABLE Cliente ADD COLUMN apodo TEXT`)
    persistDB()
  }
  if (!colNamesCliente.includes('nombreComercio')) {
    db.run(`ALTER TABLE Cliente ADD COLUMN nombreComercio TEXT`)
    persistDB()
  }

  // v20 → v21: soft-delete en Cliente — columna "activo" (1 = activo, 0 = borrado)
  // Esto permite que el ABMC marque clientes como inactivos sin borrar el registro,
  // preservando el historial de presupuestos y evitando que aparezcan en el buscador.
  const colsCliente2 = db.exec(`PRAGMA table_info(Cliente)`)[0]?.values ?? []
  if (!colsCliente2.some(r => r[1] === 'activo')) {
    db.run(`ALTER TABLE Cliente ADD COLUMN activo INTEGER NOT NULL DEFAULT 1`)
    db.run(`UPDATE Cliente SET activo = 1 WHERE activo IS NULL`)
    persistDB()
  }

  // v14 → v15: crea tabla Ingreso si no existe
  db.run(`
    CREATE TABLE IF NOT EXISTS Ingreso (
      idIngreso   INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha       TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      monto       REAL NOT NULL DEFAULT 0
    );
  `)

  // v15 → v16: snapshot de nombre de producto en DetallePresupuesto.
  // Garantiza que borrar/renombrar un Producto no destruya el dato histórico.
  const colsDetalle = db.exec(`PRAGMA table_info(DetallePresupuesto)`)[0]?.values ?? []
  if (!colsDetalle.some(r => r[1] === 'nombreProducto')) {
    db.run(`ALTER TABLE DetallePresupuesto ADD COLUMN nombreProducto TEXT`)
    db.run(`
      UPDATE DetallePresupuesto
      SET nombreProducto = (
        SELECT nombre FROM Producto
        WHERE Producto.idProducto = DetallePresupuesto.idProducto
      )
      WHERE nombreProducto IS NULL
    `)
    persistDB()
  }

  // v17 → v18: snapshot de nombre de proveedor en PedidoCompra.
  // Garantiza que borrar un Proveedor no haga desaparecer el nombre en historial.
  const colsPedido2 = db.exec(`PRAGMA table_info(PedidoCompra)`)[0]?.values ?? []
  if (!colsPedido2.some(r => r[1] === 'nombreProveedor')) {
    db.run(`ALTER TABLE PedidoCompra ADD COLUMN nombreProveedor TEXT`)
    db.run(`
      UPDATE PedidoCompra
      SET nombreProveedor = (
        SELECT COALESCE(nombreComercial, nombreFiscal)
        FROM Proveedor
        WHERE Proveedor.idProveedor = PedidoCompra.idProveedor
      )
      WHERE nombreProveedor IS NULL AND idProveedor IS NOT NULL
    `)
    persistDB()
  }

  // v18 → v19: backfill nombreProducto en DetallePedidoCompra.
  // La columna ya existe pero el INSERT nunca la populaba — rellenar los registros vacíos.
  const colsDetallePedido = db.exec(`PRAGMA table_info(DetallePedidoCompra)`)[0]?.values ?? []
  if (!colsDetallePedido.some(r => r[1] === 'nombreProducto')) {
    db.run(`ALTER TABLE DetallePedidoCompra ADD COLUMN nombreProducto TEXT`)
  }
  db.run(`
    UPDATE DetallePedidoCompra
    SET nombreProducto = (
      SELECT nombre FROM Producto
      WHERE Producto.idProducto = DetallePedidoCompra.idProducto
    )
    WHERE (nombreProducto IS NULL OR nombreProducto = '') AND idProducto IS NOT NULL
  `)
  persistDB()

  // v16 → v17: snapshot de nombre de cliente en Presupuesto.
  // Garantiza que borrar un Cliente no haga desaparecer el nombre en historial y PDF.
  const colsPresMig = db.exec(`PRAGMA table_info(Presupuesto)`)[0]?.values ?? []
  const colNamesPresMig = colsPresMig.map(r => r[1])
  if (!colNamesPresMig.includes('nombreCliente')) {
    db.run(`ALTER TABLE Presupuesto ADD COLUMN nombreCliente TEXT`)
    db.run(`
      UPDATE Presupuesto
      SET nombreCliente = (
        SELECT nombre FROM Cliente
        WHERE Cliente.idCliente = Presupuesto.idCliente
      )
      WHERE nombreCliente IS NULL
    `)
    persistDB()
  }
  if (!colNamesPresMig.includes('apellidoCliente')) {
    db.run(`ALTER TABLE Presupuesto ADD COLUMN apellidoCliente TEXT`)
    db.run(`
      UPDATE Presupuesto
      SET apellidoCliente = (
        SELECT apellido FROM Cliente
        WHERE Cliente.idCliente = Presupuesto.idCliente
      )
      WHERE apellidoCliente IS NULL
    `)
    persistDB()
  }

  // v19 → v20: ampliar categorías de Egreso (ART, Seguro de vida, IVA, Ingresos Brutos, Impuesto a las ganancias)
  // SQLite no permite ALTER COLUMN para cambiar el CHECK, así que recreamos la tabla si es necesario.
  try {
    db.run(`SAVEPOINT check_egreso_cats`)
    db.run(`INSERT INTO Egreso (fecha, categoria, descripcion, monto, metodoPago) VALUES ('1900-01-01','ART','__test__',0,'efectivo')`)
    db.run(`DELETE FROM Egreso WHERE descripcion='__test__'`)
    db.run(`RELEASE SAVEPOINT check_egreso_cats`)
  } catch {
    db.run(`ROLLBACK TO SAVEPOINT check_egreso_cats`)
    db.run(`RELEASE SAVEPOINT check_egreso_cats`)
    db.run(`ALTER TABLE Egreso RENAME TO Egreso_old`)
    db.run(`
      CREATE TABLE Egreso (
        idEgreso    INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha       TEXT NOT NULL,
        categoria   TEXT NOT NULL CHECK(categoria IN ('Sueldo','Transporte','Comida','Servicios','Flete','Envíos','ART','Seguro de vida','IVA','Ingresos Brutos','Impuesto a las ganancias','Otro')),
        descripcion TEXT NOT NULL,
        monto       REAL NOT NULL DEFAULT 0,
        metodoPago  TEXT NOT NULL DEFAULT 'efectivo' CHECK(metodoPago IN ('efectivo','transferencia','cheque'))
      )
    `)
    db.run(`INSERT INTO Egreso SELECT * FROM Egreso_old`)
    db.run(`DROP TABLE Egreso_old`)
    persistDB()
  }
}



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
  // IMPORTANT: read rowid BEFORE persistDB() — db.export() resets last_insert_rowid to 0
  const lastId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]
  persistDB()
  return lastId
}

export function getDB() { return db }
