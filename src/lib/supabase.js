// src/lib/supabase.js
// NUNCA importar @supabase/supabase-js directamente desde un componente.
// Todos los accesos a la BD deben pasar por src/services/.
// Cliente Supabase centralizado.

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    '[supabase.js] Faltan variables de entorno.\n' +
    'Asegurate de definir VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.local'
  )
}

// La URL de Supabase debe viajar siempre por HTTPS. Un http:// aquí
// (típico de copiar/pegar una URL de un entorno local por error)
// expondría el JWT y la key en texto plano en la red.
if (!supabaseUrl.startsWith('https://')) {
  throw new Error(
    `[supabase.js] VITE_SUPABASE_URL debe usar https://. Valor recibido: "${supabaseUrl}"`
  )
}

/**
 * Guardrail crítico: distingue una anon key de una service_role key
 * decodificando el claim "role" del JWT (sin validar firma, solo leemos
 * el payload — la validación real la hace el servidor de Supabase).
 *
 * La service_role key BYPASEA Row Level Security por completo. Si se
 * filtra al bundle del frontend por error (son dos keys parecidas en
 * el mismo dashboard de Supabase), cualquiera con las devtools tiene
 * acceso total de lectura/escritura a toda la base, sin importar las
 * políticas RLS configuradas. Frenamos la app antes de que eso llegue
 * a producción en vez de fallar silenciosamente.
 */
function assertIsAnonKey(jwt) {
  try {
    const payloadB64 = jwt.split('.')[1]
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.role !== 'anon') {
      throw new Error(
        `[supabase.js] VITE_SUPABASE_ANON_KEY tiene role="${payload.role}", se esperaba "anon". ` +
        'Es muy probable que hayas pegado la service_role key por error. ' +
        'Esa key NUNCA debe usarse en el frontend: bypasea RLS por completo.'
      )
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('service_role')) throw err
    // Si el JWT no se puede decodificar, dejamos que Supabase lo rechace
    // más adelante en vez de bloquear el arranque por un parseo frágil.
    console.warn('[supabase.js] No se pudo verificar el claim "role" de la key:', err)
  }
}

assertIsAnonKey(supabaseKey)

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,      // La sesión se guarda en localStorage (sobrevive F5)
    autoRefreshToken: true,    // Supabase renueva el JWT automáticamente antes de que expire
    detectSessionInUrl: false, // No necesitamos magic links ni OAuth callbacks
  },
})
