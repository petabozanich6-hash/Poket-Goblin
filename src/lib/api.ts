export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const data = (await response.json().catch(() => ({}))) as {
    error?: string
  } & T

  if (!response.ok) {
    if (
      response.status === 401 &&
      !path.startsWith('/auth/') &&
      typeof window !== 'undefined' &&
      window.location.pathname !== '/'
    ) {
      window.dispatchEvent(new CustomEvent('pg:session-expired'))
    }
    throw new ApiError(
      response.status,
      data.error ||
        (response.status === 401
          ? 'Your session ended — please log in again.'
          : 'Request failed'),
    )
  }

  return data
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** Multipart upload — do not set JSON Content-Type. */
  upload: async <T>(path: string, form: FormData): Promise<T> => {
    const response = await fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
    } & T
    if (!response.ok) {
      throw new ApiError(response.status, data.error || 'Upload failed')
    }
    return data
  },
}
