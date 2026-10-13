import type { ObjectStore } from './types'

/** In-process fallback for unit tests when R2 binding is absent. */
export function createMemoryStore(): ObjectStore {
  const map = new Map<string, { data: Uint8Array; contentType: string }>()
  return {
    kind: 'memory',
    async put(key, data, contentType) {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
      map.set(key, { data: bytes, contentType })
      return { key, byteSize: bytes.byteLength, contentType }
    },
    async get(key) {
      const row = map.get(key)
      if (!row) return null
      const copy = row.data.slice()
      return {
        body: copy.buffer as ArrayBuffer,
        contentType: row.contentType,
        byteSize: copy.byteLength,
      }
    },
    async delete(key) {
      map.delete(key)
    },
    async exists(key) {
      return map.has(key)
    },
  }
}
