import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  CAPACITY_HINTS,
  CAPACITY_LABELS,
  CAPACITY_LIMITS,
  type CapacityMode,
} from '@shared/types'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useAuth } from '@/features/auth/useAuth'
import { rebuildTodayPlan, fetchTodayPlan } from '@/features/plan/planApi'
import { TaskList } from '@/features/tasks/TaskList'

import styles from './Page.module.css'

const modes: CapacityMode[] = ['goblin', 'steady', 'quest']

export function PlanPage() {
  const { settings, saveSettings } = useAuth()
  const queryClient = useQueryClient()
  const planQuery = useQuery({
    queryKey: ['plan', 'today'],
    queryFn: fetchTodayPlan,
  })

  const rebuildMutation = useMutation({
    mutationFn: rebuildTodayPlan,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plan'] }),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
      ])
    },
  })

  async function chooseMode(mode: CapacityMode) {
    await saveSettings({ capacityMode: mode })
    rebuildMutation.mutate(mode)
  }

  const active =
    planQuery.data?.plan.capacityMode ?? settings?.capacityMode ?? 'steady'

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Daily plan</h1>
          <p className={styles.sub}>
            Pick a capacity. The goblin suggests a realistic shortlist — never a
            guilt pile.
          </p>
        </div>
      </header>

      <Card>
        <h2>How&apos;s your energy?</h2>
        <div className={styles.modeGrid}>
          {modes.map((mode) => (
            <button
              key={mode}
              type="button"
              className={active === mode ? styles.modeActive : styles.modeCard}
              onClick={() => void chooseMode(mode)}
            >
              <strong>{CAPACITY_LABELS[mode]}</strong>
              <span>About {CAPACITY_LIMITS[mode]} things</span>
              <span>{CAPACITY_HINTS[mode]}</span>
            </button>
          ))}
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            onClick={() => rebuildMutation.mutate(active)}
            disabled={rebuildMutation.isPending}
          >
            {rebuildMutation.isPending ? 'Shuffling…' : "Rebuild today's plan"}
          </Button>
        </div>
      </Card>

      <Card>
        <h2>Suggested for today</h2>
        <p className={styles.sub}>
          Soft limit around{' '}
          {planQuery.data?.plan.suggestedCapacity ?? CAPACITY_LIMITS[active]}{' '}
          units of effort.
        </p>
        <TaskList
          tasks={planQuery.data?.plan.tasks ?? []}
          emptyMessage="Add a few open tasks, then rebuild the plan."
        />
      </Card>
    </div>
  )
}
