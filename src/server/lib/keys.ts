import { emptyApiKeys, type ApiKeys } from '@shared/types';

/** Decode the browser-only key header. Never logs or persists the values. */
export function keysFromHeader(raw: string | string[] | undefined): ApiKeys {
  const blank = emptyApiKeys();
  if (!raw) return blank;
  try {
    const value = Array.isArray(raw) ? raw[0] ?? '' : raw;
    const parsed = JSON.parse(decodeURIComponent(Buffer.from(value, 'base64').toString('utf8'))) as Partial<ApiKeys>;
    for (const k of Object.keys(blank) as Array<keyof ApiKeys>) {
      if (typeof parsed[k] === 'string') blank[k] = parsed[k] as string;
    }
  } catch { /* malformed header — fall back to environment keys only */ }
  return blank;
}
