/**
 * Structured PDF text extraction: walks the page tree, resolves each page's
 * fonts and decodes glyph codes through the font's /ToUnicode CMap.
 *
 * This is what reads PDFs from Chrome/Skia, Word, InDesign and most
 * publishers, which show text as hex glyph ids (`<002D0058> Tj`) that only
 * mean something via the font's character map. Callers fall back to the
 * simple literal-string scanner when this finds nothing.
 */

type PdfObject = { dict: string; data?: Uint8Array; filtered: boolean }

type Font = {
  codeBytes: number
  map: Map<number, string> | null
  /** Type0 fonts without a map are glyph ids — unreadable without vision. */
  opaque: boolean
}

const MAX_OBJECTS = 50_000
const MAX_PAGES = 2_000

export type Inflate = (data: Uint8Array) => Promise<Uint8Array | null>

function latin1(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return s
}

/** Raw stream bytes, inflated if FlateDecode; null for other filters. */
async function streamBytes(
  obj: PdfObject,
  inflate: Inflate,
): Promise<Uint8Array | null> {
  if (!obj.data) return null
  if (!obj.filtered) return obj.data
  if (/\/Filter\s*\[[^\]]*\/(?!FlateDecode)\w+/.test(obj.dict)) return null
  if (!/\/FlateDecode/.test(obj.dict)) return null
  if (
    /\/DecodeParms/.test(obj.dict) &&
    /\/Predictor\s+(?:1[0-5]|2)\b/.test(obj.dict)
  )
    return null
  return inflate(obj.data)
}

async function parseObjects(
  bytes: Uint8Array,
  raw: string,
  inflate: Inflate,
): Promise<Map<number, PdfObject>> {
  const objects = new Map<number, PdfObject>()
  const re = /(\d+)\s+\d+\s+obj\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) && objects.size < MAX_OBJECTS) {
    const num = Number(m[1])
    const start = m.index + m[0].length
    const endobj = raw.indexOf('endobj', start)
    if (endobj < 0) break
    const streamAt = raw.slice(start, endobj).search(/>>\s*stream\r?\n/)
    if (streamAt < 0) {
      objects.set(num, { dict: raw.slice(start, endobj), filtered: false })
      re.lastIndex = endobj
      continue
    }
    const kw = raw.indexOf('stream', start + streamAt)
    let dataStart = kw + 6
    if (raw[dataStart] === '\r') dataStart += 1
    if (raw[dataStart] === '\n') dataStart += 1
    const dict = raw.slice(start, kw)
    const endstream = raw.indexOf('endstream', dataStart)
    if (endstream < 0) break
    const declared = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/)
    let stop = endstream
    if (declared && dataStart + Number(declared[1]) <= endstream) {
      stop = dataStart + Number(declared[1])
    } else {
      while (
        stop > dataStart &&
        (raw[stop - 1] === '\n' || raw[stop - 1] === '\r')
      )
        stop -= 1
    }
    objects.set(num, {
      dict,
      data: bytes.subarray(dataStart, stop),
      filtered: /\/Filter/.test(dict),
    })
    const after = raw.indexOf('endobj', endstream)
    re.lastIndex = after < 0 ? endstream : after
  }

  // Objects packed inside object streams (PDF 1.5+).
  for (const obj of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(obj.dict)) continue
    const data = await streamBytes(obj, inflate)
    if (!data) continue
    const text = latin1(data)
    const n = Number(obj.dict.match(/\/N\s+(\d+)/)?.[1] ?? 0)
    const first = Number(obj.dict.match(/\/First\s+(\d+)/)?.[1] ?? 0)
    const header = text.slice(0, first).trim().split(/\s+/).map(Number)
    for (let i = 0; i < n && i * 2 + 1 < header.length; i += 1) {
      const num = header[i * 2]!
      const from = first + header[i * 2 + 1]!
      const to =
        i + 1 < n
          ? first + (header[(i + 1) * 2 + 1] ?? text.length)
          : text.length
      if (!objects.has(num))
        objects.set(num, { dict: text.slice(from, to), filtered: false })
    }
  }
  return objects
}

/** The value text after `/Key` inside a dictionary string. */
function valueOf(dict: string, key: string): string | null {
  const m = new RegExp(`/${key}(?![A-Za-z0-9])\\s*`).exec(dict)
  if (!m) return null
  const rest = dict.slice(m.index + m[0].length)
  const ref = rest.match(/^(\d+)\s+\d+\s+R/)
  if (ref) return ref[0]
  if (rest.startsWith('<<')) return balanced(rest, '<<', '>>')
  if (rest.startsWith('[')) return balanced(rest, '[', ']')
  return rest.match(/^[^\s/<>[\]]*(?:\/[^\s/<>[\]]+)?/)?.[0] ?? null
}

function balanced(s: string, open: string, close: string): string {
  let depth = 0
  for (let i = 0; i < s.length; i += 1) {
    if (s.startsWith(open, i)) {
      depth += 1
      i += open.length - 1
    } else if (s.startsWith(close, i)) {
      depth -= 1
      i += close.length - 1
      if (depth === 0) return s.slice(0, i + 1)
    }
  }
  return s
}

const refNum = (v: string | null): number | null => {
  const m = v?.match(/^(\d+)\s+\d+\s+R/)
  return m ? Number(m[1]) : null
}

/** Follow a reference to its dictionary text, or return the inline value. */
function deref(
  objects: Map<number, PdfObject>,
  v: string | null,
): string | null {
  const n = refNum(v)
  return n === null ? v : (objects.get(n)?.dict ?? null)
}

function hexBytes(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  const even = clean.length % 2 ? `${clean}0` : clean
  let s = ''
  for (let i = 0; i < even.length; i += 2)
    s += String.fromCharCode(parseInt(even.slice(i, i + 2), 16))
  return s
}

function utf16Hex(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  const units: number[] = []
  for (let i = 0; i + 4 <= clean.length; i += 4)
    units.push(parseInt(clean.slice(i, i + 4), 16))
  if (clean.length === 2) units.push(parseInt(clean, 16))
  return String.fromCharCode(...units)
}

export function parseCMap(text: string): {
  codeBytes: number
  map: Map<number, string>
} {
  const map = new Map<number, string>()
  const space = text.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/)
  const codeBytes = space ? Math.max(1, space[1]!.length / 2) : 2
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g))
      map.set(parseInt(p[1]!, 16), utf16Hex(p[2]!))
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of block[1]!.matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g,
    )) {
      const lo = parseInt(r[1]!, 16)
      const hi = Math.min(parseInt(r[2]!, 16), lo + 0xffff)
      if (r[3] !== undefined) {
        const base = utf16Hex(r[3])
        const last = base.charCodeAt(base.length - 1)
        for (let c = lo; c <= hi; c += 1)
          map.set(c, base.slice(0, -1) + String.fromCharCode(last + (c - lo)))
      } else {
        const dsts = [...r[4]!.matchAll(/<([0-9a-fA-F]*)>/g)]
        for (let c = lo; c <= hi && c - lo < dsts.length; c += 1)
          map.set(c, utf16Hex(dsts[c - lo]![1]!))
      }
    }
  }
  return { codeBytes, map }
}

async function loadFont(
  objects: Map<number, PdfObject>,
  dict: string,
  inflate: Inflate,
): Promise<Font> {
  const type0 = /\/Subtype\s*\/Type0/.test(dict)
  const tu = refNum(valueOf(dict, 'ToUnicode'))
  const cmapObj = tu === null ? undefined : objects.get(tu)
  if (cmapObj) {
    const data = await streamBytes(cmapObj, inflate)
    if (data) {
      const { codeBytes, map } = parseCMap(latin1(data))
      if (map.size)
        return { codeBytes: type0 ? 2 : codeBytes, map, opaque: false }
    }
  }
  return { codeBytes: type0 ? 2 : 1, map: null, opaque: type0 }
}

function decode(s: string, font: Font | undefined): string {
  if (!font) return s
  if (font.opaque) return ''
  if (!font.map) return s
  let out = ''
  for (let i = 0; i + font.codeBytes <= s.length; i += font.codeBytes) {
    let code = 0
    for (let b = 0; b < font.codeBytes; b += 1)
      code = code * 256 + s.charCodeAt(i + b)
    const u = font.map.get(code)
    if (u !== undefined) out += u
    else if (font.codeBytes === 1) out += String.fromCharCode(code)
  }
  return out
}

function unescapeLiteral(inner: string): string {
  return inner.replace(/\\(\r\n|\r|\n|[0-7]{1,3}|.)/g, (_, e: string) => {
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8) & 0xff)
    if (/^[\r\n]/.test(e)) return ''
    return (
      ({ n: '\n', r: '', t: '\t', b: '', f: '' } as Record<string, string>)[
        e
      ] ?? e
    )
  })
}

type Token =
  | { t: 'str'; v: string }
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string }
  | { t: '['; v: '' }
  | { t: ']'; v: '' }

function* tokens(c: string): Generator<Token> {
  let i = 0
  const n = c.length
  while (i < n) {
    const ch = c[i]!
    if (/\s/.test(ch)) {
      i += 1
    } else if (ch === '%') {
      while (i < n && c[i] !== '\n' && c[i] !== '\r') i += 1
    } else if (ch === '(') {
      let depth = 1
      let j = i + 1
      while (j < n && depth > 0) {
        if (c[j] === '\\') j += 2
        else {
          if (c[j] === '(') depth += 1
          else if (c[j] === ')') depth -= 1
          j += 1
        }
      }
      yield { t: 'str', v: unescapeLiteral(c.slice(i + 1, j - 1)) }
      i = j
    } else if (ch === '<' && c[i + 1] === '<') {
      i += 2
    } else if (ch === '>' && c[i + 1] === '>') {
      i += 2
    } else if (ch === '<') {
      const j = c.indexOf('>', i)
      if (j < 0) return
      yield { t: 'str', v: hexBytes(c.slice(i + 1, j)) }
      i = j + 1
    } else if (ch === '[') {
      yield { t: '[', v: '' }
      i += 1
    } else if (ch === ']') {
      yield { t: ']', v: '' }
      i += 1
    } else if (ch === '/') {
      const m = /^\/[^\s/<>[\]()%{}]*/.exec(c.slice(i, i + 128))!
      yield { t: 'name', v: m[0].slice(1) }
      i += m[0].length
    } else if (/[-+.\d]/.test(ch)) {
      const m = /^[-+]?(?:\d+\.?\d*|\.\d+)/.exec(c.slice(i, i + 32))
      if (m) {
        yield { t: 'num', v: Number(m[0]) }
        i += m[0].length
      } else i += 1
    } else {
      const m = /^[^\s/<>[\]()%{}]+/.exec(c.slice(i, i + 32))
      if (!m) {
        i += 1
        continue
      }
      i += m[0].length
      if (m[0] === 'ID') {
        // Inline image data: skip to EI.
        const ei = c.slice(i).search(/\sEI(?=\s|$)/)
        i = ei < 0 ? n : i + ei + 3
        continue
      }
      yield { t: 'op', v: m[0] }
    }
  }
}

function textOfContent(content: string, fonts: Map<string, Font>): string {
  let out = ''
  let font: Font | undefined
  let stack: Token[] = []
  let array: Token[] | null = null
  let y: number | null = null
  const newline = () => {
    if (out && !out.endsWith('\n')) out += '\n'
  }
  const space = () => {
    if (out && !/\s$/.test(out)) out += ' '
  }
  const moveTo = (ny: number, sameLineSpace: boolean) => {
    if (y !== null && Math.abs(ny - y) > 0.5) newline()
    else if (sameLineSpace) space()
    y = ny
  }
  for (const tok of tokens(content)) {
    if (tok.t === '[') {
      array = []
      continue
    }
    if (tok.t === ']') continue
    if (tok.t !== 'op') {
      ;(array ?? stack).push(tok)
      continue
    }
    const nums = stack.filter((s) => s.t === 'num').map((s) => s.v as number)
    switch (tok.v) {
      case 'Tf': {
        const name = [...stack].reverse().find((s) => s.t === 'name')
        font = name ? fonts.get(name.v as string) : undefined
        break
      }
      case 'Tj':
      case "'":
      case '"': {
        if (tok.v !== 'Tj') newline()
        const s = [...stack].reverse().find((x) => x.t === 'str')
        if (s) out += decode(s.v as string, font)
        break
      }
      case 'TJ':
        for (const el of array ?? []) {
          if (el.t === 'str') out += decode(el.v, font)
          else if (el.t === 'num' && el.v < -200) space()
        }
        break
      case 'Td':
      case 'TD':
        if (nums.length >= 2) moveTo((y ?? 0) + nums[nums.length - 1]!, true)
        break
      case 'Tm':
        if (nums.length >= 6) moveTo(nums[nums.length - 1]!, false)
        break
      case 'T*':
        newline()
        break
      case 'ET':
        break
      case 'BT':
        break
    }
    stack = []
    array = null
  }
  return out
}

async function pageOrder(objects: Map<number, PdfObject>): Promise<number[]> {
  const pages: number[] = []
  const seen = new Set<number>()
  const visit = (num: number) => {
    if (seen.has(num) || pages.length >= MAX_PAGES) return
    seen.add(num)
    const dict = objects.get(num)?.dict
    if (!dict) return
    if (/\/Type\s*\/Page(?![s\w])/.test(dict)) {
      pages.push(num)
      return
    }
    const kids = valueOf(dict, 'Kids')
    for (const k of kids?.matchAll(/(\d+)\s+\d+\s+R/g) ?? [])
      visit(Number(k[1]))
  }
  for (const obj of objects.values()) {
    if (/\/Type\s*\/Catalog/.test(obj.dict)) {
      const root = refNum(valueOf(obj.dict, 'Pages'))
      if (root !== null) visit(root)
    }
  }
  if (pages.length) return pages
  return [...objects.entries()]
    .filter(([, o]) => /\/Type\s*\/Page(?![s\w])/.test(o.dict))
    .map(([n]) => n)
    .slice(0, MAX_PAGES)
}

/** Text of a structured PDF, or '' when nothing decodable was found. */
export async function structuredPdfText(
  bytes: Uint8Array,
  inflate: Inflate,
  maxText: number,
): Promise<string> {
  const raw = latin1(bytes)
  const objects = await parseObjects(bytes, raw, inflate)
  const fontCache = new Map<number, Font>()
  const parts: string[] = []
  let total = 0

  const fontsFor = async (pageDict: string): Promise<Map<string, Font>> => {
    let dict: string | null = pageDict
    let resources: string | null = null
    for (let depth = 0; dict && depth < 32; depth += 1) {
      resources = deref(objects, valueOf(dict, 'Resources'))
      if (resources) break
      dict = deref(objects, valueOf(dict, 'Parent'))
    }
    const fonts = new Map<string, Font>()
    const fontDict = resources
      ? deref(objects, valueOf(resources, 'Font'))
      : null
    if (!fontDict) return fonts
    for (const f of fontDict.matchAll(
      /\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g,
    )) {
      const num = Number(f[2])
      let font = fontCache.get(num)
      if (!font) {
        const d = objects.get(num)?.dict
        if (!d) continue
        font = await loadFont(objects, d, inflate)
        fontCache.set(num, font)
      }
      fonts.set(f[1]!, font)
    }
    return fonts
  }

  for (const num of await pageOrder(objects)) {
    const page = objects.get(num)!.dict
    const fonts = await fontsFor(page)
    const contents = valueOf(page, 'Contents')
    const refs = [...(contents?.matchAll(/(\d+)\s+\d+\s+R/g) ?? [])].map((r) =>
      Number(r[1]),
    )
    // A /Contents reference may point at an array object.
    const expanded = refs.flatMap((r) => {
      const o = objects.get(r)
      if (o && !o.data && o.dict.trim().startsWith('['))
        return [...o.dict.matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1]))
      return [r]
    })
    let content = ''
    for (const r of expanded) {
      const o = objects.get(r)
      const data = o ? await streamBytes(o, inflate) : null
      if (data) content += `${latin1(data)}\n`
    }
    const text = textOfContent(content, fonts).trim()
    if (text) {
      parts.push(text)
      total += text.length
      if (total > maxText) break
    }
  }
  return parts.join('\n\n')
}
