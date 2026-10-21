/** Setup del auto tal como lo guardó iRacing en el .ibt (valores reales, sin inventar nada). */
import type { SetupGroup } from '@shared/analysis'
import { Card, Label } from '../components/ui'

export function SetupView({ setup }: { setup: SetupGroup[] | null }) {
  if (!setup)
    return (
      <Card className="max-w-[720px]">
        <Label>Setup</Label>
        <p className="text-plata mt-3 leading-relaxed">
          Esta sesión no trae el setup del auto. iRacing lo guarda en el <span className="data">.ibt</span>; Assetto Corsa no lo expone a otras
          aplicaciones.
        </p>
      </Card>
    )
  return (
    <div className="flex flex-col gap-5">
      {setup.map((g) => (
        <section key={g.name}>
          <h2 className="text-[16px] font-bold mb-3">{g.name}</h2>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {g.parts.map((p) => (
              <article key={p.name} className="bg-carbono-2 border border-grafito rounded-card px-4 py-3.5">
                <Label>{p.name}</Label>
                <dl className="mt-2.5">
                  {p.values.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 py-1.5 border-t border-grafito first:border-0 text-[13px]">
                      <dt className="text-plata min-w-0">{k}</dt>
                      <dd className="data text-blanco text-right shrink-0 max-w-[55%] break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
