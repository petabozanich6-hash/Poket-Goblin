/**
 * Rule-based understanding of life-admin paperwork. Deterministic, free, and
 * immune to instructions hidden in documents (it only pattern-matches). The
 * AI path, when configured, produces the same shape and is validated against
 * the same rules.
 *
 * Never invents amounts, dates or times: everything comes from the text.
 */
import type { Confidence } from '../types'
import { planDeadlines } from './deadlines'
import {
  addDays,
  dateAfterCue,
  findDates,
  timeNear,
  type FoundDate,
} from './dates'

export const DOCUMENT_TYPES = [
  'bill',
  'appointment',
  'medical',
  'education',
  'employment',
  'government',
  'insurance',
  'form',
  'general',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  bill: 'bill',
  appointment: 'appointment letter',
  medical: 'medical letter',
  education: 'school or study notice',
  employment: 'work document',
  government: 'official letter',
  insurance: 'insurance document',
  form: 'form to fill in',
  general: 'document',
}

export type SuggestionType =
  'task' | 'reminder' | 'appointment' | 'note' | 'follow_up'

export type DocumentSuggestion = {
  kind: 'suggestion'
  type: SuggestionType
  title: string
  details: string
  dueDate: string | null
  startTime?: string | null
  confidence: Confidence
  uncertain: boolean
  missingInformation: string[]
  sourceExcerpt: string
  categorySlug: string | null
  /** 'high' puts it at the top of the list ("do this straight away"). */
  priority?: 'high' | 'normal'
  urgent?: boolean
  /** The deadline this belongs to, so a plan can be shown and added together. */
  group?: string
  /** "2/5": which step of the plan. */
  step?: string
  /** Suggested study sessions are reviewed as one plan before being applied. */
  requiresReview?: boolean
  /** 'ai' when a model suggested it: never added without the person's OK. */
  origin?: 'ai' | 'rules'
}

export type ExtractedFact = {
  kind: 'fact'
  label: string
  value: string
  confidence: Confidence
  sourceExcerpt: string
}

export type DocumentUnderstanding = {
  documentType: DocumentType
  /** The goblin's one-line explanation, e.g. "I've found an electricity bill…" */
  summary: string
  facts: ExtractedFact[]
  suggestions: DocumentSuggestion[]
  categorySlug: string | null
  warnings: string[]
  status: 'ready' | 'needs_ocr' | 'failed'
}

type Signal = { type: DocumentType; score: number }

const PATTERNS: Record<Exclude<DocumentType, 'general'>, RegExp[]> = {
  bill: [
    /\b(amount\s+due|total\s+due|balance\s+due|please\s+pay|payment\s+due|invoice|bill(?:ing)?\s+(?:period|date)|account\s+(?:number|no)|direct\s+debit|tax\s+invoice|statement\s+of\s+account)\b/i,
    /\b(electricity|energy|gas|water|internet|broadband|phone|mobile|council\s+tax|rates|rent)\b/i,
  ],
  medical: [
    /\b(doctor|dr\.?|gp|clinic|hospital|surgery|dentist|dental|physio\w*|specialist|consultant|patient|nhs|medicare|pharmacy|prescription|referral|vaccinat\w+|blood\s+test|scan|x-ray)\b/i,
  ],
  appointment: [
    /\b(appointment|you\s+are\s+booked|booked\s+(?:in\s+)?for|please\s+attend|consultation|scheduled\s+for|your\s+visit|check-?in)\b/i,
  ],
  education: [
    /\b(school|excursion|permission\s+(?:slip|form|note)|parent|guardian|teacher|classroom|term\s+\d|semester|university|college|enrol\w*|tuition|course|assignment|exam(?:ination)?|campus|student)\b/i,
  ],
  employment: [
    /\b(employ(?:er|ee|ment)|payslip|pay\s+slip|salary|wages|contract\s+of\s+employment|offer\s+letter|job\s+offer|interview|roster|shift|probation|resignation|human\s+resources|\bhr\b|onboarding|timesheet)\b/i,
  ],
  government: [
    /\b(government|department\s+of|ministry|council|tax\s+(?:return|office|assessment)|hmrc|irs|cra|ato|revenue\s+(?:agency|service)|licen[cs]e|passport|visa|immigration|registration\s+(?:renewal|expiry)|fine|penalty\s+notice|parking\s+(?:fine|ticket)|court|jury|electoral|census|benefit|social\s+security|centrelink|dvla|dmv)\b/i,
  ],
  insurance: [
    /\b(insurance|insurer|policy\s+(?:number|no|schedule)|premium|renewal\s+notice|claim\s+(?:number|no)|excess|deductible|cover(?:age)?\s+(?:starts|ends|period))\b/i,
  ],
  form: [
    /\b(please\s+(?:complete|fill\s+(?:in|out)|sign)|sign\s+and\s+return|return\s+this\s+form|complete\s+(?:the|this)\s+(?:attached\s+)?form|application\s+form|consent\s+form|tick\s+(?:the\s+)?box)\b/i,
  ],
}

const CATEGORY_FOR: Record<DocumentType, string | null> = {
  bill: 'money',
  appointment: 'appointments',
  medical: 'health',
  education: 'work_study',
  employment: 'work_study',
  government: 'personal',
  insurance: 'money',
  form: 'personal',
  general: null,
}

export function classifyDocument(text: string, filename = ''): DocumentType {
  const haystack = `${filename}\n${text}`
  const signals: Signal[] = []
  for (const [type, patterns] of Object.entries(PATTERNS) as [
    Exclude<DocumentType, 'general'>,
    RegExp[],
  ][]) {
    let score = 0
    for (const pattern of patterns) {
      const re = new RegExp(pattern.source, 'gi')
      score += Math.min(4, [...haystack.matchAll(re)].length)
    }
    if (score > 0) signals.push({ type, score })
  }
  if (signals.length === 0) return 'general'
  // Medical appointments are medical; a booked medical visit beats a bill.
  const by = (t: DocumentType) => signals.find((s) => s.type === t)?.score ?? 0
  if (by('medical') >= 2 && by('appointment') >= 1) return 'medical'
  if (by('bill') >= 2 && by('bill') >= by('insurance')) return 'bill'
  signals.sort((a, b) => b.score - a.score)
  return signals[0]!.type
}

const MONEY =
  /(?:(?:[$€£¥₹]|A\$|NZ\$|C\$|US\$|R\$|AUD|USD|GBP|EUR|CAD|NZD|INR|JPY)\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*(?:\.\d{2})?\s?(?:AUD|USD|GBP|EUR|CAD|NZD|INR|JPY|€|£))/

function findAmount(text: string): { value: string; excerpt: string } | null {
  const cued = text.match(
    new RegExp(
      `(?:amount\\s*(?:due|owing|payable)|total\\s*(?:due|amount|payable)?|balance\\s*(?:due)?|please\\s+pay|to\\s+pay)[^\\n\\d$€£¥₹A-Z]{0,20}(${MONEY.source})`,
      'i',
    ),
  )
  if (cued?.[1]) return { value: cued[1].trim(), excerpt: cued[0].trim() }
  const any = text.match(MONEY)
  return any ? { value: any[0].trim(), excerpt: any[0].trim() } : null
}

function billKind(text: string): string {
  // Most specific first: "Bright Energy … electricity bill" is electricity.
  const kinds = [
    'electricity',
    'gas',
    'water',
    'internet',
    'broadband',
    'mobile',
    'phone',
    'council tax',
    'rates',
    'rent',
    'energy',
  ]
  const lower = text.toLowerCase()
  return kinds.find((k) => new RegExp(`\\b${k}\\b`).test(lower)) ?? ''
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  // Locale-neutral, unambiguous: "28 October 2026" style is read worldwide.
  return `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`
}

function excerptAround(text: string, index: number, length = 140): string {
  // Start and end on word boundaries so quotes never begin mid-word.
  let start = Math.max(0, index - 40)
  if (start > 0) {
    const space = text.slice(start, index).search(/\s/)
    start = space >= 0 ? start + space + 1 : index
  }
  let end = Math.min(text.length, start + length)
  if (end < text.length) {
    const lastSpace = text.slice(start, end).search(/\s\S*$/)
    if (lastSpace > 0) end = start + lastSpace
  }
  return text.slice(start, end).replace(/\s+/g, ' ').trim()
}

function dateMissing(date: FoundDate | null, what: string): string[] {
  if (!date) return [what]
  return date.uncertain ? [date.reason ? `${what}: ${date.reason}` : what] : []
}

export type UnderstandOptions = {
  /** Today in the user's time zone. */
  reference?: Date
  /** Locale writes month first (e.g. en-US), for numeric dates. */
  monthFirst?: boolean
  dailyLoad?: Record<string, number>
  capacityMode?: 'goblin' | 'steady' | 'quest'
  planningApproach?: 'minimal' | 'balanced' | 'ambitious'
}

export function understandDocument(
  rawText: string,
  filename: string,
  options: UnderstandOptions = {},
): DocumentUnderstanding {
  const text = rawText.replace(/\r/g, '').trim()
  const reference = options.reference ?? new Date()
  if (!text) {
    return {
      documentType: 'general',
      summary: 'I couldn’t find any readable text in this one.',
      facts: [],
      suggestions: [],
      categorySlug: null,
      warnings: ['No readable text found.'],
      status: 'needs_ocr',
    }
  }

  const documentType = classifyDocument(text, filename)
  const categorySlug = CATEGORY_FOR[documentType]
  const dates = findDates(text, { reference, monthFirst: options.monthFirst })
  const due = dateAfterCue(text, dates, 'due')
  const event = dateAfterCue(text, dates, 'event')
  const amount = findAmount(text)
  const facts: ExtractedFact[] = []
  const suggestions: DocumentSuggestion[] = []
  const warnings: string[] = []

  if (amount) {
    facts.push({
      kind: 'fact',
      label: 'Amount',
      value: amount.value,
      confidence: 'high',
      sourceExcerpt: amount.excerpt.slice(0, 120),
    })
  }
  if (due) {
    facts.push({
      kind: 'fact',
      label: 'Deadline',
      value: due.text,
      confidence: due.uncertain ? 'medium' : 'high',
      sourceExcerpt: excerptAround(text, due.index),
    })
  }
  if (event && event !== due) {
    facts.push({
      kind: 'fact',
      label: 'Date',
      value: event.text,
      confidence: event.uncertain ? 'medium' : 'high',
      sourceExcerpt: excerptAround(text, event.index),
    })
  }
  for (const d of [due, event]) {
    if (d?.uncertain && d.reason) warnings.push(`Check the date: ${d.reason}.`)
  }

  const suggest = (
    s: Omit<DocumentSuggestion, 'kind' | 'categorySlug'> & {
      categorySlug?: string | null
    },
  ) =>
    suggestions.push({
      kind: 'suggestion',
      categorySlug: categorySlug ?? null,
      ...s,
    })

  let summary: string
  switch (documentType) {
    case 'bill': {
      const kind = billKind(text)
      const what = kind ? `${kind} bill` : 'bill'
      const label = what.charAt(0).toUpperCase() + what.slice(1)
      summary = `I've found ${/^[aeiou]/i.test(what) ? 'an' : 'a'} ${what}${amount ? ` for ${amount.value}` : ''}${due ? ` due on ${formatDay(due.iso)}` : ''}.${due ? ' Want me to add a reminder and put paying it on your task list?' : ' I couldn’t spot a due date — check it before I add anything.'}`
      suggest({
        type: 'task',
        title: `Pay ${what}`,
        details: amount ? `Amount: ${amount.value}` : '',
        dueDate: due?.iso ?? null,
        confidence: due && !due.uncertain ? 'high' : 'medium',
        uncertain: !due || due.uncertain,
        missingInformation: dateMissing(due, 'Confirm the due date'),
        sourceExcerpt: (due
          ? excerptAround(text, due.index)
          : (amount?.excerpt ?? '')
        ).slice(0, 160),
      })
      if (due) {
        const before = addDays(due.iso, -3)
        const today = reference.toISOString().slice(0, 10)
        suggest({
          type: 'reminder',
          title: `${label} due ${formatDay(due.iso)}`,
          details: 'A nudge a few days before it is due.',
          dueDate: before >= today ? before : due.iso,
          startTime: '09:00',
          confidence: 'medium',
          uncertain: due.uncertain,
          missingInformation: dateMissing(due, 'Confirm the due date'),
          sourceExcerpt: excerptAround(text, due.index).slice(0, 160),
        })
      }
      break
    }
    case 'appointment':
    case 'medical': {
      const when = event ?? due ?? dates[0] ?? null
      const time = when ? timeNear(text, when.index) : null
      const who =
        documentType === 'medical' ? 'medical appointment' : 'appointment'
      summary = `This looks like ${documentType === 'medical' ? 'a medical letter' : 'an appointment letter'}${when ? ` for ${formatDay(when.iso)}${time ? ` at ${time}` : ''}` : ''}.${when ? ' Shall I put it in your calendar?' : ' I couldn’t find the date — check the letter and I’ll add it.'}`
      suggest({
        type: 'appointment',
        title:
          documentType === 'medical' ? 'Medical appointment' : 'Appointment',
        details: 'Check the place and anything to bring from the letter.',
        dueDate: when?.iso ?? null,
        startTime: time,
        confidence: when && !when.uncertain ? 'high' : 'low',
        uncertain: !when || when.uncertain || !time,
        missingInformation: [
          ...dateMissing(when, 'Confirm the date'),
          ...(time ? [] : ['Confirm the time']),
        ],
        sourceExcerpt: (when
          ? excerptAround(text, when.index)
          : text.slice(0, 140)
        ).slice(0, 160),
        categorySlug: documentType === 'medical' ? 'health' : 'appointments',
      })
      if (
        when &&
        /\b(fast(?:ing)?|bring|arrive\s+\d+\s+minutes|referral|medicare|insurance\s+card|photo\s+id)\b/i.test(
          text,
        )
      ) {
        suggest({
          type: 'task',
          title: `Prepare for ${who}`,
          details: 'The letter mentions something to bring or do beforehand.',
          dueDate: addDays(when.iso, -1),
          confidence: 'medium',
          uncertain: true,
          missingInformation: ['Check what to bring'],
          sourceExcerpt:
            text
              .match(
                /[^.\n]*\b(fast(?:ing)?|bring|arrive\s+\d+\s+minutes|referral)\b[^.\n]*/i,
              )?.[0]
              ?.slice(0, 160) ?? '',
          categorySlug: documentType === 'medical' ? 'health' : 'appointments',
        })
      }
      break
    }
    case 'education': {
      const hasForm =
        PATTERNS.form.some((p) => p.test(text)) || /\bpermission\b/i.test(text)
      const parent = /\b(parent|guardian|your\s+child|son|daughter)\b/i.test(
        text,
      )
      const category = parent ? 'family' : 'work_study'
      summary = `This is a ${parent ? 'school notice' : 'study notice'}${due ? ` with a deadline of ${formatDay(due.iso)}` : ''}${event && event !== due ? ` about something on ${formatDay(event.iso)}` : ''}.`
      if (hasForm || due) {
        suggest({
          type: 'task',
          title: hasForm
            ? 'Complete and return the form'
            : 'Deal with school notice',
          details: '',
          dueDate: due?.iso ?? null,
          confidence: due ? 'medium' : 'low',
          uncertain: !due || due.uncertain,
          missingInformation: dateMissing(due, 'Confirm the deadline'),
          sourceExcerpt: (due
            ? excerptAround(text, due.index)
            : text.slice(0, 140)
          ).slice(0, 160),
          categorySlug: category,
        })
      }
      if (event && event !== due) {
        suggest({
          type: 'appointment',
          title: /excursion|trip/i.test(text)
            ? 'School excursion'
            : 'School or study event',
          details: '',
          dueDate: event.iso,
          startTime: timeNear(text, event.index),
          confidence: event.uncertain ? 'low' : 'medium',
          uncertain: true,
          missingInformation: dateMissing(event, 'Confirm the date and time'),
          sourceExcerpt: excerptAround(text, event.index).slice(0, 160),
          categorySlug: category,
        })
      }
      break
    }
    case 'employment': {
      const interview = /\binterview\b/i.test(text)
      const when = interview ? (event ?? dates[0] ?? null) : due
      summary = interview
        ? `This looks like an interview invitation${when ? ` for ${formatDay(when.iso)}` : ''}.`
        : `This looks like a work document${due ? ` with a deadline of ${formatDay(due.iso)}` : ''}.`
      suggest({
        type: interview ? 'appointment' : 'task',
        title: interview
          ? 'Job interview'
          : /\bcontract|offer\b/i.test(text)
            ? 'Review and sign the work contract'
            : 'Deal with work document',
        details: '',
        dueDate: when?.iso ?? null,
        startTime: interview && when ? timeNear(text, when.index) : null,
        confidence: when ? 'medium' : 'low',
        uncertain: !when || when.uncertain,
        missingInformation: dateMissing(
          when,
          interview ? 'Confirm the date and time' : 'Confirm the deadline',
        ),
        sourceExcerpt: (when
          ? excerptAround(text, when.index)
          : text.slice(0, 140)
        ).slice(0, 160),
      })
      break
    }
    case 'government':
    case 'insurance':
    case 'form': {
      const noun =
        documentType === 'insurance'
          ? /\brenew/i.test(text)
            ? 'insurance renewal'
            : 'insurance letter'
          : documentType === 'form'
            ? 'form'
            : 'official letter'
      summary = `This is ${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}${amount ? ` mentioning ${amount.value}` : ''}${due ? ` with a deadline of ${formatDay(due.iso)}` : ''}. I won’t submit or pay anything — I can just remind you.`
      suggest({
        type: 'task',
        title:
          documentType === 'form'
            ? 'Complete and return the form'
            : documentType === 'insurance'
              ? /\brenew/i.test(text)
                ? 'Review insurance renewal'
                : 'Check insurance letter'
              : 'Respond to official letter',
        details: amount ? `Amount mentioned: ${amount.value}` : '',
        dueDate: due?.iso ?? null,
        confidence: due ? 'medium' : 'low',
        uncertain: !due || due.uncertain,
        missingInformation: dateMissing(due, 'Confirm the deadline'),
        sourceExcerpt: (due
          ? excerptAround(text, due.index)
          : text.slice(0, 140)
        ).slice(0, 160),
      })
      if (due) {
        suggest({
          type: 'reminder',
          title: `${noun.charAt(0).toUpperCase() + noun.slice(1)} deadline`,
          details: '',
          dueDate:
            addDays(due.iso, -3) >= reference.toISOString().slice(0, 10)
              ? addDays(due.iso, -3)
              : due.iso,
          startTime: '09:00',
          confidence: 'medium',
          uncertain: due.uncertain,
          missingInformation: dateMissing(due, 'Confirm the deadline'),
          sourceExcerpt: excerptAround(text, due.index).slice(0, 160),
        })
      }
      break
    }
    default: {
      const when = due ?? dates[0] ?? null
      summary = when
        ? `I read it and spotted a date (${formatDay(when.iso)}), but I’m not sure what it’s for.`
        : 'I read it but didn’t spot anything that needs doing.'
      suggest({
        type: 'note',
        title:
          `Notes from ${filename.replace(/\.[^.]+$/, '') || 'document'}`.slice(
            0,
            200,
          ),
        details: text.slice(0, 400),
        dueDate: null,
        confidence: 'low',
        uncertain: false,
        missingInformation: [],
        sourceExcerpt: text.slice(0, 80),
      })
      if (when) {
        suggest({
          type: 'reminder',
          title:
            `Check ${filename.replace(/\.[^.]+$/, '') || 'document'}`.slice(
              0,
              200,
            ),
          details: '',
          dueDate: when.iso,
          startTime: '09:00',
          confidence: 'low',
          uncertain: true,
          missingInformation: ['Confirm what this date is for'],
          sourceExcerpt: excerptAround(text, when.index).slice(0, 160),
        })
      }
    }
  }

  return {
    documentType,
    summary,
    facts,
    suggestions,
    categorySlug,
    warnings,
    status: 'ready',
  }
}

/**
 * Swap in the deadline planner when a document has real deadlines to work
 * towards (anything except a single bill or appointment, which the readers
 * above already handle well), and always surface urgent parts.
 */
export function withDeadlinePlan<
  U extends Pick<
    DocumentUnderstanding,
    'documentType' | 'summary' | 'suggestions' | 'warnings' | 'categorySlug'
  >,
>(
  understanding: U,
  text: string,
  options: UnderstandOptions & { fromAi?: boolean } = {},
): U {
  const plan = planDeadlines(text.replace(/\r/g, ''), {
    reference: options.reference ?? new Date(),
    monthFirst: options.monthFirst,
    categorySlug: understanding.categorySlug,
    dailyLoad: options.dailyLoad,
    capacityMode: options.capacityMode,
    planningApproach: options.planningApproach,
  })
  if (!plan) return understanding
  // Nothing dated, but worth saying what it contains (e.g. an outline).
  // Its own guesses (e.g. "Pay phone bill" from a passing mention) would
  // only add noise.
  if (plan.deadlines.length === 0 && plan.suggestions.length === 0)
    return {
      ...understanding,
      documentType: 'education',
      summary: plan.summary,
      suggestions: [],
    }
  const simple = ['bill', 'appointment', 'medical'].includes(
    understanding.documentType,
  )
  const hasStudySessions = plan.suggestions.some(
    (s) => s.requiresReview && s.group?.startsWith('Week '),
  )
  if (
    hasStudySessions ||
    plan.deadlines.length >= 2 ||
    (plan.deadlines.length === 1 && !simple)
  ) {
    // When the AI read it too, its plain-language description leads, and
    // any dated item it spotted that the plan doesn't have joins "check
    // these" (AI items are never added automatically).
    const ai = understanding.suggestions.filter((s) => s.origin === 'ai')
    const planned = new Set(
      plan.suggestions.map((s) => s.dueDate).filter(Boolean),
    )
    const extras = ai
      .filter((s) => s.dueDate && !planned.has(s.dueDate))
      .map((s) => ({ ...s, group: 'Also spotted', uncertain: true }))
    return {
      ...understanding,
      summary: options.fromAi
        ? `${understanding.summary} ${plan.summary}`
        : plan.summary,
      suggestions: [...plan.suggestions, ...extras],
      warnings: [...understanding.warnings, ...plan.warnings],
    }
  }
  const urgent = plan.suggestions.filter((s) => s.group === 'Urgent')
  if (!urgent.length && !plan.deadlines.some((d) => d.urgent))
    return understanding
  return {
    ...understanding,
    summary: urgent.length
      ? `${understanding.summary} Part of it is urgent, so I’ve put that on today.`
      : `${understanding.summary} It’s marked urgent, so it’s at the top of your list.`,
    suggestions: [
      ...urgent,
      ...understanding.suggestions.map((s) =>
        s.type === 'task' ? { ...s, priority: 'high' as const } : s,
      ),
    ],
  }
}
