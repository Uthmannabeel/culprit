/**
 * Retry-with-backoff for transient provider failures. A single network blip or
 * per-minute rate limit shouldn't fail an entire triage — but a spent DAILY
 * quota will exhaust the retries quickly and surface the real error, which
 * friendlyTriageError then explains to the user.
 */

/** Errors worth retrying: rate limits, overload, and network-level failures. */
export function isTransient(err: unknown): boolean {
  const message = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? "")}` : String(err);
  return /429|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|503|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message);
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  shouldRetry?: (err: unknown) => boolean;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1500;
  const shouldRetry = options.shouldRetry ?? isTransient;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLast = attempt === attempts - 1;
      if (isLast || !shouldRetry(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError; // unreachable, satisfies the type checker
}
