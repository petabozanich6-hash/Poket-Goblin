/**
 * The Goblin's spoken reply, in the voice the person chose.
 *
 * Facts come first and are never changed by style: a quip is only ever
 * appended after the useful part, never during anything sensitive (overwhelm,
 * a question back, an error), and never when humour is off.
 */
import type { GoblinProfile } from './profile'

export type ReplyTopic =
  'shopping' | 'task' | 'reminder' | 'event' | 'overview' | 'undo' | 'none'

export type ReplyPart = {
  /** done: something changed. info: an answer. ask: a question back. care: sensitive. */
  tone: 'done' | 'info' | 'ask' | 'care'
  topic: ReplyTopic
  /** The full sentence (used for "detailed" replies and on screen). */
  text: string
  /** A shorter version for "short" replies and Quiet Goblin. */
  brief?: string
  /** Item names, for item-aware quips ("Another dairy emergency…"). */
  items?: string[]
}

const DAIRY = /\b(milk|cheese|butter|yog(?:h)?urt|cream)\b/i
const CAFFEINE = /\b(coffee|tea|energy drink)\b/i
const CHOCOLATE = /\b(chocolate|biscuits?|crisps|snacks?|cake)\b/i

const QUIPS: Record<
  'shopping' | 'task' | 'reminder' | 'event' | 'overview' | 'undo',
  string[]
> = {
  shopping: [
    'The list grows stronger.',
    'Your future self thanks you.',
    'One less thing rattling around in your head.',
  ],
  task: [
    'Out of your head and onto the list.',
    'Filed under “things the Goblin is watching”.',
    'Safely parked.',
  ],
  reminder: ['I’ll nudge you. Gently. Mostly.', 'Consider it remembered.'],
  event: ['In the calendar, where it can’t sneak up on you.'],
  overview: [
    'Manageable. Probably.',
    'A truly heroic level of optimism is advised.',
    'Nothing the two of us can’t handle.',
  ],
  undo: ['As if it never happened.', 'Unscrambled.'],
}

function itemQuip(items: string[]): string | null {
  const all = items.join(' ')
  if (DAIRY.test(all)) return 'Another dairy emergency narrowly avoided.'
  if (CAFFEINE.test(all)) return 'Caffeine supply chain secured.'
  if (CHOCOLATE.test(all)) return 'A wise and necessary purchase.'
  return null
}

/** A small deterministic hash so the same request gets the same line. */
function pick<T>(list: T[], seed: string): T {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0
  return list[Math.abs(h) % list.length]!
}

/** Remove emoji and decorative symbols so speech synthesis reads cleanly. */
export function speakable(text: string): string {
  return text
    .replace(
      /(?:[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|\u{FE0F}|\u{200D})/gu,
      '',
    )
    .replace(/[“”]/g, '"')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function sentence(text: string): string {
  const t = text.trim()
  if (!t) return t
  return /[.!?]$/.test(t) ? t : `${t}.`
}

/** Compose the reply for this turn. `seed` keeps the choice of quip stable. */
export function styleReply(
  parts: ReplyPart[],
  profile: Pick<GoblinProfile, 'style' | 'humour' | 'replyLength'>,
  seed = '',
): string {
  if (parts.length === 0) return ''
  const short = profile.replyLength === 'short' || profile.style === 'quiet'
  const body = parts
    .map((p) => sentence(speakable(short && p.brief ? p.brief : p.text)))
    .filter(Boolean)

  // Many little confirmations read better as one line.
  let text: string
  if (short && body.length > 3) {
    const done = parts.filter((p) => p.tone === 'done').length
    const rest = body.filter((_, i) => parts[i]!.tone !== 'done')
    text = [done ? `${done} things sorted.` : '', ...rest.slice(0, 2)]
      .filter(Boolean)
      .join(' ')
  } else {
    text = body.join(' ')
  }

  if (profile.style === 'professional') {
    return text.replace(/!/g, '.')
  }
  if (profile.style === 'quiet') {
    return text
  }

  const sensitive = parts.some((p) => p.tone === 'care' || p.tone === 'ask')
  const lead = parts.find((p) => p.tone === 'done' || p.tone === 'info')
  let quip: string | null = null
  if (
    !sensitive &&
    lead &&
    profile.humour !== 'none' &&
    lead.topic !== 'none'
  ) {
    const wantsQuip =
      profile.humour === 'lots' ||
      profile.style === 'chaotic' ||
      pick([true, false, false], seed + text)
    if (wantsQuip) {
      quip =
        (lead.topic === 'shopping' && itemQuip(lead.items ?? [])) ||
        pick(QUIPS[lead.topic], seed + lead.text)
    }
  }

  if (profile.style === 'chaotic') {
    const opener = sensitive
      ? ''
      : pick(['RIGHT.', 'BEHOLD.', 'HUMAN.', 'SORTED.'], seed + text)
    return [opener, text, quip ? quip.toUpperCase() : '']
      .filter(Boolean)
      .join(' ')
  }
  return [text, quip].filter(Boolean).join(' ')
}
