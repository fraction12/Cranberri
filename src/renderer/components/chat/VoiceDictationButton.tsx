import { Mic } from 'lucide-react'
import { cn, iconButton } from '../../lib/ui'

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
      className={cn(iconButton(), listening && 'bg-app-danger/15 text-app-danger hover:text-app-danger')}
      aria-label={listening ? 'Stop voice dictation' : 'Start voice dictation'}
      title={listening ? 'Stop voice dictation' : 'Start voice dictation'}
      aria-pressed={listening}
    >
      <Mic className={listening ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
    </button>
  )
}
