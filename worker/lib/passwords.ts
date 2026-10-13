const ITERATIONS = 100_000
const HASH_BYTES = 32

function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  // Copy into a fresh ArrayBuffer to satisfy BufferSource typing across DOM/Workers.
  const saltCopy = new Uint8Array(salt)
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltCopy,
      iterations: ITERATIONS,
    },
    keyMaterial,
    HASH_BYTES * 8,
  )
  return bufferToHex(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt)
  return `pbkdf2$${ITERATIONS}$${bufferToHex(salt)}$${hash}`
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algo, iter, saltHex, hash] = encoded.split('$')
  if (algo !== 'pbkdf2' || !iter || !saltHex || !hash) return false
  if (Number(iter) !== ITERATIONS) return false
  const candidate = await derive(password, hexToBuffer(saltHex))
  return candidate === hash
}

export async function hashToken(
  token: string,
  secret: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${secret}:${token}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bufferToHex(digest)
}
