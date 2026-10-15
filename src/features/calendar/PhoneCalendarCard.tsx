import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, Copy, Download } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

import {
  createCalendarFeed,
  exportUrl,
  fetchCalendarFeed,
  subscribeLinks,
  turnOffCalendarFeed,
} from './calendarApi'
import styles from './PhoneCalendarCard.module.css'

/**
 * Get everything into the calendar people already use: a live link their
 * phone keeps checking, or a one-off file.
 */
export function PhoneCalendarCard() {
  const queryClient = useQueryClient()
  const [link, setLink] = useState<{ url: string; webcalUrl: string } | null>(
    null,
  )
  const [copied, setCopied] = useState(false)
  const feed = useQuery({
    queryKey: ['calendar-feed'],
    queryFn: fetchCalendarFeed,
  })
  const create = useMutation({
    mutationFn: createCalendarFeed,
    onSuccess: async (data) => {
      setLink(data)
      setCopied(false)
      await queryClient.invalidateQueries({ queryKey: ['calendar-feed'] })
    },
  })
  const turnOff = useMutation({
    mutationFn: turnOffCalendarFeed,
    onSuccess: async () => {
      setLink(null)
      await queryClient.invalidateQueries({ queryKey: ['calendar-feed'] })
    },
  })

  const on = Boolean(feed.data?.feed)
  const links = link ? subscribeLinks(link.url, link.webcalUrl) : null

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Card>
      <div className={styles.card}>
        <h2 className={styles.title}>
          <CalendarPlus size={20} aria-hidden /> Put it in my phone calendar
        </h2>
        <p className={styles.muted}>
          Appointments, due dates and reminders from Pocket Goblin show up in
          the calendar you already use.
        </p>

        {links ? (
          <div className={styles.links}>
            <p>
              <strong>Tap the one you use:</strong>
            </p>
            <div className={styles.buttons}>
              <a className={styles.linkButton} href={links.apple}>
                iPhone or Mac
              </a>
              <a
                className={styles.linkButton}
                href={links.google}
                target="_blank"
                rel="noreferrer"
              >
                Google or Android
              </a>
              <a
                className={styles.linkButton}
                href={links.outlook}
                target="_blank"
                rel="noreferrer"
              >
                Outlook
              </a>
            </div>
            <div className={styles.copyRow}>
              <input
                className={styles.urlInput}
                readOnly
                value={link!.url}
                aria-label="Your private calendar link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button size="sm" variant="secondary" onClick={() => void copy()}>
                <Copy size={14} aria-hidden /> {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className={styles.muted}>
              It updates by itself every few hours. This link is private: anyone
              who has it can see your calendar titles, so keep it to yourself.
              You’ll only see it now — make a new one any time.
            </p>
          </div>
        ) : on ? (
          <p className={styles.muted}>
            Your phone calendar link is on
            {feed.data?.feed?.lastUsedAt
              ? ' and your calendar has been checking in.'
              : '.'}
          </p>
        ) : null}

        <div className={styles.buttons}>
          {!links ? (
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {on ? 'Make a new link' : 'Keep my phone calendar up to date'}
            </Button>
          ) : null}
          <a className={styles.linkButton} href={exportUrl()} download>
            <Download size={14} aria-hidden /> Download a calendar file
          </a>
          {on || links ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => turnOff.mutate()}
              disabled={turnOff.isPending}
            >
              Turn the link off
            </Button>
          ) : null}
        </div>
        {create.isError || turnOff.isError ? (
          <p className={styles.error} role="alert">
            Something went wrong — try again.
          </p>
        ) : null}
      </div>
    </Card>
  )
}
