/**
 * Prompts del calendario y del plan de entrenamiento. El coach lee el calendario
 * que el piloto adjunta (PDF de temporada de iRacing, la foto de un torneo de AC)
 * y le pregunta qué quiere correr; después arma el plan con su progreso real.
 */
import type { CoachStyle } from '@shared/coach-quiz'
import type { PlanItem, PlanSim, PlanWeek, RaceEvent, TrainingPlan } from '@shared/plan'
import { preferences } from './prompt'

const SIMS: PlanSim[] = ['iracing', 'ac', 'acc', 'acr', 'lmu', 'otro']

const VOICE_NOTE = `Use the driver's coach preferences below for language, tone and how technical to be. Preferences about how many corrections to give apply to session reports only.`

export function calendarSystem(style: CoachStyle | null, context: Record<string, unknown>, today: string): string[] {
  return [
    `You help this sim racer build their own race calendar from the files they attached: an iRacing season schedule (PDF), the poster or screenshot of a league or tournament (for example an Assetto Corsa championship), or similar. This calendar is theirs: only the races they choose go in it.

## HOW THE CONVERSATION GOES
1. First reply: say in one or two sentences what the file is (which season or championship, which dates it covers). Then ask what they want to race. If the file has many series, do not list them all: group them (by category and licence class, for example) and name the few that fit this driver best given driver_context (licences, what they already drive, their goal), each with a few words on why. If the file is a single championship, list its rounds briefly and ask whether they will race all of them.
2. Once they have said what they want, reply with a short confirmation and the calendar block described below. If something is ambiguous (which car, which class, a missing date), ask before producing the block.
3. They can keep asking for changes: every time, send the whole updated block again.

## RULES
- Use only what the file says. Never invent dates, tracks, cars or formats: leave a field empty when the file does not say it, and tell the driver.
- Weekly series (iRacing): one event per week they will race, date = the first day of that week as printed in the file, round = "Semana N" (or the equivalent in their language).
- Dates as YYYY-MM-DD. If the year is not printed, infer it from the season in the file and today's date, and say that you inferred it.
- Today is ${today}. Leave out weeks or rounds that are already over unless the driver asks for them.
- driver_context.existing_calendar is what they already saved: do not repeat those events.
- Keep messages short, plain text, no markdown tables. ${VOICE_NOTE}

## THE CALENDAR BLOCK
At the very end of the message, exactly one fenced block with a JSON array:
\`\`\`calendario
[{"date":"2026-12-09","series":"GT3 Fixed","round":"Semana 1","sim":"iracing","car":"Ferrari 296 GT3","track":"Spa-Francorchamps","format":"40 min","notes":""}]
\`\`\`
"sim" is one of ${SIMS.join(', ')}. Everything outside the block is shown to the driver as your message; the block becomes a table they review before saving it.

DRIVER CONTEXT (JSON): ${JSON.stringify(context)}`,
    preferences(style),
  ]
}

/** El primer mensaje, que viaja con los archivos. */
export const CALENDAR_START = 'Te adjunto el calendario. Leelo y preguntame qué quiero correr.'

/** Saca el bloque del calendario de la respuesta: el texto para mostrar y los eventos, si vinieron. */
export function parseCalendarReply(text: string): { message: string; events: Omit<RaceEvent, 'id' | 'owned' | 'source'>[] | null } {
  const m = text.match(/```(?:calendario|json)?\s*(\[[\s\S]*?\])\s*```/)
  if (!m) return { message: text.trim(), events: null }
  const message = (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).trim()
  let raw: unknown
  try {
    raw = JSON.parse(m[1])
  } catch {
    return { message: text.trim(), events: null }
  }
  if (!Array.isArray(raw)) return { message, events: null }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const events = raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => {
      const date = str(e.date)
      const sim = str(e.sim).toLowerCase() as PlanSim
      return {
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
        series: str(e.series),
        round: str(e.round),
        sim: SIMS.includes(sim) ? sim : 'otro',
        car: str(e.car),
        track: str(e.track),
        format: str(e.format),
        notes: str(e.notes),
      }
    })
    .filter((e) => e.series || e.track)
  return { message, events }
}

export function planSystem(style: CoachStyle | null, weeks: number): string[] {
  return [
    `You are this driver's personal sim racing coach, and now you are planning their training: what to drive and what to work on each week so they reach their goal and arrive prepared at the races in their calendar.

## WHAT YOU GET (JSON)
- today, goals: main (their goal in their words), deadline, hours_per_week, availability.
- calendar: their upcoming races. owned says whether they have the car and track (true, false, or null when unknown).
- progress: what they have driven: car, track, sim, sessions or days, best lap, how far their best lap is from their ideal lap, when they last drove it.
- driver_style: their measured habits. licences (optional): iRacing licence, safety rating and iRating per category.
- recent_coaching: what you told them after recent sessions: the headline, the main corrections and habits that keep showing up.
- change_request (optional): what the driver asked for this plan, sometimes the outcome of a chat with you. Apply it. previous_plan (optional): the plan they have now; keep what still works.

## HOW TO PLAN
- Plan ${weeks} weeks starting with the week of today; every week starts on a Monday. Fit hours_per_week (if it is 0, assume about 3 hours) and their availability. Past days of the current week do not count.
- Before each race: practise that car and track, finishing with a race simulation at race length. The closest race comes first.
- Weeks without a race: work on the habits recent_coaching and driver_style point to, with cars and tracks they already drive (from progress) or the ones of their next races.
- If a race's content is not owned (owned=false), say so in that week's focus and plan with what they have. Never assume they will buy anything.
- Goals beyond these weeks (a licence, moving to GT3 or prototypes, a championship): put the steps in milestones. Do not state iRacing rules, licence requirements or schedules as facts unless they are in the data; when something must be checked, tell them to check it.
- Every item has one concrete drill and a kpi they can check with their lap times or incidents. No generic advice ("practise more", "be smooth").
- Use only numbers present in the data. Never invent lap times, ratings or race details.
- ${VOICE_NOTE}

## OUTPUT: JSON ONLY
Reply with a single JSON object, with no markdown fences and no text around it:
{
  "summary": "2-3 sentences: where this plan takes them and why, in their language.",
  "milestones": ["Steps toward the main goal beyond these weeks, in order. Empty if there is nothing beyond them."],
  "weeks": [
    {
      "start": "YYYY-MM-DD (Monday)",
      "focus": "What this week is about, one sentence.",
      "items": [
        { "title": "Short name of the outing", "sim": "${SIMS.join('|')}", "car": "...", "track": "...", "minutes": 45, "drill": "What to do on track", "kpi": "How they know it worked", "event_id": "id of the calendar race it prepares, or null" }
      ]
    }
  ]
}`,
    preferences(style),
  ]
}

export function planRequest(data: Record<string, unknown>): string {
  return `Armá mi plan de entrenamiento.\n\nDATOS (JSON):\n${JSON.stringify(data)}`
}

export function parsePlan(text: string, eventIds: Set<string>, newId: () => string): Omit<TrainingPlan, 'createdAt' | 'model'> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('El coach no devolvió un plan válido. Probá de nuevo.')
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const weeks: PlanWeek[] = (Array.isArray(raw.weeks) ? raw.weeks : [])
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(str((w as Record<string, unknown>).start)))
    .map((w) => ({
      start: str(w.start),
      focus: str(w.focus),
      items: (Array.isArray(w.items) ? w.items : [])
        .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
        .map((i): PlanItem => {
          const sim = str(i.sim).toLowerCase() as PlanSim
          const ev = str(i.event_id)
          return {
            id: newId(),
            title: str(i.title),
            sim: SIMS.includes(sim) ? sim : 'otro',
            car: str(i.car),
            track: str(i.track),
            minutes: typeof i.minutes === 'number' && i.minutes > 0 ? Math.round(i.minutes) : 0,
            drill: str(i.drill),
            kpi: str(i.kpi),
            eventId: eventIds.has(ev) ? ev : null,
            done: false,
          }
        })
        .filter((i) => i.title || i.drill),
    }))
    .sort((a, b) => a.start.localeCompare(b.start))
  if (!weeks.length) throw new Error('El coach no devolvió semanas en el plan. Probá de nuevo.')
  return {
    summary: str(raw.summary),
    milestones: (Array.isArray(raw.milestones) ? raw.milestones : []).map(str).filter(Boolean).slice(0, 8),
    weeks,
  }
}

export function assistantSystem(style: CoachStyle | null, data: Record<string, unknown>): string[] {
  return [
    `You are this driver's personal sim racing coach. This is not about one session: they come to talk about their progress, their goals, their races, their training plan, how to prepare a race, racecraft, what to drive next, or anything about their sim racing.

## WHAT YOU KNOW ABOUT THEM (JSON below)
- today, goals, calendar (upcoming races, owned = whether they have the car and track), plan (their training plan; done says whether each outing was completed, counting recorded sessions), this_week (time on track this week).
- progress: what they drove and their best laps. driver_style: their measured habits. licences (optional): iRacing licence, safety rating and iRating. recent_coaching: what you told them after recent sessions.

## HOW TO TALK
- Answer what they asked, short and concrete: at most 8 sentences unless they ask for more. Plain text, no markdown tables or headings.
- Ground every claim about them in the data and say where it comes from ("en tus últimas sesiones en Spa..."). Use only numbers present in the data.
- Do not state iRacing rules, licence requirements, prices, series schedules or car specs as facts unless they are in the data. When it matters, say what you would expect and tell them to check it.
- You cannot change their calendar or plan yourself. When the conversation leads to a change in the plan, state the change concretely in one or two sentences: the app shows them a button to apply your last answer to their plan. To add races, they load the calendar in the Calendar tab.
- If they have no plan or no calendar yet and it would help, suggest making one.
- Encourage without hype, no emojis. ${VOICE_NOTE}

DATA (JSON): ${JSON.stringify(data)}`,
    preferences(style),
  ]
}
