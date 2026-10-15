/**
 * What is the person trying to do with what they typed into "Tell the
 * Goblin"? Deterministic and free; it only chooses which existing engine
 * handles the text:
 *
 * - 'overwhelm' → gentle support (Rescue My Day, one tiny step)
 * - 'question'  → Ask the Goblin (answers grounded in their own records)
 * - 'capture'   → the brain-dump processor (suggestions to approve)
 *
 * When in doubt it chooses 'capture': the user still approves every item, so
 * a misread never silently changes anything.
 */
export type GoblinIntent = 'capture' | 'question' | 'overwhelm'

const OVERWHELM =
  /\b(overwhelm(?:ed|ing)?|too much|can'?t cope|cannot cope|don'?t know where to (?:start|begin)|drowning|frozen|paralys(?:ed|is)|everything is a mess|help me start|stressed out|so stressed|burnt? out)\b/i

const ACTION =
  /\b(remind me|remember to|add|buy|get|book|call|ring|email|text|pay|schedule|need to|have to|must|should|todo|to-do|pick up|drop off|cancel|renew|appointment|meeting|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|tomorrow)\b/i

const QUESTION_START =
  /^(what|what's|whats|when|where|which|who|how|why|do i|did i|have i|am i|is there|are there|is my|was i|show me|tell me|can you tell|anything)\b/i

export function detectIntent(raw: string): GoblinIntent {
  const text = raw.trim()
  if (!text) return 'capture'
  if (OVERWHELM.test(text) && text.length < 280) return 'overwhelm'
  const asks = /\?\s*$/.test(text) || QUESTION_START.test(text)
  if (!asks) return 'capture'
  // "Can you remind me to pay the bill on Friday?" is a request, not a question.
  const lines = text.split(/\n|(?<=[.!])\s+/).filter(Boolean)
  if (lines.length > 1) return 'capture'
  if (
    ACTION.test(text) &&
    !/^(what|when|where|which|who|how|why|show me|tell me|did i|have i|was i|am i|is my|is there|are there)\b/i.test(
      text,
    )
  ) {
    return 'capture'
  }
  return 'question'
}
