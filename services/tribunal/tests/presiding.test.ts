import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { handler, buildDeliberationRecord } from '../stubs/presiding';
import { PresidingInput } from '../../shared/step-functions';
import { JudgeOutput } from '../../shared/schemas';

const invokeJudgeModelMock = vi.hoisted(() => vi.fn());
const s3SendMock = vi.hoisted(() => vi.fn());

vi.mock('../../shared/helpers', () => ({
  invokeJudgeModel: invokeJudgeModelMock,
}));

// Mock only the S3 transport: the REAL sanitizeJudgeOutput / loadBlindedCaseFile
// run, so the fabricated-evidenceId test exercises the production code path.
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(() => ({ send: s3SendMock })),
  };
});

const caseFileJson = JSON.stringify({
  caseId: 'c-test',
  evidenceItems: [
    { evidenceId: 'e-1', party: 'Claimant', type: 'contract' },
    { evidenceId: 'e-2', party: 'Respondent', type: 'chat' },
  ],
});

beforeEach(() => {
  process.env.BUCKET = 'test-bucket';
  s3SendMock.mockReset().mockImplementation(async (cmd: any) => {
    if (cmd instanceof GetObjectCommand) {
      return { Body: { transformToString: async () => caseFileJson } };
    }
    throw new Error(`unexpected S3 command in test: ${cmd?.constructor?.name}`);
  });
  invokeJudgeModelMock.mockReset();
});

const judgeRuling = (judgeName: string, reasoning: string, payeeShareBps: number): JudgeOutput => ({
  findingsOfFact: [{ fact: `fact from ${judgeName}`, evidenceIds: ['e-1'] }],
  clausesRelied: [{ clauseRef: '3.1', interpretation: `reading by ${judgeName}` }],
  payeeShareBps,
  reasoning,
  confidence: 0.9,
  uncertainties: [],
});

const buildEvent = (): PresidingInput => ({
  caseId: 'c-test',
  medianPayeeShareBps: 5000,
  spreadBps: 5000,
  swapConsistent: true,
  escalated: false,
  blindedCaseFileS3Key: 'blinded/c-test/case-file.json',
  finalPanelOutputs: {
    'judge-1': judgeRuling('judge-1', 'judge-1 reasons the delivery date controls payment timing', 5000),
    'judge-2': judgeRuling('judge-2', 'judge-2 reasons the acceptance clause was satisfied on launch', 10000),
    'judge-3': judgeRuling('judge-3', 'judge-3 reasons the payment terms fix the share at half', 5000),
  },
});

const synthesizedRuling: JudgeOutput = {
  findingsOfFact: [{ fact: 'synthesized fact', evidenceIds: ['e-1', 'e-2'] }],
  clausesRelied: [{ clauseRef: '3.1', interpretation: 'synthesized reading' }],
  payeeShareBps: 6200,
  reasoning: 'synthesis of the panel',
  confidence: 0.85,
  uncertainties: ['residual doubt on acceptance'],
};

// invokeJudgeModel returns { result, modelId, usage } since the day-3 cost
// tracking merge (#11) — mock the real contract, not the old bare ruling.
const wrapperResult = (ruling: JudgeOutput) => ({
  result: ruling,
  modelId: 'mistral.mistral-large-3-675b-instruct',
  usage: { inputTokens: 1200, outputTokens: 800, totalTokens: 2000 },
});

describe('presiding synthesis handler', () => {
  it('calls Bedrock via the shared wrapper with role "presiding" and every judge\'s full ruling', async () => {
    invokeJudgeModelMock.mockResolvedValue(wrapperResult(synthesizedRuling));
    await handler(buildEvent());

    expect(invokeJudgeModelMock).toHaveBeenCalledTimes(1);
    const [role, params] = invokeJudgeModelMock.mock.calls[0];
    expect(role).toBe('presiding');
    expect(params.schema).toBeDefined();
    expect(params.prompt).toContain('<judge-ruling judge="judge-1">');
    expect(params.prompt).toContain('<judge-ruling judge="judge-2">');
    expect(params.prompt).toContain('<judge-ruling judge="judge-3">');
    expect(params.prompt).toContain('judge-1 reasons the delivery date controls payment timing');
    expect(params.prompt).toContain('judge-2 reasons the acceptance clause was satisfied on launch');
    expect(params.prompt).toContain('judge-3 reasons the payment terms fix the share at half');
    expect(params.prompt).toContain('<evidence>');
    // The median is deliberately withheld: the presiding award must not anchor on it.
    expect(params.prompt).not.toContain('medianPayeeShareBps');
  });

  it('returns the synthesized ruling and the presiding award, not the median relay', async () => {
    invokeJudgeModelMock.mockResolvedValue(wrapperResult(synthesizedRuling));
    const out = await handler(buildEvent());

    expect(out.caseId).toBe('c-test');
    expect(out.presidingRulingS3Key).toBe('panch-rulings/c-test/ruling.json');
    expect(out.ruling).toEqual(synthesizedRuling);
    // 6200 comes from the synthesis; the median relay would have emitted 5000.
    expect(out.payeeShareBps).toBe(6200);
    expect(out.payeeShareBps).not.toBe(5000);
    expect(out.spreadBps).toBe(5000);
    expect(out.swapConsistent).toBe(true);
    expect(out.escalated).toBe(false);
    expect(out.finalPanelOutputs).toEqual(buildEvent().finalPanelOutputs);
  });

  it('drops findings citing evidenceIds that do not exist in the case file', async () => {
    invokeJudgeModelMock.mockResolvedValue(wrapperResult({
      ...synthesizedRuling,
      findingsOfFact: [
        { fact: 'real finding', evidenceIds: ['e-1'] },
        { fact: 'fabricated finding', evidenceIds: ['e-999'] },
        { fact: 'no citation at all', evidenceIds: [] },
      ],
    }));

    const out = await handler(buildEvent());
    const ruling = out.ruling!;

    expect(ruling.findingsOfFact).toHaveLength(1);
    expect(ruling.findingsOfFact[0].fact).toBe('real finding');
    expect(ruling.findingsOfFact[0].evidenceIds).toEqual(['e-1']);
  });

  it('rejects an event with no panel outputs', () => {
    const event = buildEvent();
    event.finalPanelOutputs = {};
    expect(() => buildDeliberationRecord(event, '<evidence>x</evidence>')).toThrow(/finalPanelOutputs/);
  });
});
