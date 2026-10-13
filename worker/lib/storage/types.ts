export type StoredObject = {
  key: string
  byteSize: number
  contentType: string
}

export type ObjectStore = {
  readonly kind: 'r2' | 'memory'
  put(
    key: string,
    data: ArrayBuffer | Uint8Array,
    contentType: string,
  ): Promise<StoredObject>
  get(key: string): Promise<{
    body: ReadableStream | ArrayBuffer
    contentType: string
    byteSize: number
  } | null>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}
