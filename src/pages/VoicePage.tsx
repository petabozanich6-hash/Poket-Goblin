import { ArrowLeft, Settings } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'

import { useVoice, VoiceProvider } from '@/features/voice/VoiceContext'
import { VoicePanel } from '@/features/voice/VoicePanel'

import styles from './VoicePage.module.css'

async function micAlreadyAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({
      name: 'microphone' as PermissionName,
    })
    return status?.state === 'granted'
  } catch {
    return false
  }
}

function VoiceScreen() {
  const voice = useVoice()
  const [params] = useSearchParams()
  const typeFirst = params.get('type') === '1'
  const tried = useRef(false)

  // From the "Talk to Goblin" shortcut: start straight away when the
  // browser already allows the microphone; otherwise one tap does it.
  useEffect(() => {
    if (
      tried.current ||
      typeFirst ||
      params.get('listen') !== '1' ||
      !voice.supported
    )
      return
    tried.current = true
    void micAlreadyAllowed().then((ok) => {
      if (ok) voice.startListening({ auto: true })
    })
  }, [params, typeFirst, voice])

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <Link to="/den" className={styles.iconLink} aria-label="Back to Home">
          <ArrowLeft size={20} aria-hidden />
        </Link>
        <h1 className={styles.title}>Talk to {voice.profile.name}</h1>
        <Link
          to="/settings#goblin"
          className={styles.iconLink}
          aria-label="Get to know your Goblin"
        >
          <Settings size={20} aria-hidden />
        </Link>
      </header>
      <main className={styles.main} id="main">
        <VoicePanel typeFirst={typeFirst} />
      </main>
    </div>
  )
}

/** /voice: the fastest way in. No dashboard, just the microphone. */
export function VoicePage() {
  return (
    <VoiceProvider>
      <VoiceScreen />
    </VoiceProvider>
  )
}
