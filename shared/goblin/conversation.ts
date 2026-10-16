/**
 * Conversational requests about the person's day — "what's the damage
 * tomorrow?", "which ones can wait?", "move them", "actually, remove that",
 * "yes" — that the record-level engine (language.ts) does not cover.
 *
 * This recognises *concepts* (a time, something schedule-shaped, a request
 * for information, deferral, a pronoun pointing back at the last answer)
 * rather than fixed sentences, so "What fresh hell awaits?", "Anything
 * happening today?" and "Lord Reginald, kindly review today's appointments"
 * all reach the same overview. It runs on text that has already had its
 * greeting and Goblin name removed (address.ts).
 *
 * Deterministic and free. It only names the request; the worker reads the
 * person's own records to answer it, and nothing here changes data.
 */
import { parseRelativeDate } from '../brainDump'

export type DayPart = 'morning' | 'afternoon' | 'evening'

/** Local calendar days [from, to) as YYYY-MM-DD, with a spoken label. */
export type DayRange = {
  from: string
  to: string
  label: string
  part?: DayPart
}

export type Conversational =
  | { kind: 'overview'; range: DayRange }
  | { kind: 'availability'; range: DayRange }
  | { kind: 'overdue' }
  | { kind: 'focus' }
  | { kind: 'flexible'; range: DayRange; propose: boolean }
  | { kind: 'defer_refs'; toDate: string | null; single: boolean }
  | { kind: 'undo' }
  | { kind: 'affirm' }
  | { kind: 'deny' }

function iso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

function partOf(lower: string): DayPart | undefined {
  if (/\b(tonight|evening)\b/.test(lower)) return 'evening'
  if (/\bafternoon\b/.test(lower)) return 'afternoon'
  if (/\bmorning\b/.test(lower)) return 'morning'
  return undefined
}

/**
 * The days a request is about. `wallClock` is the person's local date with
 * local fields set (as the engine already uses). Defaults to today.
 */
export function parseDayRange(text: string, wallClock: Date): DayRange {
  const lower = text.toLowerCase().replace(/[’]/g, "'")
  const part = partOf(lower)
  const single = (d: Date, label: string): DayRange => ({
    from: iso(d),
    to: iso(addDays(d, 1)),
    label: part && label !== 'tonight' ? `${label} ${part}` : label,
    ...(part ? { part } : {}),
  })
  const weekday = wallClock.getDay() // 0 = Sunday

  if (/\bday after tomorrow\b/.test(lower))
    return single(addDays(wallClock, 2), 'the day after tomorrow')
  if (/\b(tomorrow|tmrw|tmr|2moro)\b/.test(lower))
    return single(addDays(wallClock, 1), 'tomorrow')
  if (/\b(this|the|on the)?\s*weekend\b/.test(lower)) {
    const daysToSat = (6 - weekday + 7) % 7
    const start =
      weekday === 0 ? wallClock : addDays(wallClock, weekday === 6 ? 0 : daysToSat)
    const end = weekday === 0 ? addDays(wallClock, 1) : addDays(start, 2)
    return { from: iso(start), to: iso(end), label: 'this weekend' }
  }
  if (/\bnext week\b/.test(lower)) {
    const toMonday = ((8 - weekday) % 7) || 7
    const start = addDays(wallClock, toMonday)
    return { from: iso(start), to: iso(addDays(start, 7)), label: 'next week' }
  }
  if (/\b(this|the rest of the) week\b/.test(lower)) {
    const toMonday = ((8 - weekday) % 7) || 7
    return {
      from: iso(wallClock),
      to: iso(addDays(wallClock, toMonday)),
      label: 'this week',
    }
  }
  const named = lower.match(
    /\b(?:on\s+|this\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  )
  if (named?.[1]) {
    const date = parseRelativeDate(named[0], wallClock)
    if (date) {
      const d = new Date(`${date}T12:00:00`)
      const name = named[1].charAt(0).toUpperCase() + named[1].slice(1)
      return single(d, name)
    }
  }
  if (/\btonight\b/.test(lower)) return single(wallClock, 'tonight')
  return single(wallClock, 'today')
}

const TIME =
  /\b(today|todays|tonight|tomorrow|tomorrows|tmrw|tmr|this (?:morning|afternoon|evening|week|weekend)|the weekend|weekend|next week|day after tomorrow|(?:mon|tues|wednes|thurs|fri|satur|sun)days?)\b/

const SCHEDULE =
  /\b(schedule|agenda|calendar|diary|plans?|commitments?|appointments?|meetings?|events?|line-?up|itinerary|disasters?|damage|hell|happening|going on|in store|awaits?|awaiting|coming up|errands?|programme|program|docket|on the cards|booked|engagements?|obligations?)\b|\bwhat(?:'s| is)? on\b|\b(?:got|have|is) on\b|\bon (?:for )?(?:today|tonight|tomorrow|this|the weekend)\b|\b(?:day|week|weekend) look\b/

const ASK =
  /^(what|whats|what's|wot|wots|which|anything|any|is there|are there|do i have|have i got|got anything|how(?:'s| is| does| do)|tell me|show me|give me|run me through|run through|walk me through|summar|overview|rundown|brief|inform|update me|review|remind me what|check|list|read (?:me|out)|go through|what've|whatve|what have)/

const SUMMARY_NOUN =
  /\b(summary|summarise|summarize|rundown|run-down|overview|briefing|recap|lowdown|low-down)\b/

const CREATING =
  /^(?:remind me to|add|put|buy|book|schedule|i need to|i have to|i've got to|need to|we need)\b/

const OVERDUE =
  /\b(overdue|past due|past (?:the|its|their) due|late|behind on|behind with|slipped through|missed)\b/

const FOCUS =
  /\b(forgot(?:ten)? what i (?:was|am) (?:supposed to be |meant to be )?doing|what (?:was|am) i (?:supposed to be |meant to be )?doing|what (?:should|do|must) i (?:do|be doing|focus on|tackle)(?: now| next| first| today)?|where (?:was|am|were) i|what(?:'s| is) next|what now|lost the plot|sort (?:out )?my (?:life|day|week|head)(?: out)?|what (?:really |actually )?matters|work out what matters|what(?:'s| is)? (?:absolutely |actually |really |most |truly )?(?:essential|important|urgent|critical|non-negotiable|unmissable)|must(?:-| )do|help me (?:focus|prioriti[sz]e|decide)|priorit(?:y|ies|ise|ize))\b/

const DEFER_WORD =
  '(?:move|push|postpone|defer|shift|bump|reschedule|put off|kick|punt|shove|park|carry over)'
const POINTER =
  "(them|those|these|those ones|these ones|it|that|that one|this one|the rest|everything else|all of them|all that|all those|the flexible ones|the ones that can wait|everything that can wait|the lot)"

const DEFER_REFS = new RegExp(
  `^(?:(?:ok(?:ay)?|yes|yeah|right|fine|great|sure|go on|then|and|so)[,\\s]+)*(?:please\\s+|just\\s+|can you\\s+|could you\\s+)?${DEFER_WORD}\\s+${POINTER}(?:\\s+(?:off|back|over|along|on))?(?:\\s+(?:to|until|till|til|for|into)\\s+(.+?))?[.!?]*$`,
)

const FLEXIBLE_QUESTION = new RegExp(
  `^(?:what|which|anything|is there anything|are there any|any|what else)\\b.*\\b(?:can|could|should|might|may)\\b.*\\b(?:wait|${DEFER_WORD}|skip|drop|leave|ditch|let go)\\b`,
)

const FLEXIBLE_PHRASE =
  /\b(?:can wait|could wait|wait (?:until|till) (?:tomorrow|later)|flexible|not urgent|can be (?:moved|postponed|pushed|left|skipped)|do i (?:actually |really |honestly |truly )?(?:have|need) to do (?:all )?(?:this|that|it|everything|all that|these|them)|have i (?:actually |really )?got to do (?:all )?(?:this|that))\b/

const FUTURE_SELF =
  /\b(?:tomorrow'?s problem|future (?:me|you|self)|tomorrow (?:me|you)|later (?:me|you)|problem for (?:tomorrow|later|future)|another day'?s problem)\b/

const UNDO =
  /^(?:undo(?: that| it| the last (?:one|thing|bit))?|take (?:that|it) back|scratch that|remove (?:that|it)|delete (?:that|it)|cancel that|forget that|reverse that|take (?:that|it) off(?: the list| my list)?|(?:no|nope|oops|whoops|wait)[,\s]+(?:remove|undo|delete|cancel|scratch|take back|take off) (?:that|it)|that(?:'s| was| is) (?:wrong|a mistake|not right)|(?:i )?didn'?t mean that|wrong one)$/

const AFFIRM =
  /^(?:yes|yeah|yep|yup|ya|yes please|yes do it|sure|ok(?:ay)?|go (?:on|ahead|for it)|do it|please do|sounds good|perfect|correct|that'?s right|aye|absolutely|definitely|why not|alright|all right|righto|do that|make it so|go|confirm(?:ed)?|that one)$/

const DENY =
  /^(?:no|nope|nah|no thanks|no thank you|don'?t|do not|leave it|leave them|leave it be|never ?mind|cancel|forget it|not now|no don'?t|skip it|don'?t bother)$/

function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/^[\s,.;:!-]+/, '')
    .replace(/^(?:actually|also|and|but|oh|um|well|so)[,\s]+/, '')
    .replace(/[\s.!?]+$/, '')
    .trim()
}

/**
 * Recognise a conversational request in one clause, or return null so the
 * record-level engine (language.ts) handles it.
 */
export function classifyConversation(
  clause: string,
  wallClock: Date,
): Conversational | null {
  const lower = plain(clause)
  if (!lower) return null

  if (AFFIRM.test(lower)) return { kind: 'affirm' }
  if (DENY.test(lower)) return { kind: 'deny' }
  if (UNDO.test(lower)) return { kind: 'undo' }

  const defer = lower.match(DEFER_REFS)
  if (defer) {
    const pointer = defer[1] ?? ''
    const when = defer[2]
    return {
      kind: 'defer_refs',
      toDate: when ? parseRelativeDate(when, wallClock) : null,
      single: /^(it|that|that one|this one)$/.test(pointer),
    }
  }

  if (CREATING.test(lower)) return null

  const asks = ASK.test(lower) || /\?\s*$/.test(clause) || SUMMARY_NOUN.test(lower)

  if (
    /\b(?:am|are) (?:i|we) (?:free|busy|available|around)\b|\b(?:any|got any) free time\b|\bfree (?:on|this|tomorrow|today|at)\b/.test(
      lower,
    )
  ) {
    return { kind: 'availability', range: parseDayRange(lower, wallClock) }
  }

  if (FUTURE_SELF.test(lower))
    return {
      kind: 'flexible',
      range: parseDayRange(
        lower.replace(/\btomorrow'?s problem\b/g, ''),
        wallClock,
      ),
      propose: true,
    }
  if (FLEXIBLE_QUESTION.test(lower) || FLEXIBLE_PHRASE.test(lower)) {
    // "what can I move until tomorrow" is about today, not tomorrow.
    const about = lower.replace(
      /\b(?:until|till|to|for|into)\s+(?:tomorrow|later|next week|\w+day)\b/,
      '',
    )
    return {
      kind: 'flexible',
      range: parseDayRange(about, wallClock),
      propose: false,
    }
  }

  if (OVERDUE.test(lower) && (asks || /^(?:anything|what|is|am)\b/.test(lower)))
    return { kind: 'overdue' }

  if (FOCUS.test(lower)) return { kind: 'focus' }

  if (asks && (TIME.test(lower) || SCHEDULE.test(lower))) {
    // "When is my dentist?" names one thing: leave it to the matcher.
    if (/^when\b/.test(lower) && !SCHEDULE.test(lower)) return null
    return { kind: 'overview', range: parseDayRange(lower, wallClock) }
  }
  return null
}

/**
 * Everyday things people buy, used only to decide whether a bare word like
 * "Milk." clearly belongs on the shopping list. Anything not here gets one
 * short question instead of a guess. This is not a command list: it never
 * decides *what* someone wants, only where an unexplained item goes.
 */
const GROCERY_HINTS = new Set(
  `milk bread eggs egg butter cheese yoghurt yogurt cream coffee tea sugar flour rice pasta noodles cereal oats porridge
  bananas banana apples apple oranges lemons limes grapes berries strawberries tomatoes tomato potatoes potato onions onion
  garlic carrots lettuce salad cucumber peppers broccoli spinach mushrooms avocado avocados fruit veg vegetables
  chicken beef mince bacon ham sausages fish salmon tuna tofu beans lentils chickpeas soup stock gravy
  juice water lemonade wine beer cola biscuits crisps chips chocolate snacks crackers jam honey peanut marmite
  ketchup mayo mayonnaise mustard oil vinegar salt pepper spices herbs
  toothpaste toothbrush shampoo conditioner soap deodorant razors tissues loo toilet paper roll rolls nappies diapers wipes
  detergent washing powder liquid softener bleach sponges bin bags foil clingfilm batteries lightbulbs bulbs
  catfood dogfood cat dog food pet litter formula baby`
    .split(/\s+/)
    .filter(Boolean),
)

const NOT_AN_ITEM =
  /^(?:actually|also|and|so|well|um+|uh+|oh|right|then|anyway|wait|hmm+|sorry|oops|please|thanks|cheers|mate|yeah|nah|it|that|this|them|those|these|yes|no|ok|okay|hello|hi|hey|thanks|thank you|today|tomorrow|tonight|now|later|help|what|why|how|when|where|who|stop|cancel|nothing|never ?mind)$/

/**
 * A bare noun phrase with no request around it ("Milk.", "Oat milk",
 * "two loaves of bread"). Returns the phrase, or null.
 */
export function bareItem(clause: string): string | null {
  const text = plain(clause)
  if (!text || NOT_AN_ITEM.test(text)) return null
  if (!/^[a-z0-9][a-z0-9\s'&-]*$/.test(text)) return null
  const words = text.split(/\s+/)
  if (words.length > 5) return null
  // A verb or pronoun means it's a sentence, not an item.
  if (
    words.some((w) =>
      /^(i|we|you|he|she|they|is|are|was|were|am|be|do|does|did|have|has|had|can|could|will|would|should|must|need|want|to|not|don't|didn't|my|me|our|us)$/.test(
        w,
      ),
    )
  )
    return null
  return text
}

/** Does this bare item clearly name something from the shops? */
export function looksLikeShopping(item: string): boolean {
  const words = item
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  return words.some((w) => GROCERY_HINTS.has(w) || GROCERY_HINTS.has(w.replace(/s$/, '')))
}

export type Expression = { phrase: string; meaning: string }

function flatten(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Apply the person's own expressions ("when I say 'what's the damage' I mean
 * show me my schedule and urgent tasks"). The phrase is swapped for what the
 * person said it means, and the result is understood like anything else they
 * say — the same checks and confirmations apply. Phrases match whole words,
 * ignoring case and punctuation; the longest phrase wins.
 */
export function applyExpressions(
  text: string,
  expressions: readonly Expression[],
): { text: string; used: string[] } {
  const used: string[] = []
  let flat = flatten(text)
  const sorted = [...expressions]
    .map((e) => ({ ...e, key: flatten(e.phrase) }))
    .filter((e) => e.key.length >= 2 && e.meaning.trim())
    .sort((a, b) => b.key.length - a.key.length)
  let changed = false
  for (const expression of sorted) {
    const re = new RegExp(`(^|\\s)${expression.key.replace(/\s+/g, '\\s+')}(?=\\s|$)`)
    if (re.test(flat)) {
      flat = flat.replace(re, `$1${expression.meaning.trim().replace(/[.!?]+$/, '')}`)
      used.push(expression.phrase)
      changed = true
    }
  }
  return { text: changed ? flat : text, used }
}
