import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create, evidenceUrl } from '../cases';

// Env must be set before cases.ts is imported (module builds the verifier once).
vi.hoisted(() => {
  process.env.USER_POOL_ID = 'us-east-1_test';
  process.env.USER_POOL_CLIENT_ID = 'test-client';
  process.env.CASES_TABLE = 'Cases';
  process.env.EVIDENCE_BUCKET = 'evidence';
});

const sendMock = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: sendMock })) },
  GetCommand: class { constructor(public input: any) {} },
  PutCommand: class { constructor(public input: any) {} },
  UpdateCommand: class { constructor(public input: any) {} },
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  PutObjectCommand: class { constructor(public input: any) {} },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn().mockResolvedValue('https://signed') }));

function evt(body: any, sub = 'user-1') {
  return {
    body: JSON.stringify(body),
    pathParameters: { id: 'c-1' },
    requestContext: { authorizer: { claims: { sub } } },
  } as any;
}

describe('case deadline enforcement', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('create stores a valid future evidenceDeadline as ISO', async () => {
    const res = await create(evt({ evidenceDeadline: '2099-01-01T00:00:00Z' }));
    expect(res.statusCode).toBe(201);
    const put = sendMock.mock.calls.find((c) => c[0]?.constructor?.name === 'PutCommand');
    if (!put) throw new Error('expected a PutCommand call');
    expect(put[0].input.Item.evidenceDeadline).toBe('2099-01-01T00:00:00.000Z');
  });

  it('create accepts a missing deadline (optional per F1)', async () => {
    const res = await create(evt({}));
    expect(res.statusCode).toBe(201);
    const put = sendMock.mock.calls.find((c) => c[0]?.constructor?.name === 'PutCommand');
    if (!put) throw new Error('expected a PutCommand call');
    expect(put[0].input.Item.evidenceDeadline).toBeUndefined();
  });

  it('create rejects a non-ISO deadline', async () => {
    const res = await create(evt({ evidenceDeadline: 'next tuesday' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/ISO 8601/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('create rejects a deadline in the past', async () => {
    const res = await create(evt({ evidenceDeadline: '2001-01-01T00:00:00Z' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/future/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('evidenceUrl still presigns before the deadline', async () => {
    sendMock.mockResolvedValueOnce({ Item: { caseId: 'c-1', status: 'FUNDED', evidenceDeadline: '2099-01-01T00:00:00Z' } });
    const res = await evidenceUrl(evt({ contentType: 'application/pdf' }));
    expect(res.statusCode).toBe(200);
  });

  it('evidenceUrl returns 403 once the deadline has passed', async () => {
    sendMock.mockResolvedValueOnce({ Item: { caseId: 'c-1', status: 'FUNDED', evidenceDeadline: '2001-01-01T00:00:00Z' } });
    const res = await evidenceUrl(evt({ contentType: 'application/pdf' }));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/window closed/i);
  });

  it('evidenceUrl keeps the open window for cases without a deadline', async () => {
    sendMock.mockResolvedValueOnce({ Item: { caseId: 'c-1', status: 'FUNDED' } });
    const res = await evidenceUrl(evt({ contentType: 'application/pdf' }));
    expect(res.statusCode).toBe(200);
  });

  it('evidenceUrl 404s for a missing case', async () => {
    sendMock.mockResolvedValueOnce({});
    const res = await evidenceUrl(evt({ contentType: 'application/pdf' }));
    expect(res.statusCode).toBe(404);
  });
});
