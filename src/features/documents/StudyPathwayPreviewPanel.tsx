import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { StudyReplanPanel } from './StudyReplanPanel'
import {
  approveStudyPathway,
  editStudyPathwaySession,
  getSavedStudyPathway,
  previewStudyPathway,
  undoStudyPathway,
  type StudyPathwayPreview,
  type StudyDayAvailability,
  type SavedStudyPathway,
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
  const [stored, setStored] = useState<SavedStudyPathway | null>(null)
  const [sessionSaving, setSessionSaving] = useState<string | null>(null)

  async function refreshSaved() {
    const data = await getSavedStudyPathway(documentId)
    setStored(data)
    return data
  }

  useEffect(() => {
    let active = true
    void getSavedStudyPathway(documentId)
      .then((data) => {
        if (active) {
          setStored(data)
          setSaved(data.pathway?.status === 'active')
        }
      })
      .catch(() => {
        if (active) setError('Could not load your saved study pathway.')
      })
    return () => {
      active = false
    }
  }, [documentId])

  async function generate() {
    setLoading(true)
    setError(null)
    setPreview(null)
    if (stored?.pathway?.status === 'active') {
      setError('Undo the saved pathway before creating another preview.')
      setLoading(false)
      return
    }
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
      await refreshSaved()
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
      await refreshSaved()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not undo the pathway.',
      )
    } finally {
      setUndoing(false)
    }
  }

  async function saveSession(
    session: SavedStudyPathway['sessions'][number],
    date: string,
    minutesValue: number,
    availableMinutes: number,
  ) {
    setSessionSaving(session.id)
    setError(null)
    try {
      await editStudyPathwaySession(
        documentId,
        session.id,
        date,
        minutesValue,
        availableMinutes,
      )
      await refreshSaved()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not update this session.',
      )
    } finally {
      setSessionSaving(null)
    }
  }

  return (
    <section aria-label="Study pathway preview">
      <h4>Plan my study time</h4>
      {stored?.pathway?.status === 'active' ? (
        <div>
          <h5>Saved study sessions</h5>
          <p>
            You can move unfinished sessions before their original assessment
            deadlines. Confirm how much time you have on the new day; the goblin
            will account for existing tasks and appointments.
          </p>
          <ul>
            {stored.sessions
              .filter((session) => session.status === 'planned')
              .map((session) => (
                <li key={session.id}>
                  <form
                    key={`${session.date}:${session.minutes}`}
                    onSubmit={(event) => {
                      event.preventDefault()
                      const fields = new FormData(event.currentTarget)
                      void saveSession(
                        session,
                        String(fields.get('date')),
                        Number(fields.get('minutes')),
                        Number(fields.get('availableMinutes')),
                      )
                    }}
                  >
                    <strong>{session.title}</strong>{' '}
                    {session.taskStatus === 'open' &&
                    session.taskDueDate !== session.date ? (
                      <p role="alert">
                        This task was moved in your task list to{' '}
                        {session.taskDueDate ?? 'an unknown date'}. The saved
                        study pathway still shows {session.date}. Restore the
                        task date or undo the pathway before replanning.
                      </p>
                    ) : null}
                    <label>
                      Date{' '}
                      <input
                        name="date"
                        type="date"
                        defaultValue={session.date}
                        required
                      />
                    </label>{' '}
                    <label>
                      Minutes{' '}
                      <input
                        name="minutes"
                        type="number"
                        min={1}
                        max={240}
                        defaultValue={session.minutes}
                        required
                      />
                    </label>{' '}
                    <label>
                      Minutes free on new day{' '}
                      <input
                        name="availableMinutes"
                        type="number"
                        min={15}
                        max={1440}
                        defaultValue={Math.max(60, session.minutes)}
                        required
                      />
                    </label>{' '}
                    {session.deadlineDate ? (
                      <small>Assessment deadline: {session.deadlineDate}</small>
                    ) : (
                      <small>Deadline unknown: later moves are blocked.</small>
                    )}{' '}
                    <Button
                      type="submit"
                      size="sm"
                      disabled={
                        sessionSaving !== null ||
                        session.taskStatus !== 'open' ||
                        session.taskDueDate !== session.date
                      }
                    >
                      {sessionSaving === session.id
                        ? 'Saving…'
                        : 'Save changes'}
                    </Button>
                  </form>
                </li>
              ))}
          </ul>
          <StudyReplanPanel
            documentId={documentId}
            sessions={stored.sessions}
            onUpdated={refreshSaved}
          />
          <Button
            variant="secondary"
            onClick={() => void undo()}
            disabled={undoing}
          >
            {undoing ? 'Undoing…' : 'Undo this pathway'}
          </Button>
        </div>
      ) : null}
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
      {preview && stored?.pathway?.status !== 'active' ? (
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
              <Button
                variant="secondary"
                onClick={() => void undo()}
                disabled={undoing}
              >
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
