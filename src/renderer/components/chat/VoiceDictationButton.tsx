import { Mic } from 'lucide-react'
import { cn } from '../../lib/ui'
import { IconButton } from '../ui/IconButton'

interface VoiceDictationButtonProps {
  listening: boolean
  onClick: () => void
}

export function VoiceDictationButton({ listening, onClick }: VoiceDictationButtonProps) {
  return (
    <IconButton
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(listening && 'bg-app-danger/15 text-app-danger hover:text-app-danger')}
      label={listening ? 'Stop voice dictation' : 'Start voice dictation'}
      aria-pressed={listening}
    >
      <Mic className={listening ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
    </IconButton>
  )
}
