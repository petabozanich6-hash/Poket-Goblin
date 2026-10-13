/**
 * Cloudflare Worker entry — placeholder for the future API layer.
 *
 * This stub exists so wrangler.toml has a valid main module.
 * Do not implement product APIs here until the Floot inventory
 * and schema migration plan are complete.
 *
 * See docs/ARCHITECTURE.md for Workers / D1 / R2 evaluation.
 */

export interface Env {
  ENVIRONMENT: string
  // DB: D1Database — bind after provisioning
  // UPLOADS: R2Bucket — bind after provisioning
  // ASSETS: Fetcher — bind when serving Vite build from Workers Assets
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    return Response.json({
      service: 'pocket-goblin',
      status: 'foundation',
      environment: env.ENVIRONMENT,
      message:
        'API surface not yet migrated. Import Floot backend next — see docs/MIGRATION_PLAN.md.',
    })
  },
}
