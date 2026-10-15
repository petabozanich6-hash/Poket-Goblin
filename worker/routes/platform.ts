import { Hono } from 'hono'

import type { Env } from '../env'
import { loadPlatformSettings } from '../lib/platformSettings'

export const platformRoutes = new Hono<{ Bindings: Env }>()

/**
 * Public, non-sensitive platform notices for every visitor: announcement,
 * maintenance message and whether registration is open. Nothing here reveals
 * configuration beyond what the UI shows anyway.
 */
platformRoutes.get('/status', async (c) => {
  const settings = await loadPlatformSettings(c.env.DB, c.env)
  c.header('Cache-Control', 'no-store')
  return c.json({
    announcement: settings.announcement.enabled
      ? {
          message: settings.announcement.message,
          tone: settings.announcement.tone,
        }
      : null,
    maintenance: settings.maintenance.enabled
      ? { message: settings.maintenance.message }
      : null,
    registrationsOpen: settings.features.registrationsOpen,
  })
})
