import { describe, expect, it } from 'vitest'

import {
  claimCaptureItem,
  findExistingItem,
  releaseCaptureItem,
  type OpenItemIndex,
} from './dedupe'

/** Minimal D1 stand-in: one capture item row with a status column. */
function fakeDb(initialStatus: string) {
  const row = { status: initialStatus }
  const db = {
    row,
    prepare(sql: string) {
      return {
        bind() {
          return {
            async run() {
              let changes = 0
              if (/SET status = 'accepted'/.test(sql)) {
                if (row.status === 'suggested') {
                  row.status = 'accepted'
                  changes = 1
                }
              } else if (/SET status = 'suggested'/.test(sql)) {
                if (row.status === 'accepted') {
                  row.status = 'suggested'
                  changes = 1
                }
              }
              return { meta: { changes } }
            },
          }
        },
      }
    },
  }
  return db as unknown as D1Database & { row: { status: string } }
}

describe('claimCaptureItem', () => {
  it('lets exactly one of two concurrent accepts win', async () => {
    const db = fakeDb('suggested')
    const results = await Promise.all([
      claimCaptureItem(db, 'user', 'item'),
      claimCaptureItem(db, 'user', 'item'),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(db.row.status).toBe('accepted')
  })

  it('refuses suggestions that were already rejected', async () => {
    expect(await claimCaptureItem(fakeDb('rejected'), 'user', 'item')).toBe(
      false,
    )
  })

  it('can be released for a retry after a failed create', async () => {
    const db = fakeDb('suggested')
    await claimCaptureItem(db, 'user', 'item')
    await releaseCaptureItem(db, 'user', 'item')
    expect(db.row.status).toBe('suggested')
  })
})

describe('findExistingItem', () => {
  const index: OpenItemIndex = {
    tasks: new Map([
      [
        'pay electricity bill',
        { kind: 'task', id: 'task_1', title: 'Pay the electricity bill' },
      ],
    ]),
    shopping: new Map([
      ['milk', { kind: 'shopping', id: 'sitem_1', title: 'Milk' }],
    ]),
  }

  it('matches open tasks for task-creating kinds', () => {
    expect(findExistingItem(index, 'task', 'pay electricity bill!')?.id).toBe(
      'task_1',
    )
    expect(
      findExistingItem(index, 'reminder', 'Pay the electricity bill')?.id,
    ).toBe('task_1')
  })

  it('matches unticked shopping items for shopping', () => {
    expect(findExistingItem(index, 'shopping', 'milk')?.id).toBe('sitem_1')
    expect(findExistingItem(index, 'shopping', 'bread')).toBeNull()
  })

  it('never blocks notes or appointments', () => {
    expect(findExistingItem(index, 'note', 'Milk')).toBeNull()
    expect(
      findExistingItem(index, 'appointment', 'Pay electricity bill'),
    ).toBeNull()
  })
})
