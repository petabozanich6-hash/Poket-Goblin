export type Env = {
  DB: D1Database
  ENVIRONMENT: string
  AUTH_SECRET?: string
  /** Local Miniflare R2 or remote bucket (remote requires approval) */
  UPLOADS?: R2Bucket
  /** none | openai_compatible | workers_ai */
  AI?: Ai
  AI_DAILY_GLOBAL_LIMIT?: string
  /** Internal request context, set only by loadAiPolicy; never dashboard vars. */
  aiRequest?: { userId: string; dailyLimit: number }
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
  /**
   * Stripe integration point (not implemented yet). Its presence only flips
   * Goblin HQ from "Stripe is not connected" to "arrives with integration".
   */
  STRIPE_SECRET_KEY?: string
  /** Cloudflare Email Service binding for account emails (optional). */
  EMAIL?: SendEmail
}
