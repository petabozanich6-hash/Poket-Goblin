import type { BreakdownLevel, BreakdownResult, GoblinSuggestion } from './types'

const TEMPLATES: Record<
  string,
  { match: RegExp; steps: Record<BreakdownLevel, string[]> }
> = {
  taxes: {
    match: /\b(tax|taxes|tax return|ato)\b/i,
    steps: {
      tiny: [
        'Open the folder or email inbox where tax documents live',
        'Find last year’s income summary if you have one',
        'Write down one question you need answered',
      ],
      normal: [
        'Gather income statements',
        'Find relevant receipts',
        'Review deductible expenses',
        'Check filing requirements',
        'Prepare information for an accountant or online form',
      ],
      detailed: [
        'Open your tax documents folder',
        'List employers or income sources for the year',
        'Collect payment summaries for each source',
        'Gather deductible expense receipts into one pile or folder',
        'Note any gaps you still need to fill',
        'Skim the filing deadline for your situation',
        'Choose: DIY online or send a pack to an accountant',
      ],
    },
  },
  cleaning: {
    match: /\b(clean(ing)? the house|tidy(ing)? up|housework)\b/i,
    steps: {
      tiny: [
        'Pick one room',
        'Set a 10-minute timer',
        'Clear surfaces into a basket',
      ],
      normal: [
        'Clear floors of laundry and clutter',
        'Wipe kitchen benches',
        'Empty bins',
        'Quick bathroom wipe-down',
        'Start one load of laundry',
      ],
      detailed: [
        'Put on shoes and open curtains',
        'Collect dishes into the sink',
        'Wipe kitchen benches',
        'Empty rubbish bins',
        'Tidy living-room surfaces into a basket',
        'Vacuum or sweep the main floor',
        'Wipe bathroom sink and mirror',
      ],
    },
  },
  generic: {
    match: /.*/,
    steps: {
      tiny: [
        'Name the first physical action (open, find, or write)',
        'Do only that action',
        'Stop and decide the next tiny step',
      ],
      normal: [
        'Clarify the outcome in one sentence',
        'List materials or information you need',
        'Do the smallest first step',
        'Park blockers on a note',
        'Decide the next session’s first step',
      ],
      detailed: [
        'Write the outcome in one sentence',
        'List what “done” looks like',
        'Gather tools or documents',
        'Remove one blocker',
        'Complete a 15-minute work burst',
        'Record what remains',
      ],
    },
  },
}

function pickTemplate(title: string) {
  for (const key of Object.keys(TEMPLATES)) {
    if (key === 'generic') continue
    const template = TEMPLATES[key]!
    if (template.match.test(title)) return template
  }
  return TEMPLATES.generic!
}

export function breakdownTaskWithRules(
  title: string,
  level: BreakdownLevel = 'normal',
): BreakdownResult {
  const template = pickTemplate(title)
  const lines = template.steps[level]
  const steps: GoblinSuggestion[] = lines.map((step, index) => ({
    id: `step_${index}_${step.slice(0, 16).replace(/\s+/g, '_')}`,
    type: 'breakdown_step' as const,
    title: step,
    details: `Suggested step for: ${title}`,
    dueDate: null,
    startTime: null,
    recurrenceFrequency: null,
    categorySlug: null,
    priority: 'normal' as const,
    capacityCost: level === 'tiny' ? 1 : 2,
    confidence: 'medium' as const,
    uncertain: false,
    missingInformation: [],
    proposedAction: 'Create task step (after you accept)',
    sourceReference: title,
    parentSuggestionId: null,
  }))

  return {
    mode: 'rules',
    provider: 'rules',
    originalTitle: title,
    level,
    steps,
    warnings: [
      'These are suggested starting steps, not assumptions about your exact situation.',
    ],
  }
}
