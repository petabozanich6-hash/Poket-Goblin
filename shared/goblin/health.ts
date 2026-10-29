/**
 * Health phrases the Goblin understands, by rules only (health details are never sent to an AI):
 *   "I weighed 92.4 kilos", "weight 14 stone 3", "waist 98 cm"
 *   "walked 30 minutes", "went for a 20 minute run", "did an hour at the gym", "10,000 steps"
 *   "had toast for breakfast", "for dinner I had the pork belly benedict", "half the lasagne for lunch",
 *   "snacked on an apple", "drank a flat white"
 *   "drank 2 glasses of water", "had 3 serves of veg", "slept 7 hours"
 *   "took my multivitamin", "had my Deficit", "took my supplements"
 *   "did I take my vitamins today?", "how am I going with my weight?", "how's my health today?"
 * Anything that is clearly about health but not understood becomes `unclear`, never the AI review queue.
 */
import type { Habit, Intensity, Meal } from '../health'

export type HealthOp =
  | {
      kind: 'weigh'
      weight: number | null
      weightUnit: 'kg' | 'lb' | null
      waistCm: number | null
    }
  | {
      kind: 'activity'
      activity: string
      minutes: number | null
      steps: number | null
      intensity: Intensity
    }
  | { kind: 'meal'; meal: Meal | null; food: string; servings: number }
  | { kind: 'habit'; habit: Habit; amount: number; mode: 'add' | 'set' }
  /** `viaHad`: said as "had my X", which may be food or a drink if X isn't one of their supplements. */
  | { kind: 'dose'; name: string | null; viaHad?: boolean }
  | { kind: 'query'; what: 'supplements' | 'today' | 'weight' }
  | { kind: 'unclear'; hint: string }

const NUM_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  half: 0.5,
  'a half': 0.5,
  'half a': 0.5,
  couple: 2,
  'a couple of': 2,
}
function count(word: string | undefined, fallback = 1): number {
  if (!word) return fallback
  const w = word.toLowerCase().trim()
  if (/^\d+(?:\.\d+)?$/.test(w)) return Number(w)
  return NUM_WORDS[w] ?? fallback
}
const NUM =
  '(\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|a couple of|couple)'

// ---------------------------------------------------------------- weight

function parseWeigh(t: string): HealthOp | null {
  const stone = t.match(
    /\b(?:weigh(?:ed|t| in)?|i'?m|i am|on the scales?)\D{0,20}?(\d{1,2})\s*(?:st|stone)\s*(?:and\s*)?(\d{1,2}(?:\.\d)?)?\s*(?:lb|lbs|pounds?)?\b/,
  )
  const waist = t.match(
    /\bwaist\s*(?:is|was|measures?|measured|now|:)?\s*(?:at\s*)?(\d{2,3}(?:\.\d)?)\s*(cm|centimet(?:re|er)s?|in|inch(?:es)?|")?/,
  )
  const waistCm = waist
    ? Number(waist[1]) * (waist[2] && /^(in|inch|")/.test(waist[2]) ? 2.54 : 1)
    : null
  if (stone)
    return {
      kind: 'weigh',
      weight: Number(stone[1]) * 14 + Number(stone[2] ?? 0),
      weightUnit: 'lb',
      waistCm,
    }
  const w = t.match(
    /\b(?:i\s+)?(?:weigh(?:ed)?(?:\s+in)?|weight(?:\s+(?:is|was|today|this morning))?|(?:the\s+)?scales?\s+(?:said|says|showed)|i'?m|i am)\s*(?:at\s*|now\s*|in at\s*)?:?\s*(\d{2,3}(?:\.\d{1,2})?)\s*(kg|kgs|kilos?|kilograms?|lb|lbs|pounds?)?\b/,
  )
  if (w) {
    const unit = w[2] ? (/^(kg|kilo)/.test(w[2]) ? 'kg' : 'lb') : null
    // "I'm 45" is an age, not a weight: "I'm" needs a unit.
    if (!unit && /\b(i'?m|i am)\b/.test(w[0]))
      return waistCm != null
        ? { kind: 'weigh', weight: null, weightUnit: null, waistCm }
        : null
    return { kind: 'weigh', weight: Number(w[1]), weightUnit: unit, waistCm }
  }
  if (waistCm != null)
    return { kind: 'weigh', weight: null, weightUnit: null, waistCm }
  return null
}

// ---------------------------------------------------------------- activity

const ACTIVITIES: [RegExp, string, Intensity][] = [
  [/\b(ran|run|running|jog(?:ged|ging)?)\b/, 'run', 'vigorous'],
  [/\b(swam|swim(?:ming)?)\b/, 'swim', 'vigorous'],
  [/\b(hiit|crossfit|spin class|spinning)\b/, 'HIIT', 'vigorous'],
  [
    /\b(cycl(?:ed|ing)|bike ride|biked|rode (?:my|the) bike)\b/,
    'cycle',
    'moderate',
  ],
  [
    /\b(gym|weights|lifting|lifted|workout|worked out|strength)\b/,
    'gym',
    'moderate',
  ],
  [/\b(yoga|pilates)\b/, 'yoga', 'light'],
  [/\b(stretch(?:ed|ing)?)\b/, 'stretching', 'light'],
  [
    /\b(danc(?:ed|ing)|tennis|netball|football|soccer|footy|basketball|golf|hike|hiked|hiking|exercise|exercised)\b/,
    'exercise',
    'moderate',
  ],
  [/\b(walk(?:ed|ing)?|stroll(?:ed)?)\b/, 'walk', 'moderate'],
]

const DONE =
  /\b(walked|ran|jogged|swam|cycled|biked|rode|hiked|danced|stretched|lifted|exercised|worked out|went for|went to the gym|did|done|finished|completed|played|got in|managed)\b/

function minutesIn(t: string): number | null {
  if (/\b(?:half an hour|30 mins?)\b/.test(t)) return 30
  if (/\b(?:an|one) hour and a half\b|\b1\.5 hours?\b/.test(t)) return 90
  const hm = t.match(
    /\b(\d+(?:\.\d+)?|an|one|two|three)\s*(?:hours?|hrs?|h)\b(?:\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|m)\b)?/,
  )
  if (hm) return Math.round(count(hm[1]) * 60 + Number(hm[2] ?? 0))
  const m = t.match(/\b(\d+)\s*(?:-\s*)?(?:minutes?|mins?|m)\b/)
  return m ? Number(m[1]) : null
}

function parseActivity(t: string): HealthOp | null {
  const steps = t.match(
    /\b(\d{1,3}(?:,\d{3})+|\d{3,6}|\d+(?:\.\d)?\s*k)\s*steps\b/,
  )
  const stepCount = steps
    ? Math.round(
        steps[1]!.includes('k')
          ? parseFloat(steps[1]!) * 1000
          : Number(steps[1]!.replace(/,/g, '')),
      )
    : null
  const kind = ACTIVITIES.find(([re]) => re.test(t))
  const minutes = minutesIn(t)
  if (!kind && stepCount == null) return null
  // Logging what was done ("walked", "went for a run", "did 30 minutes of yoga", "30 minute walk"), not a plan.
  const done =
    DONE.test(t) ||
    (minutes != null &&
      !/^(?:walk|run|go|do|swim|jog|cycle|ride|stretch|lift)\b/.test(t)) ||
    stepCount != null
  if (!done) return null
  // "took the dog for a walk" with no time: worth asking rather than guessing.
  if (kind && minutes == null && stepCount == null) {
    return {
      kind: 'unclear',
      hint: `How long was your ${kind[1] === 'gym' ? 'workout' : kind[1]}? Try "${kind[1] === 'walk' ? 'walked' : 'did'} 30 minutes".`,
    }
  }
  if (minutes != null && (minutes < 1 || minutes > 1440)) return null
  return {
    kind: 'activity',
    activity: kind?.[1] ?? 'steps',
    minutes,
    steps: stepCount,
    intensity: kind?.[2] ?? 'light',
  }
}

// ---------------------------------------------------------------- habits

function parseHabit(t: string): HealthOp | null {
  const water = t.match(
    new RegExp(
      `\\b(?:drank|had|drinking|finished)\\s+(?:${NUM}\\s+)?(glass(?:es)?|cups?|bottles?|litres?|liters?|l)\\s+of\\s+water\\b`,
    ),
  )
  if (water) {
    const n = count(water[1])
    const per = /^bottle/.test(water[2]!)
      ? 2
      : /^(litre|liter|l$)/.test(water[2]!)
        ? 4
        : 1
    return { kind: 'habit', habit: 'water', amount: n * per, mode: 'add' }
  }
  if (/\b(?:drank|had)\s+(?:some\s+)?water\b/.test(t))
    return { kind: 'habit', habit: 'water', amount: 1, mode: 'add' }
  const serves = t.match(
    new RegExp(
      `\\b${NUM}\\s+(?:serves?|servings?|portions?)\\s+of\\s+(veg(?:gies|etables?)?|fruit)\\b`,
    ),
  )
  if (serves)
    return {
      kind: 'habit',
      habit: serves[2]!.startsWith('veg') ? 'veg' : 'fruit',
      amount: count(serves[1]),
      mode: 'add',
    }
  const sleep =
    t.match(
      /\bslept\s+(?:for\s+)?(?:about\s+|around\s+)?(\d+(?:\.\d)?|\w+)\s*(?:and a half\s+)?(?:hours?|hrs?|h)\b/,
    ) ??
    t.match(
      /\b(?:got|had)\s+(?:about\s+)?(\d+(?:\.\d)?|\w+)\s*(?:hours?|hrs?)\s+(?:of\s+)?sleep\b/,
    )
  if (sleep) {
    const n = count(sleep[1], NaN) + (/and a half/.test(sleep[0]) ? 0.5 : 0)
    if (n > 0 && n <= 16)
      return { kind: 'habit', habit: 'sleep', amount: n, mode: 'set' }
  }
  return null
}

// ---------------------------------------------------------------- food and drink

const MEAL_WORDS: [RegExp, Meal][] = [
  [/\b(breakfast|brekkie|brekky)\b/, 'breakfast'],
  [/\b(lunch)\b/, 'lunch'],
  [/\b(dinner|tea|supper)\b/, 'dinner'],
  [/\b(snack|morning tea|afternoon tea|arvo snack)\b/, 'snack'],
]
const DRINKS =
  /\b(coffee|flat white|latte|cappuccino|long black|short black|espresso|macchiato|mocha|chai|tea|energy drink|red bull|monster|coke|pepsi|soft drink|soda|juice|smoothie|protein shake|shake|milkshake|beer|wine|glass of wine|cider|spirits?|vodka|gin|rum|whisky|bourbon)\b/

function cleanFood(s: string): string {
  return s
    .replace(/^(?:some|a bit of|a little|the|a|an|my)\s+/i, '')
    .replace(
      /\s+(?:today|tonight|this morning|this arvo|this afternoon|this evening|just now)$/i,
      '',
    )
    .replace(/[.!]+$/, '')
    .trim()
}

function servingsOf(s: string): { servings: number; food: string } {
  const m = s.match(
    /^(half|a half|half a|half of|quarter|a quarter of|two|2|three|3|1\.5|one and a half)\s+(?:serves?\s+of\s+|servings?\s+of\s+|portions?\s+of\s+|of\s+)?(?:the\s+)?(.+)$/i,
  )
  if (!m) return { servings: 1, food: s }
  const w = m[1]!.toLowerCase()
  const servings =
    /half/.test(w) && !/one and/.test(w)
      ? 0.5
      : /quarter/.test(w)
        ? 0.25
        : /one and a half|1\.5/.test(w)
          ? 1.5
          : count(w, 1)
  return { servings, food: m[2]! }
}

function parseMeal(t: string): HealthOp | null {
  const mealWord = (s: string) =>
    MEAL_WORDS.find(([re]) => re.test(s))?.[1] ?? null
  // "for dinner I had X" / "dinner was X" / "breakfast: X"
  const lead = t.match(
    /^(?:for\s+)?(breakfast|brekkie|brekky|lunch|dinner|tea|supper|morning tea|afternoon tea|a snack|snack)\s*(?:i\s+(?:had|ate)|was|:|-)\s*(.+)$/,
  )
  if (lead) {
    const { servings, food } = servingsOf(cleanFood(lead[2]!))
    if (food) return { kind: 'meal', meal: mealWord(lead[1]!), food, servings }
  }
  // "had X for dinner" / "ate X for lunch" / "had X" (meal chosen by the time of day)
  const ate = t.match(
    /^(?:i\s+)?(?:just\s+)?(?:had|ate|eaten|have had|i've had|snacked on|munched on|drank|had a drink of)\s+(.+?)(?:\s+(?:for|at|with)\s+(breakfast|brekkie|brekky|lunch|dinner|tea|supper|morning tea|afternoon tea|(?:a\s+)?snack))?$/,
  )
  if (!ate) return null
  const rest = cleanFood(ate[1]!)
  const isDrink =
    /^(?:drank|had a drink of)/.test(t.replace(/^i\s+/, '')) ||
    DRINKS.test(rest)
  const meal: Meal | null = ate[2]
    ? mealWord(ate[2])
    : /snacked|munched/.test(t)
      ? 'snack'
      : isDrink && !ate[2]
        ? 'drink'
        : null
  // Without a meal word, "had" is too broad ("had a meeting"): only food-ish phrases, or a drink.
  if (!ate[2] && !isDrink && !/^(?:i\s+)?(?:ate|eaten|snacked|munched)/.test(t))
    return null
  const { servings, food } = servingsOf(rest)
  return food ? { kind: 'meal', meal, food, servings } : null
}

// ---------------------------------------------------------------- supplements

const SUPPLEMENT_WORDS =
  /\b(vitamins?|multivitamins?|multi|supplements?|tablets?|pills?|capsules?|meds|medications?|fish oil|omega|magnesium|zinc|iron|probiotic|creatine|protein powder|pre-?workout|fat burner|collagen)\b/

function parseDose(t: string): HealthOp | null {
  const m = t.match(
    /^(?:i\s+)?(?:just\s+|already\s+)?(?:took|taken|have taken|i've taken|had|swallowed|popped)\s+(?:my|the|a|an|one|two)?\s*(.+?)(?:\s+(?:today|this morning|tonight|with breakfast|with dinner|with food|just now))?$/,
  )
  if (!m) return null
  const what = m[1]!.trim()
  // "had" only counts when it names something supplement-like ("had my multivitamin").
  if (
    /^(?:i\s+)?had\b/.test(t) &&
    !SUPPLEMENT_WORDS.test(what) &&
    !/^(?:i\s+)?had\s+my\s+/.test(t)
  )
    return null
  if (
    /^(?:i\s+)?(?:took|taken|have taken|i've taken)\b/.test(t) === false &&
    !/^(?:i\s+)?had\b/.test(t) &&
    !/\b(swallowed|popped)\b/.test(t)
  )
    return null
  // "took the bins out", "took my dog for a walk": not doses.
  if (
    /\b(out|for a|to the|to school|off|over|back|bins?|dog|kids?|car|photo|picture|shower|bath|nap|break|day off|call|test|exam)\b/.test(
      what,
    ) &&
    !SUPPLEMENT_WORDS.test(what)
  )
    return null
  const generic =
    /^(?:vitamins|supplements|tablets|pills|capsules|meds|medications|morning (?:vitamins|supplements)|everything)$/.test(
      what,
    )
  const viaHad = /^(?:i\s+)?had\b/.test(t)
  // "had my coffee", "had my lunch": food and drink, not supplements.
  if (
    viaHad &&
    !SUPPLEMENT_WORDS.test(what) &&
    (DRINKS.test(what) || MEAL_WORDS.some(([re]) => re.test(what)))
  )
    return null
  return {
    kind: 'dose',
    name: generic
      ? null
      : what.replace(/\s+(?:tablet|pill|capsule|scoop|dose)s?$/, ''),
    ...(viaHad ? { viaHad } : {}),
  }
}

// ---------------------------------------------------------------- questions

function parseQuery(t: string): HealthOp | null {
  if (
    /^(?:did|have)\s+i\s+(?:take|taken|had)\s+(?:my|the|all my)?\s*(.+?)(?:\s+(?:today|yet))*\??$/.test(
      t,
    )
  ) {
    const what =
      t.match(
        /(?:take|taken|had)\s+(?:my|the|all my)?\s*(.+?)(?:\s+(?:today|yet))*\??$/,
      )?.[1] ?? ''
    if (
      SUPPLEMENT_WORDS.test(what) ||
      /\b(deficit|voost|blackmores|swisse|nature'?s way)\b/.test(what)
    )
      return { kind: 'query', what: 'supplements' }
  }
  if (
    /\b(?:what|which)\s+(?:vitamins|supplements|tablets)\b.*\b(?:left|still|to take|haven'?t)\b/.test(
      t,
    )
  )
    return { kind: 'query', what: 'supplements' }
  if (
    /^how\s+(?:am i|'?m i|is my)\s+(?:going|doing|tracking)\s+(?:with|on)\s+(?:my\s+)?(?:weight|weight loss|losing weight)\b|^how(?:'s| is)\s+my\s+weight\b/.test(
      t,
    )
  ) {
    return { kind: 'query', what: 'weight' }
  }
  if (
    /^how(?:'s| is| am i)\s+(?:my\s+)?(?:health|eating|macros|calories|nutrition|food)(?:\s+(?:going|looking|today|tracking))*\??$|^how many calories\s+(?:have i|did i)\b|^what(?:'s| is| have i)\s+(?:my\s+)?(?:eaten|calories|macros)\b/.test(
      t,
    )
  ) {
    return { kind: 'query', what: 'today' }
  }
  return null
}

const FUTURE =
  /^(?:remind|please remind|don'?t forget)|\b(need to|have to|has to|should|going to|gonna|will|want to|wanna|plan to|planning to|must|tomorrow|next week|later today|tonight i'?ll)\b/

/** Clearly about health, even when the details weren't understood: keep it out of the AI review queue. */
const HEALTH_HINT =
  /\b(weigh(?:ed|t)?|kilos?|kgs?|calories|kcal|macros?|protein|carbs|breakfast|brekkie|lunch|dinner|snack(?:ed)?|ate|eaten|drank|walked|ran|jogged|gym|workout|exercise(?:d)?|steps|slept|sleep|vitamins?|supplements?|multivitamin)\b/

export function parseHealth(rawClause: string): HealthOp | null {
  const t = rawClause
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^(?:ok(?:ay)?|so|um+|right|oh|well|yeah|and|also)[,\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return null
  const query = parseQuery(t)
  if (query) return query
  // Plans and reminders ("need to walk the dog", "remind me to take my vitamins") are not logs.
  if (FUTURE.test(t)) return null
  return (
    parseQuery(t) ??
    parseWeigh(t) ??
    parseHabit(t) ??
    parseDose(t) ??
    parseActivity(t) ??
    parseMeal(t) ??
    null
  )
}

/** For clauses nothing else understood: is this about health? */
export function looksLikeHealth(rawClause: string): boolean {
  return HEALTH_HINT.test(rawClause.toLowerCase())
}
