import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, TextArea } from '@/components/ui/Input'
import {
  formatDate,
  hq,
  type PlatformSettings,
  type SettingsResponse,
} from '@/features/hq/hqApi'
import { ApiError } from '@/lib/api'

import styles from './Hq.module.css'
import { HqError } from './HqLayout'

type Key = keyof PlatformSettings

/**
 * One editable section. Saves through the validated settings API; if the
 * server says the change is high-impact, shows its reasons and asks again.
 */
function SettingSection<K extends Key>({
  settingKey,
  title,
  lead,
  data,
  children,
}: {
  settingKey: K
  title: string
  lead: string
  data: SettingsResponse
  children: (
    value: PlatformSettings[K],
    set: (next: PlatformSettings[K]) => void,
  ) => ReactNode
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<PlatformSettings[K]>(
    data.settings[settingKey],
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [reasons, setReasons] = useState<string[] | null>(null)

  async function save(confirm = false) {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const saved = await hq.saveSetting(settingKey, draft, confirm)
      setDraft(saved.value)
      setReasons(null)
      setMessage('Saved.')
      await queryClient.invalidateQueries({ queryKey: ['hq', 'settings'] })
      await queryClient.invalidateQueries({ queryKey: ['platform-status'] })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'confirmation_required') {
        setReasons(
          Array.isArray(err.data.reasons) ? (err.data.reasons as string[]) : [],
        )
      } else {
        setError(err)
      }
    } finally {
      setBusy(false)
    }
  }

  const changed =
    JSON.stringify(draft) !== JSON.stringify(data.settings[settingKey])

  return (
    <Card>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <p className={styles.sectionLead}>
        {lead}
        {data.updatedAt[settingKey]
          ? ` Last changed ${formatDate(data.updatedAt[settingKey])}.`
          : ' Using the default.'}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save(false)
        }}
      >
        {children(draft, (next) => {
          setDraft(next)
          setReasons(null)
          setMessage(null)
        })}
        <div className={styles.actionsRow}>
          <Button type="submit" disabled={!changed || busy}>
            Save
          </Button>
          {changed ? (
            <Button
              variant="ghost"
              onClick={() => setDraft(data.settings[settingKey])}
            >
              Undo changes
            </Button>
          ) : null}
          {message ? (
            <span className={styles.message} role="status">
              {message}
            </span>
          ) : null}
        </div>
        {reasons ? (
          <div className={styles.confirmBox} role="alert">
            <strong>This change needs confirmation:</strong>
            <ul>
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <div className={styles.actionsRow}>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void save(true)}
              >
                Yes, make this change
              </Button>
              <Button variant="ghost" onClick={() => setReasons(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {error ? <HqError error={error} /> : null}
      </form>
    </Card>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className={styles.check}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

function NumberField({
  label,
  value,
  max,
  onChange,
}: {
  label: string
  value: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <Input
      label={label}
      name={label}
      type="number"
      min={0}
      max={max}
      step={1}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) =>
        onChange(e.target.value === '' ? NaN : Number(e.target.value))
      }
      required
    />
  )
}

export function HqSettingsPage() {
  const settings = useQuery({
    queryKey: ['hq', 'settings'],
    queryFn: hq.settings,
  })

  if (settings.isLoading) return <p>Loading settings…</p>
  if (settings.error) return <HqError error={settings.error} />
  const data = settings.data
  if (!data) return null
  const { limits } = data

  return (
    <>
      <p className={styles.note} style={{ marginTop: 0 }}>
        These settings live in Pocket Goblin’s database and are checked by the
        server. Cloudflare secrets (keys, passwords) are never shown or changed
        here. Every change is recorded in the audit log.
      </p>

      <SettingSection
        settingKey="announcement"
        title="Announcement"
        lead="A short banner for every customer, signed in or not."
        data={data}
      >
        {(v, set) => (
          <div className={styles.gateForm}>
            <Toggle
              label="Show announcement"
              checked={v.enabled}
              onChange={(enabled) => set({ ...v, enabled })}
            />
            <TextArea
              label={`Message (plain text, up to ${limits.messageLength} characters)`}
              name="announcement"
              value={v.message}
              maxLength={limits.messageLength}
              onChange={(e) => set({ ...v, message: e.target.value })}
            />
            <label className={styles.fieldLabel}>
              Tone
              <select
                className={styles.select}
                value={v.tone}
                onChange={(e) =>
                  set({ ...v, tone: e.target.value as 'info' | 'warning' })
                }
              >
                <option value="info">Information</option>
                <option value="warning">Warning</option>
              </select>
            </label>
          </div>
        )}
      </SettingSection>

      <SettingSection
        settingKey="maintenance"
        title="Maintenance messaging"
        lead="Tells customers about planned work. It shows a message; it does not take the app offline."
        data={data}
      >
        {(v, set) => (
          <div className={styles.gateForm}>
            <Toggle
              label="Show maintenance message"
              checked={v.enabled}
              onChange={(enabled) => set({ ...v, enabled })}
            />
            <TextArea
              label="Message"
              name="maintenance"
              value={v.message}
              maxLength={limits.messageLength}
              onChange={(e) => set({ ...v, message: e.target.value })}
            />
          </div>
        )}
      </SettingSection>

      <SettingSection
        settingKey="features"
        title="Feature availability"
        lead="Switch whole features on or off for everyone."
        data={data}
      >
        {(v, set) => (
          <div className={styles.gateForm}>
            <Toggle
              label="New registrations open"
              checked={v.registrationsOpen}
              onChange={(registrationsOpen) => set({ ...v, registrationsOpen })}
            />
            <Toggle
              label="Document uploads"
              checked={v.documentUploads}
              onChange={(documentUploads) => set({ ...v, documentUploads })}
            />
            <Toggle
              label="Paid AI provider calls (off = rule-based goblin only)"
              checked={v.aiProvider}
              onChange={(aiProvider) => set({ ...v, aiProvider })}
            />
          </div>
        )}
      </SettingSection>

      <SettingSection
        settingKey="aiLimits"
        title="AI usage safeguards"
        lead={`Goblin-intelligence requests per customer per day. Maximum ${limits.aiDailyMax}; raising any limit above ${limits.aiDailyHighImpact} needs confirmation. The Owner has a limit too.`}
        data={data}
      >
        {(v, set) => (
          <div className={styles.formGrid}>
            <NumberField
              label="Free"
              value={v.free}
              max={limits.aiDailyMax}
              onChange={(free) => set({ ...v, free })}
            />
            <NumberField
              label="Premium"
              value={v.premium}
              max={limits.aiDailyMax}
              onChange={(premium) => set({ ...v, premium })}
            />
            <NumberField
              label="Owner"
              value={v.owner}
              max={limits.aiDailyMax}
              onChange={(owner) => set({ ...v, owner })}
            />
          </div>
        )}
      </SettingSection>

      <SettingSection
        settingKey="storageQuotas"
        title="Storage limits"
        lead={`Document storage per customer, in MB. Maximum ${limits.storageMbMax} MB; raising any quota above ${limits.storageMbHighImpact} MB needs confirmation. Single files are capped at 10 MB.`}
        data={data}
      >
        {(v, set) => (
          <div className={styles.formGrid}>
            <NumberField
              label="Free (MB)"
              value={v.freeMb}
              max={limits.storageMbMax}
              onChange={(freeMb) => set({ ...v, freeMb })}
            />
            <NumberField
              label="Premium (MB)"
              value={v.premiumMb}
              max={limits.storageMbMax}
              onChange={(premiumMb) => set({ ...v, premiumMb })}
            />
            <NumberField
              label="Owner (MB)"
              value={v.ownerMb}
              max={limits.storageMbMax}
              onChange={(ownerMb) => set({ ...v, ownerMb })}
            />
          </div>
        )}
      </SettingSection>
    </>
  )
}
