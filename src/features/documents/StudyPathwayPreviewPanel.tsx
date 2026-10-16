import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import {
  previewStudyPathway,
  type StudyPathwayPreview,
} from '@/features/explore/exploreApi'

/** Read-only preview; no tasks or events are written until a separate approval flow exists. */
export function StudyPathwayPreviewPanel({ documentId }: { documentId: string }) {
  const [minutes, setMinutes] = useState(60)
  const [includeWeekends, setIncludeWeekends] = useState(false)
  const [preview, setPreview] = useState<StudyPathwayPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    setPreview(null)
    try {
      const dates = Array.from({ length: 21 }, (_, index) => {
        const date = new Date()
        date.setHours(12, 0, 0, 0)
        date.setDate(date.getDate() + index)
        const weekday = date.getDay()
        const blocked = !includeWeekends && (weekday === 0 || weekday === 6)
        const iso = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
        return { date: iso, availableMinutes: blocked ? 0 : minutes }
      })
      setPreview(await previewStudyPathway(documentId, dates))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not preview your pathway.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section aria-label="Study pathway preview">
      <h4>Plan my study time</h4>
      <p>See how these steps could fit into your next three weeks. This is only a preview and will not change your tasks or calendar.</p>
      <label>
        Minutes available per study day{' '}
        <input
          type="number"
          min={15}
          max={600}
          step={15}
          value={minutes}
          onChange={(event) => setMinutes(Number(event.target.value))}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={includeWeekends}
          onChange={(event) => setIncludeWeekends(event.target.checked)}
        />{' '}
        Include weekends
      </label>
      <Button onClick={() => void generate()} disabled={loading || !Number.isFinite(minutes) || minutes < 15 || minutes > 600}>
        {loading ? 'Planning…' : 'Preview my pathway'}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
      {preview ? (
        <div aria-live="polite">
          <p>{preview.preview.sessions.length} proposed sessions. {preview.preview.unscheduledMinutes} minutes could not be scheduled.</p>
          <p>{preview.assumptions.note} Each existing task is estimated at {preview.assumptions.taskMinutes} minutes and appointment at {preview.assumptions.appointmentMinutes} minutes.</p>
          <ul>
            {preview.preview.sessions.map((session) => (
              <li key={`${session.stepId}:${session.sequence}`}>
                {session.date}: {session.title} — {session.minutes} min
              </li>
            ))}
          </ul>
          {preview.preview.warnings.length > 0 ? (
            <p role="alert">Some work could not fit. Change your availability or review the deadlines.</p>
          ) : null}
          <p>Nothing has been added. Approval and rescheduling are still being built.</p>
        </div>
      ) : null}
    </section>
  )
}
