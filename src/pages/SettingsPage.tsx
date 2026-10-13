import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import type {
  CapacityMode,
  GoblinFrequency,
  NudgeFrequency,
  PlanningApproach,
  ThemePreference,
} from '@shared/types'
import { CAPACITY_HINTS, CAPACITY_LABELS } from '@shared/types'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useAuth } from '@/features/auth/useAuth'
import { fetchAchievements } from '@/features/magical/magicalApi'
import { applyTheme } from '@/lib/theme'

import styles from './Page.module.css'

export function SettingsPage() {
  const { settings, saveSettings } = useAuth()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const achievements = useQuery({
    queryKey: ['achievements'],
    queryFn: fetchAchievements,
  })

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
