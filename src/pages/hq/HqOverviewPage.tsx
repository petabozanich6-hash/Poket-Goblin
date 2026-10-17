import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/Card'
import {
  formatBytes,
  formatDate,
  hq,
  PLAN_LABELS,
  type Unavailable,
} from '@/features/hq/hqApi'

import styles from './Hq.module.css'
import { HqError } from './HqLayout'

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: string
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {hint ? <span className={styles.statHint}>{hint}</span> : null}
    </div>
  )
}

function NotAvailable({ label, info }: { label: string; info: Unavailable }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.unavailable}>Not configured</span>
      <span className={styles.statHint}>{info.reason}</span>
    </div>
  )
}

const FEATURE_LABELS: Record<string, string> = {
  brain_dump: 'Brain dump sorting',
  interpret: 'Interpret',
  breakdown: 'Tiny steps / breakdown',
  assist: 'Ask the Goblin',
}

const OUTCOME_LABELS: Record<string, string> = {
  ai: 'AI answered',
  rules: 'Rules (no AI call)',
  ai_unavailable: 'AI failed → rules',
  limit_reached: 'Daily limit reached',
  disabled: 'AI switched off',
}

export function HqOverviewPage() {
  const overview = useQuery({
    queryKey: ['hq', 'overview'],
    queryFn: hq.overview,
  })

  if (overview.isLoading) return <p>Counting goblins…</p>
  if (overview.error) return <HqError error={overview.error} />
  const data = overview.data
  if (!data) return null
  const { customers, subscriptions, ai, storage, health } = data

  return (
    <>
      <Card>
        <h2 className={styles.sectionTitle}>Customers</h2>
        <div className={styles.stats}>
          <Stat label="Registered" value={customers.total} />
          <Stat
            label="Active (30 days)"
            value={customers.active30d}
            hint={customers.activeDefinition}
          />
          <Stat label="New (7 days)" value={customers.new7d} />
          <Stat label="New (30 days)" value={customers.new30d} />
          <Stat label="Free" value={customers.byPlan.free} />
          <Stat label="Premium" value={customers.byPlan.premium} />
          <Stat label="Owner Premium" value={customers.byPlan.owner_premium} />
          <Stat label="Suspended" value={customers.suspended} />
        </div>
      </Card>

      <Card>
        <h2 className={styles.sectionTitle}>Subscriptions</h2>
        {!subscriptions.stripeConfigured ? (
          <p className={styles.sectionLead}>
            Stripe is not connected yet. Counts below come from Pocket Goblin’s
            own entitlement records and stay at zero until billing goes live.
          </p>
        ) : null}
        <div className={styles.stats}>
          <Stat label="Active" value={subscriptions.active} />
          <Stat label="Monthly" value={subscriptions.monthly} />
          <Stat label="Annual" value={subscriptions.annual} />
          <Stat label="Failed payments" value={subscriptions.failedPayments} />
          <Stat
            label="Cancelling at period end"
            value={subscriptions.upcomingCancellations}
          />
          <Stat label="Cancelled" value={subscriptions.cancelled} />
          <NotAvailable
            label="Recurring revenue"
            info={subscriptions.recurringRevenue}
          />
        </div>
      </Card>

      <Card>
        <h2 className={styles.sectionTitle}>Goblin intelligence</h2>
        <p className={styles.sectionLead}>
          {ai.providerConfigured
            ? `AI provider configured${ai.model ? ` (${ai.model})` : ''}${ai.providerEnabled ? '' : ' but switched off in settings'}.`
            : 'No AI provider configured: everything runs on the rule-based goblin.'}
        </p>
        <div className={styles.stats}>
          <Stat label="Requests today" value={ai.requests.today} />
          <Stat label="Last 7 days" value={ai.requests.last7d} />
          <Stat label="Last 30 days" value={ai.requests.last30d} />
          <Stat
            label="Failed (30 days)"
            value={ai.failed30d}
            hint="AI errors that fell back to rules"
          />
          {ai.costs.available ? (
            <Stat
              label="Measured AI model calls"
              value={ai.costs.trackedCalls30d}
              hint={`${ai.costs.unpricedCalls30d} successful calls have no verified cost rate; see AI & Costs for measured latency.`}
            />
          ) : (
            <NotAvailable label="AI measurements" info={ai.costs} />
          )}
        </div>
        <h3
          className={styles.statLabel}
          style={{ marginTop: 'var(--space-4)' }}
        >
          Usage by feature (30 days)
        </h3>
        {ai.byFeature30d.length === 0 ? (
          <p className={styles.note}>
            No intelligence activity recorded
            {ai.eventsTrackedSince
              ? ''
              : ' yet (tracking starts with this release)'}
            .
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Outcome</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {ai.byFeature30d.map((row) => (
                  <tr key={`${row.feature}-${row.outcome}`}>
                    <td data-label="Feature">
                      {FEATURE_LABELS[row.feature] ?? row.feature}
                    </td>
                    <td data-label="Outcome">
                      {OUTCOME_LABELS[row.outcome] ?? row.outcome}
                    </td>
                    <td data-label="Count">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.note}>
          {ai.approachingLimit.length === 0
            ? 'Nobody is near their daily AI limit today.'
            : `${ai.approachingLimit.length} customer(s) at 80% or more of today’s limit: `}
          {ai.approachingLimit.map((row, i) => (
            <span key={row.userId}>
              {i > 0 ? ', ' : ''}
              <Link to={`/hq/customers/${row.userId}`}>
                {row.used}/{row.limit} ({PLAN_LABELS[row.plan]})
              </Link>
            </span>
          ))}
        </p>
      </Card>

      <Card>
        <h2 className={styles.sectionTitle}>Documents</h2>
        <div className={styles.stats}>
          <Stat
            label="Kept storage"
            value={formatBytes(storage.trackedBytes)}
            hint={storage.source}
          />
          <Stat label="Kept documents" value={storage.documents} />
          <Stat
            label="Processing failures"
            value={storage.processingFailures}
          />
          <Stat
            label="Being sorted now"
            value={storage.temporaryInReview}
            hint="“Just sort it” uploads waiting for review (auto-deleted within 24 h)"
          />
          <Stat
            label="Awaiting OCR"
            value={storage.awaitingOcr}
            hint="OCR is not configured"
          />
          {storage.byPlan.map((row) => (
            <Stat
              key={row.plan}
              label={`${PLAN_LABELS[row.plan]} storage`}
              value={formatBytes(row.bytes)}
              hint={`${row.documents} document(s)`}
            />
          ))}
        </div>
        <p className={styles.note}>
          {storage.nearQuota.length === 0
            ? 'Nobody is near their storage allowance.'
            : `${storage.nearQuota.length} customer(s) at 80% or more of their allowance.`}
        </p>
      </Card>

      <Card>
        <h2 className={styles.sectionTitle}>Application health</h2>
        <div className={styles.stats}>
          <Stat
            label="API"
            value="OK"
            hint={`Environment: ${health.api.environment}`}
          />
          <Stat label="Errors (24 hours)" value={health.errors24h} />
          <Stat label="Errors (7 days)" value={health.errors7d} />
          <Stat label="Failed jobs (7 days)" value={health.failedJobs7d} />
          <NotAvailable label="Recent deployments" info={health.deployments} />
        </div>
        {health.topErrorRoutes.length > 0 ? (
          <div
            className={styles.tableWrap}
            style={{ marginTop: 'var(--space-4)' }}
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Errors (7 days)</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {health.topErrorRoutes.map((row) => (
                  <tr key={`${row.method} ${row.route}`}>
                    <td data-label="Route" className={styles.mono}>
                      {row.method} {row.route}
                    </td>
                    <td data-label="Errors">{row.count}</td>
                    <td data-label="Last seen">{formatDate(row.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div style={{ marginTop: 'var(--space-4)' }}>
          {health.warnings.length === 0 ? (
            <p className={styles.ok}>No operational warnings.</p>
          ) : (
            <ul className={styles.warnings} aria-label="Operational warnings">
              {health.warnings.map((w) => (
                <li key={w} className={styles.warning}>
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className={styles.note}>Generated {formatDate(data.generatedAt)}.</p>
      </Card>
    </>
  )
}
