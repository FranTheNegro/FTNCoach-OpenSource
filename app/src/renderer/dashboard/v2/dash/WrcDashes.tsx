/**
 * Réplicas de los tableros de los autos de rally (la lista de "Dashboard" del
 * juego). Lienzo de 1280 × 760, la proporción de esas pantallas. Cada dato sale
 * de la telemetría; lo que el sim no publica se ve como el tablero sin lectura.
 */
import type { ReactNode } from 'react'
import type { SkinTemplate } from '@shared/skin'
import { colonTime, dashData, num, pt, ringPath, type DashData, type DashProps } from './data'

const W = 1280
const H = 760
const SANS = "'Saira Dash', 'Archivo Variable', sans-serif"
const SEG7 = "'DSEG7 Classic', monospace"
const SEG14 = "'DSEG14 Classic', monospace"

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rp-svg" preserveAspectRatio="xMidYMid meet">
      <rect width={W} height={H} fill="#000" />
      {children}
    </svg>
  )
}

type T = { x: number; y: number; children: ReactNode; size: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; weight?: number; italic?: boolean; stretch?: number; font?: string; spacing?: string }

function Txt({ x, y, children, size, fill = '#fff', anchor = 'start', weight = 600, italic, stretch = 100, font = SANS, spacing }: T) {
  return (
    <text x={x} y={y} fill={fill} fontFamily={font} fontSize={size} fontWeight={weight} fontStyle={italic ? 'italic' : undefined} textAnchor={anchor} style={{ fontStretch: `${stretch}%`, letterSpacing: spacing, fontVariantNumeric: 'tabular-nums' }}>
      {children}
    </text>
  )
}

const blink = (d: DashData) => (d.shift ? `rp-blink ${d.limit ? 'fast' : ''}` : undefined)
const rpmFrac = (d: DashData) => Math.max(0, Math.min(1, d.rpm / (d.scaleK * 1000)))

// ── Rally4 / Rally3: marcha en el círculo y cuatro datos en las esquinas ─

function RallyN({ d, model }: { d: DashData; model: string }) {
  const ring = d.shift ? '#ff3020' : '#fff'
  return (
    <Frame>
      {/* Marco con la pestaña abajo al centro */}
      <path d="M40 14 H1240 Q1266 14 1266 40 V706 Q1266 732 1240 732 H806 L776 674 Q770 662 756 662 H524 Q510 662 504 674 L474 732 H40 Q14 732 14 706 V40 Q14 14 40 14 Z" fill="none" stroke="#fff" strokeWidth={6} />
      <Txt x={640} y={722} size={50} weight={800} italic anchor="middle" stretch={90}>
        {model}
      </Txt>
      <g className={blink(d)}>
        <circle cx={640} cy={370} r={292} fill="none" stroke={ring} strokeWidth={5} />
        <circle cx={640} cy={370} r={262} fill="none" stroke={ring} strokeWidth={10} />
      </g>
      <Txt x={640} y={530} size={440} weight={700} anchor="middle" stretch={88}>
        {d.gear}
      </Txt>
      <Txt x={42} y={58} size={26} weight={700}>
        ENGINE OIL (Bar)
      </Txt>
      <Txt x={42} y={104} size={38}>
        {num(d.oilBar, 1) ?? '0.0'}
      </Txt>
      <Txt x={1238} y={58} size={26} weight={700} anchor="end">
        ENGINE COOLANT (°C)
      </Txt>
      <Txt x={1238} y={104} size={38} anchor="end">
        {num(d.waterC, 1) ?? '0.0'}
      </Txt>
      <Txt x={42} y={664} size={38}>
        {num(d.fuel, 1) ?? '0.0'}
      </Txt>
      <Txt x={42} y={700} size={26} weight={700}>
        FUEL ({d.fuelUnit})
      </Txt>
      <Txt x={1238} y={664} size={38} anchor="end">
        {num(d.volt, 2) ?? '0.00'}
      </Txt>
      <Txt x={1238} y={700} size={26} weight={700} anchor="end">
        BATTERY (V)
      </Txt>
    </Frame>
  )
}

// ── Franjas verdes y naranjas con la marcha al centro ───────────────────

function Franjas({ d }: { d: DashData }) {
  const g = d.lights > 0.01
  const o = d.lights > 0.6
  const green = g ? '#00e676' : '#073d22'
  const orange = o ? '#ffa000' : '#4a2e00'
  return (
    <Frame>
      <rect x={0} y={0} width={86} height={500} fill={green} />
      <rect x={86} y={0} width={86} height={500} fill={orange} />
      <rect x={1108} y={0} width={86} height={500} fill={orange} />
      <rect x={1194} y={0} width={86} height={500} fill={green} />
      <rect x={334} y={0} width={612} height={692} fill={d.shift ? '#ff0000' : '#000'} className={blink(d)} />
      <Txt x={640} y={636} size={760} weight={800} anchor="middle" stretch={92}>
        {d.gear}
      </Txt>
      <Txt x={150} y={688} size={104} weight={600} anchor="middle">
        {Math.round(d.rpm)}
      </Txt>
      <Txt x={150} y={730} size={30} weight={700} anchor="middle">
        RPM
      </Txt>
      <Txt x={1130} y={688} size={104} weight={600} anchor="middle">
        {d.speed}
      </Txt>
      <Txt x={1130} y={730} size={30} weight={700} anchor="middle">
        {d.speedUnit}
      </Txt>
    </Frame>
  )
}

// ── RACE: barra de LEDs verde, crema y roja ──────────────────────────────

function Race({ d }: { d: DashData }) {
  const n = 86
  const lit = Math.round(rpmFrac(d) * n)
  const dl = d.deltaS === null ? 0 : Math.max(-1, Math.min(1, d.deltaS))
  return (
    <Frame>
      {/* Tira de ganancia y pérdida */}
      <rect x={400} y={22} width={150} height={10} fill="#25c22a" />
      <rect x={550} y={22} width={80} height={10} fill="#d6d48a" />
      <rect x={630} y={22} width={60} height={10} fill="#e8261e" />
      <rect x={690} y={22} width={80} height={10} fill="#d6d48a" />
      <rect x={770} y={22} width={150} height={10} fill="#25c22a" />
      <path d={`M${660 + dl * 250} 40 l-10 14 h20 z`} fill="#fff" />
      <Txt x={60} y={128} size={28} weight={800} italic>
        RACE
      </Txt>
      {Array.from({ length: n }, (_, i) => {
        const x = 60 + i * 13.6
        const h = 70 + (i / n) * 40
        const tone = i < n * 0.72 ? ['#1fbf2a', '#0b2d0d'] : i < n * 0.9 ? ['#e2e4a8', '#2c2d1d'] : ['#f02a1e', '#3a0c0a']
        return <rect key={i} x={x} y={250 - h} width={8.5} height={h} fill={i < lit ? tone[0] : tone[1]} className={i < lit && d.shift ? blink(d) : undefined} />
      })}
      <Txt x={160} y={420} size={28} weight={700} italic>
        RPM
      </Txt>
      <Txt x={640} y={432} size={120} font={SEG7} weight={400} italic fill="#d6e8a0" anchor="end">
        {Math.round(d.rpm)}
      </Txt>
      <Txt x={160} y={612} size={28} weight={700} italic>
        {d.speedUnit.toUpperCase()}
      </Txt>
      <Txt x={640} y={624} size={120} font={SEG7} weight={400} italic fill="#d6e8a0" anchor="end">
        {d.speed}
      </Txt>
      <Txt x={1020} y={650} size={360} font={SEG7} weight={400} italic fill="#d6e8a0" anchor="middle">
        {d.gearNum === '-1' ? 'r' : d.gearNum === '0' ? 'n' : d.gearNum}
      </Txt>
      <Txt x={1220} y={712} size={30} weight={800} italic fill="#d6e8a0" anchor="end">
        GEAR
      </Txt>
    </Frame>
  )
}

// ── LCD crema: barra de rayas arriba, velocidad, marcha y vueltas ────────

function Lcd({ d, fuelPct }: { d: DashData; fuelPct: number | null }) {
  const n = 76
  const lit = Math.round(rpmFrac(d) * n)
  const cream = '#e8e9b4'
  return (
    <Frame>
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={36 + i * 16} y={30} width={8} height={150} fill={i < lit ? cream : '#25261b'} className={i < lit && d.shift ? blink(d) : undefined} />
      ))}
      <Txt x={60} y={420} size={130} font={SEG7} weight={400} italic fill={cream}>
        {String(d.speed).padStart(3, '!')}
      </Txt>
      <Txt x={380} y={420} size={30} weight={700} italic fill={cream}>
        SPEED
      </Txt>
      <Txt x={640} y={560} size={380} weight={700} anchor="middle" stretch={85}>
        {d.gear}
      </Txt>
      <Txt x={1220} y={420} size={130} font={SEG7} weight={400} italic fill={cream} anchor="end">
        {Math.round(d.rpm)}
      </Txt>
      <Txt x={850} y={420} size={30} weight={700} italic fill={cream} anchor="end">
        RPM
      </Txt>
      {/* Testigos: motor, aceite y batería */}
      <g fill="none" stroke="#bfc0a0" strokeWidth={4} strokeLinejoin="round">
        <path d="M60 606 h14 v-10 h22 v10 h16 l10 -10 h14 v40 h-14 l-10 -10 h-16 v10 h-36 z" />
        <path d="M190 626 h46 l18 -16 l14 4 l-14 14 v6 h-64 z M200 610 h20" />
        <rect x={300} y={598} width={46} height={30} />
        <path d="M308 598 v-6 h8 v6 M330 598 v-6 h8 v6" />
      </g>
      <Txt x={1220} y={630} size={32} weight={800} italic fill="#bfc0a0" anchor="end">
        RACE
      </Txt>
      <rect x={36} y={660} width={1208} height={60} fill="#3a3a3a" />
      {fuelPct !== null && <rect x={36} y={660} width={1208 * fuelPct} height={60} fill="#8a8a7a" />}
    </Frame>
  )
}

// ── REV: barra roja con escala y cajas de REV y SPEED ────────────────────

function Rev({ d }: { d: DashData }) {
  const from = 2
  const to = Math.max(from + 2, d.scaleK)
  const x0 = 128
  const x1 = 1010
  const xs = (k: number) => x0 + ((x1 - x0) * (k - from)) / (to - 1 - from)
  const v = Math.max(from, Math.min(to, d.rpm / 1000))
  const box = (x: number, label: string, value: string) => (
    <g>
      <rect x={x} y={518} width={318} height={168} fill="none" stroke="#cfcfcf" strokeWidth={5} />
      <Txt x={x + 159} y={556} size={36} weight={500} anchor="middle" fill="#cfcfcf">
        {label}
      </Txt>
      <Txt x={x + 159} y={664} size={110} weight={600} anchor="middle" fill="#f2f2f2" stretch={90}>
        {value}
      </Txt>
    </g>
  )
  return (
    <Frame>
      <Txt x={34} y={82} size={30} weight={500} fill="#2fbf3a">
        REV
      </Txt>
      {Array.from({ length: to - from + 1 }, (_, i) => {
        const k = from + i
        const x = k === to ? 1150 : xs(k)
        return (
          <g key={k}>
            <Txt x={x} y={120} size={40} weight={500} anchor="middle" fill="#2fbf3a">
              {k}
            </Txt>
            <line x1={x} y1={130} x2={x} y2={k === to ? 260 : 150} stroke="#2fbf3a" strokeWidth={4} />
          </g>
        )
      })}
      <rect x={x0} y={150} width={x1 - x0} height={70} fill="#2a0806" />
      <rect x={x0} y={150} width={Math.min(x1 - x0, xs(v) - x0)} height={70} fill="#ff1a12" className={blink(d)} />
      {Array.from({ length: to - from - 1 }, (_, i) => (
        <line key={i} x1={xs(from + i + 1)} y1={150} x2={xs(from + i + 1)} y2={220} stroke="#000" strokeWidth={3} opacity={0.5} />
      ))}
      <Txt x={640} y={700} size={460} weight={300} anchor="middle" fill="#f0a080" stretch={80}>
        {d.gear}
      </Txt>
      {box(38, 'REV', String(Math.round(d.rpm)))}
      {box(924, 'SPEED', String(d.speed).padStart(3, '0'))}
    </Frame>
  )
}

// ── Ignition: escalones que se llenan desde abajo ────────────────────────

const STEP_SHAPE = 'M282 704 V300 H330 V250 H420 L470 194 H810 L860 250 H950 V300 H998 V704 H850 V330 H430 V704 Z'

function Ignicion({ d }: { d: DashData }) {
  const fill = rpmFrac(d)
  const top = 194
  const bottom = 704
  const level = bottom - (bottom - top) * fill
  const lights = Math.round(d.lights * 5)
  const tones = ['#2fd12c', '#2fd12c', '#f2e64a', '#f2e64a', '#ff1a12']
  return (
    <Frame>
      {Array.from({ length: 5 }, (_, i) => (
        <rect key={i} x={38 + i * 238} y={36} width={226} height={110} rx={6} fill={i < lights ? tones[i] : 'none'} stroke="#777" strokeWidth={5} className={i < lights && d.shift ? blink(d) : undefined} />
      ))}
      <Txt x={38} y={280} size={84} font={SEG7} weight={700} fill="#e8b850">
        {Math.round(d.rpm)}
      </Txt>
      <Txt x={1230} y={210} size={30} weight={500} fill="#e8b850" anchor="end">
        Ignition ON
      </Txt>
      <defs>
        <clipPath id="ign-shape">
          <path d={STEP_SHAPE} />
        </clipPath>
        <clipPath id="ign-level">
          <rect x={0} y={level} width={W} height={H - level} />
        </clipPath>
      </defs>
      <g clipPath="url(#ign-shape)">
        <rect x={0} y={0} width={W} height={330} fill="#3a0806" />
        <rect x={0} y={330} width={W} height={90} fill="#3c3a10" />
        <rect x={0} y={420} width={W} height={100} fill="#33331a" />
        <rect x={0} y={520} width={W} height={200} fill="#0f2e0c" />
        <g clipPath="url(#ign-level)">
          <rect x={0} y={0} width={W} height={330} fill="#ff1a12" />
          <rect x={0} y={330} width={W} height={90} fill="#f2e64a" />
          <rect x={0} y={420} width={W} height={100} fill="#eef08a" />
          <rect x={0} y={520} width={W} height={200} fill="#6fdc3a" />
        </g>
      </g>
      <rect x={470} y={360} width={340} height={300} fill="#000" />
      <Txt x={640} y={620} size={230} font={SEG7} weight={700} italic fill="#e8b850" anchor="middle">
        {d.gearNum === '-1' ? 'r' : d.gearNum === '0' ? 'n' : d.gearNum}
      </Txt>
    </Frame>
  )
}

// ── Analógico: tacómetro ámbar, datos a los costados y vueltas abajo ─────

function Analogico({ d }: { d: DashData }) {
  const cx = 640
  const cy = 352
  const R = 330
  const A0 = 120
  const A1 = 420
  const top = d.scaleK
  const at = (k: number) => A0 + ((A1 - A0) * Math.max(0, Math.min(k, top))) / top
  const amber = '#e9b44c'
  const lbl = (x: number, y: number, t: string, anchor: 'start' | 'end') => (
    <Txt x={x} y={y} size={24} weight={800} italic fill={amber} anchor={anchor}>
      {t}
    </Txt>
  )
  const val = (x: number, y: number, t: string, anchor: 'start' | 'end' | 'middle') => (
    <Txt x={x} y={y} size={80} weight={700} italic anchor={anchor} stretch={92}>
      {t}
    </Txt>
  )
  const kpa = (bar: number | null) => (bar === null ? null : String(Math.round(bar * 100)))
  const dl = d.deltaS === null ? 0 : Math.max(-1, Math.min(1, -d.deltaS))
  return (
    <Frame>
      <defs>
        <clipPath id="ana-top">
          <rect x={0} y={0} width={W} height={480} />
        </clipPath>
        <linearGradient id="ana-panel" x1={0} y1={0} x2={0} y2={1}>
          <stop offset={0} stopColor="#2e2e2e" />
          <stop offset={1} stopColor="#161616" />
        </linearGradient>
      </defs>
      <g clipPath="url(#ana-top)">
        <circle cx={cx} cy={cy} r={R} fill="#1c1c1c" />
        <path d={ringPath(cx, cy, R - 70, R - 8, A0, A1)} fill="#d4d4d4" />
        <path d={ringPath(cx, cy, R - 70, R - 8, A0, at(d.rpm / 1000))} fill={d.shift ? '#ff3a22' : amber} className={blink(d)} />
        <circle cx={cx} cy={cy} r={R - 4} fill="none" stroke="#9a9a9a" strokeWidth={6} />
        <circle cx={cx} cy={cy} r={R - 74} fill="#000" stroke="#555" strokeWidth={4} />
        {Array.from({ length: top + 1 }, (_, k) => {
          const [tx, ty] = pt(cx, cy, R - 39, at(k))
          return (
            <Txt key={k} x={tx} y={ty + 12} size={32} weight={700} anchor="middle" fill="#2a2a2a">
              {k}
            </Txt>
          )
        })}
        <Txt x={cx} y={cy - 110} size={26} weight={800} anchor="middle" fill="#cfcfcf">
          RACE
        </Txt>
        <Txt x={cx} y={cy + 110} size={250} weight={700} anchor="middle" stretch={85}>
          {d.gear}
        </Txt>
      </g>
      {lbl(26, 46, 'ENGINE OIL TMP', 'start')}
      {val(26, 128, num(d.oilC, 0) ?? '---', 'start')}
      {lbl(26, 196, 'GBOX OIL TMP', 'start')}
      {val(26, 278, '---', 'start')}
      {lbl(26, 340, 'SPEED', 'start')}
      {val(26, 422, String(d.speed).padStart(3, '0'), 'start')}
      {lbl(1254, 46, 'WATER TMP', 'end')}
      {val(1254, 128, num(d.waterC, 0) ?? '---', 'end')}
      {lbl(1254, 196, 'OIL PRESS', 'end')}
      {val(1254, 278, kpa(d.oilBar) ?? '---', 'end')}
      {lbl(1254, 340, 'FUEL PRESS', 'end')}
      {val(1254, 422, kpa(d.fuelBar) ?? '---', 'end')}

      <rect x={0} y={480} width={W} height={280} fill="url(#ana-panel)" />
      {lbl(26, 520, 'REFERENCE LAP', 'start')}
      {val(26, 604, colonTime(d.bestS) ?? '00:00:00', 'start')}
      <Txt x={640} y={520} size={24} weight={800} italic fill={amber} anchor="middle">
        GAIN/LOST
      </Txt>
      {val(640, 604, d.deltaS === null ? '0.00' : Math.abs(d.deltaS).toFixed(2), 'middle')}
      {lbl(1254, 520, 'RUNNING LAP', 'end')}
      {val(1254, 604, colonTime(d.lapS, 1) ?? '00:00:0', 'end')}
      <Txt x={640} y={650} size={22} weight={800} italic fill="#e8261e" anchor="middle">
        GAIN/LOST
      </Txt>
      <Txt x={150} y={700} size={18} weight={700} fill="#bdbdbd" anchor="end">
        LOSS
      </Txt>
      <Txt x={1130} y={700} size={18} weight={700} fill="#bdbdbd">
        GAIN
      </Txt>
      <rect x={170} y={690} width={940} height={6} fill="#4a4a4a" />
      <rect x={Math.min(640, 640 + dl * 470)} y={688} width={Math.abs(dl) * 470} height={10} fill="#e8261e" />
      <rect x={636} y={680} width={8} height={26} fill="#cfcfcf" />
    </Frame>
  )
}

// ── Segmentos: semáforo y marcha de 14 segmentos ─────────────────────────

function Segmentos({ d }: { d: DashData }) {
  const lamp = (cy: number, on: boolean, color: string, dim: string) => (
    <g>
      {on && <circle cx={320} cy={cy} r={58} fill={color} opacity={0.25} />}
      <circle cx={320} cy={cy} r={38} fill={on ? color : dim} className={on && d.shift ? blink(d) : undefined} />
    </g>
  )
  return (
    <Frame>
      {lamp(190, d.shift, '#ff2a1a', '#2a0806')}
      {lamp(380, d.lights > 0.66, '#ffe21a', '#2a2606')}
      {lamp(570, d.lights > 0.2, '#22e030', '#062a08')}
      <rect x={660} y={110} width={380} height={540} rx={16} fill="#140504" stroke="#2c0c08" strokeWidth={6} />
      <Txt x={850} y={590} size={420} font={SEG14} weight={700} italic fill="#3a100c" anchor="middle">
        ~
      </Txt>
      <Txt x={850} y={590} size={420} font={SEG14} weight={700} italic fill="#ff2a1a" anchor="middle">
        {d.gear}
      </Txt>
    </Frame>
  )
}

// ── Dorado: luces arriba, datos de motor a la izquierda y marcha dorada ──

function Dorado({ d }: { d: DashData }) {
  const gold = '#e6b85a'
  const lights = Math.round(d.lights * 5)
  const row = (y: number, k: string, v: string, size = 46) => (
    <g>
      <Txt x={80} y={y} size={size} weight={500} fill={gold} stretch={75}>
        {k}
      </Txt>
      <Txt x={560} y={y} size={size} weight={500} fill={gold} anchor="end" stretch={75}>
        {v}
      </Txt>
    </g>
  )
  return (
    <Frame>
      {Array.from({ length: 5 }, (_, i) => (
        <rect key={i} x={80 + i * 116} y={30} width={108} height={100} fill={i < lights ? (i < 3 ? '#2fd12c' : '#ff1a12') : 'none'} stroke={gold} strokeWidth={5} className={i < lights && d.shift ? blink(d) : undefined} />
      ))}
      <Txt x={1110} y={74} size={40} weight={500} fill={gold} stretch={75}>
        {d.lap}
      </Txt>
      {row(232, 'WATER T', num(d.waterC, 0) ?? '--')}
      {row(300, 'OIL T', num(d.oilC, 0) ?? '--')}
      {row(368, 'BATT V', num(d.volt, 1) ?? '--.-')}
      {row(452, 'PEDAL TPS', String(Math.round(d.throttle * 100)), 56)}
      <Txt x={80} y={500} size={22} weight={500} fill="#8a6f3a" stretch={75}>
        Tyre
      </Txt>
      <Txt x={80} y={548} size={46} weight={500} fill={gold} stretch={75}>
        RACE MODE
      </Txt>
      <Txt x={240} y={702} size={40} weight={500} fill="#8a6f3a" stretch={75}>
        Oil Pressure
      </Txt>
      <Txt x={500} y={702} size={40} weight={500} fill={gold} stretch={75}>
        {num(d.oilBar, 1) ?? '-.-'}
      </Txt>
      <Txt x={980} y={640} size={600} weight={500} fill={gold} anchor="middle" stretch={70}>
        {d.gear}
      </Txt>
    </Frame>
  )
}

export function WrcDash({ template, ...p }: DashProps & { template: SkinTemplate }) {
  const d = dashData(p)
  const max = p.meta?.fuelMaxL ?? null
  const fuelPct = p.f.fuelL !== null && max ? Math.max(0, Math.min(1, p.f.fuelL / max)) : null
  let body: ReactNode
  switch (template) {
    case 'wrc-rally3':
      body = <RallyN d={d} model="Rally3" />
      break
    case 'wrc-franjas':
      body = <Franjas d={d} />
      break
    case 'wrc-race':
      body = <Race d={d} />
      break
    case 'wrc-lcd':
      body = <Lcd d={d} fuelPct={fuelPct} />
      break
    case 'wrc-rev':
      body = <Rev d={d} />
      break
    case 'wrc-ignicion':
      body = <Ignicion d={d} />
      break
    case 'wrc-analogico':
      body = <Analogico d={d} />
      break
    case 'wrc-segmentos':
      body = <Segmentos d={d} />
      break
    case 'wrc-dorado':
      body = <Dorado d={d} />
      break
    default:
      body = <RallyN d={d} model="Rally4" />
  }
  return (
    <section className="rp-dash" style={{ ['--rp-ratio' as string]: `${W} / ${H}`, ['--rp-w' as string]: String(W / H) }}>
      <div className="rp-frame">{body}</div>
    </section>
  )
}
