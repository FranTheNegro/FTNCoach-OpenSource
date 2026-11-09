/**
 * El quiz que arma el coach de cada piloto. De esta misma lista salen la pantalla
 * (`label`, `hint`) y las instrucciones para la IA (`prompt`), así lo que el piloto
 * elige es exactamente lo que recibe el modelo. Todas las preguntas suman además la
 * opción "Personalizado", con texto libre; la agrega la pantalla.
 */

export interface QuizOption {
  id: string
  label: string
  hint?: string
  /** Lo que se le pide al modelo si el piloto elige esta opción. */
  prompt: string
}

export interface QuizQuestion {
  id: string
  title: string
  sub?: string
  /** Se pueden elegir varias opciones. */
  multi?: boolean
  /** Título de la preferencia en el prompt. */
  topic: string
  /** Sin opciones la pregunta es solo de texto libre y se puede dejar vacía. */
  options: QuizOption[]
  placeholder: string
}

export const COACH_QUIZ: QuizQuestion[] = [
  {
    id: 'level',
    title: '¿En qué nivel te ves hoy?',
    sub: 'Define desde dónde te explica el coach.',
    topic: 'Driver level',
    placeholder: 'Por ejemplo: corro hace años en karting, pero recién arranco en simulador.',
    options: [
      {
        id: 'new',
        label: 'Estoy empezando',
        hint: 'Todavía estoy aprendiendo las trazadas y a frenar bien.',
        prompt: 'Beginner. Start from fundamentals, explain why each thing matters and avoid assuming racecraft knowledge.',
      },
      {
        id: 'club',
        label: 'Ya doy vueltas limpias',
        hint: 'Me falta ritmo y entender dónde pierdo.',
        prompt: 'Intermediate. They can repeat a clean lap; focus on where time goes and on one technique at a time.',
      },
      {
        id: 'racer',
        label: 'Corro seguido',
        hint: 'Ligas, carreras online, busco las últimas décimas.',
        prompt: 'Experienced racer. Skip the basics and go straight to the fine differences.',
      },
      {
        id: 'pro',
        label: 'Corro o corrí en pista real',
        hint: 'Conozco el auto y los términos.',
        prompt: 'Real-world racing experience. Speak as you would to a racing driver, with no basics.',
      },
    ],
  },
  {
    id: 'goal',
    title: '¿Qué querés lograr?',
    sub: 'Podés elegir más de una.',
    multi: true,
    topic: 'What the driver wants',
    placeholder: 'Por ejemplo: bajar de 2:18 en Spa con el Corvette antes de la carrera del domingo.',
    options: [
      { id: 'pace', label: 'Bajar mi mejor vuelta', prompt: 'A faster best lap: prioritise the biggest single gains.' },
      { id: 'consistency', label: 'Ser más constante', prompt: 'Consistency: prioritise the corners that change most from lap to lap and how to repeat the good version.' },
      { id: 'race', label: 'Tener ritmo de carrera', prompt: 'Race pace: prioritise stint pace, pace drop-off, fuel use and laps that can be repeated without risk.' },
      { id: 'clean', label: 'Dejar de irme de pista', prompt: 'Staying on track: prioritise off-tracks and where the driver is over the limit, before chasing time.' },
      { id: 'learn', label: 'Aprender una pista o un auto', prompt: 'Learning this car or track: explain what the session shows about how this combination wants to be driven.' },
      { id: 'fun', label: 'Disfrutar y mejorar de a poco', prompt: 'Enjoyment: keep it light, with one small thing to try and no pressure about lap times.' },
    ],
  },
  {
    id: 'struggle',
    title: '¿Qué sentís que te cuesta más?',
    sub: 'Lo cruzamos con lo que mide la telemetría. Podés elegir más de una.',
    multi: true,
    topic: 'What the driver feels is hard (check it against the data; say so if the data disagrees)',
    placeholder: 'Por ejemplo: en las curvas rápidas no me animo a ir a fondo.',
    options: [
      { id: 'braking', label: 'Las frenadas', hint: 'Dónde frenar y cuánto.', prompt: 'Braking: where to brake and how hard.' },
      { id: 'corner', label: 'Llevar velocidad en la curva', hint: 'Me paso o llego muy lento.', prompt: 'Carrying speed through the middle of the corner.' },
      { id: 'exit', label: 'Salir bien de las curvas', hint: 'Acelerar sin perder el auto.', prompt: 'Corner exits and getting on the throttle.' },
      { id: 'car', label: 'Controlar el auto', hint: 'Se me va de cola o no dobla.', prompt: 'Controlling the car: oversteer or understeer.' },
      { id: 'repeat', label: 'Repetir lo que me sale bien', hint: 'Una vuelta buena y tres malas.', prompt: 'Repeating a good lap.' },
      { id: 'unknown', label: 'No sé, por eso estoy acá', prompt: 'They do not know yet: discover it from the data and explain it simply.' },
    ],
  },
  {
    id: 'tone',
    title: '¿Cómo querés que te hable?',
    topic: 'Personality',
    placeholder: 'Por ejemplo: como mi ingeniero de equipo, con humor y sin vueltas.',
    options: [
      { id: 'engineer', label: 'Ingeniero de pista', hint: 'Directo, frases cortas, al punto.', prompt: 'A race engineer on the radio: direct, short sentences, no filler.' },
      { id: 'teacher', label: 'Profe paciente', hint: 'Me explica el porqué de cada cosa.', prompt: 'A patient instructor: warm and calm, explaining the why behind each thing.' },
      { id: 'mate', label: 'Compañero de equipo', hint: 'Cercano, de igual a igual.', prompt: 'A teammate: friendly and informal, talking as an equal.' },
      { id: 'tough', label: 'Exigente', hint: 'Sin filtro. Si está mal, decímelo.', prompt: 'A demanding coach: blunt with high standards. Never insult, and no praise that the data has not earned.' },
    ],
  },
  {
    id: 'language',
    title: '¿En qué idioma y cómo te trato?',
    topic: 'Language',
    placeholder: 'Por ejemplo: português do Brasil.',
    options: [
      { id: 'voseo', label: 'Español, de vos', hint: '“Frená más tarde”.', prompt: 'Rioplatense Spanish with voseo ("frená", "soltá"). Motorsport terms that are normally said in English stay in English.' },
      { id: 'tu', label: 'Español, de tú', hint: '“Frena más tarde”.', prompt: 'Neutral Spanish using "tú". Motorsport terms that are normally said in English stay in English.' },
      { id: 'en', label: 'English', hint: '“Brake later”.', prompt: 'English.' },
    ],
  },
  {
    id: 'detail',
    title: '¿Cuánta técnica querés?',
    topic: 'Depth and jargon',
    placeholder: 'Por ejemplo: términos técnicos sí, pero sin tablas de números.',
    options: [
      { id: 'plain', label: 'Sin jerga', hint: 'Como se lo contarías a un amigo.', prompt: 'No jargon at all: say it in everyday words, as you would to a friend. No technical terms.' },
      { id: 'explained', label: 'Algunos términos, explicados', hint: 'Quiero ir aprendiendo.', prompt: 'A few technical terms, each one explained briefly the first time it appears.' },
      { id: 'technical', label: 'Técnico', hint: 'Hablame de trail-braking y rotación.', prompt: 'Technical vocabulary without explanations (trail-braking, rotation, weight transfer).' },
      { id: 'engineer', label: 'Todos los datos', hint: 'Números, velocidades y comparaciones.', prompt: 'Full engineering detail: give all the relevant numbers and comparisons alongside the explanation.' },
    ],
  },
  {
    id: 'places',
    title: 'Cuando te marca un punto de la pista, ¿qué te sirve más?',
    sub: 'Por ejemplo, para decirte que frenes más tarde.',
    topic: 'How to express positions and distances',
    placeholder: 'Por ejemplo: decime la marcha que tengo que traer y cuánto antes o después.',
    options: [
      {
        id: 'visual',
        label: 'Una referencia que yo elija',
        hint: 'Decime que busque algo que vea y cuánto moverme.',
        prompt: 'Ask them to pick their own visual reference where they do it today (a board, a shadow, a kerb) and say how much to move from it in car lengths. Never name a landmark yourself.',
      },
      {
        id: 'feel',
        label: 'Con sensaciones',
        hint: '“Un toque más tarde”, “soltá antes”.',
        prompt: 'Use feel and rhythm ("a touch later", "half a beat earlier", "let it roll"), with no numbers unless they add something.',
      },
      {
        id: 'lengths',
        label: 'Largos de auto y tiempo',
        hint: '“Dos autos más tarde”, “medio segundo antes”.',
        prompt: 'Use car lengths and seconds, taken from the `car_lengths` and `seconds` fields.',
      },
      { id: 'metres', label: 'Metros exactos', hint: 'Prefiero los números.', prompt: 'Exact metres and km/h are fine, always relative to the corner rather than to the start line.' },
    ],
  },
  {
    id: 'feedback',
    title: '¿Cómo preferís el feedback?',
    topic: 'How to structure the feedback',
    placeholder: 'Por ejemplo: arrancá por lo que hice mal y cerrá con un plan.',
    options: [
      { id: 'balance', label: 'Primero lo bueno, después lo que falta', prompt: 'Lead with what went well, measured from the data, and then what to improve.' },
      { id: 'direct', label: 'Directo a lo que hay que mejorar', prompt: 'Go straight to what to improve; keep what went well to one short mention.' },
      { id: 'tasks', label: 'Solo tareas para la próxima salida', prompt: 'Keep the analysis to a minimum: mostly concrete tasks for the next time out.' },
      { id: 'why', label: 'Que me explique qué pasa y por qué', prompt: 'Explain the cause and effect behind each point before saying what to do.' },
    ],
  },
  {
    id: 'amount',
    title: '¿Cuántas cosas querés trabajar por sesión?',
    topic: 'Number of corrections',
    placeholder: 'Por ejemplo: una por sector.',
    options: [
      { id: 'one', label: 'Una sola', hint: 'La más importante.', prompt: 'Exactly 1 correction, the one that matters most.' },
      { id: 'three', label: 'Tres', hint: 'Lo normal.', prompt: 'Exactly 3 corrections.' },
      { id: 'five', label: 'Hasta cinco', hint: 'Todo lo que sirva.', prompt: 'Up to 5 corrections, only those that are really worthwhile.' },
    ],
  },
  {
    id: 'practice',
    title: '¿Cómo practicás normalmente?',
    sub: 'Para que los ejercicios entren en tu tiempo.',
    topic: 'Practice routine (fit the drill to it)',
    placeholder: 'Por ejemplo: 40 minutos a la noche, tres veces por semana.',
    options: [
      { id: 'short', label: 'Salidas cortas', hint: '15 a 30 minutos.', prompt: 'Short outings of 15 to 30 minutes: the drill must fit in a few laps.' },
      { id: 'long', label: 'Tandas largas', hint: 'Una hora o más.', prompt: 'Long sessions of an hour or more: the drill can have stages.' },
      { id: 'prerace', label: 'Lo justo antes de correr', hint: 'Practico para la carrera.', prompt: 'Practice just before racing: favour safe, repeatable gains over experiments.' },
      { id: 'none', label: 'Sin rutina', hint: 'Corro cuando puedo.', prompt: 'No routine: the drill must be simple to remember and apply at any time.' },
    ],
  },
  {
    id: 'extra',
    title: '¿Algo más que tu coach tenga que saber?',
    sub: 'Lo que quieras: cómo te gusta aprender, qué no querés escuchar, tu equipo. Es opcional.',
    topic: 'Anything else the driver wants the coach to know',
    placeholder: 'Escribilo como te salga.',
    options: [],
  },
]

/** Respuesta a una pregunta: opciones elegidas y lo que escribió el piloto. */
export interface QuizAnswer {
  options: string[]
  /** Con texto, la opción "Personalizado" cuenta como elegida. */
  custom: string
}

export interface CoachStyle {
  answers: Record<string, QuizAnswer>
  /** ms epoch; 0 = todavía no lo hizo. */
  completedAt: number
  /** Eligió seguir sin el quiz: no se lo vuelve a ofrecer solo. */
  skipped: boolean
}

export function defaultCoachStyle(): CoachStyle {
  return {
    answers: Object.fromEntries(COACH_QUIZ.map((q) => [q.id, { options: [], custom: '' }])),
    completedAt: 0,
    skipped: false,
  }
}

const CUSTOM_MAX = 500

/** Las preferencias para el prompt, solo de lo que el piloto respondió. */
export function stylePrompt(style: CoachStyle | null | undefined): string {
  if (!style) return ''
  const lines: string[] = []
  for (const q of COACH_QUIZ) {
    const a = style.answers[q.id]
    if (!a) continue
    const chosen = q.options.filter((o) => a.options.includes(o.id)).map((o) => o.prompt)
    const custom = a.custom.trim().slice(0, CUSTOM_MAX)
    if (!chosen.length && !custom) continue
    const said = custom ? ` In their own words: ${JSON.stringify(custom)}` : ''
    lines.push(`- ${q.topic}: ${chosen.join(' ')}${said}`.replace(/: +In/, ': In'))
  }
  return lines.join('\n')
}

/** Lo que eligió en una pregunta, para mostrarlo en el perfil. */
export function answerLabels(q: QuizQuestion, a: QuizAnswer | undefined): string[] {
  if (!a) return []
  const labels = q.options.filter((o) => a.options.includes(o.id)).map((o) => o.label)
  const custom = a.custom.trim()
  return custom ? [...labels, custom] : labels
}

/** Abre el detalle técnico del reporte para quien pidió datos. */
export function wantsTechnical(style: CoachStyle | null | undefined): boolean {
  const o = style?.answers.detail?.options ?? []
  return o.includes('technical') || o.includes('engineer')
}
