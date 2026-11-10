/**
 * Si una pantalla falla al dibujarse, muestra el error en su lugar en vez de
 * dejar toda la ventana en blanco. El texto se puede copiar para reportarlo.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button, Card, Label } from './ui'

interface State {
  error: Error | null
  stack: string
}

export class ErrorBoundary extends Component<{ children: ReactNode; where: string }, State> {
  state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.where}]`, error, info.componentStack)
    this.setState({ stack: (info.componentStack ?? '').trim().split('\n').slice(0, 6).join('\n') })
  }

  render(): ReactNode {
    const { error, stack } = this.state
    if (!error) return this.props.children
    const text = `${this.props.where} · v${window.ftn.version}\n${error.name}: ${error.message}\n${(error.stack ?? '').split('\n').slice(1, 6).join('\n')}\n${stack}`
    return (
      <Card className="border-alerta flex flex-col gap-3">
        <Label icon={TriangleAlert} color="var(--ftn-alerta)">
          Esta pantalla falló
        </Label>
        <p className="text-plata">El resto de la app sigue andando. Copiá este texto y pasáselo a quien te dé soporte:</p>
        <pre className="data text-[12px] text-niebla bg-carbono rounded-control p-3 whitespace-pre-wrap select-text max-h-[300px] overflow-auto">{text}</pre>
        <div className="flex gap-3">
          <Button onClick={() => void navigator.clipboard.writeText(text)}>Copiar el error</Button>
          <Button variant="ghost" onClick={() => this.setState({ error: null, stack: '' })}>
            Reintentar
          </Button>
        </div>
      </Card>
    )
  }
}
