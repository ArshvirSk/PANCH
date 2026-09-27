import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { handler as publishHandler } from '../stubs/publish';
import { PublishInput } from '../../shared/step-functions';
import { JudgeOutput } from '../../shared/schemas';

const putObjectMock = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: putObjectMock })),
  PutObjectCommand: vi.fn(),
}));

const putObjectBody = (callIndex: number): any => {
  const input = vi.mocked(PutObjectCommand).mock.calls[callIndex][0] as { Body: string };
  return JSON.parse(input.Body);
};

const judgeRuling = (judgeName: string, payeeShareBps: number): JudgeOutput => ({
  findingsOfFact: [{ fact: `fact from ${judgeName}`, evidenceIds: ['e-1'] }],
  clausesRelied: [{ clauseRef: '3.1', interpretation: `reading by ${judgeName}` }],
  payeeShareBps,
  reasoning: `reasoning by ${judgeName}`,
  confidence: 0.9,
  uncertainties: [],
});

const synthesis: JudgeOutput = {
  findingsOfFact: [{ fact: 'presiding synthesized fact', evidenceIds: ['e-1'] }],
  clausesRelied: [{ clauseRef: '3.1', interpretation: 'presiding synthesized reading' }],
  payeeShareBps: 6200,
  reasoning: 'presiding synthesis of the panel',
  confidence: 0.85,
  uncertainties: [],
};

const baseEvent: PublishInput = {
  caseId: 'c-test',
  presidingRulingS3Key: 'panch-rulings/c-test/ruling.json',
  payeeShareBps: 5000,
  spreadBps: 5000,
  swapConsistent: true,
  escalated: false,
  blindedCaseFileS3Key: 'blinded/c-test/case-file.json',
  finalPanelOutputs: {
    'judge-1': judgeRuling('judge-1', 4000),
    'judge-2': judgeRuling('judge-2', 10000),
    'judge-3': judgeRuling('judge-3', 5000),
  },
};

beforeEach(() => {
  putObjectMock.mockReset();
  vi.mocked(PutObjectCommand).mockClear();
  putObjectMock.mockResolvedValue({});
});

describe('publish', () => {
  it('publishes the presiding synthesis when present', async () => {
    await publishHandler({ ...baseEvent, ruling: synthesis });

    expect(putObjectMock).toHaveBeenCalledTimes(1);
    const body = putObjectBody(0);
    expect(body.payeeShareBps).toBe(6200);
    expect(body.reasoning).toBe('presiding synthesis of the panel');
    expect(body.findingsOfFact[0].fact).toBe('presiding synthesized fact');
  });

  it('falls back to the median judge output when no synthesis is present (FAILED path)', async () => {
    await publishHandler({ ...baseEvent });

    const body = putObjectBody(0);
    expect(body.payeeShareBps).toBe(5000);
    expect(body.reasoning).toBe('reasoning by judge-3');
  });
});
