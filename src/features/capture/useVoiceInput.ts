import { useEffect, useRef, useState } from 'react'

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult:
    | ((event: {
        resultIndex: number
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>
      }) => void)
    | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

/**
 * Browser speech-to-text, appended to the text box. Uses the reader's own
 * language; nothing is recorded by Pocket Goblin.
 */
export function useVoiceInput(
  onText: (chunk: string) => void,
  onError: (message: string) => void,
) {
  const [listening, setListening] = useState(false)
  const [supported] = useState(() => Boolean(getSpeechRecognition()))
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => () => recognitionRef.current?.stop(), [])

  function toggle() {
    const Ctor = getSpeechRecognition()
    if (!Ctor) {
      onError(
        'Voice isn’t supported in this browser. You can still type or paste.',
      )
      return
    }
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }
    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en'
    recognition.onresult = (event) => {
      let finalChunk = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (result?.isFinal) finalChunk += result[0].transcript
      }
      if (finalChunk) onText(finalChunk)
    }
    recognition.onerror = (event) => {
      setListening(false)
      if (event.error === 'not-allowed') {
        onError(
          'Microphone permission was denied. Allow it to speak to the goblin.',
        )
      } else if (event.error !== 'aborted') {
        onError(`Voice stopped (${event.error}).`)
      }
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }

  return { listening, supported, toggle }
}
