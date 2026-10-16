import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import {
  approveStudyPathway,
  previewStudyPathway,
  undoStudyPathway,
  type StudyPathwayPreview,
  type StudyDayAvailability,
} from '@/features/explore/exploreApi'

/** Approvals always require the backend to revalidate the displayed pathway. */
export function StudyPathwayPreviewPanel({
  documentId,
}: {
  documentId: string
}) {
  const [minutes, setMinutes] = useState(60)
  const [includeWeekends, setIncludeWeekends] = useState(false)
  const [horizonDays, setHorizonDays] = useState(21)
  const [preview, setPreview] = useState<StudyPathwayPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [availability, setAvailability] = useState<StudyDayAvailability[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    setPreview(null)
    setSaved(false)
    try {
      const dates = Array.from({ length: horizonDays }, (_, index) => {
        const date = new Date()
        date.setHours(12, 0, 0, 0)
        date.setDate(date.getDate() + index)
        const weekday = date.getDay()
        const blocked = !includeWeekends && (weekday === 0 || weekday === 6)
        const iso = [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, '0'),
          String(date.getDate()).padStart(2, '0'),
        ].join('-')
        return { date: iso, availableMinutes: blocked ? 0 : minutes }
      })
      const result = await previewStudyPathway(documentId, dates)
      setAvailability(dates)
      setPreview(result)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not preview your pathway.',
      )
    } finally {
      setLoading(false)
    }
  }

  async function approve() {
    if (!preview || saving) return
    setSaving(true)
    setError(null)
    try {
      await approveStudyPathway(
        documentId,
        availability,
        preview.preview.sessions,
      )
      setSaved(true)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save the pathway.',
      )
      setPreview(null)
    } finally {
      setSaving(false)
    }
  }

  async function undo() {
    if (!saved || undoing) return
    setUndoing(true)
    setError(null)
    try {
      await undoStudyPathway(documentId)
      setSaved(false)
      setPreview(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not undo the pathway.')
    } finally {
      setUndoing(false)
    }
  }

  return (
    <section aria-label="Study pathway preview">
      <h4>Plan my study time</h4>
      <p>
        See how these steps could fit into your available study days. Previewing
        does not change your tasks or calendar. Only approving a complete plan
        creates tasks.
      </p>
      <label>
        Planning window{' '}
        <select
          value={horizonDays}
          onChange={(event) => {
            setHorizonDays(Number(event.target.value))
            setPreview(null)
          }}
        >
          <option value={21}>3 weeks</option>
          <option value={42}>6 weeks</option>
          <option value={84}>12 weeks</option>
        </select>
      </label>
      <label>
        Minutes available per study day{' '}
        <input
          type="number"
          min={15}
          max={600}
          step={15}
          value={minutes}
          onChange={(event) => {
            setMinutes(Number(event.target.value))
            setPreview(null)
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={includeWeekends}
          onChange={(event) => {
            setIncludeWeekends(event.target.checked)
            setPreview(null)
          }}
        />{' '}
        Include weekends
      </label>
      <Button
        onClick={() => void generate()}
        disabled={
          loading || !Number.isFinite(minutes) || minutes < 15 || minutes > 600
        }
      >
        {loading ? 'Planning…' : 'Preview my pathway'}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
      {preview ? (
        <div aria-live="polite">
          <p>
            {preview.preview.sessions.length} proposed sessions.{' '}
            {preview.preview.unscheduledMinutes} minutes could not be scheduled.
          </p>
          <p>
            {preview.assumptions.note} Each existing task is estimated at{' '}
            {preview.assumptions.taskMinutes} minutes and appointment at{' '}
            {preview.assumptions.appointmentMinutes} minutes.
          </p>
          <ul>
            {preview.preview.sessions.map((session) => (
              <li key={`${session.stepId}:${session.sequence}`}>
                {session.date}: {session.title} — {session.minutes} min
              </li>
            ))}
          </ul>
          {preview.preview.warnings.length > 0 ? (
            <p role="alert">
              Some work could not fit. Change your availability or review the
              deadlines.
            </p>
          ) : null}
          {preview.preview.unschedulable.length > 0 ? (
            <p role="alert">
              {preview.preview.unschedulable.length} study steps need a
              confirmed deadline before they can be scheduled.
            </p>
          ) : null}
          {saved ? (
            <div>
              <p role="status">Pathway approved and saved to your tasks.</p>
              <Button variant="secondary" onClick={() => void undo()} disabled={undoing}>
                {undoing ? 'Undoing…' : 'Undo this pathway'}
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => void approve()}
              disabled={
                saving ||
                preview.preview.sessions.length === 0 ||
                preview.preview.unscheduledMinutes > 0 ||
                preview.preview.warnings.length > 0 ||
                preview.preview.unschedulable.length > 0
              }
            >
              {saving ? 'Saving…' : 'Approve and add these study tasks'}
            </Button>
          )}
        </div>
      ) : null}
    </section>
  )
}
