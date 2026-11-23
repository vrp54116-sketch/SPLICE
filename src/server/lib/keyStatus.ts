import type { KeyFailure, ProviderId } from '@shared/types';

/** In-memory, per-instance record of providers whose key failed recently. */
const failures = new Map<ProviderId, KeyFailure>();

export function recordKeyFailure(provider: ProviderId, detail: string): void {
  failures.set(provider, { provider, message: String(detail).slice(0, 300), at: Date.now() });
}

export function clearKeyFailure(provider: ProviderId): void {
  failures.delete(provider);
}

export function listKeyFailures(): KeyFailure[] {
  return [...failures.values()];
}
