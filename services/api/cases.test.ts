import { describe, it, expect, vi } from 'vitest';
import { evidenceUrl } from './cases';

// evidenceUrl now reads the case (deadline gate) before presigning.
const sendMock = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: sendMock })) },
  GetCommand: class { constructor(public input: any) {} },
  PutCommand: class { constructor(public input: any) {} },
  UpdateCommand: class { constructor(public input: any) {} },
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: vi.fn() }));

// Mock dependencies
vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: class {},
    PutObjectCommand: class {
      constructor(params: any) { Object.assign(this, params); }
    }
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => {
  return {
    getSignedUrl: vi.fn().mockResolvedValue('https://mock-url.com')
  };
});

describe('Evidence API', () => {
  it('generates presigned URL with correct content type constraints', async () => {
    // No deadline on this case: the evidence window stays open.
    sendMock.mockResolvedValueOnce({ Item: { caseId: 'c-123', status: 'FUNDED' } });
    const event = {
      pathParameters: { id: 'c-123' },
      body: JSON.stringify({ contentType: 'application/pdf', contentLength: 1024 }),
      requestContext: { authorizer: { claims: { sub: 'test-user' } } }
    } as any;

    const res = await evidenceUrl(event);
    expect(res.statusCode).toBe(200);
    
    const body = JSON.parse(res.body);
    expect(body.uploadUrl).toBe('https://mock-url.com');
    expect(body.key).toMatch(/^c-123\/ev-/);
  });
});
