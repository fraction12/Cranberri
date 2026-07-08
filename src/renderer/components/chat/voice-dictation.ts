export interface SpeechRecognitionAlternativeLike {
  transcript?: string
}

export interface SpeechRecognitionResultLike {
  length: number
  isFinal?: boolean
  [index: number]: SpeechRecognitionAlternativeLike | undefined
}

export interface SpeechRecognitionResultListLike {
  length: number
  [index: number]: SpeechRecognitionResultLike | undefined
}

export interface SpeechRecognitionEventLike {
  resultIndex?: number
  results: SpeechRecognitionResultListLike
}

export interface SpeechRecognitionErrorEventLike {
  error?: string
  message?: string
}

export interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort?: () => void
}

export type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike

export interface SpeechRecognitionWindowLike {
  SpeechRecognition?: SpeechRecognitionConstructorLike
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike
}

export function speechRecognitionConstructor(win: object): SpeechRecognitionConstructorLike | null {
  const speechWindow = win as SpeechRecognitionWindowLike
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

export function appendDictationTranscript(current: string, transcript: string): string {
  const normalized = transcript.trim().replace(/\s+/g, ' ')
  if (!normalized) return current
  if (!current.trim()) return normalized
  if (/\s$/.test(current) || /^[,.;:!?]/.test(normalized)) return `${current}${normalized}`
  return `${current} ${normalized}`
}

export function transcriptFromSpeechRecognitionEvent(event: SpeechRecognitionEventLike): string {
  const parts: string[] = []
  const startIndex = Math.max(0, event.resultIndex ?? 0)

  for (let index = startIndex; index < event.results.length; index += 1) {
    const result = event.results[index]
    if (!result || result.isFinal === false) continue
    const transcript = result[0]?.transcript?.trim()
    if (transcript) parts.push(transcript)
  }

  return parts.join(' ')
}

export function voiceDictationErrorMessage(event: SpeechRecognitionErrorEventLike): string {
  if (event.message?.trim()) return event.message.trim()
  if (event.error === 'not-allowed' || event.error === 'service-not-allowed') return 'Microphone permission was denied.'
  if (event.error === 'no-speech') return 'No speech was detected.'
  if (event.error?.trim()) return `Voice dictation failed: ${event.error}`
  return 'Voice dictation failed.'
}
