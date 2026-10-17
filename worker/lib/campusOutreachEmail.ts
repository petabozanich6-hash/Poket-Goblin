/**
 * Reusable global-campus outreach email.
 *
 * Builds HTML + plain-text content only. DO NOT dispatch this via
 * worker/lib/email.ts: Cloudflare Email Service is transactional-only.
 * An explicitly approved, compliant outreach provider must send it.
 */
import type { OutgoingEmail } from './email'

const SITE = 'https://pocketgoblin.org'
const FACEBOOK = 'https://www.facebook.com/profile.php?id=61595286215724'
const SUPPORT = 'support@pocketgoblin.org'
const LOGO = SITE + '/icons/icon-192.png'
const SUBJECT = 'A little help for your students — Pocket Goblin 👹'
const CODE = 'CAMPUS10'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const features: ReadonlyArray<readonly [string, string]> = [
  [
    'Make sense of study documents',
    'Identify tasks and deadlines from uploaded study schedules, assignment information and PDFs.',
  ],
  [
    'Turn deadlines into a plan',
    'Break larger assignments into manageable steps that fit around available study time.',
  ],
  [
    'Keep responsibilities organised',
    'Stay on top of tasks, recurring commitments and upcoming deadlines.',
  ],
  [
    'Find the important things',
    'Keep documents, notes and useful information together.',
  ],
  [
    'Take the next small step',
    'Work through an overwhelming workload without staring at one enormous to-do list.',
  ],
  [
    'Keep an existing calendar',
    'Export planned schedules to a preferred calendar.',
  ],
]

/**
 * Supply the public organisational address required by the outbound email
 * provider and applicable marketing laws (a business postal/PO-box address).
 * Do not pass private home details unless intentionally public.
 */
export function campusOutreachEmail(input: {
  to: string
  institutionName?: string
  senderPostalAddress: string
}): OutgoingEmail {
  const address = input.senderPostalAddress.trim()
  if (!address) throw new Error('A sender postal address is required.')
  const institution = input.institutionName?.trim()
  const greeting = institution ? 'Hello ' + institution + ' team,' : 'Hello!'
  const intro =
    "I'm the founder of Pocket Goblin, an Australian-built personal organisation platform available worldwide. I created it while juggling university study, parenting, homeschooling and all the everyday chaos that comes with trying to keep everything organised."
  const why =
    "I wanted to create something that went beyond another to-do list and actually helped people work out how to get things done."
  const beyondStudy =
    "And Pocket Goblin isn't just for university. It's designed for the rest of life too — work, appointments, household tasks, family commitments and everything else competing for attention. It's useful for parents, professionals, homeschooling families and anyone trying to keep everyday chaos under control, long after graduation."
  const offer =
    "I'd love to offer your students 10% off Pocket Goblin Premium for their first 12 months, using the code " +
    CODE +
    '. Pocket Goblin also has a permanent free version.'
  const request =
    "Would you consider sharing this offer through a student newsletter, noticeboard or social media, if you think it could be useful? There's no partnership, sponsorship or financial commitment involved — just a practical student discount."
  const signoff =
    'Thank you for your time and consideration!\n\nKind regards,\nPeta Bozanich\nFounder, Pocket Goblin'

  const text = [
    greeting,
    '',
    intro,
    '',
    why,
    '',
    'Pocket Goblin helps students:',
    ...features.map(([title, detail]) => '- ' + title + ': ' + detail),
    '',
    'Useful far beyond university',
    beyondStudy,
    '',
    offer,
    '',
    request,
    '',
    'Explore Pocket Goblin: ' + SITE,
    'Facebook: ' + FACEBOOK,
    '',
    signoff,
    '',
    'Your brain has enough jobs already. Give the chaos a goblin.',
    'Questions, or prefer not to receive further outreach? Reply to ' + SUPPORT,
    address,
  ].join('\n')

  // Keep the verbose, hand-optimised email-client table markup readable.
  // prettier-ignore
  const listHtml = features
    .map(
      ([title, detail]) =>
        '<tr><td style="padding:0 0 14px;vertical-align:top;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#302f2a">' +
        '<strong style="color:#2f4a36">' +
        escapeHtml(title) +
        '</strong><br>' +
        escapeHtml(detail) +
        '</td></tr>',
    )
    .join('\n')

  // prettier-ignore
  const html = [
    '<!doctype html><html lang="en"><head>',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<title>' + escapeHtml(SUBJECT) + '</title></head>',
    '<body style="margin:0;padding:0;background:#f7f4ef">',
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">A useful student organisation tool, plus a simple 10% student discount.</div>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f4ef">',
    '<tr><td align="center" style="padding:28px 12px">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">',
    '<tr><td style="background:#2f4a36;padding:24px;border-radius:16px 16px 0 0">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>',
    '<td style="vertical-align:middle"><img src="' + LOGO + '" alt="Pocket Goblin mascot" width="60" height="60" style="display:block;border:0;border-radius:14px;background:#f7f4ef"></td>',
    '<td style="vertical-align:middle;padding-left:14px">',
    '<div style="font-family:Georgia,serif;font-size:25px;font-weight:bold;color:#ffffff">Pocket Goblin</div>',
    '<div style="padding-top:4px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;color:#ead28e">A LITTLE LESS CHAOS. A LOT MORE GOBLIN.</div>',
    '</td></tr></table></td></tr>',
    '<tr><td style="background:#ffffff;border:1px solid #e2ddd3;border-top:4px solid #d8b86d;border-radius:0 0 16px 16px;padding:28px 24px">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">',
    '<tr><td style="font-family:Arial,sans-serif;font-size:12px;font-weight:bold;letter-spacing:1.4px;color:#786744;padding:0 0 10px">A LITTLE SUPPORT FOR THE STUDENTS</td></tr>',
    '<tr><td style="font-family:Georgia,serif;font-size:26px;font-weight:bold;line-height:1.28;color:#2f4a36;padding:0 0 18px">Their brains have enough tabs open.</td></tr>',
    '<tr><td style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#302f2a;padding:0 0 12px">' +
      escapeHtml(greeting) +
      '</td></tr>',
    '<tr><td style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#302f2a;padding:0 0 12px">' +
      escapeHtml(intro) +
      '</td></tr>',
    '<tr><td style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#302f2a;padding:0 0 18px">' +
      escapeHtml(why) +
      '</td></tr>',
    '<tr><td style="font-family:Georgia,serif;font-size:19px;font-weight:bold;color:#2f4a36;padding:0 0 12px">What can the little goblin do?</td></tr>',
    '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      listHtml +
      '</table></td></tr>',
    '<tr><td style="padding:6px 0 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#f7f4ef;border-left:4px solid #d8b86d;border-radius:8px;padding:16px 18px">',
    '<div style="font-family:Georgia,serif;font-size:19px;font-weight:bold;color:#2f4a36;padding-bottom:8px">Useful far beyond university</div>',
    '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#302f2a">' + escapeHtml(beyondStudy) + '</div>',
    '</td></tr></table></td></tr>',
    '<tr><td style="padding:10px 0 20px">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:#f1ead5;border:1px solid #dcc78b;border-radius:12px;padding:24px 14px">',
    '<div style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:2px;color:#69552e">A LITTLE SOMETHING FOR STUDENTS</div>',
    '<div style="font-family:Georgia,serif;font-size:34px;font-weight:bold;color:#2f4a36;padding:9px 0 4px">10% OFF PREMIUM</div>',
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#302f2a">For the first 12 months · Monthly or annual</div>',
    '<div style="font-family:Arial,sans-serif;font-size:21px;font-weight:bold;letter-spacing:2px;color:#2f4a36;padding:12px 0 0">' +
      CODE +
      '</div>',
    '</td></tr></table></td></tr>',
    '<tr><td style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#302f2a;padding:0 0 13px">' +
      escapeHtml(offer) +
      '</td></tr>',
    '<tr><td style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#302f2a;padding:0 0 18px">' +
      escapeHtml(request) +
      '</td></tr>',
    '<tr><td align="center" style="padding:2px 0 20px">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:10px;background:#2f4a36">',
    '<a href="' + SITE + '" style="display:inline-block;padding:15px 26px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none">Explore Pocket Goblin</a>',
    '</td></tr></table></td></tr>',
    '<tr><td style="font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#5c574e;padding:0 0 18px">Website: <a href="' + SITE + '" style="color:#2f4a36">' + SITE + '</a><br>Facebook: <a href="' + FACEBOOK + '" style="color:#2f4a36">Pocket Goblin on Facebook</a></td></tr>',
    '<tr><td style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#302f2a;white-space:pre-line">' +
      escapeHtml(signoff) +
      '</td></tr>',
    '</table></td></tr>',
    '<tr><td style="padding:20px 12px 0;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#716b5f">',
    '<strong style="color:#2f4a36">Your brain has enough jobs already. Give the chaos a goblin.</strong><br>',
    'Questions or no further emails? Write to <a href="mailto:' + SUPPORT + '?subject=No%20further%20Pocket%20Goblin%20emails" style="color:#2f4a36">' + SUPPORT + '</a>.<br>',
    escapeHtml(address),
    '</td></tr></table></td></tr></table></body></html>',
  ].join('\n')

  return { to: input.to, subject: SUBJECT, text, html }
}