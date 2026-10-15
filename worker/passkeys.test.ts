import { beforeEach, describe, expect, it, vi } from 'vitest'

// The cryptographic verification belongs to SimpleWebAuthn and is tested
// there. These tests cover what Pocket Goblin adds around it: who may enrol,
// single-use session-bound challenges, credential ownership and elevation.
const verified = { value: true }
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(async () => ({
    challenge: `reg-${Math.random().toString(36).slice(2)}`,
    rp: { name: 'Pocket Goblin' },
  })),
  generateAuthenticationOptions: vi.fn(async () => ({
    challenge: `auth-${Math.random().toString(36).slice(2)}`,
  })),
  verifyRegistrationResponse: vi.fn(
    async (opts: { response: { id: string } }) =>
      verified.value
        ? {
            verified: true,
            registrationInfo: {
              credential: {
                id: opts.response.id,
                publicKey: new Uint8Array([1, 2, 3]),
                counter: 0,
                transports: ['internal'],
              },
              credentialDeviceType: 'multiDevice',
              credentialBackedUp: true,
            },
          }
        : { verified: false },
  ),
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: verified.value,
    authenticationInfo: { newCounter: 7 },
  })),
}))

import { createHarness, type Harness, type TestUser } from './testing/harness'

let h: Harness
let owner: TestUser

beforeEach(async () => {
  verified.value = true
  h = createHarness()
  owner = await h.register('owner@example.com')
  h.makeOwner(owner.id)
})

const post = (path: string, body: unknown, user = owner) =>
  h.request(`/api/admin/security/${path}`, {
    cookie: user.cookie,
    admin: true,
    body,
  })

async function enrol(id = 'cred-1') {
  const opts = await post('passkeys/register/options', {
    password: 'correct horse battery',
  })
  expect(opts.status).toBe(200)
  return post('passkeys/register/verify', { response: { id }, label: 'Laptop' })
}

describe('passkey enrolment', () => {
  it('requires the account password for the first passkey', async () => {
    expect((await post('passkeys/register/options', {})).status).toBe(401)
    expect(
      (await post('passkeys/register/options', { password: 'wrong guess!!' }))
        .status,
    ).toBe(401)
    const events = h.query(
      `SELECT event_type FROM security_events WHERE user_id = ? AND event_type = 'reauth_failed'`,
      owner.id,
    )
    expect(events).toHaveLength(2)
  })

  it('registers a passkey and audits it', async () => {
    expect((await enrol()).status).toBe(201)
    expect(
      h.query('SELECT id, user_id, label FROM webauthn_credentials'),
    ).toEqual([{ id: 'cred-1', user_id: owner.id, label: 'Laptop' }])
    expect(
      h.query(
        `SELECT action FROM admin_audit_log WHERE action = 'passkey.register'`,
      ),
    ).toHaveLength(1)
  })

  it('uses each challenge once', async () => {
    await enrol()
    const replay = await post('passkeys/register/verify', {
      response: { id: 'cred-2' },
    })
    expect(replay.status).toBe(400)
  })

  it('requires a step-up, not just a password, for additional passkeys', async () => {
    await enrol()
    const res = await post('passkeys/register/options', {
      password: 'correct horse battery',
    })
    expect(res.status).toBe(401)
    h.elevate(owner)
    expect((await post('passkeys/register/options', {})).status).toBe(200)
  })

  it('rejects an unverifiable response', async () => {
    await post('passkeys/register/options', {
      password: 'correct horse battery',
    })
    verified.value = false
    expect(
      (await post('passkeys/register/verify', { response: { id: 'x' } }))
        .status,
    ).toBe(400)
    expect(h.query('SELECT * FROM webauthn_credentials')).toEqual([])
  })

  it('is closed to ordinary customers', async () => {
    const alice = await h.register('alice@example.com')
    const res = await post(
      'passkeys/register/options',
      { password: 'correct horse battery' },
      alice,
    )
    expect(res.status).toBe(404)
  })
})

describe('passkey step-up', () => {
  beforeEach(async () => {
    await enrol()
  })

  it('elevates the session for a limited time', async () => {
    expect((await post('step-up/options', {})).status).toBe(200)
    const res = await post('step-up/verify', { response: { id: 'cred-1' } })
    expect(res.status).toBe(200)
    const { elevatedUntil } = (await res.json()) as { elevatedUntil: string }
    const minutes = (new Date(elevatedUntil).getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(14)
    expect(minutes).toBeLessThanOrEqual(15)
    expect(
      (await h.request('/api/admin/overview', { cookie: owner.cookie })).status,
    ).toBe(200)
    expect(h.query('SELECT counter FROM webauthn_credentials')).toEqual([
      { counter: 7 },
    ])
  })

  it('needs a fresh challenge every time', async () => {
    expect(
      (await post('step-up/verify', { response: { id: 'cred-1' } })).status,
    ).toBe(401)
    await post('step-up/options', {})
    await post('step-up/verify', { response: { id: 'cred-1' } })
    expect(
      (await post('step-up/verify', { response: { id: 'cred-1' } })).status,
    ).toBe(401)
  })

  it('binds the challenge to the session that asked for it', async () => {
    await post('step-up/options', {})
    const otherLogin = await h.login(owner.email)
    const other = {
      ...owner,
      cookie: otherLogin.headers.get('set-cookie')!.split(';')[0]!,
    }
    expect(
      (await post('step-up/verify', { response: { id: 'cred-1' } }, other))
        .status,
    ).toBe(401)
  })

  it('only accepts the user’s own passkeys', async () => {
    h.run(
      `INSERT INTO webauthn_credentials (id, user_id, public_key) VALUES ('cred-alice', ?, 'AQID')`,
      (await h.register('alice@example.com')).id,
    )
    await post('step-up/options', {})
    expect(
      (await post('step-up/verify', { response: { id: 'cred-alice' } })).status,
    ).toBe(401)
  })

  it('records failed attempts and rejects a failed signature', async () => {
    await post('step-up/options', {})
    verified.value = false
    expect(
      (await post('step-up/verify', { response: { id: 'cred-1' } })).status,
    ).toBe(401)
    expect(
      h.query(
        `SELECT event_type FROM security_events WHERE event_type = 'step_up_failed'`,
      ),
    ).toHaveLength(1)
    expect(
      (await h.request('/api/admin/overview', { cookie: owner.cookie })).status,
    ).toBe(401)
  })

  it('will not remove the last passkey', async () => {
    h.elevate(owner)
    const res = await h.request('/api/admin/security/passkeys/cred-1', {
      method: 'DELETE',
      cookie: owner.cookie,
      admin: true,
    })
    expect(res.status).toBe(409)
  })
})
