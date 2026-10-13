import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'

import type { AssistantAction, BreakdownLevel } from '@shared/intelligence'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, TextArea } from '@/components/ui/Input'
import { useAuth } from '@/features/auth/useAuth'
import {
  acceptBreakdown,
  askAssistant,
  breakdownTask,
  deleteMemory,
  fetchIntelligenceStatus,
  fetchMemories,
  saveMemory,
} from '@/features/intelligence/intelligenceApi'
import { rebuildTodayPlan } from '@/features/plan/planApi'

import styles from './Page.module.css'

const prompts = [
  'What do I need to do today?',
  'What am I forgetting?',
  'What appointments do I have coming up?',
  'Help me organise this week.',
  'Break down sorting my taxes.',
]

export function AssistantPage() {
  const { settings } = useAuth()
  const queryClient = useQueryClient()
  const [question, setQuestion] = useState('')
  const [breakdownTitle, setBreakdownTitle] = useState('')
  const [level, setLevel] = useState<BreakdownLevel>('normal')
  const [selectedSteps, setSelectedSteps] = useState<Record<string, boolean>>(
    {},
  )
  const [memoryKey, setMemoryKey] = useState('planning_style')
  const [memoryValue, setMemoryValue] = useState('')

  const statusQuery = useQuery({
    queryKey: ['intelligence-status'],
    queryFn: fetchIntelligenceStatus,
  })
  const memoryQuery = useQuery({
    queryKey: ['memory'],
    queryFn: fetchMemories,
  })

  const assistMutation = useMutation({
    mutationFn: askAssistant,
  })
  const breakdownMutation = useMutation({
    mutationFn: () => breakdownTask(breakdownTitle, level),
    onSuccess: (data) => {
      const next: Record<string, boolean> = {}
      for (const step of data.result.steps) next[step.id] = true
      setSelectedSteps(next)
    },
  })
  const acceptMutation = useMutation({
    mutationFn: async () => {
      const steps = (breakdownMutation.data?.result.steps ?? [])
        .filter((step) => selectedSteps[step.id])
        .map((step) => ({ title: step.title }))
      return acceptBreakdown(breakdownTitle, steps)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      await queryClient.invalidateQueries({ queryKey: ['plan'] })
    },
  })
  const planMutation = useMutation({
    mutationFn: () => rebuildTodayPlan(settings?.capacityMode ?? 'steady'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['plan'] })
    },
  })
  const saveMem = useMutation({
    mutationFn: () => saveMemory(memoryKey, memoryValue),
    onSuccess: async () => {
      setMemoryValue('')
      await queryClient.invalidateQueries({ queryKey: ['memory'] })
    },
  })
  const delMem = useMutation({
    mutationFn: deleteMemory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['memory'] })
    },
  })

  function onAsk(event: FormEvent) {
    event.preventDefault()
    if (!question.trim()) return
    assistMutation.mutate(question.trim())
  }

  function actionHref(action: AssistantAction): string | null {
    switch (action.kind) {
      case 'open_plan':
        return '/plan'
      case 'open_capture':
        return '/capture'
      case 'open_calendar':
        return '/calendar'
      case 'open_tasks':
        return '/tasks'
      case 'open_life':
        return '/life'
      case 'open_find':
        return '/find'
      default:
        return null
    }
  }

  const reply = assistMutation.data?.reply
  const steps = breakdownMutation.data?.result.steps ?? []

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Ask the goblin</h1>
          <p className={styles.sub}>
            Not a generic chatbot — answers use your real shelves. Nothing is
            created without your say-so.
          </p>
        </div>
      </header>

      <Card>
        <p className={styles.sub}>
          {statusQuery.data?.modeLabel ?? 'Checking goblin brain…'}
          {statusQuery.data
            ? ` · ${statusQuery.data.usedToday}/${statusQuery.data.dailyLimit} intelligence requests today`
            : ''}
        </p>
        {!statusQuery.data?.aiConfigured ? (
          <p className={styles.sub}>
            Rule-based brain active. To enable structured AI interpret, set{' '}
            <code>AI_PROVIDER=openai_compatible</code>, <code>AI_API_KEY</code>,
            and optional <code>AI_BASE_URL</code> / <code>AI_MODEL</code> in
            Worker secrets (never in the frontend).
          </p>
        ) : null}
      </Card>

      <Card>
        <h2>Ask</h2>
        <form className={styles.stackTight} onSubmit={onAsk}>
          <TextArea
            label="Question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What do I need to do today?"
          />
          <div className={styles.tabs}>
            {prompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className={styles.tab}
                onClick={() => setQuestion(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
          <Button type="submit" disabled={assistMutation.isPending}>
            {assistMutation.isPending ? 'Thinking…' : 'Ask'}
          </Button>
        </form>
        {reply ? (
          <div className={styles.stackTight} style={{ marginTop: '1rem' }}>
            <p style={{ whiteSpace: 'pre-wrap' }}>{reply.message}</p>
            {reply.warnings.map((warning) => (
              <p key={warning} className={styles.sub}>
                {warning}
              </p>
            ))}
            <div className={styles.tabs}>
              {reply.actions.map((action) => {
                const href = actionHref(action)
                if (action.kind === 'add_to_plan') {
                  return (
                    <Button
                      key={action.id}
                      size="sm"
                      variant="secondary"
                      onClick={() => planMutation.mutate()}
                    >
                      {action.label}
                    </Button>
                  )
                }
                if (action.kind === 'propose_breakdown') {
                  const topic = action.payload?.title
                  if (!topic) return null
                  return (
                    <Button
                      key={action.id}
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setBreakdownTitle(topic)
                        breakdownMutation.mutate()
                      }}
                    >
                      {action.label}
                    </Button>
                  )
                }
                return href ? (
                  <Link key={action.id} to={href} className={styles.tab}>
                    {action.label}
                  </Link>
                ) : null
              })}
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <h2>Break it down</h2>
        <p className={styles.sub}>
          Stuck starting? Ask for tiny, normal, or detailed steps — then accept
          only what helps.
        </p>
        <div className={styles.stackTight}>
          <Input
            label="Overwhelming task"
            value={breakdownTitle}
            onChange={(e) => setBreakdownTitle(e.target.value)}
            placeholder="Sort out my taxes"
          />
          <div className={styles.tabs}>
            {(['tiny', 'normal', 'detailed'] as BreakdownLevel[]).map(
              (item) => (
                <button
                  key={item}
                  type="button"
                  className={level === item ? styles.tabActive : styles.tab}
                  onClick={() => setLevel(item)}
                >
                  {item}
                </button>
              ),
            )}
          </div>
          <Button
            type="button"
            disabled={!breakdownTitle.trim() || breakdownMutation.isPending}
            onClick={() => breakdownMutation.mutate()}
          >
            Suggest steps
          </Button>
        </div>
        {steps.length > 0 ? (
          <ul className={styles.stack} style={{ marginTop: '1rem' }}>
            {steps.map((step) => (
              <li key={step.id} className={styles.listRow}>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(selectedSteps[step.id])}
                    onChange={(e) =>
                      setSelectedSteps((prev) => ({
                        ...prev,
                        [step.id]: e.target.checked,
                      }))
                    }
                  />{' '}
                  {step.title}
                </label>
              </li>
            ))}
          </ul>
        ) : null}
        {steps.length > 0 ? (
          <Button
            style={{ marginTop: '0.75rem' }}
            disabled={acceptMutation.isPending}
            onClick={() => acceptMutation.mutate()}
          >
            {acceptMutation.isPending
              ? 'Saving…'
              : 'Accept selected steps as tasks'}
          </Button>
        ) : null}
        {acceptMutation.isSuccess ? (
          <p className={styles.sub}>Steps saved. They are waiting on Tasks.</p>
        ) : null}
      </Card>

      <Card>
        <h2>Goblin memory</h2>
        <p className={styles.sub}>
          Only preferences you approve. Review or delete anytime. No sensitive
          traits are inferred.
        </p>
        <div className={styles.stackTight}>
          <Input
            label="Key"
            value={memoryKey}
            onChange={(e) => setMemoryKey(e.target.value)}
          />
          <Input
            label="Value"
            value={memoryValue}
            onChange={(e) => setMemoryValue(e.target.value)}
            placeholder="Prefer tiny first steps"
          />
          <Button
            type="button"
            disabled={!memoryKey.trim() || !memoryValue.trim()}
            onClick={() => saveMem.mutate()}
          >
            Save preference
          </Button>
        </div>
        <ul className={styles.stack} style={{ marginTop: '1rem' }}>
          {(memoryQuery.data?.memories ?? []).length === 0 ? (
            <p className={styles.sub}>No saved preferences yet.</p>
          ) : (
            memoryQuery.data?.memories.map((memory) => (
              <li key={memory.id} className={styles.listRow}>
                <div>
                  <strong>{memory.key}</strong>
                  <p className={styles.sub}>{memory.value}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => delMem.mutate(memory.id)}
                >
                  Delete
                </Button>
              </li>
            ))
          )}
        </ul>
      </Card>
    </div>
  )
}
