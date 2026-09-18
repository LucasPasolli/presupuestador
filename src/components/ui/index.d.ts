// src/components/ui/index.d.ts
//
// Tipado estático sin migrar el proyecto a TypeScript.
// Con `checkJs`/JSDoc o simplemente con el servidor de lenguaje de VS Code,
// estas definiciones dan autocompletado y detección de errores en los 125
// usos de <Button> del proyecto.
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  ComponentType,
  ReactNode,
} from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize    = 'sm' | 'md' | 'lg'
export type BadgeColor    =
  | 'orange' | 'green' | 'blue' | 'red' | 'yellow' | 'gray' | 'violet'

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ComponentType<{ size?: number; className?: string }>
  /**
   * Handler de la acción. Si devuelve una `Promise`, el botón se bloquea y
   * muestra el spinner hasta que se resuelva. Los handlers síncronos
   * conservan el comportamiento original.
   */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => unknown | Promise<unknown>
  /** Estado de carga controlado desde el exterior. */
  loading?: boolean
  /** Texto anunciado por lectores de pantalla mientras se procesa. */
  loadingText?: string
  /** `false` desactiva la protección anti-doble-clic (usar con criterio). */
  guard?: boolean
  /** Duración mínima del spinner en ms. Por defecto 250. */
  minPendingMs?: number
  /** Watchdog en ms que libera el bloqueo si el backend no responde. Por defecto 30000. */
  timeoutMs?: number
  /** Se invoca si la promesa del handler se rechaza sin ser capturada. */
  onError?: (error: unknown) => void
}

export declare function Button(props: ButtonProps): JSX.Element

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode
  error?: ReactNode
}
export declare function Input(props: InputProps): JSX.Element

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode
  error?: ReactNode
  children?: ReactNode
}
export declare function Select(props: SelectProps): JSX.Element

export declare function Badge(props: { children?: ReactNode; color?: BadgeColor }): JSX.Element
export declare function Card(props: { children?: ReactNode; className?: string }): JSX.Element

export declare function PageHeader(props: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}): JSX.Element

export declare function Table(props: {
  headers: string[]
  children?: ReactNode
  empty?: ReactNode
}): JSX.Element

export declare function Tr(props: {
  children?: ReactNode
  onClick?: () => void
  className?: string
}): JSX.Element

export declare function Td(props: { children?: ReactNode; className?: string }): JSX.Element

export declare function Modal(props: {
  open: boolean
  onClose: () => void
  title: string
  children?: ReactNode
  width?: string
  /** Bloquea el cierre por backdrop/Escape mientras hay una operación en curso. */
  busy?: boolean
}): JSX.Element | null

export declare function Spinner(props?: { label?: string }): JSX.Element
