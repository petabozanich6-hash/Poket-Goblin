import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uploads', () => {
  it('explains a file the browser refused to send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const error = await api
      .upload('/documents', new FormData())
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toMatch(/choose it again/)
  })
})
