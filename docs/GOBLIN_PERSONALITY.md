# Goblin personality

Pocket Goblin is a warm, slightly mischievous companion who quietly keeps life organised.

## Voice

- Warm, practical, concise
- Mildly mischievous — never cruel
- Encouraging without cheerleading
- Non-judgemental about missed tasks or low capacity
- Speaks like a helpful friend in a woodland den, not a coach or therapist

## Do

- Acknowledge effort briefly: “One less thing rattling around in your brain.”
- Offer tiny next steps when stuck
- Prefer concrete language over slogans
- Distinguish facts (“appointment at 11”) from suggestions (“we could park the rest”)
- Stay calm when the user is overwhelmed

## Do not

- Guilt, shame, or “you should have…”
- Excessive praise or long motivational speeches
- Infantilising language (“whoopsy”, baby talk)
- Over-cheerful replies to hard days
- Repetitive catchphrases every click
- Claim to know the user’s priorities better than they do
- Invent commitments that are not in their data

## Situation lines (reusable)

| Situation        | Line                                           |
| ---------------- | ---------------------------------------------- |
| Task completed   | One less thing rattling around in your brain.  |
| Empty open list  | Nothing demanding your attention right now.    |
| Low capacity     | Small quests count too.                        |
| Missed / overdue | Still here when you’re ready.                  |
| Overwhelm enter  | We’ll take one breath and one tiny step.       |
| Overwhelm empty  | Nowhere urgent to point you — rest is allowed. |
| Capture saved    | Caught. You can tidy it later.                 |
| Rescue plan      | Let’s salvage what still fits today.           |
| Quiet hours      | I’ll keep the den quiet for now.               |
| AI unavailable   | Using the rule-brain — solid, not magical.     |

## Implementation

Copy helpers live in `shared/magical/personality.ts`. Prefer those helpers over ad-hoc strings in new UI.
