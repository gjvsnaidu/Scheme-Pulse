import type { User } from './types';

let token: string | null = null;
export class ApiError extends Error { constructor(public status: number, public code: string, message: string, public details?: { path: string; message: string }[]) { super(message); } }

async function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`/api${path}`, { ...init, headers, credentials: 'include' });
}

export async function refresh(): Promise<User | null> {
  const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
  if (!r.ok) { token = null; return null; }
  const d = await r.json(); token = d.accessToken; return d.user;
}
export function setSession(accessToken: string | null) { token = accessToken; }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET') };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers = { 'content-type': 'application/json' }; }
  let res: Response;
  try { res = await send(path, init); } catch { throw new ApiError(0, 'network', 'We could not reach SchemePulse. Check your connection and try again.'); }
  if (res.status === 401 && !path.startsWith('/auth/') && token && (await refresh())) res = await send(path, init);
  if (!res.ok) {
    const e = (await res.json().catch(() => null))?.error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? 'Something went wrong. Please try again.', e?.details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const notify = (msg: string) => window.dispatchEvent(new CustomEvent('sp-toast', { detail: msg }));
export const errMsg = (e: unknown) => (e instanceof ApiError ? (e.details?.length ? `${e.message} ${e.details.map((d) => `${d.path}: ${d.message}`).join('; ')}` : e.message) : 'Something went wrong. Please try again.');
