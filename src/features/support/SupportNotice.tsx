import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { api } from '@/lib/api'
import { useAuth } from '@/features/auth/useAuth'

type Unread = { unread: number; latestReplyId: string | null }

/**
 * The existing banner remains until the customer reads HQ's reply.
 * A new reply also triggers a once-per-session pop-up, including if the
 * reply arrived while the customer was away or on another page.
 */
export function SupportNotice() {
  const { user } = useAuth()
  const location = useLocation()
  const [popupReplyId, setPopupReplyId] = useState<string | null>(null)
  const q = useQuery({
    queryKey: ['support', 'unread'],
    queryFn: () => api.get<Unread>('/support/unread'),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  })
  const unread = q.data?.unread ?? 0
  const latest = q.data?.latestReplyId ?? null
  const storageKey = user && latest ? `pg:hq-reply-ack:${user.id}:${latest}` : null

  useEffect(() => {
    if (!storageKey || unread === 0 || location.pathname === '/support') {
      return
    }
    try {
      if (sessionStorage.getItem(storageKey)) return
    } catch {
      // Session storage may be unavailable in private browsing.
    }
    setPopupReplyId(latest)
  }, [storageKey, latest, unread, location.pathname])

  function dismiss() {
    if (storageKey && popupReplyId === latest) {
      try {
        sessionStorage.setItem(storageKey, '1')
      } catch {
        // The banner still shows, even when session storage is unavailable.
      }
    }
    setPopupReplyId(null)
  }

  useEffect(() => {
    if (unread === 0 || location.pathname === '/support') setPopupReplyId(null)
  }, [unread, location.pathname])

  if (!unread) return null
  return (
    <>
      <div
        role="status"
        style={{
          marginBottom: '1rem',
          padding: '0.9rem 1rem',
          borderRadius: '0.8rem',
          background: 'var(--color-warm-soft)',
          border: '1px solid var(--color-border)',
        }}
      >
        🧌 <strong>Your Goblin has reported back from HQ!</strong>{' '}
        <Link to="/support" style={{ textDecoration: 'underline', fontWeight: 700 }}>
          Read {unread === 1 ? 'your message' : `your ${unread} messages`}
        </Link>
      </div>
      {popupReplyId && popupReplyId === latest && location.pathname !== '/support' ? (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.58)',
            display: 'grid', placeItems: 'center', zIndex: 10000, padding: '1rem',
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="hq-reply-popup-title"
            style={{
              width: '100%', maxWidth: '26rem', borderRadius: '1rem',
              background: 'var(--color-surface, #fff)', color: 'var(--color-text, #252525)',
              padding: '1.5rem', boxShadow: '0 16px 65px rgba(0,0,0,.3)',
              border: '1px solid var(--color-border)',
            }}
          >
            <h2 id="hq-reply-popup-title">🧌 Your Goblin has returned from HQ!</h2>
            <p>There's a new reply to your message. The gremlins have reported back!</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.75rem' }}>
              <Link
                to="/support"
                onClick={dismiss}
                style={{
                  padding: '.7rem 1rem', borderRadius: '.65rem',
                  background: 'var(--color-warm-soft)', fontWeight: 700,
                }}
              >
                Read HQ's reply
              </Link>
              <button type="button" onClick={dismiss} style={{ padding: '.7rem 1rem' }}>
                Not now
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
