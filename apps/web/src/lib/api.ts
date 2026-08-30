/**
 * Thin fetch wrapper.
 *
 * Every request carries the bearer token; a 401 clears the session and returns
 * the user to sign-in, so an expired token never leaves the UI in a state where
 * every panel silently fails.
 */
const TOKEN_KEY = 'shift-planner.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Return the raw Response, for file downloads. */
  raw?: boolean;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, raw, headers, ...rest } = options;
  const token = getToken();

  const response = await fetch(`/api${path}`, {
    ...rest,
    headers: {
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && !window.location.pathname.startsWith('/login')) {
    setToken(null);
    window.location.href = '/login';
    throw new ApiError(401, 'Your session has expired');
  }

  if (raw) {
    if (!response.ok) throw new ApiError(response.status, 'Download failed');
    return response as unknown as T;
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      (payload as { error?: string }).error ?? `Request failed (${response.status})`,
      (payload as { details?: unknown }).details,
    );
  }
  return payload as T;
}
