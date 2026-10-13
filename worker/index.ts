import { Hono } from 'hono'
import { cors } from 'hono/cors'

import type { Env } from './env'
import { resolveUser, type AuthUser } from './lib/session'
import { authRoutes } from './routes/auth'
import { captureRoutes } from './routes/captures'
import { categoryRoutes } from './routes/categories'
import { meRoutes } from './routes/me'
import { planRoutes } from './routes/plan'
import { taskRoutes } from './routes/tasks'

type Vars = { user: AuthUser }

const app = new Hono<{ Bindings: Env; Variables: Vars }>().basePath('/api')

app.use(
  '*',
  cors({
    origin: (origin) => origin || 'http://localhost:5173',
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
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
  if (c.req.path.startsWith('/api/auth') || c.req.path === '/api/health') {
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

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default app
