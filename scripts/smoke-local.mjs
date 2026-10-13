#!/usr/bin/env node
/**
 * Smoke check that localhost is serving Sprint 1 (not a stale foundation build).
 * Run while `npm run dev` is up.
 */

const web = process.env.PG_WEB_URL || 'http://localhost:5173'
const api = process.env.PG_API_URL || 'http://127.0.0.1:8787'

async function main() {
  const health = await fetch(`${api}/api/health`)
  if (!health.ok) throw new Error(`API health failed: ${health.status}`)

  const routerSrc = await fetch(`${web}/src/app/router.tsx`)
  if (!routerSrc.ok)
    throw new Error(`Could not fetch router from Vite: ${routerSrc.status}`)
  const text = await routerSrc.text()

  if (text.includes('LandingPage')) {
    throw new Error(
      'Stale Vite is still serving LandingPage. Stop port 5173, rm -rf node_modules/.vite, npm run dev',
    )
  }
  if (!text.includes('AuthPage')) {
    throw new Error('Router does not reference AuthPage — unexpected build')
  }

  const html = await fetch(`${web}/`)
  const body = await html.text()
  if (!body.includes('Pocket Goblin')) {
    throw new Error('Root HTML missing Pocket Goblin title')
  }

  console.log(
    'Smoke OK: API healthy, Vite serving AuthPage router (not LandingPage).',
  )
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
