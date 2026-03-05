import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary] Uncaught error:', error, info)
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center">
          <h1 className="text-2xl font-bold text-red-600">Si è verificato un errore</h1>
          <p className="text-gray-600 max-w-md">
            Qualcosa è andato storto. Ricarica la pagina o contatta il supporto.
          </p>
          {import.meta.env.DEV && this.state.error && (
            <pre className="text-left text-sm bg-gray-100 p-4 rounded overflow-auto max-w-2xl w-full">
              {this.state.error.toString()}
            </pre>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Riprova
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
