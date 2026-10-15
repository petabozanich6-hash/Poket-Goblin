// The SPA and API share one origin (Vite proxies /api in development), so
// browsers never need CORS. Only explicitly listed origins are echoed back.
// The same list decides which origins may perform administrative mutations
// and passkey ceremonies.
const PRODUCTION_ORIGINS: readonly string[] = ['https://pocketgoblin.org']
const DEVELOPMENT_ORIGINS: readonly string[] = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
]

export function allowedOrigins(environment: string): readonly string[] {
  return environment === 'production' ? PRODUCTION_ORIGINS : DEVELOPMENT_ORIGINS
}

export function allowedOrigin(
  origin: string,
  environment: string,
): string | null {
  return allowedOrigins(environment).includes(origin) ? origin : null
}
