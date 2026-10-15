import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { goblinLine } from '@shared/magical/personality'

import { Button } from '@/components/ui/Button'
import { updateTask } from '@/features/tasks/tasksApi'

import { useOverwhelm } from './useOverwhelm'
import { acceptTinyStep, fetchPriorities, fetchTinySteps } from './magicalApi'
import styles from './OverwhelmMode.module.css'

export function OverwhelmMode() {
  const { active, exit } = useOverwhelm()
  const queryClient = useQueryClient()
  const [stepTitles, setStepTitles] = useState<string[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // Every panic starts with one slow breath before anything else.
  const [breathing, setBreathing] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    if (active) setBreathing(true)
  }, [active])

  const priorities = useQuery({
    queryKey: ['priorities'],
    queryFn: fetchPriorities,
    enabled: active,
  })

  const focus = priorities.data?.items[0]

  const completeMutation = useMutation({
    mutationFn: (id: string) => updateTask(id, { status: 'completed' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      await queryClient.invalidateQueries({ queryKey: ['priorities'] })
      await queryClient.invalidateQueries({ queryKey: ['briefing'] })
      setStepTitles(null)
    },
  })

  const acceptStep = useMutation({
    mutationFn: (title: string) => acceptTinyStep(focus!.task.id, title),
    onSuccess: async () => {
      setNote('Tiny step added under this task.')
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  if (!active) return null

  async function loadSteps(smaller = false) {
    if (!focus) return
    const current = smaller && stepTitles?.[0] ? stepTitles[0] : undefined
    const result = await fetchTinySteps(focus.task.title, current)
    setStepTitles(result.steps.map((s) => s.title))
    setNote(result.note)
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="overwhelm-title"
    >
      <div className={styles.panel}>
        {breathing ? (
          <div className={styles.breathe}>
            <h1 id="overwhelm-title" className={styles.title}>
              You’re okay. Let’s slow down.
            </h1>
            <div className={styles.breathCircle} aria-hidden />
            <p className={styles.lead}>
              Breathe in as the circle grows, and out as it shrinks. Once or
              twice is enough.
            </p>
            <div className={styles.actions}>
              <Button onClick={() => setBreathing(false)}>I’m ready</Button>
              <Button variant="ghost" onClick={exit}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className={styles.kicker}>{goblinLine('overwhelmEnter')}</p>
            <h1 id="overwhelm-title" className={styles.title}>
              One thing at a time
            </h1>
            <p className={styles.lead}>
              Everything else is tucked away for a moment. No guilt — just a
              starting point.
            </p>

            {priorities.isLoading ? (
              <p className={styles.lead}>Looking for the gentlest next move…</p>
            ) : !focus ? (
              <div className={styles.focus}>
                <p className={styles.focusTitle}>
                  {goblinLine('overwhelmEmpty')}
                </p>
                <div className={styles.actions}>
                  <Button onClick={exit}>Back to the den</Button>
                </div>
              </div>
            ) : (
              <div className={styles.focus}>
                <p className={styles.focusLabel}>Most useful next focus</p>
                <h2 className={styles.focusTitle}>{focus.task.title}</h2>
                <p className={styles.reason}>{focus.reasons[0]}</p>
                <div className={styles.actions}>
                  <Button
                    onClick={() => completeMutation.mutate(focus.task.id)}
                    disabled={completeMutation.isPending}
                  >
                    Mark done
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void loadSteps(false)}
                  >
                    Help me start
                  </Button>
                  <Button variant="ghost" onClick={exit}>
                    Leave calm mode
                  </Button>
                </div>
                {stepTitles ? (
                  <>
                    <ul className={styles.steps}>
                      {stepTitles.map((title) => (
                        <li key={title} className={styles.step}>
                          <span>{title}</span>
                          <Button
                            size="sm"
                            onClick={() => acceptStep.mutate(title)}
                            disabled={acceptStep.isPending}
                          >
                            Add step
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <div className={styles.actions}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void loadSteps(true)}
                      >
                        Even smaller
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void loadSteps(false)}
                      >
                        Another idea
                      </Button>
                    </div>
                  </>
                ) : null}
                {note ? <p className={styles.reason}>{note}</p> : null}
              </div>
            )}
            <div className={styles.clear}>
              <p className={styles.reason}>
                Too much on today? The Goblin can move everything that isn’t
                urgent to later.
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  exit()
                  void navigate('/?rescue=1')
                }}
              >
                Clear my day for me
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
