import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { hq } from '@/features/hq/hqApi'
import styles from './Hq.module.css'
import { HqError } from './HqLayout'

function aud(value: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Cloudflare Workers AI billing is neuron/token based. The existing database
 * only records request counts; do not disguise those as actual expenses.
 */
export function HqCostsPage() {
  const [rawUsd, setRawUsd] = useState('')
  const overview = useQuery({
    queryKey: ['hq', 'overview'],
    queryFn: hq.overview,
  })
  const fx = useQuery({
    queryKey: ['hq', 'finance', 'fx'],
    queryFn: hq.fx,
    staleTime: 60 * 60_000,
  })
  const quote = fx.data?.quote ?? null
  const usd = rawUsd.trim() !== '' ? Number(rawUsd) : null
  const amountValid =
    usd !== null && Number.isFinite(usd) && usd >= 0 && usd <= 1_000_000_000

  return (
    <div className={styles.hq}>
      <Card>
        <h2 className={styles.sectionTitle}>AI & Costs — Australian dollars</h2>
        <p className={styles.sectionLead}>
          See real usage counts, your AUD conversion reference and what has not
          yet been measured.
        </p>
        {overview.error ? <HqError error={overview.error} /> : null}
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>AI requests today</span>
            <strong className={styles.statValue}>
              {overview.data?.ai.requests.today ?? '—'}
            </strong>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Last 7 days</span>
            <strong className={styles.statValue}>
              {overview.data?.ai.requests.last7d ?? '—'}
            </strong>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Last 30 days</span>
            <strong className={styles.statValue}>
              {overview.data?.ai.requests.last30d ?? '—'}
            </strong>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>AI failures (30 days)</span>
            <strong className={styles.statValue}>
              {overview.data?.ai.failed30d ?? '—'}
            </strong>
          </div>
        </div>
        <p className={styles.note}>
          <strong>Actual AI spending in AUD: not yet available.</strong> The
          database counts requests but does not record chargeable model usage. A
          request is not a fixed-cost unit; displaying an invented total would
          be misleading. Cloudflare billing is the source of truth.
        </p>
      </Card>

      <Card>
        <h2 className={styles.sectionTitle}>Convert a USD charge into AUD</h2>
        <p className={styles.sectionLead}>
          Enter an amount from your Cloudflare bill or usage statement; the
          conversion happens only on this screen and is not saved.
        </p>
        {fx.error ? <HqError error={fx.error} /> : null}
        {quote ? (
          <p className={styles.note}>
            Reference exchange rate:{' '}
            <strong>1 USD = {quote.rate.toFixed(5)} AUD</strong> · {quote.date}{' '}
            · Frankfurter (central-bank data). This is not your bank's
            settlement rate.
          </p>
        ) : (
          <p className={styles.note}>
            Current exchange-rate data is unavailable; no estimated conversion
            will be shown.
          </p>
        )}
        <div style={{ maxWidth: '19rem', marginTop: '1rem' }}>
          <Input
            label="USD amount from provider"
            name="providerUsd"
            type="number"
            min="0"
            max="1000000000"
            step="any"
            inputMode="decimal"
            value={rawUsd}
            onChange={(e) => setRawUsd(e.target.value)}
            placeholder="e.g. 5.00"
          />
        </div>
        <p
          role="status"
          className={styles.statValue}
          style={{ marginTop: '1rem' }}
        >
          {quote && amountValid
            ? aud(Math.round((usd as number) * quote.rate * 100) / 100)
            : 'A$ —'}
        </p>
        <p className={styles.note}>
          Converted reference amount only, not an invoice or a live Cloudflare
          cost total. AUD is the default display currency in Goblin HQ.
        </p>
      </Card>

      <Card>
        <h2 className={styles.sectionTitle}>Usage breakdown (30 days)</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Feature</th>
                <th>Outcome</th>
                <th>Requests</th>
              </tr>
            </thead>
            <tbody>
              {overview.data?.ai.byFeature30d.map((f, i) => (
                <tr key={i}>
                  <td>{f.feature}</td>
                  <td>{f.outcome}</td>
                  <td>{f.count}</td>
                </tr>
              ))}
              {!overview.data?.ai.byFeature30d.length && (
                <tr>
                  <td colSpan={3}>No tracked events.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
