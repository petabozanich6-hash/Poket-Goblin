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
  /** Glyph advance widths in 1/1000 em, to tell letter gaps from word gaps. */
  widths: Map<number, number>
  defaultWidth: number
  /** Width units to ems: 1/1000, or a Type 3 font's own FontMatrix. */
  widthScale: number
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

/** Numbers and nested arrays of a PDF array, e.g. "[3 [500 600] 10 20 250]". */
function parseArray(text: string): (number | number[])[] {
  const out: (number | number[])[] = []
  let inner: number[] | null = null
  for (const m of text.matchAll(/\[|\]|[-+]?(?:\d+\.?\d*|\.\d+)/g)) {
    if (m[0] === '[') {
      if (out.length === 0 && inner === null && m.index === text.indexOf('['))
        continue
      inner = []
    } else if (m[0] === ']') {
      if (inner) {
        out.push(inner)
        inner = null
      }
    } else (inner ?? out).push(Number(m[0]))
  }
  return out
}

function fontWidths(
  objects: Map<number, PdfObject>,
  dict: string,
  type0: boolean,
): { widths: Map<number, number>; defaultWidth: number } {
  const widths = new Map<number, number>()
  if (type0) {
    const descendants = deref(objects, valueOf(dict, 'DescendantFonts'))
    const ref = descendants?.match(/(\d+)\s+\d+\s+R/)
    const cid = ref ? objects.get(Number(ref[1]))?.dict : descendants
    if (!cid) return { widths, defaultWidth: 1000 }
    const dw = Number(valueOf(cid, 'DW') ?? NaN)
    const w = deref(objects, valueOf(cid, 'W'))
    if (w) {
      const items = parseArray(w)
      for (let i = 0; i < items.length && widths.size < 65_536;) {
        const first = items[i]
        const next = items[i + 1]
        if (typeof first !== 'number') {
          i += 1
          continue
        }
        if (Array.isArray(next)) {
          next.forEach((width, k) => widths.set(first + k, width))
          i += 2
        } else if (
          typeof next === 'number' &&
          typeof items[i + 2] === 'number'
        ) {
          const last = Math.min(next, first + 65_535)
          for (let c = first; c <= last; c += 1)
            widths.set(c, items[i + 2] as number)
          i += 3
        } else i += 1
      }
    }
    return { widths, defaultWidth: Number.isFinite(dw) ? dw : 1000 }
  }
  const firstChar = Number(valueOf(dict, 'FirstChar') ?? 0)
  const list = deref(objects, valueOf(dict, 'Widths'))
  if (list) {
    parseArray(list).forEach((width, k) => {
      if (typeof width === 'number') widths.set(firstChar + k, width)
    })
  }
  const known = [...widths.values()].filter((w) => w > 0)
  const average = known.length
    ? known.reduce((a, b) => a + b, 0) / known.length
    : 500
  return { widths, defaultWidth: average }
}

/** Type 3 fonts (Chrome prints web fonts this way) use 1/2048-style units. */
function widthScaleOf(dict: string): number {
  if (!/\/Subtype\s*\/Type3/.test(dict)) return 0.001
  const m = valueOf(dict, 'FontMatrix')?.match(/[-+]?(?:\d+\.?\d*|\.\d+)/)
  const a = m ? Math.abs(Number(m[0])) : 0.001
  return a > 0 && a < 1 ? a : 0.001
}

async function loadFont(
  objects: Map<number, PdfObject>,
  dict: string,
  inflate: Inflate,
): Promise<Font> {
  const type0 = /\/Subtype\s*\/Type0/.test(dict)
  const metrics = {
    ...fontWidths(objects, dict, type0),
    widthScale: widthScaleOf(dict),
  }
  const tu = refNum(valueOf(dict, 'ToUnicode'))
  const cmapObj = tu === null ? undefined : objects.get(tu)
  if (cmapObj) {
    const data = await streamBytes(cmapObj, inflate)
    if (data) {
      const { codeBytes, map } = parseCMap(latin1(data))
      if (map.size)
        return {
          codeBytes: type0 ? 2 : codeBytes,
          map,
          opaque: false,
          ...metrics,
        }
    }
  }
  return { codeBytes: type0 ? 2 : 1, map: null, opaque: type0, ...metrics }
}

type Glyph = { code: number; text: string }

function glyphs(s: string, font: Font | undefined): Glyph[] {
  const bytes = font?.codeBytes ?? 1
  const out: Glyph[] = []
  for (let i = 0; i + bytes <= s.length; i += bytes) {
    let code = 0
    for (let b = 0; b < bytes; b += 1) code = code * 256 + s.charCodeAt(i + b)
    let text = ''
    if (!font) text = String.fromCharCode(code)
    else if (font.opaque) text = ''
    else if (!font.map) text = String.fromCharCode(code)
    else {
      const u = font.map.get(code)
      text = u ?? (bytes === 1 ? String.fromCharCode(code) : '')
    }
    out.push({ code, text })
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

/**
 * Lay text out the way a PDF viewer does: follow the text matrix and each
 * glyph's width, so a gap between two pieces of text becomes a space only
 * when it is word-sized. PDFs that place every letter separately (common
 * when printing web pages) then read as words, not "S t u d y".
 */
function textOfContent(content: string, fonts: Map<string, Font>): string {
  let out = ''
  let font: Font | undefined
  let size = 1
  let charSpacing = 0
  let wordSpacing = 0
  let scale = 1
  let leading = 0
  // Text matrix [a b c d e f] and the start of the current line.
  let tm = [1, 0, 0, 1, 0, 0]
  let tlm = [1, 0, 0, 1, 0, 0]
  // Where the last glyph ended, in the same space as tm's e/f.
  let penX: number | null = null
  let penY: number | null = null
  let stack: Token[] = []
  let array: Token[] | null = null

  const em = () => Math.abs(size * (tm[0] || 1)) || 1
  const newline = () => {
    if (out && !out.endsWith('\n')) out += '\n'
  }
  const space = () => {
    if (out && !/\s$/.test(out)) out += ' '
  }
  /** Decide what separates the new position from the last text drawn. */
  const settle = () => {
    const x = tm[4]!
    const y = tm[5]!
    if (penX === null || penY === null) return
    if (Math.abs(y - penY) > em() * 0.5) newline()
    else {
      const gap = x - penX
      if (gap > em() * 0.15 || gap < -em() * 0.5) space()
    }
  }
  const moveLine = (tx: number, ty: number) => {
    const [a, b, c, d, e, f] = tlm as [
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    tlm = [a, b, c, d, e + tx * a + ty * c, f + tx * b + ty * d]
    tm = [...tlm]
    settle()
  }
  const show = (s: string) => {
    for (const g of glyphs(s, font)) {
      out += g.text
      const w =
        (font?.widths.get(g.code) ?? font?.defaultWidth ?? 500) *
        (font?.widthScale ?? 0.001)
      const isSpace = (font?.codeBytes ?? 1) === 1 && g.code === 32
      const advance =
        (w * size + charSpacing + (isSpace ? wordSpacing : 0)) * scale
      tm = [
        tm[0]!,
        tm[1]!,
        tm[2]!,
        tm[3]!,
        tm[4]! + advance * tm[0]!,
        tm[5]! + advance * tm[1]!,
      ]
    }
    penX = tm[4]!
    penY = tm[5]!
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
    const last = (n: number) => nums[nums.length - n]
    switch (tok.v) {
      case 'BT':
        tm = [1, 0, 0, 1, 0, 0]
        tlm = [1, 0, 0, 1, 0, 0]
        break
      case 'Tf': {
        const name = [...stack].reverse().find((s) => s.t === 'name')
        font = name ? fonts.get(name.v as string) : undefined
        if (last(1) !== undefined) size = last(1)!
        break
      }
      case 'Tc':
        charSpacing = last(1) ?? 0
        break
      case 'Tw':
        wordSpacing = last(1) ?? 0
        break
      case 'Tz':
        scale = (last(1) ?? 100) / 100
        break
      case 'TL':
        leading = last(1) ?? 0
        break
      case 'Td':
        if (nums.length >= 2) moveLine(last(2)!, last(1)!)
        break
      case 'TD':
        if (nums.length >= 2) {
          leading = -last(1)!
          moveLine(last(2)!, last(1)!)
        }
        break
      case 'Tm':
        if (nums.length >= 6) {
          tm = nums.slice(-6)
          tlm = [...tm]
          settle()
        }
        break
      case 'T*':
        moveLine(0, -leading)
        newline()
        break
      case "'":
      case '"': {
        if (tok.v === '"' && nums.length >= 2) {
          wordSpacing = nums[0]!
          charSpacing = nums[1]!
        }
        moveLine(0, -leading)
        newline()
        const s = [...stack].reverse().find((x) => x.t === 'str')
        if (s) show(s.v as string)
        break
      }
      case 'Tj': {
        const s = [...stack].reverse().find((x) => x.t === 'str')
        if (s) show(s.v as string)
        break
      }
      case 'TJ':
        for (const el of array ?? []) {
          if (el.t === 'str') show(el.v)
          else if (el.t === 'num') {
            // TJ adjustments are always thousandths of an em.
            const shift = (-el.v / 1000) * size * scale
            tm = [
              tm[0]!,
              tm[1]!,
              tm[2]!,
              tm[3]!,
              tm[4]! + shift * tm[0]!,
              tm[5]!,
            ]
            if (shift > size * 0.15) space()
            penX = tm[4]!
          }
        }
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
