export function delay(ms, { signal } = {}) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("aborted"));
        },
        { once: true },
      );
    }
  });
}

export function backoffMs(attempt, options = {}) {
  const baseMs = options.baseMs ?? 1_000;
  const maxMs = options.maxMs ?? 60_000;
  const jitterRatio = options.jitterRatio ?? 0.2;
  const raw = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  if (jitterRatio <= 0) return raw;
  const jitter = raw * jitterRatio;
  return Math.round(raw - jitter + Math.random() * jitter * 2);
}

export async function withRetry(operation, options = {}) {
  const retries = options.retries ?? 3;
  const retryable = options.retryable ?? (() => true);
  let lastError;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt > retries || !retryable(error)) throw error;
      await delay(backoffMs(attempt, options), { signal: options.signal });
    }
  }

  throw lastError;
}
