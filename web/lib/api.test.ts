import { describe, expect, it, vi } from 'vitest';
import { ApiError, NETWORK_ERROR_MESSAGE, createApiClient, normalizeCaseView } from './api';

const BASE = 'https://api.example.com/prod/';

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(responses: Response[] | ((url: string, init?: RequestInit) => Response), token: string | null = 'id-token') {
  const queue = Array.isArray(responses) ? [...responses] : null;
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) =>
    queue ? queue.shift()! : (responses as (u: string, i?: RequestInit) => Response)(url, init),
  );
  const onUnauthorized = vi.fn();
  const api = createApiClient({ baseUrl: BASE, getIdToken: async () => token ?? undefined, onUnauthorized, fetchImpl, retryDelayMs: 0 });
  return { api, fetchImpl, onUnauthorized };
}

const CASE = {
  caseId: 'c-1234abcd',
  status: 'CREATED',
  claimantId: 'sub-1',
  respondentId: 'klaus@example.com',
  amountCents: 40000,
  currency: 'USD',
  createdAt: '2026-09-25T10:00:00Z',
};

describe('protected routes', () => {
  it('sends the raw Cognito ID token in the Authorization header', async () => {
    const { api, fetchImpl } = setup([jsonResponse(201, CASE)]);
    await api.createCase({ respondentEmail: 'klaus@example.com', amountCents: 40000, currency: 'USD' });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE}cases`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('id-token');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ respondentEmail: 'klaus@example.com', amountCents: 40000, currency: 'USD' });
  });

  it('refuses to call a protected route without a token and reports it', async () => {
    const { api, fetchImpl, onUnauthorized } = setup([], null);
    await expect(api.getCase('c-1')).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('treats a 401 from API Gateway as an expired session', async () => {
    const { api, onUnauthorized } = setup([jsonResponse(401, { message: 'Unauthorized' })]);
    await expect(api.getCase('c-1')).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/expired/) });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('surfaces the Lambda error message for a failed transition', async () => {
    const { api } = setup([jsonResponse(400, { error: 'Illegal transition: FUNDED -> FUND' })]);
    await expect(api.fundCase('c-1')).rejects.toEqual(new ApiError(400, 'Illegal transition: FUNDED -> FUND'));
  });

  it('maps fund and dispute responses to ledger receipts', async () => {
    const { api, fetchImpl } = setup([
      jsonResponse(200, { success: true, newStatus: 'FUNDED', entryHash: 'a'.repeat(64) }),
      jsonResponse(200, { success: true, newStatus: 'DISPUTED', entryHash: 'b'.repeat(64) }),
    ]);
    expect(await api.fundCase('c-1')).toEqual({ event: 'FUND', newStatus: 'FUNDED', entryHash: 'a'.repeat(64) });
    expect(await api.disputeCase('c-1')).toEqual({ event: 'DISPUTE', newStatus: 'DISPUTED', entryHash: 'b'.repeat(64) });
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([`${BASE}cases/c-1/fund`, `${BASE}cases/c-1/dispute`]);
  });

  it('encodes case IDs in the path', async () => {
    const { api, fetchImpl } = setup([jsonResponse(200, CASE)]);
    await api.getCase('c 1/../x');
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}cases/c%201%2F..%2Fx`);
  });

  it('turns a network failure (including a CORS block) into a readable error', async () => {
    const { api } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(api.getCase('c-1')).rejects.toEqual(new ApiError(0, NETWORK_ERROR_MESSAGE));
  });

  it('submits and returns the new status', async () => {
    const { api } = setup([jsonResponse(200, { success: true, status: 'DELIBERATING' })]);
    expect(await api.submitCase('c-1')).toBe('DELIBERATING');
  });
});

describe('evidence upload', () => {
  it('requests a presigned URL with party, type, content type and size', async () => {
    const { api, fetchImpl } = setup([jsonResponse(200, { uploadUrl: 'https://s3.example/put', evidenceId: 'ev-1', key: 'c-1/ev-1' })]);
    const ticket = await api.requestEvidenceUpload('c-1', { party: 'claimant', type: 'chat', contentType: 'text/plain', contentLength: 12 });
    expect(ticket).toEqual({ uploadUrl: 'https://s3.example/put', evidenceId: 'ev-1', key: 'c-1/ev-1' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string)).toEqual({ party: 'claimant', type: 'chat', contentType: 'text/plain', contentLength: 12 });
  });

  it('rejects a ticket without an upload URL', async () => {
    const { api } = setup([jsonResponse(200, { evidenceId: 'ev-1' })]);
    await expect(api.requestEvidenceUpload('c-1', { party: 'claimant', type: 'chat', contentType: 'text/plain', contentLength: 1 })).rejects.toMatchObject({ status: 502 });
  });

  it('PUTs the file with the presigned content type and no Authorization header', async () => {
    const { api, fetchImpl } = setup([new Response('', { status: 200 })]);
    const file = new Blob(['Hello World!'], { type: 'text/plain' });
    await api.uploadToPresignedUrl('https://s3.example/put?sig=1', file, 'text/plain');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://s3.example/put?sig=1');
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toEqual({ 'Content-Type': 'text/plain' });
    expect(init?.body).toBe(file);
  });

  it('reads the S3 XML error message when the upload is rejected', async () => {
    const xml = '<?xml version="1.0"?><Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match</Message></Error>';
    const { api } = setup([new Response(xml, { status: 403 })]);
    await expect(api.uploadToPresignedUrl('https://s3.example/put', new Blob(['x']), 'text/plain')).rejects.toMatchObject({
      status: 403,
      message: 'Upload failed: The request signature we calculated does not match',
    });
  });
});

describe('public routes', () => {
  it('runs the demo without a token', async () => {
    const { api, fetchImpl } = setup([jsonResponse(200, { success: true, message: 'Demo run started', executionArn: 'arn:x' })], null);
    expect(await api.runDemo()).toEqual({ message: 'Demo run started', executionArn: 'arn:x', caseId: undefined });
    const init = fetchImpl.mock.calls[0][1];
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('reads the health response the Lambda actually returns', async () => {
    const { api } = setup([jsonResponse(200, { status: 'ok', timestamp: '2026-09-25T00:00:00Z' })]);
    expect(await api.health()).toEqual({ ok: true, timestamp: '2026-09-25T00:00:00Z' });
  });

  it('returns null for an empty ruling body (not published)', async () => {
    const { api } = setup([new Response('', { status: 200 })]);
    expect(await api.getRuling('c-1')).toBeNull();
  });

  it('returns null for a 404 ruling', async () => {
    const { api } = setup([jsonResponse(404, { error: 'Not found' })]);
    expect(await api.getRuling('c-1')).toBeNull();
  });

  it('parses a published ruling', async () => {
    const ruling = {
      findingsOfFact: [{ fact: 'Work delivered on time', evidenceIds: ['e-2'] }],
      clausesRelied: [{ clauseRef: '3.1', interpretation: 'Payment upon delivery' }],
      payeeShareBps: 10000,
      reasoning: 'Delivered as specified.',
      confidence: 0.95,
      uncertainties: [],
    };
    const { api } = setup([jsonResponse(200, ruling)]);
    expect(await api.getRuling('c-104')).toEqual(ruling);
  });

  it('fails clearly when the API URL is not configured', async () => {
    const api = createApiClient({ baseUrl: '', getIdToken: async () => 't', fetchImpl: vi.fn() });
    await expect(api.health()).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/NEXT_PUBLIC_API_URL/) });
  });
});

describe('normalizeCaseView', () => {
  it('accepts the bare Cases item the API returns today', () => {
    expect(normalizeCaseView(CASE)).toEqual({ case: CASE, timeline: [] });
  });

  it('accepts the wrapped shape with a timeline', () => {
    expect(normalizeCaseView({ case: CASE, timeline: ['INTAKE', 'BLIND', 7] })).toEqual({ case: CASE, timeline: ['INTAKE', 'BLIND'] });
  });

  it('rejects a body that is not a case', () => {
    expect(() => normalizeCaseView({ hello: 'world' })).toThrow(ApiError);
  });
});
