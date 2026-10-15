/**
 * Understanding what someone wants to *do* — not just what they mentioned.
 *
 * "I need milk" (create), "I've bought the milk" (complete), "I don't need
 * milk anymore" (cancel), "Actually, two cartons of milk" (update), "Did I
 * buy milk?" (query), "I haven't bought milk yet" (not yet — never complete).
 *
 * Deterministic and free. It only proposes operations; the worker matches
 * them against the person's own records before anything changes, and
 * anything not recognised falls through to the existing brain-dump review.
 */
import { parseRelativeDate, parseTime } from '../brainDump'

export type ShoppingEntry = { name: string; quantity: string }

export type Operation =
  | { op: 'shopping_add'; items: ShoppingEntry[]; clause: string }
  | {
      op: 'complete'
      target: string
      domain: 'shopping' | 'task' | 'event' | 'any'
      clause: string
      /** Said with a likely typo ("brought"): only act on a clear match. */
      loose?: boolean
    }
  | { op: 'cancel'; target: string; clause: string }
  | { op: 'not_yet'; target: string; clause: string }
  | { op: 'task_add'; title: string; dueDate: string | null; clause: string }
  | {
      op: 'reminder_add'
      subject: string | null
      date: string | null
      time: string | null
      clause: string
    }
  | {
      op: 'event_add'
      title: string
      date: string | null
      time: string | null
      clause: string
    }
  | {
      op: 'event_move'
      target: string
      date: string | null
      time: string | null
      clause: string
    }
  | {
      op: 'query_done'
      target: string
      domain: 'shopping' | 'task'
      clause: string
    }
  | { op: 'query_event'; target: string; clause: string }
  | {
      op: 'query_calendar'
      range: 'today' | 'tomorrow' | 'this_week' | 'next_week'
      clause: string
    }
  | { op: 'question'; clause: string }
  | { op: 'overwhelm'; clause: string }
  | { op: 'capture'; clause: string }

const OVERWHELM =
  /\b(overwhelm(?:ed|ing)?|too much|can'?t cope|cannot cope|don'?t know where to (?:start|begin)|drowning|frozen|paralys(?:ed|is)|everything is a mess|so stressed|stressed out|burnt? out)\b/i

// "brought" is a very common slip for "bought"; it only counts when it
// clearly names something on the list (see `loose`).
const SHOPPING_VERBS =
  /^(bought|brought|got|grabbed|picked up|purchased|collected)$/
const COMPLETION_VERBS =
  'bought|brought|got|grabbed|picked up|purchased|collected|paid|called|rang|phoned|finished|completed|done|sent|booked|returned|submitted|emailed|posted|cleaned|did|fixed|renewed|cancelled|handed in|dropped off|filed|wrote|replied to|texted|messaged|visited|attended|went to'

const NUMBER_WORDS: Record<string, string> = {
  a: '1',
  an: '1',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  dozen: '12',
  'a couple of': '2',
  'a few': '3',
}
const UNITS =
  'cartons?|bottles?|packs?|packets?|bags?|boxes?|tins?|cans?|jars?|loa(?:f|ves)|dozen|kg|kilos?|g|grams?|litres?|liters?|l|ml|bunch(?:es)?|rolls?|tubs?|punnets?'

function clean(text: string): string {
  return text
    .replace(/[.!?]+$/, '')
    .replace(
      /^(?:oh|ok|okay|so|um|well|also|and|but|then|plus|actually|just|oh and)[,\s]+/i,
      '',
    )
    .replace(
      /^(?:oh|ok|okay|so|um|well|also|and|but|then|plus|actually|just)[,\s]+/i,
      '',
    )
    .trim()
}

function stripLeadingArticles(text: string): string {
  return text
    .replace(/^(?:the|a|an|my|some|our|that|this|those|these)\s+/i, '')
    .trim()
}

/** "two cartons of milk" → { name: 'milk', quantity: '2 cartons' } */
export function parseShoppingEntry(raw: string): ShoppingEntry {
  let text = stripLeadingArticles(
    raw
      .trim()
      .replace(/\s+(?:please|as well|too|also)$/i, '')
      // "milk tomorrow", "bread on Friday": when to buy isn't part of the name.
      .replace(
        /\s+(?:today|tonight|tomorrow|this (?:morning|afternoon|evening|week|weekend)|on the way home|(?:on |this |next )?(?:mon|tues|wednes|thurs|fri|satur|sun)day)$/i,
        '',
      ),
  )
  let quantity = ''
  const numberWord = Object.keys(NUMBER_WORDS)
    .sort((a, b) => b.length - a.length)
    .find((w) => new RegExp(`^${w}\\s+`, 'i').test(text))
  const num = text.match(/^(\d+(?:\.\d+)?)\s*/)
  let count: string | null = null
  if (num?.[1]) {
    count = num[1]
    text = text.slice(num[0].length)
  } else if (numberWord) {
    count = NUMBER_WORDS[numberWord]!
    text = text.slice(numberWord.length).trim()
  }
  const unit = text.match(new RegExp(`^(${UNITS})\\s+(?:of\\s+)?`, 'i'))
  if (unit?.[1]) {
    quantity = `${count ?? '1'} ${unit[1].toLowerCase()}`
    text = text.slice(unit[0].length)
  } else if (count && count !== '1') {
    quantity = count
  }
  return { name: stripLeadingArticles(text).trim(), quantity }
}

function splitList(text: string): string[] {
  return text
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/i)
    .map((p) => p.trim())
    .filter(Boolean)
}

/**
 * Split an utterance into clauses at sentence breaks and at "but"/"and"
 * when they start a new clause ("…the milk, but I still need bread, and
 * remind me…"), while keeping item lists together ("milk and bread").
 */
export function splitClauses(text: string): string[] {
  const starters =
    "(?:i\\b|i'|remind|add|also|still|please|can you|could you|don'?t|do not|move|reschedule|cancel|remove|book|call|pay|buy|get|pick up|grab|need|we\\b|my\\b|did|when|what)"
  return text
    .split(/(?:\n+|(?<=[.!?;])\s+)/)
    .flatMap((sentence) =>
      sentence.split(
        new RegExp(
          `\\s*(?:,\\s*(?:but|and|then)?|\\s+but|\\s+and(?:\\s+then)?|\\s+then)\\s+(?=${starters})`,
          'i',
        ),
      ),
    )
    .map((c) => c.trim())
    .filter((c) => c.replace(/[^a-z0-9]/gi, '').length > 1)
}

const WEEK_RANGE = /\b(next week|this week|today|tomorrow)\b/i

export function parseOperation(rawClause: string, now: Date): Operation {
  const clause = rawClause.trim()
  const text = clean(clause)
  const lower = text.toLowerCase()

  if (OVERWHELM.test(lower) && lower.length < 280)
    return { op: 'overwhelm', clause }

  // Negation: "I haven't bought milk yet", "I didn't pay the bill".
  const notYet = lower.match(
    new RegExp(
      `^(?:i\\s+)?(?:haven'?t|have not|didn'?t|did not|still haven'?t|not yet)\\s+(?:yet\\s+)?(?:${COMPLETION_VERBS}|buy|get|pay|call|finish|book|send|do)\\s+(.+?)(?:\\s+yet)?$`,
    ),
  )
  if (notYet?.[1])
    return { op: 'not_yet', target: stripLeadingArticles(notYet[1]), clause }

  // Questions about state: "Did I buy milk?", "Have I paid the bill?"
  const didI = lower.match(
    /^(?:did|have)\s+i\s+(?:already\s+)?(buy|bought|get|got|pick up|picked up|pay|paid|call|called|finish|finished|book|booked|send|sent|do|done)\s+(.+?)\??$/,
  )
  if (didI?.[2]) {
    const domain = /^(buy|bought|get|got|pick up|picked up)$/.test(didI[1]!)
      ? 'shopping'
      : 'task'
    return {
      op: 'query_done',
      target: stripLeadingArticles(didI[2]),
      domain,
      clause,
    }
  }
  const whenIs = lower.match(/^when(?:'s| is| was)\s+(?:my|the)\s+(.+?)\??$/)
  if (whenIs?.[1]) return { op: 'query_event', target: whenIs[1], clause }
  if (
    /^what(?:'s| is)? (?:on )?(?:my )?(?:calendar|schedule|on)\b|^what do i have on\b|^what have i got on\b/.test(
      lower,
    )
  ) {
    const range = (lower.match(WEEK_RANGE)?.[1]?.replace(' ', '_') ??
      'this_week') as 'today' | 'tomorrow' | 'this_week' | 'next_week'
    return { op: 'query_calendar', range, clause }
  }
  if (
    /\?\s*$/.test(clause) ||
    /^(what|when|where|which|who|how|why|is there|are there|show me|tell me)\b/.test(
      lower,
    )
  ) {
    return { op: 'question', clause }
  }

  // Cancel: "I don't need milk anymore", "remove eggs from my list", "cancel the dentist".
  const dontNeed = lower.match(
    /^(?:i\s+|we\s+)?(?:don'?t|do not|no longer)\s+need\s+(?:to\s+)?(.+?)(?:\s+any\s?more|\s+after all)?$/,
  )
  if (dontNeed?.[1])
    return { op: 'cancel', target: stripLeadingArticles(dontNeed[1]), clause }
  const remove = lower.match(
    /^(?:please\s+)?(?:remove|take|cross)\s+(.+?)\s+(?:off|from)\s+(?:my|the)\s+(?:shopping\s+)?list$/,
  )
  if (remove?.[1])
    return { op: 'cancel', target: stripLeadingArticles(remove[1]), clause }
  const forget = lower.match(
    /^(?:please\s+)?(?:forget(?:\s+about)?|scratch|never mind|nevermind)\s+(.+)$/,
  )
  if (forget?.[1])
    return { op: 'cancel', target: stripLeadingArticles(forget[1]), clause }

  // Move: "Move my dentist appointment to Friday at 3pm".
  const move = lower.match(
    /^(?:please\s+)?(?:move|reschedule|change|push|shift)\s+(?:my\s+|the\s+)?(.+?)\s+to\s+(.+)$/,
  )
  if (move?.[1] && move[2]) {
    return {
      op: 'event_move',
      target: move[1].replace(/\s+(?:appointment|booking)$/, (m) => m),
      date: parseRelativeDate(move[2], now),
      time:
        parseTime(`at ${move[2].replace(/^.*?\bat\s+/, '')}`) ??
        parseTime(move[2]),
      clause,
    }
  }

  // Complete: "I've bought the milk", "Got the milk", "I paid the electricity bill".
  const done = lower.match(
    new RegExp(
      `^(?:i\\s+|i've\\s+|ive\\s+|i have\\s+|we've\\s+|we\\s+)?(?:just\\s+|already\\s+|finally\\s+)?(${COMPLETION_VERBS})\\s+(?!to\\b)(.+?)(?:\\s+(?:already|today|now|earlier|just now))?$`,
    ),
  )
  if (
    done?.[1] &&
    done[2] &&
    !/^(?:a|an)\s+(?:appointment|meeting)\b/.test(done[2])
  ) {
    const domain = SHOPPING_VERBS.test(done[1]) ? 'shopping' : 'task'
    return {
      op: 'complete',
      target: stripLeadingArticles(done[2]),
      domain,
      clause,
      ...(done[1] === 'brought' ? { loose: true } : {}),
    }
  }
  const isDone = lower.match(
    /^(?:the\s+|my\s+|that\s+)?(.+?)\s+(?:is|are|was|were)\s+(?:all\s+)?(?:done|sorted|finished|paid|bought|over|complete|completed|handled|taken care of)$/,
  )
  if (isDone?.[1]) {
    const target = stripLeadingArticles(isDone[1])
    const domain = /appointment|meeting|interview|visit|class|lesson/.test(
      target,
    )
      ? 'event'
      : 'any'
    return { op: 'complete', target, domain, clause }
  }
  const doneWith = lower.match(
    /^(?:i'?m\s+|i am\s+)?(?:done|finished)\s+with\s+(.+)$/,
  )
  if (doneWith?.[1])
    return {
      op: 'complete',
      target: stripLeadingArticles(doneWith[1]),
      domain: 'any',
      clause,
    }

  // Reminders: "remind me to call Mum tomorrow", "remind me tomorrow".
  const remind = text.match(
    /^(?:please\s+|can you\s+|could you\s+)?remind me(?:\s+(?:to|about)\s+(.+?))?(?:\s+(today|tomorrow|tonight|on\s+\w+|next\s+\w+|this\s+\w+|at\s+.+))*\??$/i,
  )
  if (
    /^(?:please\s+|can you\s+|could you\s+)?remind me\b/i.test(text) &&
    remind
  ) {
    const subject = (remind[1] ?? '')
      .replace(
        /\s+(?:today|tomorrow|tonight|on\s+\w+day|next\s+\w+|this\s+\w+|at\s+[\d:.apm\s]+)$/i,
        '',
      )
      .replace(/\s+(?:today|tomorrow|tonight)$/i, '')
      .trim()
    return {
      op: 'reminder_add',
      subject: subject || null,
      date: /\btonight\b/i.test(text)
        ? parseRelativeDate('today', now)
        : parseRelativeDate(text, now),
      time:
        /\btonight\b/i.test(text) && !parseTime(text)
          ? '19:00'
          : parseTime(text),
      clause,
    }
  }

  // Appointments: "I have an appointment Thursday", "dentist appointment on Friday at 3pm".
  if (
    /\b(appointment|meeting|interview|booking|consultation|check-?up)\b/.test(
      lower,
    ) &&
    !/^(?:i\s+)?(?:need|have)\s+to\b/.test(lower)
  ) {
    const date = parseRelativeDate(text, now)
    if (date || /^(?:i\s+have|i've got|there's)\b/.test(lower)) {
      const title = text
        .replace(
          /^(?:i\s+have|i've got|i have got|there's|there is)\s+(?:(?:an|a|my|the)\s+)?/i,
          '',
        )
        .replace(
          /\s+(?:on\s+)?(?:today|tomorrow|next\s+\w+|this\s+\w+|(?:on\s+)?\w+day)\b.*$/i,
          '',
        )
        .replace(/\s+at\s+.*$/i, '')
        .trim()
      return {
        op: 'event_add',
        title: title
          ? title.charAt(0).toUpperCase() + title.slice(1)
          : 'Appointment',
        date,
        time: parseTime(text),
        clause,
      }
    }
  }

  // Tasks: "I need to call the dentist", "I have to finish my assignment by Friday".
  const task = text.match(
    /^(?:i\s+|we\s+)?(?:still\s+)?(?:need|have|must|should|gotta|got)\s+to\s+(.+)$/i,
  )
  if (task?.[1]) {
    const title = task[1]
      .replace(
        /\s+(?:by|on|before)\s+(?:today|tomorrow|next\s+\w+|this\s+\w+|\w+day)\b.*$/i,
        '',
      )
      .replace(/\s+(?:today|tomorrow)$/i, '')
      .trim()
    return {
      op: 'task_add',
      title: title.charAt(0).toUpperCase() + title.slice(1),
      dueDate: parseRelativeDate(text, now),
      clause,
    }
  }

  // Shopping: "I need milk", "I still need bread and eggs", "add two cartons of milk",
  // "buy oat milk", "milk, bread and coffee on my shopping list".
  const toList = text.match(
    /^(?:please\s+)?(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:my|the)\s+(?:shopping\s+)?list$/i,
  )
  const need = text.match(
    /^(?:i\s+|we\s+)?(?:still\s+|also\s+)?(?:need|want|gotta get|need to get|need to buy|must buy|should buy)\s+(?!to\b)(.+)$/i,
  )
  const buy = text.match(
    /^(?:please\s+)?(?:buy|get|pick up|grab|add)\s+(?!to\b)(.+?)(?:\s+(?:to|on)\s+(?:my|the)\s+(?:shopping\s+)?list)?$/i,
  )
  const listText = toList?.[1] ?? need?.[1] ?? buy?.[1]
  if (
    listText &&
    !/\b(appointment|meeting|bill|call|email|haircut|dentist|doctor)\b/i.test(
      listText,
    ) &&
    listText.split(/\s+/).length <= 12
  ) {
    const items = splitList(listText)
      .map(parseShoppingEntry)
      .filter((i) => i.name.length > 1)
    if (items.length) return { op: 'shopping_add', items, clause }
  }

  return { op: 'capture', clause }
}

export function parseUtterance(text: string, now: Date): Operation[] {
  return splitClauses(text).map((clause) => parseOperation(clause, now))
}
