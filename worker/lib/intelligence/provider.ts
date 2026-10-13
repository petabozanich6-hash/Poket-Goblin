import {
  breakdownTaskWithRules,
  interpretWithRules,
  validateSuggestions,
  type BreakdownLevel,
  type BreakdownResult,
  type IntelligenceResult,
} from '../../../shared/intelligence'
import type { Env } from '../../env'

export type ProviderKind = 'rules' | 'openai_compatible'

export function resolveProvider(env: Env): {
  kind: ProviderKind
  model: string | null
  configured: boolean
} {
  const name = (env.AI_PROVIDER ?? 'none').toLowerCase()
  const key = env.AI_API_KEY?.trim()
  if (name === 'openai_compatible' && key) {
    return {
      kind: 'openai_compatible',
      model: env.AI_MODEL?.trim() || 'gpt-4o-mini',
      configured: true,
    }
  }
  return { kind: 'rules', model: null, configured: false }
}

async function callOpenAiCompatible(
  env: Env,
  system: string,
  user: string,
): Promise<unknown> {
  const base = (env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(
    /\/$/,
    '',
  )
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.AI_MODEL?.trim() || 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`AI provider HTTP ${res.status}`)
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty AI response')
    return JSON.parse(content) as unknown
  } finally {
    clearTimeout(timer)
  }
}

const INTERPRET_SYSTEM = `You are Pocket Goblin's organisation engine.
Return JSON: {"suggestions":[...],"summary":"..."}.
Each suggestion needs: type (task|reminder|appointment|note|shopping|follow_up),
title, details, dueDate (YYYY-MM-DD or null), startTime (HH:mm or null),
categorySlug, confidence (low|medium|high), uncertain (boolean),
missingInformation (string[]), proposedAction, sourceReference.
Never invent exact dates. If ambiguous, set dueDate null and uncertain true.
Do not invent user facts. Output JSON only.`

export async function interpretIntelligence(
  env: Env,
  text: string,
  now = new Date(),
): Promise<IntelligenceResult> {
  const provider = resolveProvider(env)
  if (provider.kind === 'rules') {
    return interpretWithRules(text, now)
  }

  try {
    const raw = await callOpenAiCompatible(
      env,
      INTERPRET_SYSTEM,
      `Interpret this brain dump into suggestions:\n${text}`,
    )
    const obj = raw as { suggestions?: unknown; summary?: unknown }
    const suggestions = validateSuggestions(obj.suggestions)
    if (suggestions.length === 0) {
      const fallback = interpretWithRules(text, now)
      return {
        ...fallback,
        mode: 'ai_unavailable',
        provider: 'openai_compatible+rules_fallback',
        warnings: [
          ...fallback.warnings,
          'AI returned no valid suggestions; used rule-based fallback.',
        ],
      }
    }
    return {
      mode: 'ai',
      provider: 'openai_compatible',
      suggestions,
      summary:
        typeof obj.summary === 'string'
          ? obj.summary
          : `Found ${suggestions.length} suggestions.`,
      warnings: [],
    }
  } catch {
    const fallback = interpretWithRules(text, now)
    return {
      ...fallback,
      mode: 'ai_unavailable',
      provider: 'openai_compatible+rules_fallback',
      warnings: [
        ...fallback.warnings,
        'AI provider failed or timed out; used rule-based fallback.',
      ],
    }
  }
}

export async function breakdownIntelligence(
  env: Env,
  title: string,
  level: BreakdownLevel,
): Promise<BreakdownResult> {
  const provider = resolveProvider(env)
  // Breakdown uses rules until a dedicated AI schema path is configured.
  // When AI is configured we still prefer validated rules for predictability
  // unless explicitly expanded later.
  const result = breakdownTaskWithRules(title, level)
  if (provider.configured) {
    return {
      ...result,
      mode: 'ai_unavailable',
      provider: 'rules (AI breakdown schema reserved)',
      warnings: [
        ...result.warnings,
        'Task breakdown currently uses the labelled rule engine even when AI credentials exist.',
      ],
    }
  }
  return result
}
