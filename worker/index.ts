import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

import type { Env } from './env'
import { allowedOrigin } from './lib/cors'
import {
  sweepExpiredChallenges,
  sweepExpiredDocuments,
} from './lib/documents/lifecycle'
import { newId } from './lib/ids'
import {
  authSecretProblem,
  resolveSession,
  type AuthUser,
  type SessionInfo,
} from './lib/session'
import { accountRoutes } from './routes/account'
import { adminRoutes } from './routes/admin'
import { authRoutes } from './routes/auth'
import { captureRoutes } from './routes/captures'
import { categoryRoutes } from './routes/categories'
import { connectionRoutes } from './routes/connections'
import { dashboardRoutes } from './routes/dashboard'
import { documentRoutes } from './routes/documents'
import { goblinRoutes } from './routes/goblin'
import { eventRoutes } from './routes/events'
import { historyRoutes } from './routes/history'
import { intelligenceRoutes } from './routes/intelligence'
import { magicalRoutes } from './routes/magical'
import { meRoutes } from './routes/me'
import { noteRoutes } from './routes/notes'
import { platformRoutes } from './routes/platform'
import { planRoutes } from './routes/plan'
import { reminderRoutes } from './routes/reminders'
import { reviewRoutes } from './routes/review'
import { searchRoutes } from './routes/search'
import { shoppingRoutes } from './routes/shopping'
import { taskRoutes } from './routes/tasks'

type Vars = { user: AuthUser; session: SessionInfo }

const app = new Hono<{ Bindings: Env; Variables: Vars }>().basePath('/api')

app.use(
  '*',
  cors({
    origin: (origin, c) => allowedOrigin(origin, c.env.ENVIRONMENT),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Pocket-Goblin-Admin'],
  }),
)

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
    xFrameOptions: 'DENY',
    // HSTS is a domain-wide decision (owner approval D4); not set here.
    strictTransportSecurity: false,
  }),
)

app.get('/health', (c) =>
  c.json({
    service: 'pocket-goblin',
    status: 'ok',
    environment: c.env.ENVIRONMENT,
  }),
)

// Fail closed: without a real AUTH_SECRET in production, refuse anything
// that reads or writes sessions instead of silently using a public fallback.
app.use('*', async (c, next) => {
  if (c.req.path === '/api/health') return next()
  const problem = authSecretProblem(c.env)
  if (problem) {
    console.error(`Auth disabled: ${problem}`)
    return c.json({ error: 'Service temporarily unavailable' }, 503)
  }
  return next()
})

app.route('/auth', authRoutes)
app.route('/platform', platformRoutes)

app.use('*', async (c, next) => {
  if (
    c.req.path.startsWith('/api/auth') ||
    c.req.path.startsWith('/api/platform') ||
    c.req.path === '/api/health' ||
    c.req.path === '/api/connections/oauth/callback'
  ) {
    return next()
  }
  const resolved = await resolveSession(c.env.DB, c.env, c.req.header('Cookie'))
  if (resolved.kind === 'suspended') {
    return c.json(
      { error: 'This account is suspended.', code: 'account_suspended' },
      403,
    )
  }
  if (resolved.kind === 'none') return c.json({ error: 'Unauthorized' }, 401)
  c.set('user', resolved.user)
  c.set('session', resolved.session)
  return next()
})

app.route('/me', meRoutes)
app.route('/account', accountRoutes)
app.route('/goblin', goblinRoutes)
app.route('/categories', categoryRoutes)
app.route('/tasks', taskRoutes)
app.route('/captures', captureRoutes)
app.route('/plan', planRoutes)
app.route('/events', eventRoutes)
app.route('/reminders', reminderRoutes)
app.route('/notes', noteRoutes)
app.route('/shopping', shoppingRoutes)
app.route('/search', searchRoutes)
app.route('/history', historyRoutes)
app.route('/dashboard', dashboardRoutes)
app.route('/intelligence', intelligenceRoutes)
app.route('/documents', documentRoutes)
app.route('/review', reviewRoutes)
app.route('/connections', connectionRoutes)
app.route('/magical', magicalRoutes)
app.route('/admin', adminRoutes)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

// Unhandled errors: log the route and error class (never bodies) so Goblin
// HQ can report application health, then return a generic 500.
app.onError(async (error, c) => {
  console.error(error)
  try {
    await c.env.DB.prepare(
      `INSERT INTO app_errors (id, method, route, status, error_name)
       VALUES (?, ?, ?, 500, ?)`,
    )
      .bind(
        newId('err'),
        c.req.method,
        c.req.routePath || c.req.path,
        (error instanceof Error ? error.name : 'Error').slice(0, 80),
      )
      .run()
  } catch {
    // The database may be the thing that failed; the response still goes out.
  }
  return c.json({ error: 'Something went wrong' }, 500)
})

export { app }

/**
 * Hourly housekeeping (Cron Trigger in wrangler.toml): forget abandoned
 * "Just sort it" documents and unfinished uploads, and drop expired passkey
 * challenges. Logs counts only.
 */
async function scheduled(
  _controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
) {
  ctx.waitUntil(
    (async () => {
      const documents = await sweepExpiredDocuments(env)
      await sweepExpiredChallenges(env)
      // Voice housekeeping: replay records and expired follow-up context.
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM goblin_requests WHERE created_at < ?`).bind(
          new Date(Date.now() - 2 * 86_400_000).toISOString(),
        ),
        env.DB.prepare(`DELETE FROM goblin_context WHERE expires_at < ?`).bind(
          new Date().toISOString(),
        ),
      ])
      console.log(
        `housekeeping: ${documents.forgotten} document(s) forgotten, ${documents.failed} retry later`,
      )
    })(),
  )
}

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>
