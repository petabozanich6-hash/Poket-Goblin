export type Env = {
  DB: D1Database
  ENVIRONMENT: string
  AUTH_SECRET?: string
  /** none | openai_compatible */
  AI_PROVIDER?: string
  AI_API_KEY?: string
  AI_BASE_URL?: string
  AI_MODEL?: string
  /** Max intelligence requests per user per UTC day */
  AI_DAILY_USER_LIMIT?: string
}
