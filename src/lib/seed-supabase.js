// ============================================================
// seed-supabase.js — Migración de datos a Supabase
// ============================================================
// USO:
//   1. Instalar dependencias: npm install @supabase/supabase-js
//   2. Completar SUPABASE_URL y SUPABASE_SERVICE_KEY abajo
//   3. Ejecutar: node seed-supabase.js
// ============================================================

import { createClient } from "@supabase/supabase-js";
import {
  PROVEEDORES_SEED,
  CLIENTES_SEED,
  PRODUCTOS_SEED,
} from "./seedData.js";

// ⚠️  COMPLETAR con tus credenciales de Supabase
const SUPABASE_URL = "https://ybejzmwfuugnaltmbqkq.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InliZWp6bXdmdXVnbmFsdG1icWtxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDc1MzIyOCwiZXhwIjoyMDk2MzI5MjI4fQ.XneqdWFu2D7RY_BIbbAgxbWVIC3GmZ19DAOKVq8SnWk"; // Usar la service_role key (Settings > API)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================================
// Helpers
// ============================================================

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function insertInChunks(table, rows, chunkSize = 100) {
  const chunks = chunkArray(rows, chunkSize);
  let inserted = 0;
  for (const chunk of chunks) {
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(`Error en tabla "${table}": ${error.message}`);
    inserted += chunk.length;
    log(`  ${table}: ${inserted}/${rows.length} filas insertadas`);
  }
}

// ============================================================
// Mapeo de datos
// ============================================================

function mapProveedores() {
  return PROVEEDORES_SEED.map((p) => ({
    nombre_fiscal: p.nombreFiscal,
    nombre_comercial: p.nombreComercio,
    identificacion_tributaria: p.cuit,
    telefono: p.telefono,
    email: p.email,
  }));
}

function mapClientes() {
  return CLIENTES_SEED.map((c) => ({
    nombre: c.nombre,
    apellido: c.apellido,
    cuit: c.cuit,
    domicilio: c.domicilioComercio,
    telefono: c.telefono,
    mail: c.email,
    apodo: c.apodo,
    nombre_comercio: c.nombreComercio,
    activo: true,
  }));
}

// Extrae categorías únicas de los productos
function getCategorias() {
  const nombres = [...new Set(PRODUCTOS_SEED.map((p) => p.categoria))];
  return nombres.map((nombre) => ({ nombre }));
}

// Genera los productos ya con id_categoria resuelto
function mapProductos(categoriaMap) {
  return PRODUCTOS_SEED.map((p) => ({
    nombre: p.nombre,
    id_categoria: categoriaMap[p.categoria],
    precio_proveedor: p.precioProveedor,
    precio_unitario: p.precioVenta,
    cantidad: p.stock,
    punto_reposicion: p.puntoReposicion,
    tiene_medidas: false,
  }));
}

// ============================================================
// Main
// ============================================================

async function main() {
  log("=== Iniciando migración ===");

  // 1. Proveedores
  log("Insertando proveedores...");
  await insertInChunks("proveedor", mapProveedores());

  // 2. Clientes
  log("Insertando clientes...");
  await insertInChunks("cliente", mapClientes());

  // 3. Categorías
  log("Insertando categorías...");
  const categorias = getCategorias();
  const { data: categoriasInsertadas, error: catError } = await supabase
    .from("categoria")
    .insert(categorias)
    .select("id_categoria, nombre");

  if (catError) throw new Error(`Error en categorías: ${catError.message}`);

  // Construir mapa nombre -> id
  const categoriaMap = {};
  for (const cat of categoriasInsertadas) {
    categoriaMap[cat.nombre] = cat.id_categoria;
  }
  log(`  Categorías registradas: ${Object.keys(categoriaMap).join(", ")}`);

  // 4. Productos
  log("Insertando productos...");
  const productos = mapProductos(categoriaMap);
  await insertInChunks("producto", productos, 200);

  log("=== Migración completada exitosamente ===");
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
