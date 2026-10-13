import type { ObjectStore } from './types'

export function createR2Store(bucket: R2Bucket): ObjectStore {
  return {
    kind: 'r2',
    async put(key, data, contentType) {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
      await bucket.put(key, bytes, {
        httpMetadata: { contentType },
      })
      return { key, byteSize: bytes.byteLength, contentType }
    },
    async get(key) {
      const obj = await bucket.get(key)
      if (!obj) return null
      return {
        body: obj.body,
        contentType:
          obj.httpMetadata?.contentType || 'application/octet-stream',
        byteSize: obj.size,
      }
    },
    async delete(key) {
      await bucket.delete(key)
    },
    async exists(key) {
      const head = await bucket.head(key)
      return Boolean(head)
    },
  }
}
