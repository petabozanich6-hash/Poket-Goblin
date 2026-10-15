import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

/**
 * A PDF the way modern tools write it: catalog → page tree, objects packed
 * in a compressed object stream, a Type0 font showing hex glyph ids, and a
 * compressed /ToUnicode map using bfchar plus both bfrange forms.
 */
function cidPdf(opts: { toUnicode: boolean }): Uint8Array {
  const cmap = `/CIDInit /ProcSet findresource begin
begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar
<0003> <0020>
<0010> <2014>
endbfchar
2 beginbfrange
<0024> <003D> <0041>
<0044> <0046> [<0061> <0062> <00E9>]
endbfrange
endcmap`
  // "CAB" via the incremental range (0x26 → C), a space, "abé" via the array
  // form, an em dash, and a kerned TJ that should become a space.
  const content =
    'BT /F1 12 Tf 1 0 0 -1 72 720 Tm <002600240025> Tj <0003> Tj <004400450046> Tj ' +
    '<0010> Tj ET BT 1 0 0 -1 72 700 Tm [<0024> -400 <0025>] TJ ET'
  const packed = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /Contents 6 0 R /Resources << /Font << /F1 4 0 R >> >> >>`,
    `<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Georgia /Encoding /Identity-H${opts.toUnicode ? ' /ToUnicode 5 0 R' : ''} >>`,
  ]
  let header = ''
  let body = ''
  packed.forEach((obj, i) => {
    header += `${i + 1} ${body.length} `
    body += `${obj}\n`
  })
  const objStm = deflateSync(Buffer.from(header + body, 'latin1'))
  const cmapZ = deflateSync(Buffer.from(cmap, 'latin1'))
  const contentZ = deflateSync(Buffer.from(content, 'latin1'))
  const stream = (n: number, dict: string, data: Buffer) =>
    Buffer.concat([
      Buffer.from(
        `${n} 0 obj\n<< ${dict} /Length ${data.length} /Filter /FlateDecode >>\nstream\n`,
        'latin1',
      ),
      data,
      Buffer.from('\nendstream\nendobj\n', 'latin1'),
    ])
  return new Uint8Array(
    Buffer.concat([
      Buffer.from('%PDF-1.7\n', 'latin1'),
      stream(7, `/Type /ObjStm /N 4 /First ${header.length}`, objStm),
      stream(5, '', cmapZ),
      stream(6, '', contentZ),
      Buffer.from('%%EOF\n', 'latin1'),
    ]),
  )
}

describe('pdf with embedded font character maps', () => {
  it('decodes hex glyph ids through ToUnicode, inside object streams', async () => {
    const text = await extractPdfText(cidPdf({ toUnicode: true }))
    expect(text).toBe('CAB abé—\nA B')
  })

  it('never shows glyph-id garbage when a font has no map', async () => {
    const res = await extractText(
      cidPdf({ toUnicode: false }),
      'application/pdf',
    )
    expect(res).toEqual({ text: '', needsVision: true })
  })

  it('reads a real Chrome-printed PDF (Type0 fonts, Identity-H)', async () => {
    const bytes = new Uint8Array(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          'fixtures/chrome-cid-fonts.pdf',
        ),
      ),
    )
    const res = await extractText(bytes, 'application/pdf')
    expect(res.needsVision).toBe(false)
    expect(res.text).toMatch(/^Judicial Independence in Australia\n/)
    expect(res.text).toContain('Submissions are due by 28 November 2026.')
    expect(res.text).toContain('“quotes” and café accents')
  })
})
