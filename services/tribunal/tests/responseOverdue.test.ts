import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../stubs/responseOverdue';

vi.hoisted(() => {
  process.env.CASES_TABLE = 'Cases';
});

const sendMock = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: sendMock })) },
  ScanCommand: class { constructor(public input: any) {} },
  UpdateCommand: class { constructor(public input: any) {} },
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: vi.fn() }));
vi.mock('../../shared/metrics', () => ({ emitMetric: vi.fn() }));

const isScan = (c: any[]) => c[0]?.constructor?.name === 'ScanCommand';
const isUpdate = (c: any[]) => c[0]?.constructor?.name === 'UpdateCommand';

// Route responses by command type: scans consume scanResponses, updates
// consume updateResponses (an Error instance is thrown to simulate a lost
// conditional race).
let scanResponses: any[];
let updateResponses: any[];

describe('response overdue sweep', () => {
  beforeEach(() => {
    sendMock.mockReset();
    scanResponses = [];
    updateResponses = [];
    sendMock.mockImplementation(async (cmd: any) => {
      if (isScan([cmd])) return scanResponses.shift() ?? { Items: [] };
      const r = updateResponses.shift();
      if (r instanceof Error) throw r;
      return r ?? {};
    });
  });

  it('flags overdue FUNDED and DISPUTED rows conditionally', async () => {
    scanResponses = [
      { Items: [{ caseId: 'c-over-1', evidenceDeadline: '2001-01-01T00:00:00Z' }] },
      { Items: [{ caseId: 'c-over-2', evidenceDeadline: '2001-02-01T00:00:00Z' }] },
    ];

    const out = await handler();
    expect(out.flagged).toBe(2);
    const updates = sendMock.mock.calls.filter(isUpdate);
    expect(updates).toHaveLength(2);
    expect(updates[0][0].input.ConditionExpression).toContain('#st = :st');
    expect(updates[0][0].input.Key).toEqual({ caseId: 'c-over-1' });
  });

  it('counts only rows the conditional update won', async () => {
    scanResponses = [
      { Items: [{ caseId: 'c-a', evidenceDeadline: '2001-01-01T00:00:00Z' }, { caseId: 'c-b', evidenceDeadline: '2001-01-01T00:00:00Z' }] },
      { Items: [] },
    ];
    // c-a wins; c-b races into another status mid-sweep
    updateResponses = [{}, new Error('The conditional request failed')];

    const out = await handler();
    expect(out.flagged).toBe(1);
  });

  it('follows scan pagination to the end', async () => {
    scanResponses = [
      { Items: [{ caseId: 'c-1', evidenceDeadline: '2001-01-01T00:00:00Z' }], LastEvaluatedKey: { caseId: 'c-1' } },
      { Items: [{ caseId: 'c-2', evidenceDeadline: '2001-01-01T00:00:00Z' }] },
      { Items: [] },
    ];

    const out = await handler();
    expect(out.flagged).toBe(2);
    const scans = sendMock.mock.calls.filter(isScan);
    expect(scans.length).toBe(3); // two FUNDED pages + one DISPUTED page
    // The second FUNDED page continues from the first page's key.
    expect(scans[1][0].input.ExclusiveStartKey).toEqual({ caseId: 'c-1' });
  });

  it('is a no-op without CASES_TABLE', async () => {
    const saved = process.env.CASES_TABLE;
    delete process.env.CASES_TABLE;
    try {
      const out = await handler();
      expect(out).toEqual({ scanned: 0, flagged: 0 });
      expect(sendMock).not.toHaveBeenCalled();
    } finally {
      process.env.CASES_TABLE = saved;
    }
  });
});
