import type { Confidence } from '../types'

export type ExtractedFact = {
  kind: 'fact'
  label: string
  value: string
  confidence: Confidence
  sourceExcerpt: string
}

export type DocumentSuggestion = {
  kind: 'suggestion'
  type: 'task' | 'reminder' | 'appointment' | 'note' | 'follow_up'
  title: string
  details: string
  dueDate: string | null
  confidence: Confidence
  uncertain: boolean
  missingInformation: string[]
  sourceExcerpt: string
  categorySlug: string | null
}

export type DocumentInterpretResult = {
  facts: ExtractedFact[]
  suggestions: DocumentSuggestion[]
  categorySlug: string | null
  warnings: string[]
  status: 'ready' | 'needs_ocr' | 'failed'
}

const MONEY = /\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/
const ISOISH =
  /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+\d{1,2}\s+\w+)/i

function detectCategory(text: string): string | null {
  const lower = text.toLowerCase()
  if (/\b(electric|energy|gas|water|bill|invoice|amount due)\b/.test(lower)) {
    return 'money'
  }
  if (
    /\b(school|excursion|permission|parent|classroom|homework)\b/.test(lower)
  ) {
    return 'family'
  }
  if (/\b(appointment|clinic|hospital|dentist|doctor|gp)\b/.test(lower)) {
    return 'health'
  }
  if (/\b(meeting|calendar|reschedule)\b/.test(lower)) return 'appointments'
  return null
}

/**
 * Rule-based document interpretation from extracted plain text.
 * Never invents amounts or dates that are not present as cues.
 */
export function interpretDocumentText(
  text: string,
  filename: string,
): DocumentInterpretResult {
  const trimmed = text.trim()
  const warnings: string[] = []
  if (!trimmed) {
    return {
      facts: [],
      suggestions: [],
      categorySlug: detectCategory(filename),
      warnings: [
        'No extractable text found. Scanned images need OCR (not configured).',
      ],
      status: 'needs_ocr',
    }
  }

  const facts: ExtractedFact[] = []
  const suggestions: DocumentSuggestion[] = []
  const categorySlug = detectCategory(trimmed) ?? detectCategory(filename)
  const lower = trimmed.toLowerCase()

  const amount = trimmed.match(
    new RegExp(
      `(?:amount\\s*due|total\\s*due|balance\\s*due|total)[:\\s]*(${MONEY.source})`,
      'i',
    ),
  )
  if (amount?.[1]) {
    facts.push({
      kind: 'fact',
      label: 'Amount',
      value: amount[1],
      confidence: 'high',
      sourceExcerpt: amount[0].slice(0, 120),
    })
  }

  const dueCue = trimmed.match(
    /(?:due\s*(?:date)?|payment\s*due|pay\s*by)[:\s]*([^\n.]{3,40})/i,
  )
  let dueDate: string | null = null
  let dueUncertain = false
  if (dueCue?.[1]) {
    facts.push({
      kind: 'fact',
      label: 'Due cue',
      value: dueCue[1].trim(),
      confidence: 'medium',
      sourceExcerpt: dueCue[0].slice(0, 120),
    })
    const iso = dueCue[1].match(/\d{4}-\d{2}-\d{2}/)
    if (iso) dueDate = iso[0]
    else {
      dueUncertain = true
      warnings.push('A due date cue was found but needs confirmation.')
    }
  }

  if (/\b(bill|invoice|amount due|electric|gas|water)\b/.test(lower)) {
    suggestions.push({
      kind: 'suggestion',
      type: 'task',
      title: `Pay ${filename.replace(/\.[^.]+$/, '') || 'bill'}`.slice(0, 200),
      details: amount?.[1] ? `Amount mentioned: ${amount[1]}` : '',
      dueDate,
      confidence: dueDate ? 'high' : 'medium',
      uncertain: dueUncertain || !dueDate,
      missingInformation: dueDate ? [] : ['Confirm due date'],
      sourceExcerpt: (dueCue?.[0] || amount?.[0] || trimmed.slice(0, 80)).slice(
        0,
        160,
      ),
      categorySlug: categorySlug ?? 'money',
    })
    suggestions.push({
      kind: 'suggestion',
      type: 'reminder',
      title: 'Reminder for bill payment',
      details: 'Optional reminder — confirm a date before creating.',
      dueDate,
      confidence: 'medium',
      uncertain: true,
      missingInformation: ['Reminder date'],
      sourceExcerpt: '',
      categorySlug: categorySlug ?? 'money',
    })
  }

  if (/\b(excursion|permission\s*form|school\s*trip)\b/.test(lower)) {
    suggestions.push({
      kind: 'suggestion',
      type: 'task',
      title: 'Complete permission form',
      details: 'Suggested from school notice text.',
      dueDate,
      confidence: 'medium',
      uncertain: !dueDate,
      missingInformation: dueDate ? [] : ['Confirm return deadline'],
      sourceExcerpt: trimmed.slice(0, 120),
      categorySlug: 'family',
    })
    if (ISOISH.test(trimmed)) {
      suggestions.push({
        kind: 'suggestion',
        type: 'appointment',
        title: 'School excursion',
        details: 'Date needs confirmation from the notice.',
        dueDate: null,
        confidence: 'low',
        uncertain: true,
        missingInformation: ['Confirm excursion date and time'],
        sourceExcerpt: trimmed.match(ISOISH)?.[0] ?? '',
        categorySlug: 'family',
      })
    }
  }

  if (
    /\b(appointment|clinic|please\s+attend|you\s+are\s+booked)\b/.test(lower)
  ) {
    suggestions.push({
      kind: 'suggestion',
      type: 'appointment',
      title: 'Appointment from letter',
      details: 'Confirm date, time and location from the letter.',
      dueDate: null,
      confidence: 'medium',
      uncertain: true,
      missingInformation: ['Confirm date', 'Confirm time', 'Confirm location'],
      sourceExcerpt: trimmed.slice(0, 140),
      categorySlug: categorySlug ?? 'health',
    })
  }

  if (suggestions.length === 0) {
    suggestions.push({
      kind: 'suggestion',
      type: 'note',
      title: `Note from ${filename}`.slice(0, 200),
      details: trimmed.slice(0, 400),
      dueDate: null,
      confidence: 'low',
      uncertain: false,
      missingInformation: [],
      sourceExcerpt: trimmed.slice(0, 80),
      categorySlug,
    })
  }

  return {
    facts,
    suggestions,
    categorySlug,
    warnings,
    status: 'ready',
  }
}

/** Extract readable text from UTF-8 plain files; PDFs/images need further stages. */
export function extractPlainText(
  bytes: Uint8Array,
  mime: string,
): { text: string; needsOcr: boolean } {
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'text/markdown'
  ) {
    return {
      text: new TextDecoder('utf-8').decode(bytes),
      needsOcr: false,
    }
  }
  if (mime === 'application/pdf') {
    // Lightweight extract of printable strings from simple text PDFs
    const raw = new TextDecoder('latin1').decode(bytes)
    const chunks: string[] = []
    const re = /\(([^)\\]|\\.)*\)/g
    let match: RegExpExecArray | null
    while ((match = re.exec(raw))) {
      const inner = match[0]
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\(.)/g, '$1')
      if (inner.trim().length > 1) chunks.push(inner)
    }
    const text = chunks.join(' ').replace(/\s+/g, ' ').trim()
    if (text.length < 20) {
      return { text: '', needsOcr: true }
    }
    return { text: text.slice(0, 20_000), needsOcr: false }
  }
  if (mime.startsWith('image/')) {
    return { text: '', needsOcr: true }
  }
  // docx is zip+xml — without a zip parser, mark as needs structured extract
  if (mime.includes('word')) {
    return { text: '', needsOcr: false }
  }
  return { text: '', needsOcr: true }
}
