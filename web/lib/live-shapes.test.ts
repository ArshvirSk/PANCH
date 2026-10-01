/**
 * Regression tests for the live response shapes found in the phase 23 pass:
 * currentStage/executionStatus on GET /cases/{id}, the demo daily cap,
 * GET /rulings/{id}/verify and the cached fallback ruling.
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, normalizeCaseView } from './api';
import { completedStages, executionEnded, stageOf } from './caseLogic';
import { parseRuling } from './ruling';
import { clauseLabel } from './format';
import { SAMPLE_RULING_HREF } from './samples';

const BASE = 'https://api.example.com/prod/';
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function client(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(fetchImpl);
  return { api: createApiClient({ baseUrl: BASE, getIdToken: async () => 'tok', fetchImpl: fn, retryDelayMs: 0 }), fn };
}
const DEMO = { caseId: 'demo-1', status: 'DELIBERATING', amountCents: 50000, currency: 'USD', createdAt: 't' };

describe('stageOf: every state name WorkflowStack can report as currentStage', () => {
  it.each([
    ['INTAKE', 'INTAKE'], ['BLIND', 'BLIND'], ['JUDGES', 'JUDGES'],
    ['Judge1', 'JUDGES'], ['Judge2', 'JUDGES'], ['Judge3', 'JUDGES'],
    ['PrepareCrossExam', 'CROSS_EXAM'], ['CROSS_EXAM', 'CROSS_EXAM'], ['InjectJudge1CE', 'CROSS_EXAM'], ['CrossExamJudge3', 'CROSS_EXAM'],
    ['SWAP_TEST', 'SWAP_TEST'], ['InjectJudge2ST', 'SWAP_TEST'], ['SwapTestJudge1', 'SWAP_TEST'],
    ['PrepareAggregate', 'AGGREGATE'], ['AGGREGATE', 'AGGREGATE'], ['Route', 'AGGREGATE'], ['ESCALATE', 'AGGREGATE'],
    ['PRESIDING', 'PRESIDING'], ['MergePresiding', 'PRESIDING'], ['PUBLISH', 'PUBLISH'], ['SETTLE', 'SETTLE'],
  ])('%s → %s', (state, stage) => {
    expect(stageOf(state)).toBe(stage);
  });

  it.each([undefined, '', 'PENDING', 'FAILED', 'FailWorkflow', 'ESCALATED', 'Something'])('%j → no stage', (state) => {
    expect(stageOf(state)).toBeNull();
  });
});

describe('completedStages', () => {
  it('marks the stages before the running one as done', () => {
    expect(completedStages('DELIBERATING', 'SwapTestJudge2')).toEqual(['INTAKE', 'BLIND', 'JUDGES', 'CROSS_EXAM']);
    expect(completedStages('DELIBERATING', 'INTAKE')).toEqual([]);
    expect(completedStages('DELIBERATING', 'PENDING')).toEqual([]);
  });

  it('finishes every stage for a ruled or settled case, and stops at aggregation for an escalated one', () => {
    expect(completedStages('SETTLED', 'AGGREGATE')).toHaveLength(9);
    expect(completedStages('RULED', undefined)).toHaveLength(9);
    expect(completedStages('ESCALATED', 'ESCALATE')).toEqual(['INTAKE', 'BLIND', 'JUDGES', 'CROSS_EXAM', 'SWAP_TEST', 'AGGREGATE']);
  });

  it('knows which Step Functions states end a run', () => {
    expect(['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'ABORTED'].every(executionEnded)).toBe(true);
    expect(['RUNNING', undefined, ''].some(executionEnded)).toBe(false);
  });
});

describe('normalizeCaseView with the live GET /cases/{id} body', () => {
  it('derives the timeline from currentStage and keeps executionStatus', () => {
    const view = normalizeCaseView({ ...DEMO, executionStatus: 'RUNNING', currentStage: 'CrossExamJudge1' });
    expect(view.timeline).toEqual(['INTAKE', 'BLIND', 'JUDGES']);
    expect(view.executionStatus).toBe('RUNNING');
  });

  it('reports the stuck case seen live (DELIBERATING, run SUCCEEDED at AGGREGATE)', () => {
    const view = normalizeCaseView({ ...DEMO, executionStatus: 'SUCCEEDED', currentStage: 'AGGREGATE' });
    expect(view.case.status).toBe('DELIBERATING');
    expect(executionEnded(view.executionStatus)).toBe(true);
  });

  it('still prefers an explicit timeline array (mock server shape)', () => {
    expect(normalizeCaseView({ case: DEMO, timeline: ['INTAKE', 7] }).timeline).toEqual(['INTAKE']);
    expect(normalizeCaseView(DEMO)).not.toHaveProperty('executionStatus');
  });
});

describe('client: demo, cap and verify', () => {
  it('reads a demo case without sending a token', async () => {
    const { api, fn } = client(async () => json(200, { ...DEMO, currentStage: 'Judge2' }));
    const view = await api.getDemoCase('demo-1');
    expect(fn.mock.calls[0][0]).toBe(`${BASE}cases/demo-1`);
    expect((fn.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(view.timeline).toEqual(['INTAKE', 'BLIND']);
  });

  it('passes the daily cap message through, but not API Gateway throttling', async () => {
    const cap = client(async () => json(429, { error: 'Daily demo limit reached. Try again tomorrow.' }));
    await expect(cap.api.runDemo()).rejects.toEqual(new ApiError(429, 'Daily demo limit reached. Try again tomorrow.'));
    const throttle = client(async () => json(429, { message: 'Too Many Requests' }));
    await expect(throttle.api.runDemo()).rejects.toMatchObject({ message: 'Too many requests right now. Please wait a moment and try again.' });
  });

  it('returns the verify result, and null when there is no ruling to verify', async () => {
    const body = { caseId: 'c', match: true, reason: 'ok', content: { computedHash: 'a', storedHash: 'a', match: true, verified: true }, ledger: { entries: [], chainValid: true, terminalOk: true, lastEvent: 'RELEASE' } };
    const ok = client(async () => json(200, body));
    expect(await ok.api.verifyRuling('c/1')).toEqual(body);
    expect(ok.fn.mock.calls[0][0]).toBe(`${BASE}rulings/c%2F1/verify`);
    const missing = client(async () => json(404, { error: 'Ruling not published' }));
    expect(await missing.api.verifyRuling('c')).toBeNull();
  });

  it.each([{}, { match: 'yes', content: {}, ledger: {} }, { match: true }])('rejects an unexpected verify body %j', async (body) => {
    const { api } = client(async () => json(200, body));
    await expect(api.verifyRuling('c')).rejects.toMatchObject({ status: 502 });
  });
});

describe('parseRuling: the cached fallback', () => {
  it('keeps the fallback flag so the page can label it', () => {
    const fallback = { payeeShareBps: 0, findingsOfFact: [], clausesRelied: [], reasoning: 'No ruling.', confidence: 0, uncertainties: [], fallback: true };
    expect(parseRuling(fallback)).toMatchObject({ fallback: true, payeeShareBps: 0 });
    expect(parseRuling({ ...fallback, fallback: 'true' })).not.toHaveProperty('fallback');
  });
});

describe('clause labels from live model output', () => {
  it.each([
    ['3.1', 'Clause 3.1'],
    ['Clause 3.1', 'Clause 3.1'],
    ['clause 4.2(b)', 'clause 4.2(b)'],
    ['  Section 5 ', 'Section 5'],
    ['§2', '§2'],
  ])('%j → %j (never "Clause Clause")', (ref, label) => {
    expect(clauseLabel(ref)).toBe(label);
  });
});

describe('sample ruling', () => {
  it('points at a ruling that exists live, not the retired c-104 stub id', () => {
    expect(SAMPLE_RULING_HREF).toBe('/ruling/?id=demo-ba-a-354484');
  });
});