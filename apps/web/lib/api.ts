export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost';

/** The company subdomain the browser is on, e.g. "acme" for acme.localhost:3000. */
export function tenantSlug(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const host = window.location.hostname.toLowerCase();
  if (!host.endsWith(`.${ROOT_DOMAIN}`)) return undefined;
  const sub = host.slice(0, -(ROOT_DOMAIN.length + 1));
  return sub && !sub.includes('.') && sub !== 'www' ? sub : undefined;
}

/** URL of a page on a company's own subdomain, keeping the current port. */
export function tenantUrl(slug: string, path: string) {
  const { protocol, port } = window.location;
  return `${protocol}//${slug}.${ROOT_DOMAIN}${port ? `:${port}` : ''}${path}`;
}

const TOKEN_KEY = 'erp_token';
export const getToken = () => (typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY));
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const slug = tenantSlug();
  if (slug) headers['X-Tenant'] = slug;
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join(', ') : data.message ?? res.statusText;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}
export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: string;
  currency: string;
}
