import { describe, expect, it } from 'vitest'
import {
  appendDictationTranscript,
  speechRecognitionConstructor,
  transcriptFromSpeechRecognitionEvent,
  voiceDictationErrorMessage,
  type SpeechRecognitionConstructorLike,
  type SpeechRecognitionEventLike,
} from './voice-dictation'

describe('voice dictation helpers', () => {
  it('detects standard and chromium-prefixed speech recognition constructors', () => {
    const StandardRecognition = class {} as SpeechRecognitionConstructorLike
    const PrefixedRecognition = class {} as SpeechRecognitionConstructorLike

    expect(speechRecognitionConstructor({ SpeechRecognition: StandardRecognition })).toBe(StandardRecognition)
    expect(speechRecognitionConstructor({ webkitSpeechRecognition: PrefixedRecognition })).toBe(PrefixedRecognition)
    expect(speechRecognitionConstructor({})).toBeNull()
  })

  it('appends normalized transcript text without damaging existing punctuation', () => {
    expect(appendDictationTranscript('', '  hello   world  ')).toBe('hello world')
    expect(appendDictationTranscript('Inspect this', 'file please')).toBe('Inspect this file please')
    expect(appendDictationTranscript('Inspect this ', 'file please')).toBe('Inspect this file please')
    expect(appendDictationTranscript('Looks good', '. ship it')).toBe('Looks good. ship it')
    expect(appendDictationTranscript('Keep this', '   ')).toBe('Keep this')
  })

  it('extracts final transcripts from speech recognition results', () => {
    const event: SpeechRecognitionEventLike = {
      resultIndex: 1,
      results: {
        length: 4,
        0: { length: 1, isFinal: true, 0: { transcript: 'ignored' } },
        1: { length: 1, isFinal: true, 0: { transcript: 'open the browser' } },
        2: { length: 1, isFinal: false, 0: { transcript: 'still changing' } },
        3: { length: 1, isFinal: true, 0: { transcript: 'then capture context' } },
      },
    }

    expect(transcriptFromSpeechRecognitionEvent(event)).toBe('open the browser then capture context')
  })

  it('returns useful voice dictation error messages', () => {
    expect(voiceDictationErrorMessage({ error: 'not-allowed' })).toBe('Microphone permission was denied.')
    expect(voiceDictationErrorMessage({ error: 'no-speech' })).toBe('No speech was detected.')
    expect(voiceDictationErrorMessage({ error: 'network' })).toBe('Voice dictation failed: network')
    expect(voiceDictationErrorMessage({ message: 'Custom error' })).toBe('Custom error')
  })
})
