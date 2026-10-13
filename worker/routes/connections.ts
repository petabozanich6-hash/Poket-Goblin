import { Hono } from 'hono'

import type { Env } from '../env'
import { newId } from '../lib/ids'
import type { AuthUser } from '../lib/session'
import { asString } from '../lib/validate'

type Vars = { user: AuthUser }

const PROVIDERS = [
  'gmail',
  'outlook_mail',
  'google_calendar',
  'outlook_calendar',
] as const

type Provider = (typeof PROVIDERS)[number]

function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value)
}

function oauthConfigured(env: Env, provider: Provider): boolean {
  if (provider === 'gmail' || provider === 'google_calendar') {
    return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET)
  }
  if (provider === 'outlook_mail' || provider === 'outlook_calendar') {
    return Boolean(
      env.MICROSOFT_OAUTH_CLIENT_ID && env.MICROSOFT_OAUTH_CLIENT_SECRET,
    )
  }
  return false
}

export const connectionRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

async function ensureRows(db: D1Database, userId: string) {
  for (const provider of PROVIDERS) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO external_connections (id, user_id, provider, status)
         VALUES (?, ?, ?, 'not_connected')`,
      )
      .bind(newId('conn'), userId, provider)
      .run()
  }
}

connectionRoutes.get('/', async (c) => {
  const user = c.get('user')
  await ensureRows(c.env.DB, user.id)
  const rows = await c.env.DB.prepare(
    `SELECT id, provider, status, account_label as accountLabel,
            scopes, status_message as statusMessage,
            last_synced_at as lastSyncedAt, created_at as createdAt,
            updated_at as updatedAt
     FROM external_connections WHERE user_id = ?
     ORDER BY provider ASC`,
  )
    .bind(user.id)
    .all()

  return c.json({
    connections: (rows.results ?? []).map((row) => {
      const provider = row.provider as Provider
      const configured = oauthConfigured(c.env, provider)
      return {
        ...row,
        oauthConfigured: configured,
        // Honest state: never pretend connected without tokens
        status: configured ? row.status : 'not_connected',
        statusMessage: configured
          ? row.statusMessage
          : 'OAuth credentials are not configured on the server.',
      }
    }),
  })
})

connectionRoutes.post('/:provider/connect', async (c) => {
  const user = c.get('user')
  const provider = c.req.param('provider')
  if (!isProvider(provider)) return c.json({ error: 'Unknown provider' }, 400)
  await ensureRows(c.env.DB, user.id)

  if (!oauthConfigured(c.env, provider)) {
    return c.json(
      {
        error: 'OAuth is not configured',
        status: 'not_connected',
        message:
          'Add provider client ID/secret to Worker secrets before connecting. No fake inbox will be shown.',
      },
      503,
    )
  }

  const state = crypto.randomUUID()
  const expires = new Date(Date.now() + 10 * 60_000).toISOString()
  await c.env.DB.prepare(
    `INSERT INTO oauth_states (state, user_id, provider, redirect_path, expires_at)
     VALUES (?, ?, ?, '/inbox', ?)`,
  )
    .bind(state, user.id, provider, expires)
    .run()

  await c.env.DB.prepare(
    `UPDATE external_connections SET status = 'connecting',
      status_message = 'Waiting for OAuth consent',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE user_id = ? AND provider = ?`,
  )
    .bind(user.id, provider)
    .run()

  // Auth URL construction is provider-specific; returned for the client to open.
  const redirectUri = `${c.req.url.split('/api/')[0]}/api/connections/oauth/callback`
  let authorizeUrl = ''
  if (provider === 'gmail' || provider === 'google_calendar') {
    const scope =
      provider === 'gmail'
        ? 'https://www.googleapis.com/auth/gmail.readonly'
        : 'https://www.googleapis.com/auth/calendar.readonly'
    authorizeUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?response_type=code` +
      `&client_id=${encodeURIComponent(c.env.GOOGLE_OAUTH_CLIENT_ID!)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${encodeURIComponent(state)}` +
      `&access_type=offline&prompt=consent`
  } else {
    const scope =
      provider === 'outlook_mail'
        ? 'Mail.Read offline_access'
        : 'Calendars.Read offline_access'
    authorizeUrl =
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?response_type=code` +
      `&client_id=${encodeURIComponent(c.env.MICROSOFT_OAUTH_CLIENT_ID!)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${encodeURIComponent(state)}`
  }

  return c.json({
    status: 'connecting',
    state,
    authorizeUrl,
    note: 'Read-only scopes only. No mailbox write or send permissions requested.',
  })
})

connectionRoutes.get('/oauth/callback', async (c) => {
  // Public-ish callback — still requires valid state tied to a user.
  const state = c.req.query('state')
  const code = c.req.query('code')
  const error = c.req.query('error')
  if (error) {
    return c.html(
      `<p>Connection cancelled (${error}). You can close this window.</p>`,
      400,
    )
  }
  if (!state || !code) return c.json({ error: 'Missing OAuth parameters' }, 400)

  const row = await c.env.DB.prepare(
    `SELECT user_id as userId, provider, expires_at as expiresAt
     FROM oauth_states WHERE state = ?`,
  )
    .bind(state)
    .first<{ userId: string; provider: string; expiresAt: string }>()
  if (!row || row.expiresAt < new Date().toISOString()) {
    return c.json({ error: 'Invalid or expired OAuth state' }, 400)
  }

  // Exchange is intentionally not completed without verified credentials + tests.
  // Mark needs_attention so the UI stays honest.
  await c.env.DB.prepare(
    `UPDATE external_connections SET
      status = 'needs_attention',
      status_message = 'OAuth callback received. Token exchange requires verified provider setup and testing before live sync.',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE user_id = ? AND provider = ?`,
  )
    .bind(row.userId, row.provider)
    .run()
  await c.env.DB.prepare(`DELETE FROM oauth_states WHERE state = ?`)
    .bind(state)
    .run()

  return c.html(
    `<p>Thanks — Pocket Goblin received the OAuth response for ${row.provider}. ` +
      `Live sync is not enabled until token exchange is fully configured and tested. ` +
      `<a href="http://localhost:5173/inbox">Return to Inbox</a></p>`,
  )
})

connectionRoutes.post('/:provider/disconnect', async (c) => {
  const user = c.get('user')
  const provider = c.req.param('provider')
  if (!isProvider(provider)) return c.json({ error: 'Unknown provider' }, 400)

  const conn = await c.env.DB.prepare(
    `SELECT id FROM external_connections WHERE user_id = ? AND provider = ?`,
  )
    .bind(user.id, provider)
    .first<{ id: string }>()
  if (conn) {
    await c.env.DB.prepare(`DELETE FROM oauth_tokens WHERE connection_id = ?`)
      .bind(conn.id)
      .run()
  }
  await c.env.DB.prepare(
    `UPDATE external_connections SET
      status = 'disconnected',
      account_label = '',
      status_message = 'Disconnected by user',
      last_synced_at = NULL,
      sync_cursor = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE user_id = ? AND provider = ?`,
  )
    .bind(user.id, provider)
    .run()
  return c.json({ ok: true })
})

connectionRoutes.post('/:provider/sync', async (c) => {
  const provider = c.req.param('provider')
  if (!isProvider(provider)) return c.json({ error: 'Unknown provider' }, 400)
  // Auth middleware already verified the session user.
  if (!oauthConfigured(c.env, provider)) {
    return c.json(
      {
        error: 'Not connected',
        message: 'Configure OAuth credentials and complete consent first.',
      },
      503,
    )
  }
  // No fake emails/events
  return c.json(
    {
      error: 'Sync not active',
      message:
        'Provider sync is architected but not live until OAuth token exchange is completed and tested.',
    },
    503,
  )
})

/** Calendar mapping helper for tests / future sync */
connectionRoutes.post('/calendar/map-event', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const externalId = asString(body?.externalId, 200)
  const title = asString(body?.title, 200)
  const startsAt = asString(body?.startsAt, 40)
  const endsAt = asString(body?.endsAt, 40)
  if (!externalId || !title || !startsAt || !endsAt) {
    return c.json(
      { error: 'externalId, title, startsAt, endsAt required' },
      400,
    )
  }
  return c.json({
    mapped: {
      externalId,
      title,
      startsAt,
      endsAt,
      allDay: Boolean(body?.allDay),
      timezone: typeof body?.timezone === 'string' ? body.timezone : 'UTC',
      status: body?.status === 'cancelled' ? 'cancelled' : 'scheduled',
    },
  })
})
