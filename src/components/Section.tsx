import type { ReactNode } from 'react'

/**
 * Collapsible disclosure card.
 *
 * The workout home screen had eleven controls stacked vertically, all styled
 * as equal-weight buttons, so nothing read as the primary action. Secondary
 * content now lives behind these — one open at a time — leaving a single
 * dominant "start today's session" card above them.
 */
export function Section({
  title, sub, open, onToggle, children,
}: {
  title: string
  sub?: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--separator)',
      borderRadius: 18, overflow: 'hidden', marginTop: 10,
    }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '14px 16px', display: 'flex', alignItems: 'flex-start',
          justifyContent: 'space-between', gap: 12, textAlign: 'left', color: 'inherit',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--label)', lineHeight: 1.2 }}>{title}</div>
          {sub && (
            <div style={{
              fontSize: 14, color: 'var(--label2)', marginTop: 3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{sub}</div>
          )}
        </div>
        <span style={{ color: 'var(--label3)', fontSize: 15, flexShrink: 0, lineHeight: 1.4 }}>
          {open ? '\u25b4' : '\u25be'}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ height: 1, background: 'var(--separator)', marginBottom: 14 }} />
          {children}
        </div>
      )}
    </div>
  )
}

/** A single tappable row inside a Section. */
export function SectionRow({
  name, sub, onClick,
}: {
  name: string
  sub?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', height: 64, background: 'var(--bg)',
        border: '1px solid var(--separator)', borderRadius: 16, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '0 14px', textAlign: 'left', color: 'inherit',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--label)' }}>{name}</div>
        {sub && <div style={{ fontSize: 13, color: 'var(--label3)', marginTop: 2 }}>{sub}</div>}
      </div>
      <span style={{ color: 'var(--label3)', fontSize: 15, flexShrink: 0 }}>{'\u203a'}</span>
    </button>
  )
}
