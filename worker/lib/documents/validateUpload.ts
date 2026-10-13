export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 // 8 MiB

export type AllowedKind = 'pdf' | 'docx' | 'plain' | 'image' | 'unknown'

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

function sniffKind(bytes: Uint8Array): AllowedKind {
  if (bytes.length >= 4) {
    // %PDF
    if (
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46
    ) {
      return 'pdf'
    }
    // PNG
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return 'image'
    }
    // JPEG
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image'
    }
    // GIF
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38
    ) {
      return 'image'
    }
    // ZIP-based (docx) — PK
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      return 'docx'
    }
  }
  // Heuristic plain text: mostly printable
  const sample = bytes.slice(0, Math.min(bytes.length, 512))
  let printable = 0
  for (const b of sample) {
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable += 1
  }
  if (sample.length > 0 && printable / sample.length > 0.9) return 'plain'
  return 'unknown'
}

export function validateUpload(input: {
  filename: string
  declaredMime: string
  bytes: Uint8Array
}):
  | { ok: true; mime: string; kind: AllowedKind; safeName: string }
  | { ok: false; error: string } {
  if (input.bytes.byteLength === 0) {
    return { ok: false, error: 'Empty files are not allowed' }
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `File is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)} MiB)`,
    }
  }

  const kind = sniffKind(input.bytes)
  if (kind === 'unknown') {
    return {
      ok: false,
      error: 'File type not recognised. Use PDF, Word, text, or common images.',
    }
  }

  const declared = (input.declaredMime || '')
    .toLowerCase()
    .split(';')[0]!
    .trim()
  if (
    declared &&
    !ALLOWED_MIME.has(declared) &&
    declared !== 'application/octet-stream'
  ) {
    return { ok: false, error: `MIME type not allowed: ${declared}` }
  }

  // Reject extension/MIME lies for high-risk mismatches
  const lowerName = input.filename.toLowerCase()
  if (
    kind === 'pdf' &&
    declared &&
    declared !== 'application/pdf' &&
    declared !== 'application/octet-stream'
  ) {
    return {
      ok: false,
      error: 'File content looks like a PDF but the MIME type does not match',
    }
  }
  if (
    kind === 'image' &&
    declared.startsWith('image/') === false &&
    declared !== 'application/octet-stream' &&
    declared !== ''
  ) {
    return {
      ok: false,
      error:
        'File content looks like an image but the MIME type does not match',
    }
  }

  const mime =
    kind === 'pdf'
      ? 'application/pdf'
      : kind === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : kind === 'image'
          ? declared.startsWith('image/')
            ? declared
            : lowerName.endsWith('.png')
              ? 'image/png'
              : 'image/jpeg'
          : 'text/plain'

  const base =
    input.filename.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 180) || 'document'
  return { ok: true, mime, kind, safeName: base }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
