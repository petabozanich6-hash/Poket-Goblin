import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'

import type {
  CapacityMode,
  GoblinFrequency,
  NudgeFrequency,
  PlanningApproach,
  ThemePreference,
} from '@shared/types'
import { CAPACITY_HINTS, CAPACITY_LABELS } from '@shared/types'

import { Link } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import {
  ChangePassword,
  EmailStatus,
  YourData,
} from '@/features/account/AccountControls'
import { useAuth } from '@/features/auth/useAuth'
import { fetchAchievements } from '@/features/magical/magicalApi'
import { InstallGuide } from '@/features/pwa/InstallGuide'
import { GoblinSettings } from '@/features/voice/GoblinSettings'
import { applyTheme } from '@/lib/theme'

import styles from './Page.module.css'

export function SettingsPage() {
  const { user, access, account, settings, saveSettings } = useAuth()
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const achievements = useQuery({
    queryKey: ['achievements'],
    queryFn: fetchAchievements,
  })
  const location = useLocation()
  useEffect(() => {
    if (location.hash === '#goblin' && settings)
      document.getElementById('goblin')?.scrollIntoView({ block: 'start' })
  }, [location.hash, settings])

  if (!settings) {
    return (
      <div className={styles.page}>
        <p>Loading preferences…</p>
      </div>
    )
  }

  async function patch(partial: Parameters<typeof saveSettings>[0]) {
    setSaving(true)
    setMessage(null)
    try {
      if (partial.theme) applyTheme(partial.theme)
      if (partial.reducedMotion !== undefined) {
        document.documentElement.dataset.reducedMotion = partial.reducedMotion
          ? 'true'
          : 'false'
      }
      await saveSettings(partial)
      setMessage('Saved.')
    } catch {
      setMessage('Could not save — try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Settings</h1>
          <p className={styles.sub}>
            Sensible defaults. Change only what helps — nothing mandatory.
          </p>
        </div>
      </header>

      <Card>
        <h2>First time here? Or need a refresher?</h2>
        <p className={styles.sub}>Let the Goblin show you around the workshop. Seven quick stops, and you can skip whenever you like.</p>
        <Link to="/den?tour=1">👹 Take the Grand Tour</Link>
      </Card>

      <Card>
        <h2>Account</h2>
        <p className={styles.sub}>
          Plan: <strong>{access?.planLabel ?? 'Free'}</strong>
          {access?.plan === 'owner_premium'
            ? ' — every Premium feature, permanently.'
            : null}{' '}
          <Link to="/settings/plan">
            {access?.plan === 'free' ? 'See plans' : 'Plan and billing'}
          </Link>
        </p>
        <p className={styles.sub}>
          Account ID: <code>{user?.id}</code>{' '}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!user) return
              void navigator.clipboard
                ?.writeText(user.id)
                .then(() => setCopied(true))
                .catch(() => undefined)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </p>
        <p className={styles.sub}>
          Support may ask for this ID. It is not a password and gives no access
          on its own.
        </p>
        <p className={styles.sub}>{user?.email}</p>
        <EmailStatus
          verified={Boolean(account?.emailVerified)}
          configured={Boolean(account?.emailConfigured)}
        />
        <ChangePassword />
      </Card>

      <Card>
        <h2>Your data</h2>
        <YourData isOwner={Boolean(access?.isOwner)} />
        <p className={styles.sub}>
          How your data is used: <Link to="/privacy">Privacy</Link> ·{' '}
          <Link to="/terms">Terms</Link>
        </p>
      </Card>

      <section id="goblin" aria-labelledby="goblin-heading">
        <Card>
          <h2 id="goblin-heading">Get to Know Your Goblin</h2>
          <GoblinSettings />
        </Card>
      </section>

      <Card>
        <h2>Put Pocket Goblin on your home screen</h2>
        <InstallGuide />
      </Card>

      <Card>
        <h2>How the Goblin helps</h2>
        <label className={styles.checkField}>
          <input
            type="checkbox"
            checked={settings.goblinAutonomy === 'ask'}
            onChange={(e) =>
              void patch({ goblinAutonomy: e.target.checked ? 'ask' : 'auto' })
            }
            disabled={saving}
          />
          Ask me before the Goblin changes anything
        </label>
        <p className={styles.sub}>
          Off (recommended): simple, clear things — like adding milk or ticking
          off a task — happen straight away, and you can always Undo.
          Appointment changes always ask first.
        </p>
      </Card>

      <Card>
        <h2>Capacity default</h2>
        <div className={styles.tabs}>
          {(['goblin', 'steady', 'quest'] as CapacityMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={
                settings.capacityMode === mode ? styles.tabActive : styles.tab
              }
              onClick={() => void patch({ capacityMode: mode })}
              disabled={saving}
            >
              {CAPACITY_LABELS[mode]}
            </button>
          ))}
        </div>
        <p className={styles.sub}>{CAPACITY_HINTS[settings.capacityMode]}</p>
      </Card>

      <Card>
        <h2>Planning approach</h2>
        <div className={styles.tabs}>
          {(['minimal', 'balanced', 'ambitious'] as PlanningApproach[]).map(
            (approach) => (
              <button
                key={approach}
                type="button"
                className={
                  settings.planningApproach === approach
                    ? styles.tabActive
                    : styles.tab
                }
                onClick={() => void patch({ planningApproach: approach })}
                disabled={saving}
              >
                {approach}
              </button>
            ),
          )}
        </div>
      </Card>

      <Card>
        <h2>Look & motion</h2>
        <div className={styles.tabs}>
          {(['light', 'dark', 'system'] as ThemePreference[]).map((theme) => (
            <button
              key={theme}
              type="button"
              className={
                settings.theme === theme ? styles.tabActive : styles.tab
              }
              onClick={() => void patch({ theme })}
              disabled={saving}
            >
              {theme}
            </button>
          ))}
        </div>
        <label
          className={styles.sub}
          style={{ display: 'block', marginTop: '1rem' }}
        >
          <input
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={(e) => void patch({ reducedMotion: e.target.checked })}
          />{' '}
          Prefer reduced motion
        </label>
      </Card>

      <Card>
        <h2>Gentle nudges</h2>
        <p className={styles.sub}>
          In-app only. No push or email unless those channels are configured
          later and you opt in.
        </p>
        <div className={styles.tabs}>
          {(['off', 'quiet', 'normal', 'chatty'] as NudgeFrequency[]).map(
            (freq) => (
              <button
                key={freq}
                type="button"
                className={
                  settings.nudgeFrequency === freq
                    ? styles.tabActive
                    : styles.tab
                }
                onClick={() => void patch({ nudgeFrequency: freq })}
                disabled={saving}
              >
                {freq}
              </button>
            ),
          )}
        </div>
        <label
          className={styles.sub}
          style={{ display: 'block', marginTop: '1rem' }}
        >
          <input
            type="checkbox"
            checked={settings.quietHoursEnabled}
            onChange={(e) =>
              void patch({ quietHoursEnabled: e.target.checked })
            }
          />{' '}
          Quiet hours {settings.quietHoursStart}–{settings.quietHoursEnd}
        </label>
        <div className={styles.stackTight} style={{ marginTop: '0.75rem' }}>
          <label>
            Start{' '}
            <input
              type="time"
              value={settings.quietHoursStart}
              onChange={(e) => void patch({ quietHoursStart: e.target.value })}
            />
          </label>
          <label>
            End{' '}
            <input
              type="time"
              value={settings.quietHoursEnd}
              onChange={(e) => void patch({ quietHoursEnd: e.target.value })}
            />
          </label>
        </div>
        <label
          className={styles.sub}
          style={{ display: 'block', marginTop: '1rem' }}
        >
          <input
            type="checkbox"
            checked={settings.dailyBriefingEnabled}
            onChange={(e) =>
              void patch({ dailyBriefingEnabled: e.target.checked })
            }
          />{' '}
          Daily briefing on the Den
        </label>
        <label className={styles.sub} style={{ display: 'block' }}>
          <input
            type="checkbox"
            checked={settings.eveningCheckinEnabled}
            onChange={(e) =>
              void patch({ eveningCheckinEnabled: e.target.checked })
            }
          />{' '}
          Optional evening check-in nudge
        </label>
      </Card>

      <Card>
        <h2>Goblin chatter</h2>
        <div className={styles.tabs}>
          {(['quiet', 'normal', 'chatty'] as GoblinFrequency[]).map((freq) => (
            <button
              key={freq}
              type="button"
              className={
                settings.goblinFrequency === freq
                  ? styles.tabActive
                  : styles.tab
              }
              onClick={() => void patch({ goblinFrequency: freq })}
              disabled={saving}
            >
              {freq}
            </button>
          ))}
        </div>
        <label
          className={styles.sub}
          style={{ display: 'block', marginTop: '1rem' }}
        >
          <input
            type="checkbox"
            checked={settings.gamificationEnabled}
            onChange={(e) =>
              void patch({ gamificationEnabled: e.target.checked })
            }
          />{' '}
          Optional quest milestones (no streaks, no leaderboards)
        </label>
        {settings.gamificationEnabled && achievements.data?.enabled ? (
          <div style={{ marginTop: '1rem' }}>
            <p className={styles.sub}>
              Completed quests: {achievements.data.completedQuestCount}
            </p>
            <ul className={styles.sub}>
              {(achievements.data.achievements ?? []).map((a) => (
                <li key={a.id}>
                  <strong>{a.title}</strong> — {a.detail}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {message ? <p className={styles.sub}>{message}</p> : null}
      <Button variant="ghost" disabled={saving}>
        {saving ? 'Saving…' : 'Preferences auto-save when you change them'}
      </Button>
    </div>
  )
}
