import type { DocumentSuggestion } from './understand'

/**
 * Build a suggested study workload from a standalone university module.
 * These are proposed learning sessions, NOT assessment requirements or due
 * dates. Every specific activity is gated by words in the uploaded material.
 */
export function suggestModuleStudy(
  text: string,
  filename = '',
): DocumentSuggestion[] {
  const source = `${filename}\n${text}`
  const moduleMatch = source.match(/\bmodule\s*(\d{1,2})\b/i)
  if (
    !moduleMatch ||
    !/\b(?:university|mylearn|study|student|reading|learning|activity|reflection|course|assessment|lecture|tutorial)\b/i.test(
      source,
    )
  ) {
    return []
  }

  const moduleLabel = `Module ${moduleMatch[1]}`
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 5 && line.length <= 220)
  const find = (pattern: RegExp) =>
    lines.find((line) => pattern.test(line)) ??
    (pattern.test(text) ? text.slice(0, 160).replace(/\s+/g, ' ') : null)
  const moduleExcerpt = find(/\bmodule\s*\d+\b/i) ?? moduleLabel
  const study: Array<{ title: string; excerpt: string; note: string }> = []
  const add = (title: string, excerpt: string | null, note: string) => {
    if (excerpt && !study.some((item) => item.title === title)) {
      study.push({ title, excerpt: excerpt.slice(0, 160), note })
    }
  }

  add(
    `Read and work through ${moduleLabel} learning material`,
    moduleExcerpt,
    'Recommended starting step. Time estimate is a guide, not a requirement from your university.',
  )
  add(
    `Make notes on ${moduleLabel} key concepts`,
    find(
      /\b(?:definitions?|concepts?|theor(?:y|ies)|process(?:es)?|topics?|learning outcomes?)\b/i,
    ),
    'Suggested active-learning step; review the source material for what matters.',
  )
  add(
    `Complete ${moduleLabel} prescribed readings`,
    find(
      /\b(?:required|prescribed|essential|recommended)\s+readings?\b|\breadings?\b/i,
    ),
    'Check the module for the specific reading list; the Goblin has not invented references.',
  )
  add(
    `Complete ${moduleLabel} learning activities`,
    find(
      /\b(?:learning|module)\s+activities\b|\bactivity\s*\d+\b|\bactivities\s+to\s+complete\b/i,
    ),
    'Work through the activities stated in the module.',
  )
  add(
    `Complete ${moduleLabel} reflection exercise`,
    find(
      /\b(?:reflection|reflective)\s+(?:activity|exercise|questions?|task|journal)\b|\breflect\s+on\b|\breflection activities\b/i,
    ),
    'Use the actual reflection instructions in the source document.',
  )
  add(
    `Complete ${moduleLabel} quiz`,
    find(
      /\b(?:module|knowledge|self[- ]?check|practice)\s+quiz\b|\bquiz\s*\d*\b/i,
    ),
    'Use the quiz or self-check identified in the module.',
  )
  add(
    `Watch ${moduleLabel} lecture or video`,
    find(
      /\b(?:watch|view)\s+(?:the\s+)?(?:video|lecture|recording)\b|\b(?:video|lecture)\s+recording\b/i,
    ),
    'Follow the actual video or lecture link in the module.',
  )
  add(
    `Review your ${moduleLabel} notes and identify any questions`,
    moduleExcerpt,
    'Suggested consolidation step before marking the module complete.',
  )

  return study.slice(0, 8).map(({ title, excerpt, note }, index, all) => ({
    kind: 'suggestion',
    type: 'task',
    title,
    details: note,
    dueDate: null,
    confidence: 'medium',
    uncertain: false,
    missingInformation: [],
    sourceExcerpt: excerpt,
    categorySlug: 'work_study',
    group: 'Study module',
    step: `${index + 1}/${all.length}`,
  }))
}
