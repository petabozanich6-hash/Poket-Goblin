import { interpretBrainDump, parseRelativeDate } from '../brainDump'
import type { GoblinSuggestion, IntelligenceResult } from './types'

function suggestionId(index: number, title: string): string {
  return `sug_${index}_${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 24)}`
}

function detectFollowUpCue(text: string): boolean {
  return /\b(emailed|email(ed)?|ordered|sent|applied|submitted|waiting (on|for)|heard back)\b/i.test(
    text,
  )
}

function detectVagueHorizon(text: string): boolean {
  return /\b(next month|soon|sometime|eventually|later this year|end of (the )?month)\b/i.test(
    text,
  )
}

/**
 * Rule-based goblin intelligence — labelled fallback when no AI credentials.
 * Never invents exact dates for vague horizons like "next month".
 */
export function interpretWithRules(
  rawText: string,
  now = new Date(),
): IntelligenceResult {
  const warnings: string[] = []
  const suggestions: GoblinSuggestion[] = []
  const parsed = interpretBrainDump(rawText, now)

  parsed.forEach((item, index) => {
    const missingInformation: string[] = []
    let uncertain = item.uncertain
    let dueDate = item.dueDate
    let kind = item.kind
    let title = item.title

    // Only scrub dates on the clause that is vague — not siblings in the same dump.
    if (detectVagueHorizon(item.title)) {
      dueDate = null
      uncertain = true
      missingInformation.push('Exact date needs confirmation')
      if (/\b(expire|expiry|registration|renewal)\b/i.test(item.title)) {
        kind = 'reminder'
        title = title.replace(/^Remember that\s+/i, '')
      }
    } else if (
      /\b(expire|expiry|registration|renewal)\b/i.test(item.title) &&
      detectVagueHorizon(rawText)
    ) {
      // Registration/expiry clauses often inherit "next month" from the dump.
      dueDate = null
      uncertain = true
      kind = 'reminder'
      missingInformation.push('Exact date needs confirmation')
      title = title.replace(/^Remember that\s+/i, '')
    }

    if (kind === 'appointment' && !dueDate) {
      missingInformation.push('Appointment date')
      uncertain = true
    }
    if (kind === 'reminder' && !dueDate) {
      missingInformation.push('Reminder date')
      uncertain = true
    }
    if (
      /\bby\s+(thursday|friday|monday|tuesday|wednesday|saturday|sunday)\b/i.test(
        item.title,
      ) &&
      !dueDate
    ) {
      // "by Thursday" should have been parsed from chunk; if not, mark uncertain
      uncertain = true
      missingInformation.push('Confirm deadline day')
    }

    suggestions.push({
      id: suggestionId(index, title),
      type: kind,
      title,
      details: '',
      dueDate,
      startTime: item.startTime,
      recurrenceFrequency: item.recurrenceFrequency,
      categorySlug: item.categorySlug,
      priority: kind === 'task' && dueDate ? 'high' : 'normal',
      capacityCost: kind === 'shopping' ? 1 : kind === 'note' ? 1 : 2,
      confidence: uncertain ? 'low' : item.confidence,
      uncertain,
      missingInformation,
      proposedAction: `Create ${kind}`,
      sourceReference: rawText.slice(0, 280),
      parentSuggestionId: null,
    })
  })

  // Follow-up offer when the dump describes an outbound action
  if (detectFollowUpCue(rawText)) {
    suggestions.push({
      id: suggestionId(suggestions.length, 'follow_up'),
      type: 'follow_up',
      title: 'Follow up if you have not heard back',
      details: 'Optional reminder — confirm a date before anything is created.',
      dueDate: null,
      startTime: null,
      recurrenceFrequency: null,
      categorySlug: 'admin',
      priority: 'normal',
      capacityCost: 1,
      confidence: 'medium',
      uncertain: true,
      missingInformation: ['Follow-up date'],
      proposedAction: 'Create follow-up reminder (after you confirm a date)',
      sourceReference: rawText.slice(0, 280),
      parentSuggestionId: null,
    })
    warnings.push(
      'A follow-up was suggested — confirm a date before accepting.',
    )
  }

  if (suggestions.some((s) => s.uncertain)) {
    warnings.push(
      'Some items need confirmation. The goblin will not invent missing dates.',
    )
  }

  const summary =
    suggestions.length === 0
      ? 'Nothing actionable found yet.'
      : `Found ${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} to review.`

  return {
    mode: 'rules',
    provider: 'rules',
    suggestions,
    summary,
    warnings,
  }
}

export function relativeDateOrNull(
  text: string,
  now = new Date(),
): string | null {
  return parseRelativeDate(text, now)
}
