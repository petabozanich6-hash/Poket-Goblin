import {
  understandDocument,
  type DocumentSuggestion,
  type DocumentUnderstanding,
  type ExtractedFact,
} from './understand'

export type { DocumentSuggestion, ExtractedFact }

export type DocumentInterpretResult = DocumentUnderstanding

/**
 * Rule-based document interpretation from extracted plain text.
 * Never invents amounts or dates that are not present as cues.
 * Kept for existing callers; see understandDocument() for options.
 */
export function interpretDocumentText(
  text: string,
  filename: string,
): DocumentInterpretResult {
  return understandDocument(text, filename)
}

/** Extract readable text from UTF-8 plain files; PDFs/images need further stages. */
export function extractPlainText(
  bytes: Uint8Array,
  mime: string,
): { text: string; needsOcr: boolean } {
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'text/markdown'
  ) {
    return {
      text: new TextDecoder('utf-8').decode(bytes),
      needsOcr: false,
    }
  }
  if (mime === 'application/pdf') {
    // Lightweight extract of printable strings from simple text PDFs
    const raw = new TextDecoder('latin1').decode(bytes)
    const chunks: string[] = []
    const re = /\(([^)\\]|\\.)*\)/g
    let match: RegExpExecArray | null
    while ((match = re.exec(raw))) {
      const inner = match[0]
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\(.)/g, '$1')
      if (inner.trim().length > 1) chunks.push(inner)
    }
    const text = chunks.join(' ').replace(/\s+/g, ' ').trim()
    if (text.length < 20) {
      return { text: '', needsOcr: true }
    }
    return { text: text.slice(0, 20_000), needsOcr: false }
  }
  if (mime.startsWith('image/')) {
    return { text: '', needsOcr: true }
  }
  // docx is zip+xml — without a zip parser, mark as needs structured extract
  if (mime.includes('word')) {
    return { text: '', needsOcr: false }
  }
  return { text: '', needsOcr: true }
}
