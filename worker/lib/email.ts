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

/** Hosted on the app itself, so no third-party image host sees opens. */
const LOGO_URL = 'https://pocketgoblin.org/icons/icon-192.png'

const COLOURS = {
  forest: '#2f4a36',
  ink: '#2c2a26',
  muted: '#5c574e',
  faint: '#7a7468',
  paper: '#f7f4ef',
  card: '#ffffff',
  border: '#e2ddd3',
  gold: '#d8b86d',
}

/**
 * The shared Pocket Goblin account email: logo, one clear button with the
 * raw link underneath (some mail apps strip buttons), a plain-text twin,
 * table layout for older mail clients, and a 600px column that reflows on
 * phones. Every value is escaped.
 */
export function accountEmail(input: {
  to: string
  subject: string
  greeting: string
  lines: string[]
  action?: { label: string; url: string }
  footer: string
}): OutgoingEmail {
  const text = [
    input.greeting,
    '',
    ...input.lines,
    ...(input.action ? ['', `${input.action.label}: ${input.action.url}`] : []),
    '',
    input.footer,
    '',
    'Your brain has enough tabs open. Let the goblin handle it.',
    `Pocket Goblin · ${SUPPORT}`,
  ].join('\n')
  const c = COLOURS
  const preheader = escapeHtml(input.lines[0] ?? input.subject)
  const button = input.action
    ? `<tr><td style="padding:8px 0 4px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:10px;background:${c.forest}">
<a href="${escapeHtml(input.action.url)}" style="display:inline-block;padding:14px 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(input.action.label)}</a>
</td></tr></table></td></tr>
<tr><td style="padding:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${c.muted}">
If the button doesn’t work, copy this link into your browser:<br>
<a href="${escapeHtml(input.action.url)}" style="color:${c.forest};word-break:break-all">${escapeHtml(input.action.url)}</a>
</td></tr>`
    : ''
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${c.paper}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${c.paper}">
<tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
<tr><td style="background:${c.forest};border-radius:18px 18px 0 0;padding:22px 24px 18px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle"><img src="${LOGO_URL}" width="54" height="54" alt="Pocket Goblin mascot" style="display:block;border:0;border-radius:14px;background:${c.paper}"></td>
<td style="vertical-align:middle;padding-left:14px;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#ffffff">Pocket Goblin<br><span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:400;letter-spacing:1px;color:${c.gold}">A LITTLE LESS CHAOS. A LOT MORE GOBLIN.</span></td>
</tr></table>
</td></tr>
<tr><td style="background:${c.card};border:1px solid ${c.border};border-top:4px solid ${c.gold};border-radius:0 0 18px 18px;padding:28px 24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:bold;line-height:1.25;color:${c.forest}">${escapeHtml(input.greeting)}</td></tr>
${input.lines.map((l) => `<tr><td style="padding:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:${c.ink}">${escapeHtml(l)}</td></tr>`).join('\n')}
${button}
<tr><td style="padding:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${c.muted}">${escapeHtml(input.footer)}</td></tr>
</table>
</td></tr>
<tr><td style="padding:16px 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${c.faint}">
<strong style="color:${c.forest}">Your brain has enough tabs open. Let the goblin handle it.</strong><br>Questions? Write to <a href="mailto:${SUPPORT}" style="color:${c.forest}">${SUPPORT}</a>.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
  return { to: input.to, subject: input.subject, text, html }
}

/** "Your password was changed" — sent after a change or a reset. */
export function passwordChangedEmail(input: {
  to: string
  displayName: string
  how: 'changed' | 'reset'
  forgotUrl: string
}): OutgoingEmail {
  return accountEmail({
    to: input.to,
    subject: 'Your Pocket Goblin password was changed',
    greeting: `Hi ${input.displayName},`,
    lines: [
      input.how === 'reset'
        ? 'Your Pocket Goblin password was just reset, and every device was signed out.'
        : 'Your Pocket Goblin password was just changed, and your other devices were signed out.',
      'If this was you, there’s nothing else to do.',
    ],
    action: {
      label: 'Wasn’t me — secure my account',
      url: input.forgotUrl,
    },
    footer: `If you didn’t do this, reset your password straight away and tell us at ${SUPPORT}.`,
  })
}
