import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { GetObjectCommand as S3GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { handler } from '../stubs/presiding';
import { PresidingInput } from '../../shared/step-functions';
import { JudgeOutput } from '../../shared/schemas';

/**
 * Presiding output validation: the AWS SDK layers are mocked so the REAL
 * shared wrapper (models.ts invokeModel) and the REAL sanitizeJudgeOutput
 * run — proving a raw/invalid model response can never pass through
 * unvalidated and that a transient failure is retried once.
 */

const sendMock = vi.hoisted(() => vi.fn());
const s3SendMock = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-bedrock-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-bedrock-runtime')>();
  return {
    ...actual,
    BedrockRuntimeClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
  };
});

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(() => ({ send: s3SendMock })),
  };
});

vi.mock('@aws-sdk/client-ssm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-ssm')>();
  const responses: Record<string, { Parameter?: { Value: string } }> = {
    '/panch/models/presiding': { Parameter: { Value: 'mistral.mistral-large-3-675b-instruct' } },
    '/panch/models/presiding-mode': { Parameter: { Value: 'tool' } },
  };
  return {
    ...actual,
    SSMClient: vi.fn().mockImplementation(() => ({
      send: vi.fn(async (cmd: { input?: { Name?: string } }) => {
        const name = cmd?.input?.Name ?? '';
        if (!(name in responses)) throw new Error(`unexpected SSM parameter: ${name}`);
        return responses[name];
      }),
    })),
  };
});

const caseFileJson = JSON.stringify({
  caseId: 'c-test',
  evidenceItems: [{ evidenceId: 'e-1', party: 'Claimant', type: 'contract' }],
});

beforeEach(() => {
  process.env.BUCKET = 'test-bucket';
  sendMock.mockReset();
  s3SendMock.mockReset().mockImplementation(async (cmd: any) => {
    if (cmd instanceof S3GetObjectCommand) {
      return { Body: { transformToString: async () => caseFileJson } };
    }
    throw new Error(`unexpected S3 command in test: ${cmd?.constructor?.name}`);
  });
});

const event: PresidingInput = {
  caseId: 'c-test',
  medianPayeeShareBps: 5000,
  spreadBps: 5000,
  swapConsistent: true,
  escalated: false,
  blindedCaseFileS3Key: 'blinded/c-test/case-file.json',
  finalPanelOutputs: {
    'judge-1': {
      findingsOfFact: [{ fact: 'f1', evidenceIds: ['e-1'] }],
      clausesRelied: [],
      payeeShareBps: 5000,
      reasoning: 'r1',
      confidence: 0.9,
      uncertainties: [],
    },
  },
};

const validToolUseResponse = (ruling: JudgeOutput) => ({
  output: {
    message: {
      content: [{ toolUse: { name: 'submit_ruling', toolUseId: 't1', input: ruling } }],
    },
  },
});

const validRuling: JudgeOutput = {
  findingsOfFact: [{ fact: 'fact', evidenceIds: ['e-1'] }],
  clausesRelied: [{ clauseRef: '3.1', interpretation: 'reading' }],
  payeeShareBps: 6200,
  reasoning: 'synthesis',
  confidence: 0.85,
  uncertainties: [],
};

describe('presiding output validation through the real shared wrapper', () => {
  it('rejects an invalid first response and succeeds on the retried valid one', async () => {
    sendMock
      .mockResolvedValueOnce(validToolUseResponse({ ...validRuling, payeeShareBps: 25000 })) // out of schema range
      .mockResolvedValueOnce(validToolUseResponse(validRuling));

    const out = await handler(event);

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(out.ruling).toEqual(validRuling);
    expect(out.payeeShareBps).toBe(6200);
    // Tool mode with forced submit_ruling tool, per the presiding SSM config.
    const cmd = sendMock.mock.calls[0][0] as InstanceType<typeof ConverseCommand>;
    expect(cmd.input.modelId).toBe('mistral.mistral-large-3-675b-instruct');
    expect(cmd.input.toolConfig?.toolChoice).toEqual({ tool: { name: 'submit_ruling' } });
    const promptText = (cmd.input.messages?.[0]?.content?.[0] as { text?: string })?.text ?? '';
    expect(promptText).toContain('<judge-ruling judge="judge-1">');
    expect(promptText).toContain('<evidence>');
    // Sanity: the S3 mock actually served the blinded case file.
    expect(s3SendMock.mock.calls[0][0]).toBeInstanceOf(S3GetObjectCommand);
  });

  it('throws after exhausting retries if every response is schema-invalid', async () => {
    sendMock
      .mockResolvedValueOnce(validToolUseResponse({ ...validRuling, payeeShareBps: 25000 })) // out of schema range
      .mockResolvedValueOnce({ output: { message: { content: [{ text: 'not json at all' }] } } }) // no tool use
      .mockResolvedValueOnce(validToolUseResponse({ ...validRuling, payeeShareBps: 25000 }));

    await expect(handler(event)).rejects.toThrow();
    // The shared wrapper tries three times (initial + two retries).
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  it('propagates a Bedrock failure after exhausting the retries', async () => {
    sendMock.mockRejectedValue(new Error('ThrottlingException'));
    await expect(handler(event)).rejects.toThrow('ThrottlingException');
    expect(sendMock).toHaveBeenCalledTimes(3);
  });
});
