import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getReviews, postReview } from '../reviews';

// reviews.ts reads its table/bucket env into consts at module load, so the
// values must exist before the import above is evaluated.
vi.hoisted(() => {
  process.env.CASES_TABLE = 'cases';
  process.env.LEDGER_TABLE = 'ledger';
  process.env.RULINGS_TABLE = 'rulings';
  process.env.RULINGS_BUCKET = 'rulings-bucket';
});

const { mockSend, mockS3, appendMock } = vi.hoisted(() => {
  return { mockSend: vi.fn(), mockS3: vi.fn(), appendMock: vi.fn() };
});

vi.mock('../../shared', async () => {
  const actual = await vi.importActual('../../shared');
  return {
    ...actual as any,
    docClient: { send: mockSend },
    appendLedgerEntry: appendMock,
  };
});

vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<any>('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: class { send = mockS3; },
    PutObjectCommand: class { constructor(public input: any) {} },
  };
});

const ESCALATED_CASE = {
  caseId: 'c-100',
  status: 'ESCALATED',
  amountCents: 50000,
  panelRecord: { aggregate: { medianPayeeShareBps: 8000, swapConsistent: true } },
};

function reviewEvent(body: any, sub?: string) {
  return {
    pathParameters: { caseId: 'c-100' },
    body: JSON.stringify(body),
    requestContext: { authorizer: { claims: sub ? { sub } : {} } },
  } as any;
}

describe('API Reviews', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockS3.mockReset();
    appendMock.mockReset();
    appendMock.mockResolvedValue({ entryHash: 'resolve-hash' });
  });

  it('GET /reviews lists escalated cases', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ caseId: 'c-100', status: 'ESCALATED' }]
    } as any);
    const res = await getReviews({} as any);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].caseId).toBe('c-100');
  });

  it('POST /reviews rejects a missing note', async () => {
    const res = await postReview(reviewEvent({ payeeShareBps: 10000 }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/note/);
  });

  it('POST /reviews rejects an oversized note', async () => {
    const res = await postReview(reviewEvent({ payeeShareBps: 10000, note: 'x'.repeat(1001) }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/1000/);
  });

  it('POST /reviews rejects out-of-range payeeShareBps', async () => {
    const res = await postReview(reviewEvent({ payeeShareBps: 12000, note: 'ok' }));
    expect(res.statusCode).toBe(400);
  });

  it('POST /reviews rejects a case that is not ESCALATED', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...ESCALATED_CASE, status: 'SETTLED' } } as any);
    const res = await postReview(reviewEvent({ payeeShareBps: 10000, note: 'ok' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/ESCALATED/);
  });

  it('POST /reviews chains the ledger from the real head and records the human ruling', async () => {
    mockSend
      // case read
      .mockResolvedValueOnce({ Item: ESCALATED_CASE } as any)
      // ledger head read
      .mockResolvedValueOnce({ Items: [{ seq: 2, entryHash: 'head-hash' }] } as any)
      // rulings row put
      .mockResolvedValueOnce({} as any);
    mockS3.mockResolvedValueOnce({} as any);
    appendMock
      .mockResolvedValueOnce({ entryHash: 'resolve-hash' })
      .mockResolvedValueOnce({ entryHash: 'release-hash' });

    const res = await postReview(reviewEvent({ payeeShareBps: 10000, note: 'Evidence e-2 decides it.' }, 'sub-123'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('SETTLED');
    expect(body.entryHash).toBe('release-hash');
    expect(body.published).toBe(true);

    // Ledger chained onto the real head — no fabricated seq 10 / MOCK_PREV.
    expect(appendMock).toHaveBeenCalledTimes(2);
    expect(appendMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      event: 'RESOLVE', seq: 3, prevHash: 'head-hash', payeeBps: 10000,
    }));
    expect(appendMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      event: 'RELEASE', seq: 4, prevHash: 'resolve-hash',
    }));

    // Rulings row carries the note, humanReviewed flag and rulingSha256.
    const put = mockSend.mock.calls.find((c: any[]) => c[0].constructor?.name === 'PutCommand')?.[0];
    expect(put).toBeDefined();
    expect(put.input.Item).toMatchObject({
      caseId: 'c-100', humanReviewed: true, note: 'Evidence e-2 decides it.', reviewerSub: 'sub-123',
    });
    expect(put.input.Item.rulingSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(put.input.Item.escalated).toBe(false);

    // Published body: note becomes the reasoning, hash computed over the body.
    expect(mockS3).toHaveBeenCalledTimes(1);
    const s3Input = mockS3.mock.calls[0][0].input;
    expect(s3Input.Key).toBe('panch-rulings/c-100/ruling.json');
    const published = JSON.parse(s3Input.Body);
    expect(published.humanReviewed).toBe(true);
    expect(published.reasoning).toBe('Evidence e-2 decides it.');
    expect(published.entryHash).toBe('release-hash');
    // The published-ruling contract (web parseRuling) requires numeric confidence.
    expect(published.confidence).toBe(1);
    expect(Array.isArray(published.findingsOfFact)).toBe(true);
    expect(Array.isArray(published.clausesRelied)).toBe(true);
  });

  it('POST /reviews starts the chain at genesis when the ledger is empty', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: ESCALATED_CASE } as any)
      .mockResolvedValueOnce({ Items: [] } as any)
      .mockResolvedValueOnce({} as any);
    mockS3.mockResolvedValueOnce({} as any);

    const res = await postReview(reviewEvent({ payeeShareBps: 5000, note: 'split' }));
    expect(res.statusCode).toBe(200);
    expect(appendMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      seq: 1, prevHash: '0'.repeat(64),
    }));
  });

  it('POST /reviews still settles (200) when S3 publish fails after commit', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: ESCALATED_CASE } as any)
      .mockResolvedValueOnce({ Items: [{ seq: 1, entryHash: 'h' }] } as any)
      .mockResolvedValueOnce({} as any);
    mockS3.mockRejectedValueOnce(new Error('S3 unavailable'));
    appendMock
      .mockResolvedValueOnce({ entryHash: 'r1' })
      .mockResolvedValueOnce({ entryHash: 'r2' });

    const res = await postReview(reviewEvent({ payeeShareBps: 10000, note: 'ok' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.published).toBe(false);

    const put = mockSend.mock.calls.find((c: any[]) => c[0].constructor?.name === 'PutCommand')?.[0];
    expect(put.input.Item.published).toBe(false);
  });

  it('POST /reviews surfaces ledger double-settlement as 409', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: ESCALATED_CASE } as any)
      .mockResolvedValueOnce({ Items: [{ seq: 1, entryHash: 'h' }] } as any);
    appendMock.mockRejectedValueOnce(new Error('Transaction canceled: status mismatch or sequence conflict (double-entry).'));

    const res = await postReview(reviewEvent({ payeeShareBps: 10000, note: 'ok' }));
    expect(res.statusCode).toBe(409);
  });

  it('POST /reviews surfaces an illegal transition as 409', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: ESCALATED_CASE } as any)
      .mockResolvedValueOnce({ Items: [{ seq: 1, entryHash: 'h' }] } as any);
    appendMock.mockRejectedValueOnce(new Error('Double-resolve rejected at validateTransition'));

    const res = await postReview(reviewEvent({ payeeShareBps: 10000, note: 'ok' }));
    expect(res.statusCode).toBe(409);
  });
});
