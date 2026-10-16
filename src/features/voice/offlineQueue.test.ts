import { describe, expect, it } from 'vitest'

import { enqueue, readQueue, remove } from './offlineQueue'

function memory(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  }
}

describe('offline thoughts', () => {
  it('keeps each thought with its own request id, per account', () => {
    const s = memory()
    const a = enqueue('user_a', 'milk', s)
    enqueue('user_a', 'call the dentist', s)
    enqueue('user_b', 'bread', s)
    expect(readQueue('user_a', s).map((i) => i.text)).toEqual([
      'milk',
      'call the dentist',
    ])
    expect(readQueue('user_b', s).map((i) => i.text)).toEqual(['bread'])
    expect(a.requestId).toMatch(/^req_[0-9a-f]{24}$/)
    remove('user_a', a.requestId, s)
    expect(readQueue('user_a', s).map((i) => i.text)).toEqual([
      'call the dentist',
    ])
  })

  it('refuses rather than silently dropping when the device is full', () => {
    const s = memory()
    s.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(() => enqueue('user_a', 'milk', s)).toThrow()
  })

  it('survives corrupted storage', () => {
    const s = memory()
    s.setItem('pg:offline-thoughts:user_a', '{not json')
    expect(readQueue('user_a', s)).toEqual([])
  })
})
