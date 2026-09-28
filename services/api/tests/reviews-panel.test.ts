import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getReviews } from '../reviews';

const { mockSend, mockSfnSend } = vi.hoisted(() => ({ mockSend: vi.fn(), mockSfnSend: vi.fn() }));

vi.mock('../../shared', async () => {
  const actual = await vi.importActual('../../shared');
  return { ...actual as any, docClient: { send: mockSend } };
});

vi.mock('@aws-sdk/client-sfn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-sfn')>();
  return {
    ...actual,
    SFNClient: vi.fn().mockImplementation(() => ({ send: mockSfnSend })),
  };
});

const panelRecord = {
  judges: {
    'judge-1': { findingsOfFact: [{ fact: 'f1', evidenceIds: ['e-1'] }], clausesRelied: [], payeeShareBps: 5000, reasoning: 'r1', confidence: 0.9, uncertainties: [] },
    'judge-2': { findingsOfFact: [{ fact: 'f2', evidenceIds: ['e-1'] }], clausesRelied: [], payeeShareBps: 10000, reasoning: 'r2', confidence: 0.8, uncertainties: [] },
    'judge-3': { findingsOfFact: [{ fact: 'f3', evidenceIds: ['e-2'] }], clausesRelied: [], payeeShareBps: 0, reasoning: 'r3', confidence: 0.7, uncertainties: [] },
  },
  swapOutputs: {
    'judge-1': { findingsOfFact: [], clausesRelied: [], payeeShareBps: 5000, reasoning: 's1', confidence: 0.9, uncertainties: [] },
  },
  aggregate: { medianPayeeShareBps: 5000, spreadBps: 10000, swapConsistent: true },
  escalationReason: 'High spread or swap inconsistency',
  escalatedAt: '2026-09-28T02:00:00.000Z',
};

const escalatedCase = (caseId: string, extra: Record<string, unknown> = {}) => ({
  caseId, status: 'ESCALATED', amountCents: 50000, currency: 'USD', claimantId: 'c1', respondentId: 'r1', ...extra,
});

describe('GET /reviews panel record', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSfnSend.mockReset();
    process.env.CASES_TABLE = 'cases';
  });

  it('serves the persisted panel record and strips internal fields', async () => {
    mockSend.mockResolvedValueOnce({ Items: [escalatedCase('c-esc-1', { panelRecord })] });
    const res = await getReviews({} as any);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    const item = body[0];
    expect(item.caseId).toBe('c-esc-1');
    expect(item.panelRecord).toBeUndefined();           // internal field not leaked
    expect(item.executionArn).toBeUndefined();
    expect(item.panelOutputs.judges['judge-1'].payeeShareBps).toBe(5000);
    expect(item.panelOutputs.judges['judge-3'].payeeShareBps).toBe(0);
    expect(item.panelOutputs.swapOutputs['judge-1'].payeeShareBps).toBe(5000);
    expect(item.panelOutputs.aggregate).toEqual(panelRecord.aggregate);
    expect(item.panelOutputs.escalationReason).toBe(panelRecord.escalationReason);
    expect(item.panelOutputs.recoveredFromHistory).toBeUndefined();
  });

  it('recovers the panel from execution history for a legacy escalated row and backfills the row', async () => {
    mockSend
      // 1. scan finds a legacy row with no panelRecord
      .mockResolvedValueOnce({ Items: [escalatedCase('c-legacy-1', { executionArn: 'arn:aws:states:us-east-1:1:execution:sm:c-legacy-1' })] })
      // 2. backfill update
      .mockResolvedValueOnce({});
    mockSfnSend.mockResolvedValueOnce({
      events: [
        { type: 'TaskStateExited', stateExitedEventDetails: { name: 'AGGREGATE', output: JSON.stringify({
          finalPanelOutputs: panelRecord.judges, swapOutputs: panelRecord.swapOutputs,
          medianPayeeShareBps: 5000, spreadBps: 10000, swapConsistent: true,
          escalationReason: 'High spread or swap inconsistency',
        }) } },
      ],
    });

    const res = await getReviews({} as any);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const item = body[0];
    expect(item.panelOutputs.judges['judge-2'].reasoning).toBe('r2');
    expect(item.panelOutputs.aggregate.spreadBps).toBe(10000);
    expect(item.panelOutputs.recoveredFromHistory).toBe(true);
    // backfill wrote the healed record
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1][0].input.UpdateExpression).toContain('panelRecord');
  });

  it('lists a legacy row with empty panel data (no lie) when history recovery fails', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [escalatedCase('c-gone', { executionArn: 'arn:aws:states:us-east-1:1:execution:sm:c-gone' })] });
    mockSfnSend.mockRejectedValueOnce(new Error('Execution Does Not Exist'));

    const res = await getReviews({} as any);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body[0].caseId).toBe('c-gone');
    expect(body[0].panelOutputs.judges).toEqual({});
    expect(body[0].panelOutputs.recoveredFromHistory).toBeUndefined();
  });
});
