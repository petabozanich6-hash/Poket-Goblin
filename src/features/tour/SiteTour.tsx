import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'

import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/useAuth'
import { api } from '@/lib/api'

import styles from './SiteTour.module.css'

type Stage = 'welcome' | 'tour' | 'finished' | null
type Spotlight = { left: number; top: number; width: number; height: number }

const steps = [
  {
    path: '/den',
    selector: '[data-tour="den"]',
    title: 'The Den',
    copy: 'Your headquarters. See what needs attention today, without opening twelve different tabs in your brain.',
  },
  {
    path: '/den',
    selector: '[data-tour="capture"]',
    title: 'Quick Capture',
    copy: 'A thought escaping? Tell me before it runs away. Type or speak, and I’ll help you turn it into something useful.',
  },
  {
    path: '/life/tasks',
    selector: '#main h1',
    title: 'Tasks & planning',
    copy: 'Tasks, your calendar and a plan for today live in My Life. Start small; you do not have to organise your entire universe.',
  },
  {
    path: '/life/documents',
    selector: '#main h1',
    title: 'Documents',
    copy: 'Feed me a bill, letter or form. I can help pull out what matters, and you choose whether the original should be kept.',
  },
  {
    path: '/tell',
    selector: '#main h1',
    title: 'Tell the Goblin',
    copy: 'Ask questions, empty your head, or tell me you’re overwhelmed. Suggestions that need your OK wait here for review.',
  },
  {
    path: '/life/search',
    selector: '#main h1',
    title: 'Find your stuff',
    copy: 'Forgot where you put something? Search tasks, notes, events and documents without remembering which shelf it belongs on.',
  },
  {
    path: '/settings',
    selector: '#main h1',
    title: 'Settings & your plan',
    copy: 'Make the Goblin work your way, manage your plan and come back to replay this tour whenever you fancy.',
  },
] as const

/** An account-level onboarding flag: local storage cannot reliably follow people between devices. */
export function SiteTour() {
  const { user, settings, access } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const offeredTo = useRef<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Stage>(null)
  const [step, setStep] = useState(0)
  const [spotlight, setSpotlight] = useState<Spotlight | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !settings) return
    // This link is deliberately replayable even once the account has seen the tour.
    if (
      location.pathname === '/den' &&
      new URLSearchParams(location.search).get('tour') === '1'
    ) {
      offeredTo.current = user.id
      setError(null)
      setStep(0)
      setStage('tour')
      navigate('/den', { replace: true })
      return
    }
    if (
      location.pathname === '/den' &&
      !settings.tourSeen &&
      offeredTo.current !== user.id
    ) {
      offeredTo.current = user.id
      setStage('welcome')
    }
  }, [user, settings, location.pathname, location.search, navigate])

  useEffect(() => {
    if (stage !== 'tour') return
    const wanted = steps[step]?.path
    if (wanted && wanted !== location.pathname)
      navigate(wanted, { replace: true })
  }, [stage, step, location.pathname, navigate])

  useEffect(() => {
    if (!stage) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [stage])

  useEffect(() => {
    if (!stage) return
    const timeout = window.setTimeout(() => dialogRef.current?.focus(), 80)
    return () => window.clearTimeout(timeout)
  }, [stage, step, location.pathname])

  useEffect(() => {
    if (stage !== 'tour') return
    const current = steps[step]
    if (!current || location.pathname !== current.path) return

    const measure = () => {
      const target = document.querySelector<HTMLElement>(current.selector)
      if (!target) {
        setSpotlight(null)
        return
      }
      const rect = target.getBoundingClientRect()
      setSpotlight({
        left: Math.max(8, rect.left - 8),
        top: Math.max(8, rect.top - 8),
        width: Math.min(window.innerWidth - 16, rect.width + 16),
        height: Math.min(window.innerHeight - 16, rect.height + 16),
      })
    }
    const prepare = window.setTimeout(() => {
      document.querySelector<HTMLElement>(current.selector)?.scrollIntoView({
        behavior: 'auto',
        block: 'center',
      })
      measure()
    }, 60)
    const remeasure = window.setTimeout(measure, 240)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearTimeout(prepare)
      window.clearTimeout(remeasure)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [stage, step, location.pathname])

  async function closeTour(destination: '/den' | '/tell') {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      // An already-seen tour can replay without writing the flag again.
      if (!settings?.tourSeen) {
        await api.patch('/me/tour', { seen: true })
        await queryClient.invalidateQueries({ queryKey: ['me'] })
      }
      setStage(null)
      setStep(0)
      setSpotlight(null)
      navigate(destination, { replace: true })
    } catch {
      setError('Could not save your tour choice. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function handleDialogKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !saving) {
      event.preventDefault()
      void closeTour('/den')
    }
    if (event.key !== 'Tab') return
    const controls = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href]',
      ) ?? [],
    )
    if (!controls.length) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  if (!stage) return null

  const current = steps[step]!
  const smallScreen = window.innerWidth < 600
  const panelStyle: CSSProperties | undefined =
    stage === 'tour' && spotlight
      ? {
          left: smallScreen
            ? 12
            : Math.max(12, Math.min(spotlight.left, window.innerWidth - 386)),
          top:
            spotlight.top + spotlight.height + 300 < window.innerHeight
              ? spotlight.top + spotlight.height + 16
              : spotlight.top > 320
                ? spotlight.top - 300
                : Math.max(12, window.innerHeight - 315),
          transform: 'none',
        }
      : undefined

  return (
    <div className={styles.layer}>
      <div className={styles.blocker} aria-hidden="true" />
      {stage === 'tour' && spotlight ? (
        <div
          className={styles.spotlight}
          aria-hidden="true"
          style={{
            left: spotlight.left,
            top: spotlight.top,
            width: spotlight.width,
            height: spotlight.height,
          }}
        />
      ) : (
        <div className={styles.veil} aria-hidden="true" />
      )}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-tour-title"
        aria-describedby="site-tour-description"
        tabIndex={-1}
        onKeyDown={handleDialogKeys}
        className={styles.panel}
        style={panelStyle}
      >
        {stage === 'welcome' ? (
          <>
            <p className={styles.eyebrow}>👹 OI! NEW HUMAN!</p>
            <h2 id="site-tour-title">Welcome to the Den</h2>
            <p id="site-tour-description">
              I’m your Pocket Goblin. Before you throw your entire life at me,
              fancy a quick look around the workshop? Seven tiny stops. No
              homework.
            </p>
            <div className={styles.actions}>
              <Button
                onClick={() => {
                  setError(null)
                  setStage('tour')
                  setStep(0)
                }}
              >
                Show me around
              </Button>
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => void closeTour('/den')}
              >
                I’ll figure it out
              </Button>
            </div>
          </>
        ) : stage === 'finished' ? (
          <>
            <p className={styles.eyebrow}>👹 TOUR COMPLETE</p>
            <h2 id="site-tour-title">The workshop is yours!</h2>
            <p id="site-tour-description">
              Now go make some manageable mischief. You can take this tour again
              from Settings whenever you want.
            </p>
            <div className={styles.actions}>
              <Button disabled={saving} onClick={() => void closeTour('/tell')}>
                Capture my first thought
              </Button>
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => void closeTour('/den')}
              >
                Explore my Den
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.eyebrow}>
              👹 GRAND TOUR · {step + 1} OF {steps.length}
            </p>
            <h2 id="site-tour-title">{current.title}</h2>
            <p id="site-tour-description">{current.copy}</p>
            {step === 3 && access?.plan === 'free' ? (
              <p className={styles.note}>
                Some document tools have Free plan limits; Premium features are
                labelled in the app.
              </p>
            ) : null}
            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={step === 0 || saving}
                onClick={() => setStep((i) => i - 1)}
              >
                Back
              </Button>
              <Button
                disabled={saving}
                onClick={() => {
                  if (step === steps.length - 1) {
                    setStage('finished')
                    setSpotlight(null)
                  } else {
                    setSpotlight(null)
                    setStep((i) => i + 1)
                  }
                }}
              >
                {step === steps.length - 1 ? 'Finish tour' : 'Next'}
              </Button>
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => void closeTour('/den')}
              >
                Skip tour
              </Button>
            </div>
          </>
        )}
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
