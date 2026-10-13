import { describe, expect, it } from 'vitest'

import { extractPlainText, interpretDocumentText } from './extract'

describe('document extract', () => {
  it('extracts plain text', () => {
    const bytes = new TextEncoder().encode(
      'Amount due: $42.00\nPay by 2026-10-20',
    )
    const result = extractPlainText(bytes, 'text/plain')
    expect(result.needsOcr).toBe(false)
    expect(result.text).toContain('42.00')
  })

  it('marks images as needing OCR without inventing text', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    const result = extractPlainText(bytes, 'image/jpeg')
    expect(result.needsOcr).toBe(true)
    expect(result.text).toBe('')
  })

  it('suggests bill payment without inventing a missing date', () => {
    const result = interpretDocumentText(
      'Electricity bill\nAmount due: $88.50\nPlease pay soon.',
      'power-bill.txt',
    )
    expect(result.status).toBe('ready')
    expect(result.facts.some((f) => f.label === 'Amount')).toBe(true)
    const pay = result.suggestions.find((s) => s.type === 'task')
    expect(pay?.dueDate).toBeNull()
    expect(pay?.uncertain).toBe(true)
  })
})
