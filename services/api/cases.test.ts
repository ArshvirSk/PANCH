import { describe, it, expect, vi } from 'vitest';
import { evidenceUrl } from './cases';

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
