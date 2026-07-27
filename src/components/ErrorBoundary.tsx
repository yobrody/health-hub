import { Component, type ErrorInfo, type ReactNode } from 'react'

// Without this, ANY render error anywhere unmounts React and leaves a white
// screen - indistinguishable from a backend outage. With 17 pages behind one
// root, a single undefined access in one card killed the whole app.
//
// The crash is persisted to localStorage so it survives the reload and can
// actually be read afterwards, instead of vanishing with the console.

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      localStorage.setItem('last_crash', JSON.stringify({
        message: error.message,
        stack: error.stack?.slice(0, 2000),
        component: info.componentStack?.slice(0, 2000),
        at: new Date().toISOString(),
      }))
    } catch { /* quota - best effort */ }
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const detail = error.message || String(error)
    return (
      <div style={{
        minHeight: '100dvh', background: 'var(--c-bg, #09090B)', color: 'var(--c-label, #FAFAFA)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{
          background: 'var(--c-card, #18181B)', border: '1px solid var(--c-border, #27272A)',
          borderRadius: 18, padding: 24, maxWidth: 420, width: '100%',
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Something broke on this screen</div>
          <div style={{ fontSize: 14, color: 'var(--c-label-dim, #A1A1AA)', lineHeight: 1.5, marginBottom: 16 }}>
            Your logged data is safe - nothing was lost. Reloading usually clears it.
          </div>
          <pre style={{
            background: 'var(--c-bg, #09090B)', border: '1px solid var(--c-border, #27272A)',
            borderRadius: 10, padding: 12, fontSize: 11, color: 'var(--c-label-faint, #52525B)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 140, overflow: 'auto', margin: 0,
          }}>{detail}</pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                flex: 1, background: 'var(--c-accent, #3B82F6)', color: '#fff', border: 'none',
                borderRadius: 12, padding: '13px 0', fontSize: 15, fontWeight: 700, cursor: 'pointer',
              }}
            >Reload</button>
            <button
              onClick={() => { void navigator.clipboard?.writeText(localStorage.getItem('last_crash') ?? detail) }}
              style={{
                background: 'none', color: 'var(--c-label-dim, #A1A1AA)',
                border: '1px solid var(--c-border, #27272A)', borderRadius: 12,
                padding: '13px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >Copy</button>
          </div>
        </div>
      </div>
    )
  }
}