/**
 * Built-in life categories: one place for their display names and for the
 * words the goblin (rules or AI) may use for them.
 *
 * Display names live in code, not in the database rows, so they can be
 * changed (or later localised) without migrating anyone's data.
 */

export const BUILTIN_CATEGORY_LABELS: Record<string, string> = {
  home: 'Home',
  money: 'Finances',
  health: 'Health',
  family: 'Family',
  work_study: 'Work & Study',
  appointments: 'Appointments',
  shopping: 'Shopping',
  personal: 'Personal',
  other: 'Other',
}

/** Slugs the goblin may produce that map onto a built-in category. */
const SLUG_ALIASES: Record<string, string> = {
  admin: 'personal',
  life_admin: 'personal',
  paperwork: 'personal',
  government: 'personal',
  finance: 'money',
  finances: 'money',
  bills: 'money',
  work: 'work_study',
  study: 'work_study',
  school: 'family',
  medical: 'health',
  errands: 'shopping',
  household: 'home',
}

export function canonicalCategorySlug(
  slug: string | null | undefined,
): string | null {
  if (!slug) return null
  const key = slug
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return SLUG_ALIASES[key] ?? key
}

export function builtinCategoryLabel(slug: string, storedName: string): string {
  return BUILTIN_CATEGORY_LABELS[slug] ?? storedName
}

/** SQL for a category's display name; `c` aliases the categories table. */
export const CATEGORY_NAME_SQL = `CASE WHEN c.user_id IS NULL THEN CASE c.slug ${Object.entries(
  BUILTIN_CATEGORY_LABELS,
)
  .map(([slug, label]) => `WHEN '${slug}' THEN '${label.replace(/'/g, "''")}'`)
  .join(' ')} ELSE c.name END ELSE c.name END`
