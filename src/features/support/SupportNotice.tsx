import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api } from '@/lib/api'

/** Only visible when HQ has replied; otherwise occupies no dashboard space. */
export function SupportNotice() {
  const q = useQuery({
    queryKey: ['support', 'unread'],
    queryFn: () => api.get<{ unread: number }>('/support/unread'),
    refetchInterval: 60_000,
    retry: false,
  })
  if (!q.data?.unread) return null
  return <div role="status" style={{
    marginBottom: '1rem', padding: '0.9rem 1rem', borderRadius: '0.8rem',
    background: 'var(--color-warm-soft)', border: '1px solid var(--color-border)',
  }}>
    🧌 <strong>Your Goblin has reported back from HQ!</strong>{' '}
    <Link to="/support" style={{ textDecoration: 'underline', fontWeight: 700 }}>
      Read {q.data.unread === 1 ? 'your message' : `your ${q.data.unread} messages`}
    </Link>
  </div>
}
