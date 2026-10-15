/**
 * Match what someone said ("the milk", "electric bill", "that dentist
 * appointment") against their own records ("Buy milk", "Pay electricity
 * bill", "Dentist").
 *
 * Returns the best candidate only when it is clearly better than the rest;
 * otherwise reports ambiguity so the Goblin can ask one question instead of
 * guessing.
 */

const STOP = new Set([
  'the',
  'a',
  'an',
  'my',
  'our',
  'some',
  'that',
  'this',
  'those',
  'these',
  'of',
  'for',
  'to',
  'and',
  'with',
  'from',
  'on',
  'at',
  'in',
  'up',
  'off',
  'it',
  'please',
  // Verbs that usually start a title but not a thing.
  'buy',
  'get',
  'pay',
  'call',
  'ring',
  'phone',
  'book',
  'finish',
  'do',
  'send',
  'pick',
  'grab',
  'return',
  'submit',
  'email',
  'renew',
  'make',
  'go',
  'visit',
  'attend',
  'check',
])

const SYNONYMS: Record<string, string> = {
  electric: 'electricity',
  power: 'electricity',
  mom: 'mum',
  mother: 'mum',
  dad: 'dad',
  doc: 'doctor',
  gp: 'doctor',
  dentists: 'dentist',
  appt: 'appointment',
  assignments: 'assignment',
  groceries: 'grocery',
}

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => SYNONYMS[w] ?? w)
    .map((w) => (w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w))
    .map((w) =>
      w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w,
    )
}

/** 0–1: how well `query` names `title`. All query words present scores high. */
export function similarity(query: string, title: string): number {
  const q = new Set(words(query))
  const t = new Set(words(title))
  if (q.size === 0 || t.size === 0) return 0
  let hits = 0
  for (const w of q) if (t.has(w)) hits += 1
  if (hits === 0) return 0
  const recall = hits / q.size
  const precision = hits / t.size
  return 0.7 * recall + 0.3 * precision
}

export type Candidate = { id: string; title: string; type: string }

export type MatchResult<C extends Candidate> =
  | { kind: 'none' }
  | { kind: 'one'; match: C; score: number }
  | { kind: 'many'; matches: C[] }

export const MATCH_THRESHOLD = 0.6

export function bestMatch<C extends Candidate>(
  query: string,
  candidates: C[],
): MatchResult<C> {
  const scored = candidates
    .map((c) => ({ c, score: similarity(query, c.title) }))
    .filter((s) => s.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
  if (scored.length === 0) return { kind: 'none' }
  const [first, second] = scored
  if (!second || first!.score - second.score >= 0.15) {
    return { kind: 'one', match: first!.c, score: first!.score }
  }
  const close = scored
    .filter((s) => first!.score - s.score < 0.15)
    .map((s) => s.c)
  return { kind: 'many', matches: close.slice(0, 4) }
}
