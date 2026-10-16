import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import {
  replanMissedStudySessions,
  type SavedStudyPathway,
  type StudyDayAvailability,
  type StudyReplanResponse,
} from '@/features/explore/exploreApi'

/** Missed work is never moved until the learner approves a fresh proposal. */
export function StudyReplanPanel({
  documentId,
  sessions,
  onUpdated,
}: {
  documentId: string
  sessions: SavedStudyPathway['sessions']
  onUpdated: () => Promise<unknown>
}) {
  const [minutes, setMinutes] = useState(60)
  const [includeWeekends, setIncludeWeekends] = useState(false)
  const [days, setDays] = useState(21)
  const [proposal, setProposal] = useState<StudyReplanResponse | null>(null)
  const [availability, setAvailability] = useState<StudyDayAvailability[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  function makeAvailability(): StudyDayAvailability[] {
    return Array.from({ length: days }, (_, index) => {
      const date = new Date()
      date.setHours(12, 0, 0, 0)
      date.setDate(date.getDate() + index)
      const blocked =
        !includeWeekends && (date.getDay() === 0 || date.getDay() === 6)
      const iso = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-')
      return { date: iso, availableMinutes: blocked ? 0 : minutes }
    })
  }

  async function preview() {
    setBusy(true)
    setError(null)
    setMessage(null)
    setProposal(null)
    try {
      const proposedDays = makeAvailability()
      const result = await replanMissedStudySessions(documentId, proposedDays)
      setAvailability(proposedDays)
      setProposal(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not check missed study days.')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!proposal || proposal.warnings.length || !proposal.moves.length) return
    setBusy(true)
    setError(null)
    try {
      const result = await replanMissedStudySessions(
        documentId,
        availability,
        proposal.moves,
      )
      if (!result.applied) throw new Error('The new dates were not saved.')
      setProposal(null)
      setMessage(`Rescheduled ${result.moves.length} unfinished study sessions.`)
      await onUpdated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the updated study dates.')
      setProposal(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Rescue missed study sessions">
      <h5>Missed a study day? The goblin can find another.</h5>
      <p>Only overdue, unfinished study sessions are considered. Completed work and assessment deadlines stay exactly where they are. Review all changes before applying them.</p>
      <label>
        Search ahead{' '}
        <select
          value={days}
          onChange={(event) => {
            setDays(Number(event.target.value))
            setProposal(null)
          }}
        >
          <option value={21}>3 weeks</option>
          <option value={42}>6 weeks</option>
          <option value={84}>12 weeks</option>
        </select>
      </label>{' '}
      <label>
        Minutes free per day{' '}
        <input
          type="number"
          min={15}
          max={600}
          step={15}
          value={minutes}
          onChange={(event) => {
            setMinutes(Number(event.target.value))
            setProposal(null)
          }}
        />
      </label>{' '}
      <label>
        <input
          type="checkbox"
          checked={includeWeekends}
          onChange={(event) => {
            setIncludeWeekends(event.target.checked)
            setProposal(null)
          }}
        />{' '}
        Include weekends
      </label>{' '}
      <Button
        variant="secondary"
        onClick={() => void preview()}
        disabled={busy || !Number.isFinite(minutes) || minutes < 15 || minutes > 600}
      >
        {busy ? 'Checking…' : 'Find new days for missed work'}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {proposal ? (
        <div aria-live="polite">
          <p>{proposal.missedCount} missed sessions found; {proposal.moves.length} can be rescheduled.</p>
          {proposal.moves.length ? (
            <ul>
              {proposal.moves.map((move) => (
                <li key={move.sessionId}>
                  {sessions.find((session) => session.id === move.sessionId)?.title ??
                    'Study session'}: {move.date} — {move.minutes} min
                </li>
              ))}
            </ul>
          ) : null}
          {proposal.warnings.length ? (
            <p role="alert">
              {proposal.warnings.length} sessions cannot safely fit before their deadlines.
              Change your availability or check the assessment requirements.
              No sessions have been moved.
            </p>
          ) : null}
          <Button
            onClick={() => void apply()}
            disabled={busy || !proposal.moves.length || proposal.warnings.length > 0}
          >
            {busy ? 'Saving…' : 'Approve these new study dates'}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
