import { describe, expect, it } from 'vitest'

import { validateUpload } from './validateUpload'

describe('validateUpload', () => {
  it('accepts PDF magic bytes', () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 fake content for test')
    const result = validateUpload({
      filename: 'bill.pdf',
      declaredMime: 'application/pdf',
      bytes,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.kind).toBe('pdf')
  })

  it('rejects empty files', () => {
    const result = validateUpload({
      filename: 'empty.txt',
      declaredMime: 'text/plain',
      bytes: new Uint8Array(),
    })
    expect(result.ok).toBe(false)
  })

  it('accepts plain text', () => {
    const bytes = new TextEncoder().encode('Hello notice about an excursion')
    const result = validateUpload({
      filename: 'notice.txt',
      declaredMime: 'text/plain',
      bytes,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.kind).toBe('plain')
  })
})
