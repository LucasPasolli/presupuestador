// src/hooks/useOnlineStatus.js
import { useEffect, useState } from 'react'

/**
 * Estado de conectividad del navegador. En mobile la conexión es intermitente,
 * así que la UI debe poder avisar que los datos mostrados pueden estar viejos.
 * @returns {boolean} `true` si hay conexión.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const on  = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  return online
}
