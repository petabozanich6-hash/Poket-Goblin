/** Narrow, review-only templates for everyday correspondence. No model calls. */
import { findDates, timeNear } from './dates'
import type {
  DocumentSuggestion,
  DocumentUnderstanding,
  UnderstandOptions,
} from './understand'

type Template = {
  pattern: RegExp
  title: string
  type: DocumentSuggestion['type']
  documentType: DocumentUnderstanding['documentType']
  category: string
}

const TEMPLATES: Template[] = [
  {
    pattern: /\b(?:please\s+)?(?:reply|respond|rsvp)\s+(?:by|before)\b/i,
    title: 'Reply to the message',
    type: 'task',
    documentType: 'general',
    category: 'personal',
  },
  {
    pattern:
      /\b(?:please\s+)?(?:complete|sign|return|submit)\s+(?:(?:and\s+return|the|this|attached|your|application|consent|permission)\s+)*(?:form|forms|application|documents|paperwork)\b/i,
    title: 'Complete and return the requested paperwork',
    type: 'task',
    documentType: 'form',
    category: 'personal',
  },
  {
    pattern:
      /\b(?:insurance|policy)\s+(?:renewal|expires)|\brenew\s+(?:your\s+)?(?:insurance|policy)\b/i,
    title: 'Review insurance renewal',
    type: 'task',
    documentType: 'insurance',
    category: 'money',
  },
  {
    pattern:
      /\b(?:licen[cs]e|passport|registration)\s+(?:renewal|expires)|\brenew\s+(?:your\s+)?(?:licen[cs]e|passport|registration)\b/i,
    title: 'Review official renewal',
    type: 'task',
    documentType: 'government',
    category: 'personal',
  },
  {
    pattern:
      /\b(?:please\s+)?(?:submit|return|complete)\s+(?:your\s+|the\s+)?timesheet\b/i,
    title: 'Submit timesheet',
    type: 'task',
    documentType: 'employment',
    category: 'work_study',
  },
  {
    pattern:
      /\b(?:job\s+interview\s+(?:on|at|scheduled|confirmed)|interview\s+(?:is\s+)?(?:scheduled|booked|confirmed))\b/i,
    title: 'Job interview',
    type: 'appointment',
    documentType: 'employment',
    category: 'work_study',
  },
  {
    pattern:
      /\b(?:delivery|parcel)\s+(?:is\s+)?(?:scheduled|expected|arriving|due)\b/i,
    title: 'Check expected delivery',
    type: 'reminder',
    documentType: 'general',
    category: 'home',
  },
  {
    pattern:
      /\b(?:please\s+)?(?:collect|pick\s+up)\s+(?:your\s+|the\s+)?(?:parcel|order|prescription)\b/i,
    title: 'Collect the requested item',
    type: 'task',
    documentType: 'general',
    category: 'personal',
  },
  {
    pattern:
      /\b(?:inspection|service\s+visit|repair\s+visit)\s+(?:is\s+)?(?:scheduled|booked|confirmed)\b/i,
    title: 'Inspection or service visit',
    type: 'appointment',
    documentType: 'appointment',
    category: 'home',
  },
]

// These require interpretation of the current state, not a new reminder.
const COMPLEX =
  /\b(?:cancelled|canceled|rescheduled|postponed|superseded|disregard|ignore|not\s+required|do\s+not|don't|already|if|unless|instead|previous|original)\b/i
const REQUEST =
  /\b(?:please|must|required|need\s+to|reply|respond|rsvp|submit|return|complete|sign|pay|renew|collect|pick\s+up|bring|confirm|book|call|contact|send|upload|attend)\b/i

/**
 * Only a small, plainly stated request is enough to bypass AI. Email headers
 * are not deadlines; quoted threads, contradictions and unrecognised request
 * lines fall through. Each action stays in review even if its date is clear.
 * Missing/ambiguous dates are left for the person, never guessed by a model.
 */
export function readEverydayDocument(
  text: string,
  options: UnderstandOptions = {},
): DocumentUnderstanding | null {
  if (text.length > 12_000 || COMPLEX.test(text)) return null
  if (
    /^\s*>|^-{2,}\s*(?:original|forwarded)|^On .+wrote:|^Begin forwarded/im.test(
      text,
    )
  )
    return null
  // Keep school/module planning and medical instructions on their own paths.
  if (
    /\b(?:module|assessment|university|school|patient|clinic|medical|fasting)\b/i.test(
      text,
    )
  )
    return null
  const dateOptions = { ...options, reference: options.reference ?? new Date() }
  const lines = text
    .replace(/\r/g, '')
    .split(/\n|(?<=[.!?])\s+(?=[A-Z])/)
    .map((line) => line.trim())
    .filter(Boolean)
  const suggestions: DocumentSuggestion[] = []
  let documentType: DocumentUnderstanding['documentType'] = 'general'
  let categorySlug: string | null = null
  for (const line of lines) {
    if (/^subject:/i.test(line) && REQUEST.test(line.slice(8))) return null
    if (/^(?:from|to|cc|bcc|sent|date|subject):/i.test(line)) continue
    const matches = TEMPLATES.filter((template) => template.pattern.test(line))
    // Multiple actions on one line can attach a date to the wrong action.
    if (matches.length > 1) return null
    const template = matches[0]
    if (!template) {
      if (REQUEST.test(line) || findDates(line, dateOptions).length) return null
      continue
    }
    // A recognised phrase must not hide a second, unsupported request.
    if (REQUEST.test(line.replace(template.pattern, ''))) return null
    const dates = findDates(line, dateOptions)
    if (dates.length > 1) return null
    // Do not turn an arrival window or alternative times into a fixed booking.
    if (
      template.type === 'appointment' &&
      [
        ...line.matchAll(
          /\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b/gi,
        ),
      ].length > 1
    )
      return null
    const date = dates[0]
    const action = template.pattern.exec(line)!
    if (date && date.index < action.index + action[0].length) return null
    const missingInformation: string[] = []
    if (!date || date.uncertain)
      missingInformation.push('Confirm the date against the message')
    const time =
      template.type === 'appointment' && date
        ? timeNear(line, date.index)
        : null
    if (template.type === 'appointment' && !time)
      missingInformation.push('Confirm the time')
    // Do not turn an inferred year or ambiguous numeric date into a due date.
    const dueDate = date && !date.uncertain ? date.iso : null
    const item: DocumentSuggestion = {
      kind: 'suggestion',
      type: template.type,
      title: template.title,
      details: 'Check the request against the original before adding it.',
      dueDate,
      startTime: time,
      confidence: 'medium',
      uncertain: true,
      requiresReview: true,
      missingInformation,
      sourceExcerpt: line.slice(0, 160),
      categorySlug: template.category,
      origin: 'rules',
    }
    if (
      !suggestions.some(
        (s) =>
          s.title === item.title &&
          s.dueDate === item.dueDate &&
          s.startTime === item.startTime &&
          s.sourceExcerpt === item.sourceExcerpt,
      )
    )
      suggestions.push(item)
    if (suggestions.length > 8) return null
    if (suggestions.length === 1) {
      documentType = template.documentType
      categorySlug = template.category
    } else if (documentType !== template.documentType) {
      documentType = 'general'
      categorySlug = null
    }
  }
  if (!suggestions.length) return null
  return {
    status: 'ready',
    documentType,
    categorySlug,
    facts: [],
    suggestions,
    summary: `I found ${suggestions.length} everyday action${suggestions.length === 1 ? '' : 's'} to check. Nothing has been added yet.`,
    warnings: suggestions.some((s) => s.missingInformation.length)
      ? ['Some dates or times need your confirmation.']
      : [],
  }
}
