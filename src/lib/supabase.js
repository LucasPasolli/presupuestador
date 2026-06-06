// src/lib/supabase.js
// Cliente Supabase centralizado.
// NUNCA importar @supabase/supabase-js directamente desde un componente.
// Todos los accesos a la BD deben pasar por src/services/.

import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    '[supabase.js] Faltan variables de entorno.\n' +
    'Asegurate de definir VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.local'
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // La app usa su propio sistema de auth por contraseña.
    // Deshabilitamos la sesión automática de Supabase Auth para evitar conflictos.
    persistSession: false,
    autoRefreshToken: false,
  },
})