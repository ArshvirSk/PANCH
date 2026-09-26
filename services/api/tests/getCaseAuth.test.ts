import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCase } from '../cases';

// Env must be set before cases.ts is imported (module builds the verifier once).
vi.hoisted(() => {
  process.env.USER_POOL_ID = 'us-east-1_test';
  process.env.USER_POOL_CLIENT_ID = 'test-client';
  process.env.CASES_TABLE = 'Cases';
});

// Hoisted mocks for module-level clients in cases.ts
const verifyMock = vi.hoisted(() => vi.fn());
vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: vi.fn(() => ({ verify: verifyMock })) },
}));

const sendMock = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: sendMock })) },
  GetCommand: vi.fn(),
  PutCommand: vi.fn(),
  UpdateCommand: vi.fn(),
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(),
  CopyObjectCommand: vi.fn(),
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }));
vi.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: vi.fn(),
  StartExecutionCommand: vi.fn(),
  DescribeExecutionCommand: vi.fn(),
  GetExecutionHistoryCommand: vi.fn(),
}));

const demoCase = {
  caseId: 'demo-abc',
  status: 'SETTLED',
  claimantId: 'demo-claimant',
  respondentId: 'demo-respondent',
  amountCents: 50000,
  currency: 'USD',
  createdAt: '2026-09-27T00:00:00Z',
  isDemo: true,
};
const realCase = {
  caseId: 'c-123',
  status: 'RULED',
  claimantId: 'user-a',
  respondentId: 'user-b',
  amountCents: 1000,
  currency: 'USD',
  createdAt: '2026-09-27T00:00:00Z',
};

function evt(over: Record<string, unknown> = {}) {
  return { pathParameters: { id: 'x' }, headers: {}, ...over } as any;
}

beforeEach(() => {
  verifyMock.mockReset();
  sendMock.mockReset();
});

describe('GET /cases/{id} auth matrix', () => {
  it('demo case: anonymous (no Authorization header) -> 200 trimmed body', async () => {
    sendMock.mockResolvedValueOnce({ Item: { ...demoCase } });
    const res = await getCase(evt());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.caseId).toBe('demo-abc');
    expect(body).not.toHaveProperty('claimantId');
    expect(body).not.toHaveProperty('respondentId');
    expect(body).not.toHaveProperty('isDemo');
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('demo case: garbage bearer token -> still 200 (public path, JWT never checked)', async () => {
    sendMock.mockResolvedValueOnce({ Item: { ...demoCase } });
    const res = await getCase(evt({ headers: { Authorization: 'Bearer garbage' } }));
    expect(res.statusCode).toBe(200);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('real case: no auth header -> 401', async () => {
    sendMock.mockResolvedValueOnce({ Item: { ...realCase } });
    const res = await getCase(evt());
    expect(res.statusCode).toBe(401);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('real case: invalid token -> 401', async () => {
    sendMock.mockResolvedValueOnce({ Item: { ...realCase } });
    verifyMock.mockRejectedValueOnce(new Error('invalid'));
    const res = await getCase(evt({ headers: { Authorization: 'Bearer bad.token.here' } }));
    expect(res.statusCode).toBe(401);
    expect(verifyMock).toHaveBeenCalledWith('bad.token.here');
  });

  it('real case: valid token -> 200 full body', async () => {
    sendMock.mockResolvedValueOnce({ Item: { ...realCase } });
    verifyMock.mockResolvedValueOnce({ sub: 'user-a' });
    const res = await getCase(evt({ headers: { Authorization: 'Bearer good.token' } }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.claimantId).toBe('user-a');
    expect(body.respondentId).toBe('user-b');
  });

  it('legacy item without isDemo field: anonymous -> 401 (missing flag means not demo)', async () => {
    sendMock.mockResolvedValueOnce({ Item: { ...realCase } });
    const res = await getCase(evt());
    expect(res.statusCode).toBe(401);
  });

  it('404 for missing case regardless of auth', async () => {
    sendMock.mockResolvedValueOnce({});
    const res = await getCase(evt());
    expect(res.statusCode).toBe(404);
  });
});
