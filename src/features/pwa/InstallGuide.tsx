import { useState, useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/Button'
import {
  canOfferInstallPrompt,
  detectPlatform,
  getPwaState,
  promptInstall,
  subscribePwa,
} from '@/lib/pwa'

import styles from '@/pages/Page.module.css'

/**
 * How to put Pocket Goblin on the home screen, for the browser in hand.
 * The install button only appears when the browser has actually offered
 * an install; "installed" is only said when the browser confirms it.
 */
export function InstallGuide() {
  const pwa = useSyncExternalStore(subscribePwa, getPwaState)
  const [platform] = useState(() => detectPlatform())
  const [outcome, setOutcome] = useState<string | null>(null)

  if (pwa.standalone) {
    return (
      <>
        <p className={styles.sub}>
          You’re using the installed app. To jump straight to the microphone,
          long-press the Pocket Goblin icon and choose{' '}
          <strong>Talk to Goblin</strong> (Android and desktop Chrome/Edge).
          iPhone and iPad don’t offer app shortcuts — tap the microphone button
          instead.
        </p>
      </>
    )
  }

  return (
    <>
      {pwa.justInstalled ? (
        <p className={styles.sub} role="status">
          Installed. Look for Pocket Goblin on your home screen or in your apps.
        </p>
      ) : null}
      {canOfferInstallPrompt(platform, pwa.canPrompt) ? (
        <Button
          onClick={() =>
            void promptInstall().then((result) =>
              setOutcome(
                result === 'dismissed'
                  ? 'No problem — you can install later.'
                  : null,
              ),
            )
          }
        >
          Install Pocket Goblin
        </Button>
      ) : null}
      {outcome ? <p className={styles.sub}>{outcome}</p> : null}
      {platform === 'ios-safari' ? (
        <ol className={styles.sub}>
          <li>
            Tap the <strong>Share</strong> button (the square with an arrow).
          </li>
          <li>
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </li>
          <li>
            Tap <strong>Add</strong>.
          </li>
          <li>
            For a separate “talk” icon, open{' '}
            <strong>pocketgoblin.org/voice</strong> in Safari first, then add it
            the same way. (Depending on your iOS version it may open the main
            app instead — the microphone button is always one tap away.)
          </li>
        </ol>
      ) : platform === 'ios-other' ? (
        <p className={styles.sub}>
          On iPhone and iPad, open this page in <strong>Safari</strong> and use
          Share → Add to Home Screen. Newer iOS versions also offer it from
          Share in other browsers.
        </p>
      ) : platform === 'samsung' ? (
        <>
          <p className={styles.sub}>
            Samsung Internet can trigger Google Play Protect warnings during
            web app installation.
          </p>
          <p className={styles.sub}>
            Open pocketgoblin.org in Google Chrome, then choose Install app
            from Chrome’s menu.
          </p>
          <p className={styles.sub}>
            If Play Protect shows a warning, cancel the installation. Pocket
            Goblin still works in your browser. Never disable Play Protect.
          </p>
        </>
      ) : platform === 'firefox' ? (
        <p className={styles.sub}>
          Firefox on Android: menu → <strong>Install</strong> (or Add to Home
          screen). Desktop Firefox doesn’t install web apps — Chrome, Edge or
          Safari can.
        </p>
      ) : platform === 'desktop-safari' ? (
        <p className={styles.sub}>
          In Safari on a Mac (Sonoma or later), choose{' '}
          <strong>File → Add to Dock</strong>.
        </p>
      ) : !pwa.canPrompt ? (
        <p className={styles.sub}>
          Use your browser menu and choose <strong>Install app</strong> or{' '}
          <strong>Add to Home screen</strong>. If you don’t see it, it may
          already be installed, or this browser doesn’t support installing web
          apps.
        </p>
      ) : null}
      <p className={styles.sub}>
        Installation is optional — Pocket Goblin works in your browser too.
        On supported devices, long-press the installed icon for a{' '}
        <strong>Talk to Goblin</strong> shortcut.
      </p>
    </>
  )
}
