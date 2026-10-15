import { describe, expect, it } from 'vitest'

import { canonicalCategorySlug } from '../shared/categories'
import { createHarness } from './testing/harness'

describe('life categories', () => {
  it('maps the words the goblin uses onto built-in categories', () => {
    expect(canonicalCategorySlug('admin')).toBe('personal')
    expect(canonicalCategorySlug('Finances')).toBe('money')
    expect(canonicalCategorySlug('study')).toBe('work_study')
    expect(canonicalCategorySlug('home')).toBe('home')
    expect(canonicalCategorySlug(null)).toBeNull()
  })

  it('shows friendly built-in names without changing stored data', async () => {
    const h = createHarness()
    const user = await h.register('cat@example.com')
    const res = await h.request('/api/categories', { cookie: user.cookie })
    const { categories } = (await res.json()) as {
      categories: { slug: string; name: string }[]
    }
    expect(categories.find((c) => c.slug === 'money')?.name).toBe('Finances')
    expect(categories.find((c) => c.slug === 'work_study')?.name).toBe(
      'Work & Study',
    )
    expect(h.query(`SELECT name FROM categories WHERE slug = 'money'`)).toEqual(
      [{ name: 'Money' }],
    )

    // A task filed under an alias lands in the right category, with the label.
    await h.request('/api/tasks', {
      cookie: user.cookie,
      body: { title: 'Renew passport', categorySlug: 'admin' },
    })
    await h.request('/api/tasks', {
      cookie: user.cookie,
      body: { title: 'Pay rent', categorySlug: 'finances' },
    })
    const tasks = (await (
      await h.request('/api/tasks', { cookie: user.cookie })
    ).json()) as {
      tasks: { title: string; categorySlug: string; categoryName: string }[]
    }
    const byTitle = Object.fromEntries(tasks.tasks.map((t) => [t.title, t]))
    expect(byTitle['Renew passport']).toMatchObject({
      categorySlug: 'personal',
      categoryName: 'Personal',
    })
    expect(byTitle['Pay rent']).toMatchObject({
      categorySlug: 'money',
      categoryName: 'Finances',
    })
  })
})
