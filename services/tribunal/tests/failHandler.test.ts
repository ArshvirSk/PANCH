import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../stubs/failHandler';

/**
 * The cached fallback is only ever written where nothing is published yet.
 *
 * A later failed re-run used to copy the placeholder over a real, verified
 * ruling (LOG.md phase 24, item 2): the award disappeared and GET
 * /rulings/{id}/verify started reporting a content mismatch. The copy is now
 * guarded by a HEAD on the published object.
 */

vi.hoisted(() => {
  process.env.CASES_TABLE = 'Cases';
  process.env.BUCKET = 'evidence-bucket';
  process.env.RULINGS_BUCKET = 'rulings-bucket';
});

const s3Send = vi.hoisted(() => vi.fn());
const dbSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = s3Send; },
  CopyObjectCommand: class { constructor(public input: any) {} },
  HeadObjectCommand: class { constructor(public input: any) {} },
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: vi.fn() }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: dbSend })) },
  UpdateCommand: class { constructor(public input: any) {} },
}));

const copies = () => s3Send.mock.calls.map(([cmd]: any[]) => cmd).filter((c: any) => c.input?.CopySource);
const heads = () => s3Send.mock.calls.map(([cmd]: any[]) => cmd).filter((c: any) => c.input && !c.input.CopySource);

beforeEach(() => {
  s3Send.mockReset();
  dbSend.mockReset();
  dbSend.mockResolvedValue({});
});

describe('failHandler fallback copy', () => {
  it('copies the seed when no ruling has been published for the case', async () => {
    s3Send.mockImplementation(async (cmd: any) => {
      if (cmd.input?.CopySource) return {};
      const notFound: any = new Error('NotFound');
      notFound.name = 'NotFound';
      notFound.$metadata = { httpStatusCode: 404 };
      throw notFound;
    });

    const out = await handler({ caseId: 'demo-100' });
    expect(out?.status).toBe('FAILED');
    expect(heads()).toHaveLength(1);
    expect(heads()[0].input).toEqual({ Bucket: 'rulings-bucket', Key: 'panch-rulings/demo-100/ruling.json' });
    expect(copies()).toHaveLength(1);
    expect(copies()[0].input.CopySource).toBe('evidence-bucket/bench/demo/demo-100/fallback-ruling.json');
  });

  it('never overwrites a ruling that is already published', async () => {
    s3Send.mockImplementation(async () => ({}));

    const out = await handler({ caseId: 'demo-200' });
    expect(out?.status).toBe('FAILED');
    expect(heads()).toHaveLength(1);
    expect(copies()).toHaveLength(0);
  });

  it('skips the copy when the published object cannot be checked', async () => {
    s3Send.mockImplementation(async () => {
      const denied: any = new Error('AccessDenied');
      denied.$metadata = { httpStatusCode: 403 };
      throw denied;
    });

    const out = await handler({ caseId: 'demo-300' });
    expect(out?.status).toBe('FAILED');
    expect(copies()).toHaveLength(0);
  });

  it('still marks the case FAILED and touches no object for a non-demo case', async () => {
    const out = await handler({ caseId: 'c-1234abcd' });
    expect(out?.status).toBe('FAILED');
    expect(dbSend).toHaveBeenCalledOnce();
    expect(s3Send).not.toHaveBeenCalled();
  });
});
