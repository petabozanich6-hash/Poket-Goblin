export type Env = {
  DB: D1Database
  ENVIRONMENT: string
  AUTH_SECRET?: string
  /** RFC 8292 VAPID public key, stored as a Worker secret. */
  VAPID_PUBLIC_KEY?: string
  /** RFC 8292 VAPID private scalar; NEVER expose to client. */
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
  /** Local Miniflare R2 or remote bucket (remote requires approval) */
  UPLOADS?: R2Bucket
  /** none | openai_compatible | workers_ai */
  AI?: Ai
  AI_DAILY_GLOBAL_LIMIT?: string
  /** Internal request context, set only by loadAiPolicy; never dashboard vars. */
  aiRequest?: {
    userId: string
    dailyLimit: number
    plan?: 'free' | 'premium' | 'owner_premium'
  }
  AI_PROVIDER?: string
  AI_API_KEY?: string
  AI_BASE_URL?: string
  AI_MODEL?: string
  /** Optional document-only Workers AI model. Never changes general brain dumps. */
  AI_DOCUMENT_MODEL?: string
  /** Max intelligence requests per user per UTC day */
  AI_DAILY_USER_LIMIT?: string
  GOOGLE_OAUTH_CLIENT_ID?: string
  GOOGLE_OAUTH_CLIENT_SECRET?: string
  MICROSOFT_OAUTH_CLIENT_ID?: string
  MICROSOFT_OAUTH_CLIENT_SECRET?: string
  /** Stripe secret key (Worker secret). Test keys (sk_test_…) until launch. */
  STRIPE_SECRET_KEY?: string
  /** Signing secret of the Stripe webhook endpoint (Worker secret). */
  STRIPE_WEBHOOK_SECRET?: string
  /** Price ids of the Premium product, made once in Stripe (vars). */
  STRIPE_PRICE_MONTHLY?: string
  STRIPE_PRICE_YEARLY?: string
  /** Must be "true" before live keys are used: real charges need approval. */
  STRIPE_LIVE_ENABLED?: string
  /** Opt-in after Cloudflare email sending is verified; legacy users stay unchanged. */
  EMAIL_VERIFICATION_REQUIRED?: string
  /** Cloudflare Email Service binding for account emails (optional). */
  EMAIL?: SendEmail
}
