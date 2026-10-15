export class ApiError extends Error {
  status: number
  /** Machine-readable reason from the API, e.g. "step_up_required". */
  code?: string
  data: Record<string, unknown>

  constructor(
    status: number,
    message: string,
    data: Record<string, unknown> = {},
  ) {
    super(message)
    this.status = status
    this.data = data
    this.code = typeof data.code === 'string' ? data.code : undefined
  }
}

/** Pages that work signed out; never redirect away from them. */
const PUBLIC_PAGES = new Set([
  '/',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
])

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
    code?: string
  } & T

  if (!response.ok) {
    // A missing passkey step-up is not a signed-out session.
    const sessionGone =
      (response.status === 401 && data.code !== 'step_up_required') ||
      (response.status === 403 && data.code === 'account_suspended')
    if (
      sessionGone &&
      !path.startsWith('/auth/') &&
      // The start-up "am I signed in?" check is not an expiry.
      path !== '/me' &&
      typeof window !== 'undefined' &&
      !PUBLIC_PAGES.has(window.location.pathname)
    ) {
      window.dispatchEvent(new CustomEvent('pg:session-expired'))
    }
    throw new ApiError(
      response.status,
      data.error ||
        (response.status === 401
          ? 'Your session ended — please log in again.'
          : 'Request failed'),
      data as Record<string, unknown>,
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
  delete_with_body: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'DELETE', body: JSON.stringify(body) }),
  /**
   * Goblin HQ calls. The header is required by the server for administrative
   * changes (with the Origin check it blocks cross-site requests).
   */
  admin: {
    get: <T>(path: string) => request<T>(`/admin${path}`),
    send: <T>(
      method: 'POST' | 'PUT' | 'DELETE',
      path: string,
      body?: unknown,
    ) =>
      request<T>(`/admin${path}`, {
        method,
        headers: { 'X-Pocket-Goblin-Admin': '1' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
  },
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
