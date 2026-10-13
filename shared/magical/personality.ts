export type PersonalityLine =
  | 'taskCompleted'
  | 'emptyTasks'
  | 'lowCapacity'
  | 'missedTask'
  | 'overwhelmEnter'
  | 'overwhelmEmpty'
  | 'captureSaved'
  | 'rescuePlan'
  | 'quietHours'
  | 'rulesBrain'

const LINES: Record<PersonalityLine, string[]> = {
  taskCompleted: [
    'One less thing rattling around in your brain.',
    'Parked. Soft nod from the den.',
    'Done. The shelves look a little tidier.',
  ],
  emptyTasks: [
    'Nothing demanding your attention right now.',
    'Quiet shelves. Enjoy it while it lasts.',
  ],
  lowCapacity: ['Small quests count too.', 'Tiny steps still move the day.'],
  missedTask: ['Still here when you’re ready.', 'No scolding. It’ll wait.'],
  overwhelmEnter: [
    'We’ll take one breath and one tiny step.',
    'Everything else can wait in the shadows for a moment.',
  ],
  overwhelmEmpty: [
    'Nowhere urgent to point you — rest is allowed.',
    'Nothing on fire. You’re allowed to pause.',
  ],
  captureSaved: [
    'Caught. You can tidy it later.',
    'Safe on the shelf. Review when you like.',
  ],
  rescuePlan: [
    'Let’s salvage what still fits today.',
    'We’ll keep the essentials and park the rest.',
  ],
  quietHours: [
    'I’ll keep the den quiet for now.',
    'Quiet hours — nudges can wait.',
  ],
  rulesBrain: [
    'Using the rule-brain — solid, not magical.',
    'No AI credentials — still sorting with reliable rules.',
  ],
}

export function goblinLine(key: PersonalityLine, seed = Date.now()): string {
  const options = LINES[key]
  return options[Math.abs(seed) % options.length]!
}

export function greetingForHour(hour: number, displayName: string): string {
  const name = displayName.trim() || 'friend'
  if (hour < 12) return `Morning, ${name}.`
  if (hour < 18) return `Afternoon, ${name}.`
  return `Evening, ${name}.`
}
