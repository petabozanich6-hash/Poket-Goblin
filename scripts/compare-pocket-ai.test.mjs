import { describe, expect, it } from 'vitest'
import {
  BENCHMARK_MODELS,
  comparePocket,
  evaluateDocument,
  FIXTURE,
  parseCandidateResponse,
} from './compare-pocket-ai.mjs'

describe('manual-only Cloudflare Workers AI comparison', () => {
  it('makes no provider calls on a dry run', async () => {
    const result = await comparePocket({ dryRun: true })
    expect(result).toMatchObject({
      dryRun: true,
      calls: 0,
      maximumCalls: 4,
      syntheticFixture: true,
    })
    expect(result.maxEstimatedGrossUsd).toBeLessThanOrEqual(0.15)
  })

  it('hard-codes only reviewed, Cloudflare-hosted models', () => {
    expect(Object.keys(BENCHMARK_MODELS)).toEqual([
      'baseline',
      'qwen',
      'gemma',
      'glm',
    ])
    expect(FIXTURE).toContain('30 November 2026')
  })

  it('requires grounded document items and both stated deadlines', () => {
    const response = {
      response: JSON.stringify({
        summary: 'Two assessments.',
        suggestions: [
          { title: 'Research essay', dueDate: '2026-11-30', sourceReference: 'Research essay (2000 words) due 30 November 2026 at 5 pm.' },
          { title: 'Group presentation', dueDate: '2026-12-12', sourceReference: 'Group presentation due 12 December 2026 at 2 pm.' },
        ],
      }),
    }
    expect(evaluateDocument(response)).toMatchObject({
      validJson: true,
      coveredBothDeadlines: true,
      groundedReferences: true,
      otherDatesToReview: [],
    })
  })

  it('flags invented dates and refuses JSON prose', () => {
    const result = evaluateDocument({
      response: JSON.stringify({
        suggestions: [
          { sourceReference: 'not in source', dueDate: '2027-01-01' },
        ],
      }),
    })
    expect(result.groundedReferences).toBe(false)
    expect(result.otherDatesToReview).toEqual(['2027-01-01'])
    expect(() => parseCandidateResponse({ response: 'Sure! {"suggestions":[]}' }))
      .toThrow()
  })
})
