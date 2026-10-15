/**
 * Text extraction for Word (.docx) and PDF without third-party parsers.
 * Uses the platform DecompressionStream (Workers and Node 18+).
 *
 * Guarded against decompression bombs: every inflate stops at MAX_INFLATED.
 * Best effort: scanned PDFs and exotic font encodings yield no text, and the
 * caller then reports that honestly (or uses a vision model if configured).
 */

const MAX_INFLATED = 8 * 1024 * 1024
export const MAX_TEXT = 20_000

async function inflate(
  data: Uint8Array,
  format: 'deflate' | 'deflate-raw',
): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([data as unknown as ArrayBuffer])
      .stream()
      .pipeThrough(new DecompressionStream(format))
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_INFLATED) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.byteLength
    }
    return out
  } catch {
    return null
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&amp;/g, '&')
}

// ----------------------------------------------------------------- .docx (zip)

function u16(b: Uint8Array, o: number) {
  return b[o]! | (b[o + 1]! << 8)
}
function u32(b: Uint8Array, o: number) {
  return (
    (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0
  )
}

/** Read one named entry from a zip archive (stored or deflated). */
export async function readZipEntry(
  zip: Uint8Array,
  name: string,
): Promise<Uint8Array | null> {
  // End of central directory: scan back for PK\x05\x06.
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i -= 1) {
    if (u32(zip, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const entries = u16(zip, eocd + 10)
  let p = u32(zip, eocd + 16)
  const decoder = new TextDecoder()
  for (let i = 0; i < entries && p + 46 <= zip.length; i += 1) {
    if (u32(zip, p) !== 0x02014b50) return null
    const method = u16(zip, p + 10)
    const compressedSize = u32(zip, p + 20)
    const nameLength = u16(zip, p + 28)
    const extraLength = u16(zip, p + 30)
    const commentLength = u16(zip, p + 32)
    const localOffset = u32(zip, p + 42)
    const entryName = decoder.decode(zip.subarray(p + 46, p + 46 + nameLength))
    if (entryName === name) {
      if (u32(zip, localOffset) !== 0x04034b50) return null
      const start =
        localOffset +
        30 +
        u16(zip, localOffset + 26) +
        u16(zip, localOffset + 28)
      const data = zip.subarray(start, start + compressedSize)
      if (method === 0) return data.byteLength <= MAX_INFLATED ? data : null
      if (method === 8) return inflate(data, 'deflate-raw')
      return null
    }
    p += 46 + nameLength + extraLength + commentLength
  }
  return null
}

export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const xmlBytes = await readZipEntry(bytes, 'word/document.xml')
  if (!xmlBytes) return ''
  const xml = new TextDecoder().decode(xmlBytes)
  const text = xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>|<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeXmlEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT)
}

// ------------------------------------------------------------------------ PDF

function latin1(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return s
}

function unescapePdfString(inner: string): string {
  return inner.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e: string) => {
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8))
    return (
      (
        {
          n: '\n',
          r: '',
          t: '\t',
          b: '',
          f: '',
          '(': '(',
          ')': ')',
          '\\': '\\',
        } as Record<string, string>
      )[e] ?? e
    )
  })
}

/** Text-showing operators inside BT … ET blocks of a content stream. */
function textFromContent(content: string): string {
  const out: string[] = []
  for (const block of content.matchAll(/BT([\s\S]*?)ET/g)) {
    const body = block[1]!
    const parts: string[] = []
    const re =
      /\((?:[^()\\]|\\.|\((?:[^()\\]|\\.)*\))*\)\s*(?:Tj|'|")|\[((?:[^\]\\]|\\.)*)\]\s*TJ|(T\*|Td|TD|Tm)/g
    for (const m of body.matchAll(re)) {
      if (m[2]) {
        parts.push(m[2] === 'Tm' || m[2] === 'T*' ? '\n' : ' ')
      } else if (m[1] !== undefined) {
        for (const s of m[1].matchAll(
          /\(((?:[^()\\]|\\.)*)\)|(-?\d+(?:\.\d+)?)/g,
        )) {
          if (s[1] !== undefined) parts.push(unescapePdfString(s[1]))
          else if (Number(s[2]) < -200) parts.push(' ')
        }
      } else {
        const lit = m[0].match(/^\(([\s\S]*)\)\s*(?:Tj|'|")$/)
        if (lit) parts.push(unescapePdfString(lit[1]!))
      }
    }
    out.push(parts.join(''))
  }
  return out.join('\n')
}

function looksLikeText(s: string): boolean {
  const sample = s.slice(0, 2000)
  if (!sample.trim()) return false
  let printable = 0
  for (const ch of sample) {
    const c = ch.charCodeAt(0)
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 160)
      printable += 1
  }
  return printable / sample.length > 0.85
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const raw = latin1(bytes)
  const texts: string[] = []
  const re = /<<([\s\S]{0,2000}?)>>\s*stream\r?\n/g
  let total = 0
  for (const m of raw.matchAll(re)) {
    const dict = m[1]!
    const start = m.index + m[0].length
    const end = raw.indexOf('endstream', start)
    if (end < 0) continue
    if (
      /\/Subtype\s*\/(Image|XML)|\/Type\s*\/(XObject|Metadata|EmbeddedFile|XRef|ObjStm)/.test(
        dict,
      )
    )
      continue
    // Prefer the declared /Length; otherwise drop the EOL before endstream
    // (zlib rejects trailing bytes).
    const declared = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/)
    let stop = end
    if (declared && start + Number(declared[1]) <= end) {
      stop = start + Number(declared[1])
    } else {
      while (stop > start && (raw[stop - 1] === '\n' || raw[stop - 1] === '\r'))
        stop -= 1
    }
    let data = bytes.subarray(start, stop)
    if (/\/FlateDecode/.test(dict)) {
      if (/\/Filter\s*\[[^\]]*\/(?!FlateDecode)\w+/.test(dict)) continue
      const inflated = await inflate(data, 'deflate')
      if (!inflated) continue
      data = inflated
    } else if (/\/Filter/.test(dict)) {
      continue
    }
    const content = latin1(data)
    if (!/\bBT\b/.test(content)) continue
    const text = textFromContent(content)
    if (text.trim()) {
      texts.push(text)
      total += text.length
      if (total > MAX_TEXT) break
    }
  }
  const joined = texts
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return looksLikeText(joined) ? joined.slice(0, MAX_TEXT) : ''
}

/**
 * Text for any supported upload. `needsVision` means only an image-capable
 * model can read it (photos, scans).
 */
export async function extractText(
  bytes: Uint8Array,
  mime: string,
): Promise<{ text: string; needsVision: boolean }> {
  if (mime.startsWith('text/')) {
    return {
      text: new TextDecoder('utf-8').decode(bytes).slice(0, MAX_TEXT),
      needsVision: false,
    }
  }
  if (mime.includes('wordprocessingml')) {
    return { text: await extractDocxText(bytes), needsVision: false }
  }
  if (mime === 'application/pdf') {
    const text = await extractPdfText(bytes)
    return { text, needsVision: text.length < 20 }
  }
  if (mime.startsWith('image/')) return { text: '', needsVision: true }
  return { text: '', needsVision: false }
}
