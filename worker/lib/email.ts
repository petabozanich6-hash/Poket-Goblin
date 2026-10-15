/**
 * Transactional email via the Cloudflare Email Service binding (`EMAIL`).
 *
 * Without the binding (local dev, or before the domain is onboarded) nothing
 * is sent and callers get { sent: false }. Message bodies are never logged:
 * they can contain single-use links.
 */
import type { Env } from '../env'

export const FROM = {
  email: 'no-reply@pocketgoblin.org',
  name: 'Pocket Goblin',
}
export const SUPPORT = 'support@pocketgoblin.org'

export type OutgoingEmail = {
  to: string
  subject: string
  text: string
  html: string
}

export async function sendEmail(
  env: Env,
  message: OutgoingEmail,
): Promise<{ sent: true } | { sent: false; reason: string }> {
  if (!env.EMAIL) return { sent: false, reason: 'not_configured' }
  try {
    await env.EMAIL.send({
      to: message.to,
      from: FROM,
      replyTo: SUPPORT,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })
    return { sent: true }
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'unknown'
    console.error(`email not sent: ${code}`)
    return { sent: false, reason: code }
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Simple, accessible layout shared by account emails. */
export function accountEmail(input: {
  to: string
  subject: string
  greeting: string
  lines: string[]
  action: { label: string; url: string }
  footer: string
}): OutgoingEmail {
  const text = [
    input.greeting,
    '',
    ...input.lines,
    '',
    `${input.action.label}: ${input.action.url}`,
    '',
    input.footer,
    '',
    `Pocket Goblin · ${SUPPORT}`,
  ].join('\n')
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#2c2a26;line-height:1.5;max-width:32rem;margin:0 auto;padding:1.5rem">
<p>${escapeHtml(input.greeting)}</p>
${input.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n')}
<p><a href="${escapeHtml(input.action.url)}" style="display:inline-block;background:#2f4a36;color:#fff;padding:.7rem 1.2rem;border-radius:.6rem;text-decoration:none;font-weight:700">${escapeHtml(input.action.label)}</a></p>
<p style="color:#5c574e;font-size:.9rem">${escapeHtml(input.footer)}</p>
<p style="color:#7a7468;font-size:.8rem">Pocket Goblin · ${SUPPORT}</p>
</body></html>`
  return { to: input.to, subject: input.subject, text, html }
}
