#!/usr/bin/env node
/**
 * Makes the VAPID key pair for push notifications. Run once, then store both
 * values as Worker secrets (see docs/PUSH_NOTIFICATIONS.md). Nothing is
 * written to disk or sent anywhere; the keys are only printed.
 */
import { webcrypto } from 'node:crypto'

const b64url = (buf) => Buffer.from(buf).toString('base64url')

const pair = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
)
const publicKey = b64url(
  await webcrypto.subtle.exportKey('raw', pair.publicKey),
)
const { d } = await webcrypto.subtle.exportKey('jwk', pair.privateKey)

console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${d}`)
console.log('')
console.log(
  'Keep VAPID_PRIVATE_KEY secret. Changing the keys later means everyone',
)
console.log('has to turn notifications on again.')
