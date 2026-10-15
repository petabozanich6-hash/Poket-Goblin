// The SPA and API share one origin (Vite proxies /api in development), so
// browsers never need CORS. Only explicitly listed origins are echoed back.
const PRODUCTION_ORIGINS: readonly string[] = ['https://pocketgoblin.org']
const DEVELOPMENT_ORIGINS: readonly string[] = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

export function allowedOrigin(
  origin: string,
  environment: string,
): string | null {
  const list =
    environment === 'production' ? PRODUCTION_ORIGINS : DEVELOPMENT_ORIGINS
  return list.includes(origin) ? origin : null
}
