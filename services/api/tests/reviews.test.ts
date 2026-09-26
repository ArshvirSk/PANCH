import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getReviews, postReview } from '../reviews';

const { mockSend } = vi.hoisted(() => {
  return { mockSend: vi.fn() };
});

vi.mock('../../shared', async () => {
  const actual = await vi.importActual('../../shared');
  return {
    ...actual as any,
    docClient: { send: mockSend },
    appendLedgerEntry: vi.fn().mockResolvedValue({ entryHash: 'mock-hash' })
  };
});

describe('API Reviews', () => {
  beforeEach(() => {
    mockSend.mockClear();
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

  it('POST /reviews resolves case', async () => {
    mockSend.mockResolvedValueOnce({
      Item: { caseId: 'c-100', status: 'ESCALATED', amountCents: 50000 }
    } as any);
    const res = await postReview({ pathParameters: { caseId: 'c-100' }, body: JSON.stringify({ payeeShareBps: 10000, note: 'ok' }) } as any);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('SETTLED');
  });
});
