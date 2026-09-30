// Small fetch wrapper: timeout, JSON, retry on 429/5xx, and a per-provider
// minimum spacing between calls so we stay inside plan rate limits.

export class HttpError extends Error {
  constructor(public status: number, public url: string, body: string) {
    super(`HTTP ${status} from ${redact(url)}: ${body.slice(0, 200)}`);
    this.name = "HttpError";
  }
}

/** Never let API keys leak into logs or error messages. */
export function redact(url: string): string {
  return url.replace(/(token|apiKey|apikey|api_key)=[^&]+/gi, "$1=REDACTED");
}

export class RateLimiter {
  private next = 0;
  constructor(private minSpacingMs: number) {}
  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.minSpacingMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

export async function getJson<T>(
  url: string,
  opts: { limiter?: RateLimiter; timeoutMs?: number; retries?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await opts.limiter?.wait();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: opts.headers });
      if (res.ok) return (await res.json()) as T;
      const body = await res.text();
      const err = new HttpError(res.status, url, body);
      if (res.status !== 429 && res.status < 500) throw err;
      lastErr = err;
    } catch (e) {
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function getText(url: string, limiter?: RateLimiter): Promise<string> {
  await limiter?.wait();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "MarketPulseAI/0.1 (+news aggregator; respects feed terms)" },
    });
    if (!res.ok) throw new HttpError(res.status, url, await res.text());
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
