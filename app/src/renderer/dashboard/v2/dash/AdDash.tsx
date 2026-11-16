/**
 * Réplica del tablero AD (el que usa todo el ecosistema ACTC: TC, TC Pista,
 * TN…). Dos pantallas, como el real:
 * - Carrera: la versión de simulador (V. Rápida, Vueltas, Gap, T. Vuelta,
 *   Posición, Nafta, mapa y tabla), con etiquetas amarillas y números blancos.
 * - Motor: la pantalla del auto (presiones, batería y temperaturas), con
 *   etiquetas blancas y números amarillos.
 * Lienzo de 1280 × 720, como el tablero; se escala entero a la pantalla.
 * El logo del fabricante del tablero no se reproduce: su lugar queda vacío.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { Standings } from '@shared/live'
import { DASH } from '../kit'
import { shortName, windowAround } from '../CategoryLive'
import { RpMap } from './RpMap'
import { dashData, dotTime, num, pt, type DashData, type DashProps } from './data'

const FONT = "'Saira Dash', 'Archivo Variable', sans-serif"

// ── Tacómetro ────────────────────────────────────────────────────────────

/** Ángulo del 0 (abajo a la izquierda) y del final de la escala (a la derecha). */
const A0 = 154
const A_END = 353

/**
 * La banda del tacómetro: termina en corte radial abajo a la izquierda y en
 * corte horizontal a la derecha, apenas arriba del centro (como el real).
 */
function band(cx: number, cy: number, R: number, r: number, cutY: number): string {
  const aO = 360 - (Math.asin(cutY / R) * 180) / Math.PI
  const aI = 360 - (Math.asin(cutY / r) * 180) / Math.PI
  const [x0, y0] = pt(cx, cy, R, A0)
  const [x1, y1] = pt(cx, cy, R, aO)
  const [x2, y2] = pt(cx, cy, r, aI)
  const [x3, y3] = pt(cx, cy, r, A0)
  const f = (n: number) => n.toFixed(1)
  return `M${f(x0)} ${f(y0)}A${R} ${R} 0 1 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r} ${r} 0 1 0 ${f(x3)} ${f(y3)}Z`
}

function wedge(cx: number, cy: number, R: number, to: number): string {
  // Sector desde el centro hasta el ángulo del valor: recortado por la banda queda la parte llena
  if (to <= A0 + 0.1) return ''
  const [x0, y0] = pt(cx, cy, R, A0)
  const [x1, y1] = pt(cx, cy, R, to)
  return `M${cx} ${cy}L${x0.toFixed(1)} ${y0.toFixed(1)}A${R} ${R} 0 ${to - A0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}Z`
}

function AdGauge({ d, id, cx, cy, R }: { d: DashData; id: string; cx: number; cy: number; R: number }) {
  const r = R * 0.62
  const cut = R * 0.087
  const at = (k: number) => A0 + ((A_END - A0) * Math.max(0, Math.min(k, d.scaleK))) / d.scaleK
  const value = at(d.rpm / 1000)
  const hot = d.rpm >= d.shiftRpm
  const ticks = Array.from({ length: d.scaleK + 1 }, (_, k) => k)
  return (
    <g>
      <defs>
        <clipPath id={`${id}-band`}>
          <path d={band(cx, cy, R - 12, r + 12, cut)} />
        </clipPath>
        <radialGradient id={`${id}-fill`} cx={cx} cy={cy} r={R} gradientUnits="userSpaceOnUse">
          <stop offset={0.62} stopColor={hot ? '#ff6a5c' : '#9ff0f0'} />
          <stop offset={1} stopColor={hot ? '#e0261c' : '#20b5bb'} />
        </radialGradient>
      </defs>
      <path d={band(cx, cy, R, r, cut)} fill="#585858" />
      <path d={band(cx, cy, R - 6, r + 6, cut)} fill="#a6a6a6" />
      <path d={band(cx, cy, R - 12, r + 12, cut)} fill="#dcdcdc" />
      <path d={wedge(cx, cy, R, value)} fill={`url(#${id}-fill)`} clipPath={`url(#${id}-band)`} className={d.shift ? `rp-blink ${d.limit ? 'fast' : ''}` : undefined} />
      {ticks.map((k) => {
        const a = at(k)
        const [x0, y0] = pt(cx, cy, R - 13, a)
        const [x1, y1] = pt(cx, cy, R - 30, a)
        const [tx, ty] = pt(cx, cy, R - 58, a)
        return (
          <g key={k}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#4a4a4a" strokeWidth={4} />
            <text x={tx} y={ty} fill="#454545" fontFamily={FONT} fontSize={R * 0.13} fontStyle="italic" fontWeight={600} textAnchor="middle" dominantBaseline="central" style={{ fontStretch: '110%' }}>
              {k}
            </text>
          </g>
        )
      })}
    </g>
  )
}

// ── Etiqueta con la raya quebrada ────────────────────────────────────────

/**
 * Etiqueta sobre una raya que se quiebra hacia abajo en la punta que mira al
 * tacómetro. `side` = de qué lado de la pantalla está el dato.
 */
function Label({ x, y, w, side, text, color, line, italic, size = 30 }: { x: number; y: number; w: number; side: 'l' | 'r'; text: string; color: string; line: string; italic?: boolean; size?: number }) {
  const k = 16
  const d = side === 'l' ? `M${x} ${y}H${x + w}l${k} ${k}` : `M${x + w} ${y}H${x}l${-k} ${k}`
  return (
    <g>
      <text x={x + w / 2} y={y - 9} fill={color} fontFamily={FONT} fontSize={size} fontWeight={700} fontStyle={italic ? 'italic' : undefined} textAnchor="middle" style={{ fontStretch: '125%' }}>
        {text}
      </text>
      <path d={d} fill="none" stroke={line} strokeWidth={3.5} strokeLinejoin="round" />
    </g>
  )
}

function Value({ x, y, children, color, size = 50, anchor = 'middle' }: { x: number; y: number; children: ReactNode; color: string; size?: number; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <text x={x} y={y} fill={color} fontFamily={FONT} fontSize={size} fontWeight={600} textAnchor={anchor} style={{ fontStretch: '112%', fontVariantNumeric: 'tabular-nums' }}>
      {children}
    </text>
  )
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

const comma = (x: number, d: number) => x.toFixed(d)

// ── Pantalla Carrera ─────────────────────────────────────────────────────

const Y_LBL = '#e9d84b'
const WHITE = '#f4f6fa'

function Standings({ s }: { s: Standings | null }) {
  if (!s || s.cars.length === 0) return <div className="rp-ad-table empty">Sin posiciones</div>
  const rows = windowAround(s.cars, null, 8)
  return (
    <div className="rp-ad-table">
      <div className="hd">
        <span>▲</span>
        <span>CONDUCTOR</span>
        <span>V</span>
        <span>GAP</span>
      </div>
      {rows.map((c) => (
        <div key={c.idx} className={c.me ? 'me' : ''}>
          <span>{c.position}</span>
          <span>{shortName(c.name)}</span>
          <span>{c.laps}</span>
          <span>{c.position === 1 ? '' : c.lapsDown > 0 ? `+${c.lapsDown}V` : (s.race ? c.intervalS : c.gapS) !== null ? `+${comma((s.race ? c.intervalS : c.gapS) as number, 1)}` : ''}</span>
        </div>
      ))}
    </div>
  )
}

function Carrera(p: DashProps) {
  const d = dashData(p)
  const clock = useClock()
  const cx = 600
  const cy = 345
  const R = 300
  const deltaTone = d.deltaS === null ? '#8a8f98' : d.deltaS <= 0 ? '#8fd14f' : '#ff5a4a'
  const gap = d.leader ? '-' : d.lapsDown > 0 ? `+${d.lapsDown}V` : d.gapS !== null ? comma(d.gapS, 1) : null
  const bar = (x: number, v: number, color: string) => (
    <g>
      <rect x={x} y={612} width={36} height={70} fill="rgba(255,255,255,0.21)" />
      <rect x={x} y={612 + 70 * (1 - v)} width={36} height={70 * v} fill={color} />
    </g>
  )
  return (
    <>
      <svg viewBox="0 0 1280 720" className="rp-svg" preserveAspectRatio="xMidYMid meet">
        <rect width={1280} height={720} fill="#000" />
        <AdGauge d={d} id="adc" cx={cx} cy={cy} R={R} />

        {/* Marcha y velocidad */}
        <text x={cx - 10} y={cy + 72} fill="#fff" stroke="#111" strokeWidth={6} paintOrder="stroke" fontFamily={FONT} fontSize={200} fontWeight={800} textAnchor="middle" style={{ fontStretch: '108%' }}>
          {d.gearNum}
        </text>
        <Label x={470} y={452} w={190} side="l" text="VELOCIDAD x" color="#9a9a9a" line={Y_LBL} italic size={20} />
        <text x={cx - 10} y={545} fill="#6e9fe8" stroke="#0b1530" strokeWidth={4} paintOrder="stroke" fontFamily={FONT} fontSize={82} fontWeight={800} fontStyle="italic" textAnchor="middle" style={{ fontStretch: '110%' }}>
          {d.speed}
        </text>

        {/* Izquierda */}
        <Label x={70} y={128} w={200} side="l" text="V.RAPIDA" color={Y_LBL} line={Y_LBL} italic />
        <Value x={170} y={182} color={WHITE} size={46}>
          {dotTime(d.bestS) ?? '--.--.---'}
        </Value>
        <text x={240} y={214} fill={deltaTone} fontFamily={FONT} fontSize={24} fontWeight={600} textAnchor="middle">
          {d.deltaS === null ? '' : `${d.deltaS > 0 ? '+' : ''}${d.deltaS.toFixed(1)}`}
        </text>
        <Label x={60} y={270} w={170} side="l" text="VUELTAS" color={Y_LBL} line={Y_LBL} italic />
        <Value x={145} y={326} color={WHITE}>
          {d.lapsTotal ? `${Math.min(d.lap, d.lapsTotal)}/${d.lapsTotal}` : d.lap}
        </Value>
        <Label x={40} y={385} w={150} side="l" text="GAP" color={Y_LBL} line={Y_LBL} italic />
        <Value x={115} y={440} color={WHITE}>
          {gap ?? DASH}
        </Value>

        {/* Derecha */}
        <Label x={900} y={82} w={240} side="r" text="T.VUELTA" color={Y_LBL} line={Y_LBL} italic />
        <Value x={1020} y={136} color={WHITE} size={46}>
          {dotTime(d.lapS) ?? '00.00.000'}
        </Value>
        <Label x={985} y={240} w={180} side="r" text="POSICION" color={Y_LBL} line={Y_LBL} italic />
        <Value x={1075} y={296} color={WHITE}>
          {d.position ?? DASH}
        </Value>
        <Label x={1060} y={372} w={150} side="r" text="NAFTA" color={Y_LBL} line={Y_LBL} italic />
        <Value x={1060} y={428} color={WHITE} anchor="end">
          {num(d.fuel, 0) ?? DASH}
        </Value>
        <Value x={1180} y={428} color={WHITE} anchor="end">
          {num(d.fuelLaps, 0) ?? ''}
        </Value>

        {/* Pedales y reloj */}
        {bar(548, d.clutch, '#2f6fd6')}
        {bar(596, d.brake, '#2f6fd6')}
        {bar(644, d.throttle, '#f0d43a')}
        <rect x={22} y={652} width={96} height={42} rx={6} fill="#14171c" stroke="#3a3f47" strokeWidth={2} />
        <text x={70} y={682} fill={WHITE} fontFamily={FONT} fontSize={24} fontWeight={600} textAnchor="middle">
          {clock}
        </text>
      </svg>
      <div className="rp-overlay">
        <div className="rp-ad-map" style={{ left: `${(30 / 1280) * 100}%`, top: `${(468 / 720) * 100}%`, width: `${(270 / 1280) * 100}%`, height: `${(176 / 720) * 100}%` }}>
          <RpMap f={p.f} meta={p.meta} standings={p.standings} color="#f0d43a" />
        </div>
        <div style={{ position: 'absolute', left: `${(952 / 1280) * 100}%`, top: `${(466 / 720) * 100}%`, width: `${(318 / 1280) * 100}%`, height: `${(236 / 720) * 100}%` }}>
          <Standings s={p.standings} />
        </div>
      </div>
    </>
  )
}

// ── Pantalla Motor ───────────────────────────────────────────────────────

const Y_NUM = '#f2e45c'
const Y_LINE = '#d2c142'

function Motor(p: DashProps) {
  const d = dashData(p)
  const cx = 655
  const cy = 430
  const R = 290
  // "LA" del real (sonda lambda) → delta contra tu mejor vuelta: a la derecha perdés, a la izquierda ganás
  const dl = d.deltaS
  const span = dl === null ? 0 : Math.max(-36, Math.min(36, dl * 36))
  const arcR = R + 100
  const [ax0, ay0] = pt(cx, cy, arcR, 272)
  const [ax1, ay1] = pt(cx, cy, arcR, 272 + span)
  const arc = Math.abs(span) < 0.3 ? '' : `M${ax0.toFixed(1)} ${ay0.toFixed(1)}A${arcR} ${arcR} 0 0 ${span > 0 ? 1 : 0} ${ax1.toFixed(1)} ${ay1.toFixed(1)}`
  return (
    <svg viewBox="0 0 1280 720" className="rp-svg" preserveAspectRatio="xMidYMid meet">
      <rect width={1280} height={720} fill="#000" />
      <text x={330} y={118} fill={WHITE} fontFamily={FONT} fontSize={26} fontWeight={600} textAnchor="middle" style={{ fontStretch: '115%' }}>
        Gana
      </text>
      <text x={1040} y={128} fill={WHITE} fontFamily={FONT} fontSize={26} fontWeight={600} textAnchor="middle" style={{ fontStretch: '115%' }}>
        Pierde
      </text>
      <text x={525} y={142} fill={WHITE} fontFamily={FONT} fontSize={28} fontWeight={800} textAnchor="middle" style={{ fontStretch: '125%' }}>
        DT
      </text>
      <text x={690} y={132} fill={dl !== null && dl < 0 ? '#5fd35a' : '#ff4b3a'} fontFamily={FONT} fontSize={42} fontWeight={600} textAnchor="middle" style={{ fontStretch: '115%', letterSpacing: '0.12em' }}>
        {dl === null ? '0.00' : Math.abs(dl).toFixed(2)}
      </text>
      {arc && <path d={arc} fill="none" stroke={span > 0 ? '#ff4b3a' : '#5fd35a'} strokeWidth={10} />}

      <AdGauge d={d} id="adm" cx={cx} cy={cy} R={R} />
      <text x={cx + 5} y={cy + 62} fill="#fff" fontFamily={FONT} fontSize={190} fontWeight={800} textAnchor="middle" style={{ fontStretch: '108%' }}>
        {d.gearNum}
      </text>
      <Value x={815} y={590} color={WHITE} size={48} anchor="end">
        {Math.round(d.rpm)}
      </Value>
      <Label x={560} y={634} w={240} side="l" text="RPM" color={Y_NUM} line={Y_LINE} size={28} />

      {/* Izquierda */}
      <Label x={80} y={214} w={250} side="l" text="P. Aceite" color={WHITE} line={Y_LINE} />
      <Value x={200} y={286} color={Y_NUM} size={62}>
        {num(d.oilBar, 1) ?? '0'}
      </Value>
      <Label x={70} y={364} w={250} side="l" text="P. Nafta" color={WHITE} line={Y_LINE} />
      <Value x={200} y={436} color={Y_NUM} size={62}>
        {num(d.fuelBar, 1) ?? '0.0'}
      </Value>
      {/* Batería */}
      <g fill="none" stroke="#e8e8e8" strokeWidth={3.5}>
        <rect x={90} y={515} width={186} height={104} rx={8} />
        <path d="M84 515 H282 V496 H84 Z" fill="#e8e8e8" />
        <rect x={104} y={480} width={18} height={16} fill="#e8e8e8" />
        <rect x={244} y={480} width={18} height={16} fill="#e8e8e8" />
      </g>
      <Value x={183} y={590} color={Y_NUM} size={56}>
        {num(d.volt, 1) ?? '0.0'}
      </Value>

      {/* Derecha */}
      <Label x={980} y={214} w={240} side="r" text="T. Aceite" color={WHITE} line={Y_LINE} />
      <Value x={1110} y={286} color={Y_NUM} size={62}>
        {num(d.oilC, 0) ?? DASH}
      </Value>
      <Label x={995} y={352} w={225} side="r" text="T.Agua" color={WHITE} line={Y_LINE} />
      <Value x={1115} y={424} color={Y_NUM} size={62}>
        {num(d.waterC, 0) ?? DASH}
      </Value>
      <Label x={980} y={500} w={240} side="r" text="T. Tapa" color={WHITE} line={Y_LINE} />
      <Value x={1110} y={572} color={Y_NUM} size={62}>
        {DASH}
      </Value>
    </svg>
  )
}

export function AdDash({ variant, ...p }: DashProps & { variant: 'carrera' | 'motor' }) {
  return (
    <section className="rp-dash" style={{ ['--rp-ratio' as string]: '1280 / 720', ['--rp-w' as string]: String(1280 / 720) }}>
      <div className="rp-frame">{variant === 'motor' ? <Motor {...p} /> : <Carrera {...p} />}</div>
    </section>
  )
}
