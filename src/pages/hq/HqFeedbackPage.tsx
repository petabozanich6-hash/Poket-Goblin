import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/Input'
import { api } from '@/lib/api'
import { HqError } from './HqLayout'
import styles from './Hq.module.css'

type Status = 'received' | 'in_progress' | 'resolved'
type Summary = { id: string; category: string; subject: string; status: Status; email: string; displayName: string; unreadForOwner: number; updatedAt: string }
type Message = { id: string; author: 'owner' | 'user'; body: string; createdAt: string }
type Detail = { report: Summary & { message: string; internalNote: string }; replies: Message[] }
const statusOptions: Status[] = ['received', 'in_progress', 'resolved']
const quickReplies = {
  thanks: "Thank you for taking the time to tell me. I've received your message and appreciate the feedback.",
  working: "The tech gremlins have been informed! I'm looking into this and will report back when I have an update.",
  fixed: "The gremlins have put their tools down for a moment — this should now be fixed. Please let me know if it's still misbehaving.",
  details: "Thanks for flagging this. Could you tell me what device you're using and what happened just before the problem?",
}

export function HqFeedbackPage() {
  const client = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [status, setStatus] = useState<Status>('received')
  const [note, setNote] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const list = useQuery({
    queryKey: ['hq', 'support', 'list'],
    queryFn: () => api.admin.get<{ reports: Summary[] }>('/support'),
  })
  const detail = useQuery({
    queryKey: ['hq', 'support', 'detail', selected],
    queryFn: () => api.admin.get<Detail>(`/support/${encodeURIComponent(selected || '')}`),
    enabled: Boolean(selected),
  })

  useEffect(() => {
    if (!detail.data) return
    setStatus(detail.data.report.status)
    setNote(detail.data.report.internalNote)
  }, [detail.data])

  async function refresh() {
    await client.invalidateQueries({ queryKey: ['hq', 'support'] })
  }
  async function perform(action: 'reply' | 'manage') {
    if (!selected) return
    setBusy(true); setError(null)
    try {
      if (action === 'reply') {
        await api.admin.send('POST', `/support/${encodeURIComponent(selected)}/reply`, { message: reply.trim(), status })
        setReply('')
      } else {
        await api.admin.send('POST', `/support/${encodeURIComponent(selected)}/manage`, { status, internalNote: note.trim() })
      }
      await refresh()
    } catch (e) { setError(e) }
    finally { setBusy(false) }
  }

  return <div className={styles.hq}>
    <Card>
      <h2 className={styles.sectionTitle}>Ideas, feedback & problems</h2>
      <p className={styles.sectionLead}>Private customer messages reach Goblin HQ. Reply in the thread and the customer gets an unread notice. Internal notes never appear in their messages.</p>
      {list.error && <HqError error={list.error} />}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Customer</th><th>Subject</th><th>Type</th><th>Status</th><th>Open</th></tr></thead>
          <tbody>{list.data?.reports.map(item => <tr key={item.id}>
            <td>{item.displayName}<br/><small>{item.email}</small></td>
            <td>{item.unreadForOwner ? '● ' : ''}{item.subject}</td>
            <td>{item.category}</td><td>{item.status.replace('_', ' ')}</td>
            <td><Button variant="secondary" size="sm" onClick={() => { setSelected(item.id); setReply('') }}>Read</Button></td>
          </tr>)}
          {list.data?.reports.length === 0 && <tr><td colSpan={5}>The inbox is empty. Suspiciously peaceful.</td></tr>}</tbody>
        </table>
      </div>
    </Card>
    {selected && <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
        <h2 className={styles.sectionTitle}>Conversation</h2>
        <Button size="sm" variant="secondary" onClick={() => setSelected(null)}>Close</Button>
      </div>
      {detail.error && <HqError error={detail.error} />}
      {detail.data && <div style={{ display: 'grid', gap: '1rem' }}>
        <p><strong>{detail.data.report.subject}</strong> — {detail.data.report.email}</p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{detail.data.report.message}</p>
        {detail.data.replies.map(r => <p key={r.id} style={{ background: 'var(--color-bg-muted)', borderRadius: '.65rem', padding: '1rem', whiteSpace: 'pre-wrap' }}>
          <strong>{r.author === 'owner' ? 'Goblin HQ' : 'Customer'}:</strong> {r.body}
        </p>)}
        <label>Status <select value={status} onChange={e => setStatus(e.target.value as Status)} style={{ display: 'block', padding: '.65rem' }}>
          {statusOptions.map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
        </select></label>
        <TextArea name="hqInternalNote" label="Private internal note (HQ only)" maxLength={1000} rows={3} value={note} onChange={e => setNote(e.target.value)} />
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void perform('manage')}>Save status & private note</Button>
        <label>Quick reply <select value="" onChange={e => { const key = e.target.value as keyof typeof quickReplies; if (key) setReply(quickReplies[key]) }} style={{ display: 'block', padding: '.65rem' }}>
          <option value="">Choose a starting point</option>{Object.keys(quickReplies).map(k => <option value={k} key={k}>{k}</option>)}
        </select></label>
        <TextArea name="hqReply" label="Reply to customer" minLength={2} maxLength={4000} rows={5} value={reply} onChange={e => setReply(e.target.value)} />
        <Button type="button" disabled={busy || reply.trim().length < 2} onClick={() => void perform('reply')}>Send reply to customer</Button>
      </div>}
      {error && <HqError error={error} />}
    </Card>}
  </div>
}
