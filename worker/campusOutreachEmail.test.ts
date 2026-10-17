import { describe, expect, it } from 'vitest'
import { campusOutreachEmail } from './lib/campusOutreachEmail'

const base = {
  to: 'student-support@example.edu',
  senderPostalAddress: 'Pocket Goblin, PO Box Example, Exampletown',
}

describe('campus outreach email', () => {
  it('renders a readable branded HTML email and matching plain-text version', () => {
    const email = campusOutreachEmail(base)
    expect(email.to).toBe(base.to)
    expect(email.subject).toContain('Pocket Goblin')
    expect(email.html).toContain('Pocket Goblin')
    expect(email.html).toContain('/icons/icon-192.png')
    expect(email.html).toContain('10% OFF PREMIUM')
    expect(email.html).toContain('CAMPUS10')
    expect(email.html).toContain('first 12 months')
    expect(email.html).toContain('https://pocketgoblin.org')
    expect(email.text).toContain('CAMPUS10')
    expect(email.text).toContain('permanent free version')
    expect(email.text).toContain('Useful far beyond university')
    expect(email.text).toContain(
      'parents, professionals, homeschooling families',
    )
    expect(email.html).toContain('Useful far beyond university')
    expect(email.html).toContain('long after graduation')
    expect(email.html).toContain('10% OFF PREMIUM')
    expect(email.html).toContain(base.senderPostalAddress)
    expect(email.text).toContain(base.senderPostalAddress)
    expect(email.html).toContain('mailto:support@pocketgoblin.org')
    expect(email.html).not.toContain('tracking-pixel')
  })

  it('escapes institution names rather than injecting HTML', () => {
    const email = campusOutreachEmail({
      ...base,
      institutionName: '<img src=x onerror=alert(1)> & Co',
    })
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; Co')
    expect(email.html).not.toContain('<img src=x onerror=')
    expect(email.text).toContain('<img src=x onerror=alert(1)> & Co')
  })

  it('requires public sender postal details to discourage noncompliant campaigns', () => {
    expect(() =>
      campusOutreachEmail({ ...base, senderPostalAddress: '   ' }),
    ).toThrow('sender postal address')
  })

  it('works without institution personalisation', () => {
    const email = campusOutreachEmail(base)
    expect(email.html).toContain('Hello!')
    expect(email.text).toContain('Hello!')
  })
})
