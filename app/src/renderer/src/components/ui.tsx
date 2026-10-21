// Primitivas del manual §6: botones de 44 px, radios 6/10/14/20, tarjetas
// carbono 2 + grafito, sin sombras, etiquetas mono con el cuadradito.
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-ultramar text-blanco hover:bg-ultramar-hover',
  secondary: 'bg-transparent text-blanco border border-acero hover:border-plata',
  ghost: 'bg-transparent text-plata hover:text-blanco',
}

export function Button({
  variant = 'secondary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`h-11 px-4 rounded-control font-ui font-semibold text-[14px] inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors disabled:opacity-40 disabled:pointer-events-none ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  )
}

export function Card({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`bg-carbono-2 border border-grafito rounded-card p-5 scroll-mt-4 ${className}`}>
      {children}
    </section>
  )
}

export function Label({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="data inline-flex items-center gap-2 text-[11px] tracking-[0.12em] uppercase text-niebla" style={color ? { color } : undefined}>
      <span className="w-[7px] h-[7px] bg-current shrink-0" />
      {children}
    </span>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${checked ? 'bg-ultramar' : 'bg-acero'}`}
    >
      <span
        className={`absolute top-1 w-5 h-5 rounded-full bg-blanco transition-[left] ${checked ? 'left-6' : 'left-1'}`}
      />
    </button>
  )
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4 mb-6">
      <h1 className="font-display text-[26px] font-extrabold italic leading-none" style={{ fontStretch: '125%' }}>
        {title}
      </h1>
      {children}
    </header>
  )
}
