import { describe, expect, it, vi } from 'vitest';
import { ApiError, NETWORK_ERROR_MESSAGE, TIMEOUT_MESSAGE, createApiClient, normalizeCaseView } from './api';

const BASE = 'https://api.example.com/prod/';
const CASE = { caseId: 'c-1', status: 'CREATED', claimantId: 's', respondentId: 'r@x.com', amountCents: 1, currency: 'USD', createdAt: 't' };

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function client(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, extra: Record<string, unknown> = {}) {
  const onUnauthorized = vi.fn();
  const fn = vi.fn(fetchImpl);
  const api = createApiClient({ baseUrl: BASE, getIdToken: async () => 'tok', onUnauthorized, fetchImpl: fn, retryDelayMs: 0, ...extra });
  return { api, fn, onUnauthorized };
}

/** A fetch that never answers until its signal aborts, like a hung connection. */
const hangingFetch = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

describe('timeouts', () => {
  it('aborts a hung API call and says it timed out', async () => {
    const { api, fn } = client(hangingFetch, { timeoutMs: 20 });
    await expect(api.fundCase('c-1')).rejects.toEqual(new ApiError(0, TIMEOUT_MESSAGE));
    expect(fn).toHaveBeenCalledOnce(); // POST: never retried
  });

  it('gives a timed-out GET one more try', async () => {
    let calls = 0;
    const { api, fn } = client((url, init) => (++calls === 1 ? hangingFetch(url, init) : Promise.resolve(json(200, CASE))), { timeoutMs: 20 });
    await expect(api.getCase('c-1')).resolves.toMatchObject({ case: { caseId: 'c-1' } });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('reports an upload timeout in upload terms', async () => {
    vi.useFakeTimers();
    try {
      const { api } = client(hangingFetch);
      const pending = api.uploadToPresignedUrl('https://s3/put', new Blob(['x']), 'text/plain');
      const assertion = expect(pending).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/upload timed out/) });
      await vi.advanceTimersByTimeAsync(120_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('retries', () => {
  it.each([502, 503, 504])('retries a GET once after %i and succeeds', async (status) => {
    const responses = [json(status, { message: 'Bad gateway' }), json(200, CASE)];
    const { api, fn } = client(async () => responses.shift()!);
    await expect(api.getCase('c-1')).resolves.toMatchObject({ case: { caseId: 'c-1' } });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the single retry', async () => {
    const { api, fn } = client(async () => json(503, {}));
    await expect(api.getCase('c-1')).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries a GET after a network error', async () => {
    let calls = 0;
    const { api, fn } = client(async () => {
      if (++calls === 1) throw new TypeError('Failed to fetch');
      return json(200, { status: 'ok' });
    });
    await expect(api.health()).resolves.toMatchObject({ ok: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('never retries a POST, which may already have been applied', async () => {
    const { api, fn } = client(async () => json(503, {}));
    await expect(api.submitCase('c-1')).rejects.toMatchObject({ status: 503 });
    await expect(api.createCase({ respondentEmail: 'a@b.co', amountCents: 1, currency: 'USD' })).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 500 or a 4xx', async () => {
    const { api, fn } = client(async () => json(500, { error: 'boom' }));
    await expect(api.getCase('c-1')).rejects.toMatchObject({ status: 500 });
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe('error messages', () => {
  it('asks the user to slow down on 429', async () => {
    const { api } = client(async () => json(429, { message: 'Too Many Requests' }));
    await expect(api.runDemo()).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/Too many requests/) });
  });

  it('never shows internal server error details', async () => {
    const { api } = client(async () => json(500, { error: 'AccessDeniedException: User arn:aws:sts::123:assumed-role/x is not authorized' }));
    const err = await api.fundCase('c-1').catch((e) => e);
    expect(err.message).not.toMatch(/arn:aws|AccessDenied/);
    expect(err.message).toMatch(/error 500/);
  });

  it('explains API Gateway "Missing Authentication Token" (unknown route)', async () => {
    const { api } = client(async () => json(403, { message: 'Missing Authentication Token' }));
    await expect(api.getRuling('c-1')).rejects.toMatchObject({ status: 403, message: 'This action is not available on the server yet.' });
  });

  it('handles an HTML error page without leaking markup', async () => {
    const { api } = client(async () => new Response('<html><body>502 Bad Gateway</body></html>', { status: 400 }));
    const err = await api.fundCase('c-1').catch((e) => e);
    expect(err.message).toBe('Request failed with status 400.');
  });

  it('falls back to a generic message for an empty 4xx body', async () => {
    const { api } = client(async () => new Response('', { status: 409 }));
    await expect(api.disputeCase('c-1')).rejects.toMatchObject({ message: 'Request failed with status 409.' });
  });

  it('does not call onUnauthorized for a 401 on a public route', async () => {
    const { api, onUnauthorized } = client(async () => json(401, { message: 'Unauthorized' }));
    await expect(api.runDemo()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('a 403 on a protected route is an error but keeps the session', async () => {
    const { api, onUnauthorized } = client(async () => json(403, { message: 'User is not authorized to access this resource' }));
    await expect(api.getCase('c-1')).rejects.toMatchObject({ status: 403 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('keeps retrying reads from turning a network error into anything else', async () => {
    const { api } = client(async () => { throw new TypeError('Failed to fetch'); });
    await expect(api.getRuling('c-1')).rejects.toEqual(new ApiError(0, NETWORK_ERROR_MESSAGE));
  });
});

describe('malformed success bodies', () => {
  it.each([
    ['empty body', ''],
    ['plain text', 'OK'],
    ['JSON null', 'null'],
    ['array', '[1,2]'],
    ['case without status', JSON.stringify({ caseId: 'c-1' })],
  ])('getCase rejects %s with a clear error', async (_name, body) => {
    const { api } = client(async () => new Response(body, { status: 200 }));
    await expect(api.getCase('c-1')).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/unexpected case shape/) });
  });

  it('fund with a missing newStatus/entryHash still yields a sensible receipt', async () => {
    const { api } = client(async () => json(200, { success: true }));
    expect(await api.fundCase('c-1')).toEqual({ event: 'FUND', newStatus: 'FUNDED', entryHash: '' });
  });

  it('demo with a non-object body still resolves', async () => {
    const { api } = client(async () => new Response('started', { status: 200 }));
    expect(await api.runDemo()).toEqual({ message: 'Demo case started.', caseId: undefined, executionArn: undefined });
  });

  it('health reports not-ok for an unexpected body', async () => {
    const { api } = client(async () => json(200, { status: 'degraded' }));
    expect(await api.health()).toMatchObject({ ok: false });
  });

  it('a malformed ruling is treated as not published', async () => {
    const { api } = client(async () => json(200, { payeeShareBps: 'lots' }));
    expect(await api.getRuling('c-1')).toBeNull();
  });

  it('normalizeCaseView ignores a non-array timeline', () => {
    expect(normalizeCaseView({ case: CASE, timeline: 'INTAKE' }).timeline).toEqual([]);
  });
});
