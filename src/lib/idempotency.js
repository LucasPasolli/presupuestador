// src/lib/idempotency.js
/**
 * Claves de idempotencia en el cliente.
 *
 * MODELO MENTAL
 * -------------
 * Una clave identifica una INTENCIÓN de negocio, no una petición HTTP.
 * "Crear ESTE presupuesto" es una intención: si por latencia, reintento
 * automático o una segunda pestaña se envía dos veces, el backend debe
 * reconocer que se trata de la misma intención y devolver el mismo resultado
 * en lugar de insertar otra fila.
 *
 * Ciclo de vida correcto:
 *
 *   se abre el formulario      → se genera la clave K1
 *   clic en Guardar            → POST con K1
 *   falla la red, se reintenta → POST con K1  (misma intención, no duplica)
 *   éxito                      → se rota a K2
 *   "Nuevo presupuesto"        → K2 identifica la próxima intención
 *
 * El error clásico es generar la clave dentro del handler de guardado: ahí
 * cada clic produce una clave distinta y la idempotencia no sirve para nada.
 * Por eso la clave se crea al montar el formulario y solo se rota tras un
 * éxito confirmado.
 *
 * @module lib/idempotency
 */
import { useCallback, useRef, useState } from 'react'

/**
 * UUID v4 criptográficamente seguro.
 * `crypto.randomUUID` está disponible en todo navegador moderno bajo HTTPS.
 * El fallback usa `getRandomValues` (CSPRNG): nunca `Math.random`, que es
 * predecible y permitiría a un atacante adivinar claves ajenas.
 * @returns {string}
 */
export function nuevaClaveIdempotencia() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const b = crypto.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40 // versión 4
    b[8] = (b[8] & 0x3f) | 0x80 // variante RFC 4122
    const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  throw new Error('Entorno sin generador de números aleatorios seguro.')
}

/**
 * Serialización canónica y estable de un payload.
 * Ordena las claves recursivamente para que `{a:1,b:2}` y `{b:2,a:1}`
 * produzcan la misma huella. Sin esto, el orden arbitrario de `Object.keys`
 * generaría falsos negativos al comparar dos peticiones idénticas.
 * @param {unknown} valor
 * @returns {string}
 */
export function serializarCanonico(valor) {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null'
  if (Array.isArray(valor)) return `[${valor.map(serializarCanonico).join(',')}]`
  const claves = Object.keys(valor).sort()
  return `{${claves.map((k) => `${JSON.stringify(k)}:${serializarCanonico(valor[k])}`).join(',')}}`
}

/**
 * Huella SHA-256 del payload, en hexadecimal.
 * El backend la compara contra la registrada para la clave: si difiere,
 * alguien está reutilizando una clave con otro contenido (bug del cliente o
 * intento de manipulación) y la operación se rechaza.
 * @param {unknown} payload
 * @returns {Promise<string>}
 */
export async function huellaPayload(payload) {
  const datos  = new TextEncoder().encode(serializarCanonico(payload))
  const digest = await crypto.subtle.digest('SHA-256', datos)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Hook: una clave por instancia de formulario, con rotación explícita.
 *
 * @example
 * const { clave, rotar } = useClaveIdempotencia()
 * async function guardar() {
 *   const res = await crearPresupuestoIdempotente({ clave, cabecera, detalles })
 *   rotar() // la próxima carga es otra intención
 * }
 *
 * @returns {{ clave: string, rotar: () => string, leer: () => string }}
 */
export function useClaveIdempotencia() {
  const [clave, setClave] = useState(nuevaClaveIdempotencia)
  const claveRef = useRef(clave)
  claveRef.current = clave

  const rotar = useCallback(() => {
    const nueva = nuevaClaveIdempotencia()
    claveRef.current = nueva
    setClave(nueva)
    return nueva
  }, [])

  // Lectura síncrona: dentro de un handler, `clave` del closure puede ser
  // la del render anterior si ya hubo una rotación en el mismo ciclo.
  const leer = useCallback(() => claveRef.current, [])

  return { clave, rotar, leer }
}

export default { nuevaClaveIdempotencia, huellaPayload, serializarCanonico, useClaveIdempotencia }
