export type Env = {
  DB: D1Database
  ENVIRONMENT: string
  AUTH_SECRET?: string
  /** Local Miniflare R2 or remote bucket (remote requires approval) */
  UPLOADS?: R2Bucket
  /** none | openai_compatible */
  AI_PROVIDER?: string
  AI_API_KEY?: string
  AI_BASE_URL?: string
  AI_MODEL?: string
  /** Max intelligence requests per user per UTC day */
  AI_DAILY_USER_LIMIT?: string
  GOOGLE_OAUTH_CLIENT_ID?: string
  GOOGLE_OAUTH_CLIENT_SECRET?: string
  MICROSOFT_OAUTH_CLIENT_ID?: string
  MICROSOFT_OAUTH_CLIENT_SECRET?: string
}
