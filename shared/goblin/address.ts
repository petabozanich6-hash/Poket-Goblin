/**
 * How people talk *to* their Goblin, separated from what they want done.
 *
 * "Oi Goblin, milk", "Excuse me, good sir Mr Goblin, might I trouble you
 * for…", "Yo Gobbo, sort my life out" and plain "Milk" all carry the same
 * request. This strips the greeting, the honorifics, whatever names the
 * person has given their Goblin and the politeness wrapper, so the request
 * underneath reaches the same understanding every time.
 *
 * Nothing here is a required phrase: an utterance with no name and no
 * greeting passes through unchanged.
 */

/** Names the Goblin always answers to, whatever else the person calls it. */
export const BUILT_IN_NAMES = ['goblin']

// Words that only ever greet or get attention. Stripped from the start.
// The weaker ones ("morning", "right") also start real requests ("morning
// appointment…"), so they only count when punctuation or a name follows.
const GREETING =
  /^(?:(?:oi+|oy|hey+|hi+|hiya|hello|hallo|yo+|ahoy|howdy|heya|g'?day|um+|uh+|er+m?|good\s+(?:morning|afternoon|evening|day)|excuse\s+me|pardon\s+me)\b[\s,!.:;-]*|(?:morning|afternoon|evening|cheers|okay|ok|right|so|listen|look|sorry|please|aye|ey)\s*[,!.:;-]+\s*)/i

// Forms of address that only count when a name follows them.
const HONORIFIC =
  /^(?:morning|afternoon|evening|right|okay|ok|so|well|o|oh|my|our|good|dear|dearest|most|esteemed|honou?rable|noble|mighty|great|wise|wonderful|lovely|beloved|trusty|faithful|old|little|kind|sweet|sir|mr\.?|mister|mrs\.?|ms\.?|miss|madam|madame|lord|lady|master|mistress|captain|king|queen|prince|princess|dame|duke|baron|professor|doctor|dr\.?|the)\b[\s,]*/i

// Said after the name: "Goblin, mate, what…"
const AFTER_NAME =
  /^(?:mate|buddy|pal|my\s+(?:friend|dude|man|mate|guy|love)|old\s+(?:friend|chap|bean|sport)|friend|dude|love|bro|fam|chief|boss)\b[\s,!.:;-]*/i

// Politeness that wraps a request without changing it.
const WRAPPER =
  /^(?:(?:would|could|can|will)\s+you\s+(?:please\s+|kindly\s+)?(?:be\s+so\s+kind\s+as\s+to|be\s+a\s+dear\s+and|care\s+to|mind|possibly|kindly|just)?|(?:might|may|could|can)\s+i\s+(?:please\s+)?(?:trouble|bother)\s+you\s+(?:for|to)|i\s+(?:was|am)\s+wondering\s+if\s+you\s+(?:could|would|might)|do\s+me\s+a\s+favou?r\s+and|be\s+a\s+dear\s+and|if\s+you\s+(?:would|could|please)|i'?d\s+(?:like|love)\s+(?:you\s+to|it\s+if\s+you)|kindly|please|pretty\s+please)\b[\s,]*/i

const TRAILING =
  /[\s,]+(?:please|thanks|thank\s+you|ta|cheers|mate|buddy|pal|if\s+you\s+(?:would|please|could)|my\s+(?:friend|good\s+\w+|dear\s+\w+)|thx)\s*[.!?]*$/i

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Configured names plus the built-in ones, longest first, de-duplicated. */
export function addressNames(names: readonly string[] = []): string[] {
  const all = [...names, ...BUILT_IN_NAMES]
    .map(normaliseName)
    .filter((n) => n.length >= 2 && n.length <= 40)
  return [...new Set(all)].sort((a, b) => b.length - a.length)
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The name as it might come out of speech recognition: case, possessive, a doubled letter. */
function namePattern(name: string): string {
  const parts = name.split(' ').map((word) => {
    const letters = word.split('').map((ch) => `${escapeRegex(ch)}+`)
    return letters.join('')
  })
  return `${parts.join("[\\s'’-]*")}(?:['’]?s)?`
}

function stripLeadingName(
  text: string,
  names: string[],
  possessive = false,
): { rest: string; matched: boolean } {
  for (const name of names) {
    // After "my"/"the" the name must stand alone ("my Goblin, …"), so
    // "my goblin figurine is on the shelf" is not someone talking to it.
    const re = new RegExp(
      `^${namePattern(name)}${possessive ? '(?=\\s*(?:[,!.:;?-]|$))' : '\\b'}[\\s,!.:;?-]*`,
      'i',
    )
    const m = text.match(re)
    if (m) return { rest: text.slice(m[0].length), matched: true }
  }
  return { rest: text, matched: false }
}

/** Skip honorifics ("good sir Mr", "esteemed Lord") looking for a name. */
function findName(
  text: string,
  names: string[],
): { rest: string; matched: boolean } {
  let probe = text
  let possessive = false
  for (let i = 0; i < 6; i += 1) {
    const named = stripLeadingName(probe, names, possessive)
    if (named.matched) return named
    const h = probe.match(HONORIFIC)
    if (!h || h[0].length === 0) break
    if (/^(?:my|our|the)\b/i.test(h[0])) possessive = true
    probe = probe.slice(h[0].length)
  }
  return { rest: text, matched: false }
}

export type Normalised = {
  /** The request on its own, ready for understanding. */
  text: string
  /** True when the person addressed their Goblin by one of its names. */
  addressed: boolean
}

/**
 * Remove the way someone addressed their Goblin and the politeness around
 * the request. Leaves the request itself, in the person's own words.
 */
export function normaliseAddress(
  raw: string,
  names: readonly string[] = [],
): Normalised {
  const known = addressNames(names)
  let text = raw.replace(/\s+/g, ' ').trim()
  let addressed = false

  // Up to a few rounds: "Oi, Goblin, mate, could you…"
  for (let round = 0; round < 6; round += 1) {
    const before = text
    const greet = text.match(GREETING)
    if (greet && greet[0].length < text.length) text = text.slice(greet[0].length)

    // Honorifics only count when they lead up to a name.
    const named = findName(text, known)
    if (named.matched && named.rest.trim()) {
      text = named.rest
      addressed = true
      const after = text.match(AFTER_NAME)
      if (after && after[0].length < text.length)
        text = text.slice(after[0].length)
    } else if (named.matched && !named.rest.trim()) {
      // Just the name: "Goblin?" — attention, no request yet.
      return { text: '', addressed: true }
    }

    const wrap = text.match(WRAPPER)
    if (wrap && wrap[0].length > 0 && wrap[0].length < text.length)
      text = text.slice(wrap[0].length)

    if (text === before) break
  }

  // Trailing vocative: "what's on today, Goblin?" / "milk please, Gobbo"
  for (const name of known) {
    const re = new RegExp(
      `[\\s,]+(?:(?:my|dear|good|oh|o|mr|sir|lord)\\s+)*${namePattern(name)}\\s*([.!?]*)$`,
      'i',
    )
    if (re.test(text)) {
      text = text.replace(re, '$1')
      addressed = true
      break
    }
  }
  for (let i = 0; i < 3 && TRAILING.test(text); i += 1)
    text = text.replace(TRAILING, '')

  return { text: text.replace(/^[\s,.;:!-]+/, '').trim(), addressed }
}

/**
 * For hands-free listening: did this utterance start by addressing the
 * Goblin by one of its names? Unrelated conversation in the room ("my
 * goblin figurine is on the shelf") does not count — the name has to lead.
 */
export function startsWithAddress(
  raw: string,
  names: readonly string[] = [],
): boolean {
  const known = addressNames(names)
  let text = raw.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 4; i += 1) {
    const greet = text.match(GREETING)
    if (!greet || greet[0].length === 0) break
    text = text.slice(greet[0].length)
  }
  return findName(text, known).matched
}
