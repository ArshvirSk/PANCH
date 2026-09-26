import { describe, it, expect, vi } from 'vitest';
import { handler as intakeHandler } from '../stubs/intake';
import { handler as judgeHandler } from '../stubs/judge-1';
import { handler as aggregateHandler } from '../stubs/aggregate';
import { handler as failHandler } from '../stubs/failHandler';

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  return {
    DynamoDBDocumentClient: {
      from: vi.fn().mockReturnValue({ send: vi.fn() })
    },
    UpdateCommand: vi.fn(),
    ScanCommand: vi.fn(),
    GetCommand: vi.fn()
  };
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn()
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  CopyObjectCommand: vi.fn()
}));

describe('Tribunal Stubs and API', () => {
  it('Intake stub happy path', async () => {
    const out = await intakeHandler({ caseId: 'c-100' });
    expect(out.evidenceItems).toHaveLength(1);
    expect(out.evidenceItems[0].caseId).toBe('c-100');
  });

  it('Aggregate logic: happy path', async () => {
    const out = await aggregateHandler({
      caseId: 'c-100',
      finalPanelOutputs: {
        'judge-1': { findingsOfFact: [], clausesRelied: [], payeeShareBps: 10000, reasoning: '', confidence: 1, uncertainties: [] },
        'judge-2': { findingsOfFact: [], clausesRelied: [], payeeShareBps: 10000, reasoning: '', confidence: 1, uncertainties: [] },
        'judge-3': { findingsOfFact: [], clausesRelied: [], payeeShareBps: 10000, reasoning: '', confidence: 1, uncertainties: [] }
      }
    });
    expect(out.medianPayeeShareBps).toBe(10000);
    expect(out.escalated).toBe(false);
  });

  it('Aggregate logic: escalation path (high spread)', async () => {
    const out = await aggregateHandler({
      caseId: 'c-101',
      finalPanelOutputs: {
        'judge-1': { findingsOfFact: [], clausesRelied: [], payeeShareBps: 10000, reasoning: '', confidence: 1, uncertainties: [] },
        'judge-2': { findingsOfFact: [], clausesRelied: [], payeeShareBps: 0, reasoning: '', confidence: 1, uncertainties: [] },
        'judge-3': { findingsOfFact: [], clausesRelied: [], payeeShareBps: 5000, reasoning: '', confidence: 1, uncertainties: [] }
      }
    });
    expect(out.medianPayeeShareBps).toBe(5000);
    expect(out.escalated).toBe(true);
    expect(out.spreadBps).toBe(10000);
  });

  it('Fail Handler logic', async () => {
    const out = await failHandler({ caseId: 'demo-100' });
    expect(out?.status).toBe('FAILED');
  });
});
