/**
 * Hourly safety net for billing: re-read from Stripe any linked subscription
 * that is due to renew, has just lapsed, or is in a payment-trouble state,
 * so one lost webhook can't strand a paying customer on Free (or leave an
 * ended subscription looking paid). Reads only; Stripe stays the source of
 * truth and applySubscription does the same checks as the webhook.
 */
import type { Env } from '../../env'
import {
  adoptRemainingSubscription,
  applySubscription,
  listCustomerSubscriptions,
  billingConfig,
  stripe,
  StripeError,
  type StripeSubscription,
} from './stripe'

const BATCH = 25

export async function reconcileSubscriptions(
  env: Env,
  now: Date = new Date(),
): Promise<{ checked: number; failed: number }> {
  const config = billingConfig(env)
  if (!config.enabled) return { checked: 0, failed: 0 }
  const soon = new Date(now.getTime() + 86_400_000).toISOString()
  const rows = await env.DB.prepare(
    `SELECT user_id as userId, stripe_subscription_id as subId
     FROM user_entitlements
     WHERE source = 'stripe' AND ended_at IS NULL AND stripe_subscription_id IS NOT NULL
       AND (current_period_end IS NULL OR current_period_end < ?
            OR status NOT IN ('active', 'trialing'))
     ORDER BY updated_at ASC LIMIT ?`,
  )
    .bind(soon, BATCH)
    .all<{ userId: string; subId: string }>()
  const fetchSub = (id: string) =>
    stripe<StripeSubscription>(
      config,
      'GET',
      `/subscriptions/${encodeURIComponent(id)}`,
    )
  let checked = 0
  let failed = 0
  for (const row of rows.results ?? []) {
    try {
      const sub = await fetchSub(row.subId)
      await applySubscription(env.DB, sub, row.userId, now, fetchSub)
      await adoptRemainingSubscription(
        env.DB,
        row.userId,
        sub,
        listCustomerSubscriptions(config),
        now,
        fetchSub,
      )
      // Mark it looked at, so the oldest-checked rows go first next hour.
      await env.DB.prepare(
        `UPDATE user_entitlements SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE stripe_subscription_id = ? AND ended_at IS NULL`,
      )
        .bind(row.subId)
        .run()
      checked += 1
    } catch (error) {
      failed += 1
      console.error(
        'billing reconcile failed',
        error instanceof StripeError ? error.status : 'error',
      )
    }
  }
  return { checked, failed }
}
