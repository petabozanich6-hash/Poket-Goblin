/**
 * Study-plan groups must be reviewed as a whole before creating scheduled
 * tasks. Do not apply this to all school documents: routine permission slips,
 * parent notices and excursion reminders follow ordinary document handling.
 */
export function isStudyPathwayGroup(group: string): boolean {
  const label = group.trim()
  if (!label) return false
  return (
    /^week\s+by\s+week$/i.test(label) ||
    /^study module$/i.test(label) ||
    /^week\s+\d+\b/i.test(label) ||
    /\b(?:assessment|assignment|essay|exam|study plan|research project|research proposal|coursework|portfolio|thesis)\b/i.test(
      label,
    )
  )
}
