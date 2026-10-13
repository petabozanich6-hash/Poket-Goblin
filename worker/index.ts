import { Hono } from 'hono'
import { cors } from 'hono/cors'

import type { Env } from './env'
import { resolveUser, type AuthUser } from './lib/session'
import { authRoutes } from './routes/auth'
import { captureRoutes } from './routes/captures'
import { categoryRoutes } from './routes/categories'
import { connectionRoutes } from './routes/connections'
import { dashboardRoutes } from './routes/dashboard'
import { documentRoutes } from './routes/documents'
import { eventRoutes } from './routes/events'
import { historyRoutes } from './routes/history'
import { intelligenceRoutes } from './routes/intelligence'
import { magicalRoutes } from './routes/magical'
import { meRoutes } from './routes/me'
import { noteRoutes } from './routes/notes'
import { planRoutes } from './routes/plan'
import { reminderRoutes } from './routes/reminders'
import { reviewRoutes } from './routes/review'
import { searchRoutes } from './routes/search'
import { shoppingRoutes } from './routes/shopping'
import { taskRoutes } from './routes/tasks'

type Vars = { user: AuthUser }

const app = new Hono<{ Bindings: Env; Variables: Vars }>().basePath('/api')

app.use(
  '*',
  cors({
    origin: (origin) => origin || 'http://localhost:5173',
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
)

app.get('/health', (c) =>
  c.json({
    service: 'pocket-goblin',
    status: 'ok',
    environment: c.env.ENVIRONMENT,
  }),
)

app.route('/auth', authRoutes)

app.use('*', async (c, next) => {
  if (
    c.req.path.startsWith('/api/auth') ||
    c.req.path === '/api/health' ||
    c.req.path === '/api/connections/oauth/callback'
  ) {
    return next()
  }
  const user = await resolveUser(c.env.DB, c.env, c.req.header('Cookie'))
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  c.set('user', user)
  return next()
})

app.route('/me', meRoutes)
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

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default app
