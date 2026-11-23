import type { TypedError } from '@shared/types';
import { encodeApiKeys, loadApiKeys } from './keys';

export class ApiError extends Error {
  error: TypedError;
  constructor(error: TypedError) { super(error.message); this.error = error; }
}

export async function api<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> ?? {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = localStorage.getItem('splice_api_token');
  if (token) headers.authorization = `Bearer ${token}`;
  const keys = encodeApiKeys(loadApiKeys());
  if (keys) headers['x-splice-keys'] = keys;
  const res = await fetch(path, {
    ...init, headers,
    ...(body !== undefined ? { method: init.method ?? 'POST', body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 300) }; }
  if (!res.ok) {
    const e = (data as { error?: TypedError }).error;
    throw new ApiError(e ?? { code: 'EXTRACT_FAILED', message: `Request failed (${res.status})`, remedy: 'Check the server and retry.' });
  }
  return data as T;
}

export function sse<T>(path: string, onEvent: (event: string, data: T) => void): () => void {
  const token = localStorage.getItem('splice_api_token');
  const url = new URL(path, location.href);
  if (token) url.searchParams.set('token', token);
  const es = new EventSource(url.toString());
  for (const name of ['state', 'asset', 'clip', 'done', 'error']) {
    es.addEventListener(name, (e) => { try { onEvent(name, JSON.parse((e as MessageEvent).data) as T); } catch { /* ignore */ } });
  }
  return () => es.close();
}

export const assetUrl = (id: string) => id ? `/api/assets/${encodeURIComponent(id)}` : '';
