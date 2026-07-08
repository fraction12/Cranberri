import { Mic } from 'lucide-react'

interface VoiceDictationButtonProps {
  listening: boolean
  onClick: () => void
}

export function VoiceDictationButton({ listening, onClick }: VoiceDictationButtonProps) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={[
        'rounded p-1 transition hover:bg-[var(--app-surface-2)] hover:text-[var(--app-text)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]',
        listening ? 'bg-[var(--app-danger)]/15 text-[var(--app-danger)]' : 'text-[var(--app-text-muted)]',
      ].join(' ')}
      aria-label={listening ? 'Stop voice dictation' : 'Start voice dictation'}
      title={listening ? 'Stop voice dictation' : 'Start voice dictation'}
      aria-pressed={listening}
    >
      <Mic className={listening ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
    </button>
  )
}
