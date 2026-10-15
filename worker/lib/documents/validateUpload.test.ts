import { describe, expect, it } from 'vitest'

import { MAX_UPLOAD_BYTES, validateUpload } from './validateUpload'

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

  it('allows files up to 10 MiB and rejects anything larger', () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024)
    const atLimit = new Uint8Array(MAX_UPLOAD_BYTES).fill(0x41)
    expect(
      validateUpload({
        filename: 'big.txt',
        declaredMime: 'text/plain',
        bytes: atLimit,
      }).ok,
    ).toBe(true)
    const over = validateUpload({
      filename: 'big.txt',
      declaredMime: 'text/plain',
      bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1).fill(0x41),
    })
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.error).toContain('10 MB')
  })
})
