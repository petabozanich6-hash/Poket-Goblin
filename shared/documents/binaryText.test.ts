import { deflateRawSync, deflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import {
  extractDocxText,
  extractPdfText,
  extractText,
  readZipEntry,
} from './binaryText'

/** Minimal zip writer (deflate) for test fixtures. */
function zip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder()
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(enc.encode(name))
    const raw = Buffer.from(enc.encode(content))
    const data = deflateRawSync(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    locals.push(local, nameBytes, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(files).length, 8)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, ...centrals, eocd]))
}

function pdf(content: string, compressed: boolean): Uint8Array {
  const body = compressed
    ? deflateSync(Buffer.from(content, 'latin1'))
    : Buffer.from(content, 'latin1')
  const head = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Length ${body.length}${compressed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`,
    'latin1',
  )
  const tail = Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')
  return new Uint8Array(Buffer.concat([head, body, tail]))
}

describe('docx extraction', () => {
  it('reads paragraphs from word/document.xml', async () => {
    const docx = zip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml':
        '<w:document><w:body><w:p><w:r><w:t>Dear Parent &amp; Guardian,</w:t></w:r></w:p><w:p><w:r><w:t>Return the form by 20 October 2026.</w:t></w:r></w:p></w:body></w:document>',
    })
    expect(await extractDocxText(docx)).toBe(
      'Dear Parent & Guardian,\nReturn the form by 20 October 2026.',
    )
  })

  it('returns nothing for a zip that is not a Word document', async () => {
    expect(await extractDocxText(zip({ 'a.txt': 'hello' }))).toBe('')
    expect(await readZipEntry(new Uint8Array([1, 2, 3]), 'x')).toBeNull()
  })
})

describe('pdf extraction', () => {
  const content =
    'BT /F1 12 Tf 72 720 Td (Your electricity bill) Tj T* (Amount due: \\24384.20) Tj T* [(Payment due: 28 Oct) -250 (ober 2026)] TJ ET'

  it('reads compressed (FlateDecode) content streams', async () => {
    const text = await extractPdfText(pdf(content, true))
    expect(text).toContain('Your electricity bill')
    expect(text).toContain('Amount due: £84.20')
    expect(text).toContain(
      'Payment due: 28 Oct ober 2026'.replace(' ober', ' ober'),
    )
  })

  it('reads uncompressed content streams', async () => {
    expect(await extractPdfText(pdf(content, false))).toContain(
      'Your electricity bill',
    )
  })

  it('asks for vision when a PDF has no readable text (scans)', async () => {
    const scan = pdf('q 100 0 0 100 0 0 cm /Im1 Do Q', true)
    expect(await extractText(scan, 'application/pdf')).toEqual({
      text: '',
      needsVision: true,
    })
  })

  it('stops at the inflate cap instead of exhausting memory', async () => {
    const bomb = pdf(`BT (${'A'.repeat(9 * 1024 * 1024)}) Tj ET`, true)
    expect(await extractPdfText(bomb)).toBe('')
  })
})
