/**
 * Extra-tiny first steps for the "Help me start" action.
 * Never invents personal details — stays generic and physical.
 */

const PATTERNS: Array<{ match: RegExp; steps: string[] }> = [
  {
    match: /\b(clean|kitchen|dishes|sink)\b/i,
    steps: [
      'Put one plate in the sink.',
      'Fill a glass with water and leave it by the sink.',
      'Open the dishwasher or cupboard door.',
    ],
  },
  {
    match: /\b(paper|paperwork|mail|documents?|filing)\b/i,
    steps: [
      'Find the first document in the pile.',
      'Put all papers into one stack.',
      'Open the envelope on top — don’t decide yet.',
    ],
  },
  {
    match: /\b(write|essay|assignment|report|email)\b/i,
    steps: [
      'Open the document.',
      'Write one messy sentence.',
      'Type the title or subject line.',
    ],
  },
  {
    match: /\b(call|phone|ring)\b/i,
    steps: [
      'Find the phone number.',
      'Open the phone app.',
      'Write what you want to say in one line.',
    ],
  },
  {
    match: /\b(shop|grocer|buy|errand)\b/i,
    steps: [
      'Open the shopping list.',
      'Add one item you know you need.',
      'Put shoes by the door.',
    ],
  },
  {
    match: /\b(pay|bill|invoice|money)\b/i,
    steps: [
      'Open the bill or banking app.',
      'Find the amount due — just look.',
      'Note the due date somewhere visible.',
    ],
  },
]

const FALLBACK = [
  'Name the very first physical move (open, find, or write).',
  'Set a two-minute timer and only prepare — don’t finish.',
  'Write the task title on a sticky note.',
]

export function suggestTinyFirstSteps(title: string, count = 3): string[] {
  for (const pattern of PATTERNS) {
    if (pattern.match.test(title)) {
      return pattern.steps.slice(0, count)
    }
  }
  return FALLBACK.slice(0, count)
}

export function nextTinierStep(current: string): string {
  const lower = current.toLowerCase()
  if (lower.includes('open'))
    return 'Find the icon or bookmark — don’t open yet.'
  if (lower.includes('write'))
    return 'Pick up a pen or click into the text box.'
  if (lower.includes('find')) return 'Look at the place where it usually lives.'
  if (lower.includes('put')) return 'Touch the object once.'
  return 'Do only the first three seconds of that step.'
}
