import { emptyApiKeys, type ApiKeys } from '@shared/types';

const STORAGE_KEY = 'splice_api_keys';

export const loadApiKeys = (): ApiKeys => {
  const blank = emptyApiKeys();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return blank;
    const parsed = JSON.parse(raw) as Partial<ApiKeys>;
    for (const k of Object.keys(blank) as Array<keyof ApiKeys>) {
      if (typeof parsed[k] === 'string') blank[k] = parsed[k] as string;
    }
  } catch { /* corrupt or unavailable storage — start clean */ }
  return blank;
};

export const saveApiKeys = (keys: ApiKeys) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
};

/** Header value: base64 of URL-encoded JSON so non-ASCII base URLs survive. */
export const encodeApiKeys = (keys: ApiKeys): string => {
  try { return btoa(encodeURIComponent(JSON.stringify(keys))); } catch { return ''; }
};
