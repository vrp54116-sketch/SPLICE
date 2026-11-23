import { toast } from 'sonner';
import { PROVIDER_LABELS, type KeyFailure } from '@shared/types';
import { api } from './api';

const seen = new Set<string>();
const sig = (f: KeyFailure) => `${f.provider}:${f.at}`;

/** Poll health and toast any provider key failure we have not announced yet. */
export async function checkKeyFailures(): Promise<KeyFailure[]> {
  try {
    const health = await api<{ keyFailures?: KeyFailure[] }>('/api/health');
    const failures = health.keyFailures ?? [];
    for (const f of failures) {
      if (seen.has(sig(f))) continue;
      seen.add(sig(f));
      toast.error(`${PROVIDER_LABELS[f.provider] ?? f.provider} API key is not working`, {
        description: `${f.message} — open Settings → API keys and replace it.`,
      });
    }
    return failures;
  } catch { return []; }
}

/** Avoid duplicate toasts for failures the user can already see in Settings. */
export function markFailuresSeen(failures: KeyFailure[]): void {
  failures.forEach((f) => seen.add(sig(f)));
}
