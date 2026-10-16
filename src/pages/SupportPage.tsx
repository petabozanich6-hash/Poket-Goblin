import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, TextArea } from '@/components/ui/Input'
import { api } from '@/lib/api'

type Reply = { id: string; author: 'owner' | 'user'; body: string; createdAt: string }
type Thread = {
  id: string; category: string; subject: string; message: string
  status: string; unreadForUser: number; createdAt: string; replies: Reply[]
}

export function SupportPage() {
  const client = useQueryClient()
  const reports = useQuery({
    queryKey: ['support', 'reports'],
    queryFn: () => api.get<{ reports: Thread[] }>('/support'),
  })
  const [category, setCategory] = useState('problem')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function refresh() {
    await client.invalidateQueries({ queryKey: ['support'] })
  }
  async function send(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(''); setSent(false)
    try {
      await api.post('/support', { category, subject: subject.trim(), message: message.trim() })
      setSubject(''); setMessage(''); setSent(true); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send your message.') }
    finally { setBusy(false) }
  }
  async function openThread(id: string) {
    setExpanded(expanded === id ? null : id); setReply('')
    try {
      await api.post(`/support/${encodeURIComponent(id)}/read`, {})
      await refresh()
    } catch { /* A failed read marker does not hide the thread. */ }
  }
  async function sendReply(id: string) {
    setBusy(true); setError('')
    try {
      await api.post(`/support/${encodeURIComponent(id)}/reply`, { message: reply.trim() })
      setReply(''); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not reply.') }
    finally { setBusy(false) }
  }

  return <div style={{ display: 'grid', gap: '1.25rem', maxWidth: '50rem' }}>
    <div><h1>Messages to Goblin HQ 🧌</h1><p>Found a glitch? Have a gloriously chaotic idea? Send a private message to HQ. Your Goblin will bring replies back here.</p></div>
    <Card>
      <h2>Tell HQ what's happening</h2>
      <form onSubmit={e => void send(e)} style={{ display: 'grid', gap: '1rem' }}>
        <label>Message type <select value={category} onChange={e => setCategory(e.target.value)} style={{ display: 'block', padding: '0.7rem', width: '100%', maxWidth: '20rem' }}>
          <option value="problem">Something's broken</option><option value="idea">I have an idea</option><option value="feedback">Other feedback</option>
        </select></label>
        <Input label="Subject" name="supportSubject" minLength={4} maxLength={120} required value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. My reminder won't save" />
        <TextArea label="Your message" name="supportMessage" minLength={10} maxLength={4000} required rows={5} value={message} onChange={e => setMessage(e.target.value)} placeholder="Tell me what happened and what you expected." />
        <Button type="submit" disabled={busy || subject.trim().length < 4 || message.trim().length < 10}>{busy ? 'Sending…' : 'Send to HQ'}</Button>
      </form>
      {sent && <p role="status">Message delivered! It is now in Goblin HQ.</p>}
      {error && <p role="alert">{error} If messages cannot be sent, contact support@pocketgoblin.org instead.</p>}
    </Card>
    <Card>
      <h2>Your previous messages</h2>
      {reports.isLoading && <p>Finding your messages…</p>}
      {reports.error && <p role="alert">{reports.error instanceof Error ? reports.error.message : 'Could not load messages.'}</p>}
      {!reports.data?.reports.length && !reports.isLoading && <p>No messages yet. That probably means the gremlins have been behaving.</p>}
      <div style={{ display: 'grid', gap: '0.75rem' }}>{reports.data?.reports.map(r => (
        <section key={r.id} style={{ border: '1px solid var(--color-border)', borderRadius: '0.75rem', padding: '1rem' }}>
          <button type="button" onClick={() => void openThread(r.id)} aria-expanded={expanded === r.id} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', textAlign: 'left', gap: '1rem' }}>
            <span><strong>{r.subject}</strong>{r.unreadForUser ? ' · 🧌 New reply' : ''}</span><small>{r.status.replace('_', ' ')}</small>
          </button>
          {expanded === r.id && <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
            <p>{r.message}</p>
            {r.replies.map(m => <p key={m.id} style={{ padding: '0.75rem', borderRadius: '0.5rem', background: 'var(--color-bg-muted)', whiteSpace: 'pre-wrap' }}>
              <strong>{m.author === 'owner' ? 'Goblin HQ' : 'You'}:</strong> {m.body}
            </p>)}
            <TextArea label="Reply to HQ" name={`supportReply-${r.id}`} maxLength={4000} minLength={2} rows={3} value={reply} onChange={e => setReply(e.target.value)} />
            <Button type="button" disabled={busy || reply.trim().length < 2} onClick={() => void sendReply(r.id)}>Send reply</Button>
          </div>}
        </section>
      ))}</div>
    </Card>
  </div>
}
