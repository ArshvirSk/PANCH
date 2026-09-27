import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './api';

const BASE = 'https://api.example.com/prod/';
const JUDGE = { findingsOfFact: [], clausesRelied: [], payeeShareBps: 7000, reasoning: 'r', confidence: 0.6, uncertainties: [] };
const ITEM = { caseId: 'c-105', status: 'ESCALATED', amountCents: 40000, currency: 'USD', createdAt: '2026-09-25T10:00:00Z', panelOutputs: { spreadBps: 5000, judges: [JUDGE] } };

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function client(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, token: string | null = 'id-token') {
  const onUnauthorized = vi.fn();
  const fn = vi.fn(fetchImpl);
  const api = createApiClient({ baseUrl: BASE, getIdToken: async () => token ?? undefined, onUnauthorized, fetchImpl: fn, retryDelayMs: 0 });
  return { api, fn, onUnauthorized };
}

describe('getReviews', () => {
  it('GETs /reviews with the ID token and normalizes each case', async () => {
    const { api, fn } = client(async () => json(200, [ITEM]));
    const cases = await api.getReviews();
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe(`${BASE}reviews`);
    expect(init?.method).toBe('GET');
    expect((init?.headers as Record<string, string>).Authorization).toBe('id-token');
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ caseId: 'c-105', spreadBps: 5000, judges: [{ name: 'judge-1', output: { payeeShareBps: 7000 } }] });
  });

  it('skips items without a case ID but keeps the rest', async () => {
    const { api } = client(async () => json(200, { items: [ITEM, { status: 'ESCALATED' }, null, 'junk'] }));
    expect((await api.getReviews()).map((c) => c.caseId)).toEqual(['c-105']);
  });

  it('treats an empty list as an empty queue', async () => {
    const { api } = client(async () => json(200, []));
    expect(await api.getReviews()).toEqual([]);
  });

  it.each([
    ['an empty body', undefined],
    ['an error-shaped object', { message: 'nope' }],
    ['a string', 'hello'],
  ])('rejects %s as an unexpected queue', async (_, body) => {
    const { api } = client(async () => (body === undefined ? new Response('', { status: 200 }) : json(200, body)));
    await expect(api.getReviews()).rejects.toEqual(new ApiError(502, 'The API returned an unexpected review queue.'));
  });

  it('retries once on a gateway error, like every read', async () => {
    let calls = 0;
    const { api, fn } = client(async () => (++calls === 1 ? json(503) : json(200, [ITEM])));
    expect(await api.getReviews()).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('asks the user to sign in when there is no token, without calling the API', async () => {
    const { api, fn, onUnauthorized } = client(async () => json(200, []), null);
    await expect(api.getReviews()).rejects.toMatchObject({ status: 401 });
    expect(fn).not.toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('drops the session on a 401', async () => {
    const { api, onUnauthorized } = client(async () => json(401, { message: 'Unauthorized' }));
    await expect(api.getReviews()).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/expired/) });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('says the route is missing when API Gateway has no /reviews yet', async () => {
    const { api } = client(async () => json(403, { message: 'Missing Authentication Token' }));
    await expect(api.getReviews()).rejects.toMatchObject({ status: 403, message: 'This action is not available on the server yet.' });
  });

  it('hides server internals on a 500', async () => {
    const { api } = client(async () => json(500, { error: 'AccessDeniedException: arn:aws:dynamodb:...' }));
    await expect(api.getReviews()).rejects.toMatchObject({ message: expect.not.stringContaining('arn:aws') });
  });
});

describe('resolveReview', () => {
  it('POSTs the decision to /reviews/{caseId} and reads the result', async () => {
    const { api, fn } = client(async () => json(200, { caseId: 'c-105', status: 'SETTLED' }));
    const result = await api.resolveReview('c-105', { payeeShareBps: 7000, note: 'Evidence e-2.' });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe(`${BASE}reviews/c-105`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ payeeShareBps: 7000, note: 'Evidence e-2.' });
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((init?.headers as Record<string, string>).Authorization).toBe('id-token');
    expect(result).toEqual({ caseId: 'c-105', status: 'SETTLED' });
  });

  it('encodes the case ID in the path', async () => {
    const { api, fn } = client(async () => json(200, {}));
    await api.resolveReview('c/../x?y', { payeeShareBps: 0, note: 'n' });
    expect(fn.mock.calls[0][0]).toBe(`${BASE}reviews/c%2F..%2Fx%3Fy`);
  });

  it('fills in the case ID and the TEAM_PLAN status when the body is empty', async () => {
    const { api } = client(async () => json(200));
    expect(await api.resolveReview('c-105', { payeeShareBps: 1, note: 'n' })).toEqual({ caseId: 'c-105', status: 'RESOLVED' });
  });

  it('is never retried, even on a gateway error', async () => {
    const { api, fn } = client(async () => json(503));
    await expect(api.resolveReview('c-105', { payeeShareBps: 1, note: 'n' })).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledOnce();
  });

  it('passes the ledger conflict message through', async () => {
    const { api } = client(async () => json(400, { error: 'Case must be ESCALATED' }));
    await expect(api.resolveReview('c-105', { payeeShareBps: 1, note: 'n' })).rejects.toEqual(new ApiError(400, 'Case must be ESCALATED'));
  });
});
