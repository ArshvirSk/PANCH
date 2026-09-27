import { describe, expect, it } from 'vitest';
import fixtures from '../../services/shared/fixtures/data.json';
import {
  bpsToInput,
  judgeLabel,
  medianOf,
  normalizeReviewCase,
  noteProblem,
  parsePercentToBps,
  readPanel,
  reviewItems,
  spreadOf,
  splitAmount,
  swapCheck,
  winningSide,
  MAX_NOTE_LENGTH,
} from './reviews';
import type { Ruling } from './types';

function judge(payeeShareBps: number, extra: Partial<Ruling> = {}): Ruling {
  return {
    findingsOfFact: [{ fact: 'Delivered late', evidenceIds: ['e-1'] }],
    clausesRelied: [{ clauseRef: '3.1', interpretation: 'Payment on delivery' }],
    payeeShareBps,
    reasoning: `Award ${payeeShareBps}`,
    confidence: 0.7,
    uncertainties: [],
    ...extra,
  };
}

const CASE = { caseId: 'c-105', status: 'ESCALATED', amountCents: 40000, currency: 'USD', createdAt: '2026-09-25T10:00:00Z', claimantId: 'u-1', respondentId: 'r@example.com' };

describe('readPanel', () => {
  it('reads a plain array and names seats by position', () => {
    const panel = readPanel([judge(10000), judge(0), judge(5000)]);
    expect(panel.map((j) => j.name)).toEqual(['judge-1', 'judge-2', 'judge-3']);
    expect(panel.map((j) => j.output?.payeeShareBps)).toEqual([10000, 0, 5000]);
  });

  it('reads Step Functions task results ({ judgeName, output })', () => {
    const panel = readPanel([{ judgeName: 'judge-2', output: judge(3000) }, { judgeName: 'judge-1', output: judge(9000) }]);
    expect(panel.map((j) => [j.name, j.output?.payeeShareBps])).toEqual([['judge-2', 3000], ['judge-1', 9000]]);
  });

  it('reads a record keyed by judge name, in natural order', () => {
    const panel = readPanel({ 'judge-10': judge(1), 'judge-2': judge(2), 'judge-1': judge(3) });
    expect(panel.map((j) => j.name)).toEqual(['judge-1', 'judge-2', 'judge-10']);
  });

  it('keeps a seat with an unreadable output instead of dropping it', () => {
    const panel = readPanel([judge(7000), { payeeShareBps: 'lots' }, null]);
    expect(panel).toHaveLength(3);
    expect(panel[1].output).toBeNull();
    expect(panel[2].output).toBeNull();
  });

  it.each([undefined, null, 'x', 42, true])('returns nothing for %j', (value) => {
    expect(readPanel(value)).toEqual([]);
  });

  it('drops findings without evidence, as on the ruling page', () => {
    const [seat] = readPanel([judge(5000, { findingsOfFact: [{ fact: 'cited', evidenceIds: ['e-1'] }, { fact: 'uncited', evidenceIds: [] }] })]);
    expect(seat.output?.findingsOfFact.map((f) => f.fact)).toEqual(['cited']);
  });
});

describe('normalizeReviewCase', () => {
  it('reads the escalated fixture shape (judges + aggregate block)', () => {
    const r = normalizeReviewCase({ ...fixtures.cases.ESCALATED, ...fixtures.escalatedCaseOutput })!;
    expect(r.caseId).toBe('c-105');
    expect(r.amountCents).toBe(40000);
    expect(r.judges.map((j) => j.output?.payeeShareBps)).toEqual([10000, 0, 5000]);
    expect(r.spreadBps).toBe(10000);
    expect(r.spreadComputed).toBe(false);
    expect(r.medianBps).toBe(5000);
    expect(r.swapConsistent).toBe(false);
  });

  it('reads the current GET /reviews shape (case item + panelOutputs)', () => {
    const r = normalizeReviewCase({ ...CASE, panelOutputs: { spreadBps: 5000, judges: [] } })!;
    expect(r.judges).toEqual([]);
    expect(r.spreadBps).toBe(5000);
    expect(r.medianBps).toBeUndefined();
    expect(r.swapConsistent).toBeUndefined();
  });

  it('reads the planned full shape with aggregate output and swap runs', () => {
    const r = normalizeReviewCase({
      ...CASE,
      summary: '  Logo delivered two weeks late.  ',
      panelOutputs: {
        finalPanelOutputs: { 'judge-1': judge(8000), 'judge-2': judge(2000), 'judge-3': judge(6000) },
        swapOutputs: { 'judge-1': judge(2000), 'judge-2': judge(3000), 'judge-3': judge(4000) },
        medianPayeeShareBps: 6000,
        spreadBps: 6000,
        swapConsistent: true,
        escalationReason: 'High spread or swap inconsistency',
      },
    })!;
    expect(r.summary).toBe('Logo delivered two weeks late.');
    expect(r.judges).toHaveLength(3);
    expect(r.swapJudges.map((j) => j.name)).toEqual(['judge-1', 'judge-2', 'judge-3']);
    expect(r.medianBps).toBe(6000);
    expect(r.escalationReason).toBe('High spread or swap inconsistency');
  });

  it('accepts panelOutputs sent as a JSON string', () => {
    const r = normalizeReviewCase({ ...CASE, panelOutputs: JSON.stringify({ judges: [judge(9000), judge(1000)] }) })!;
    expect(r.judges).toHaveLength(2);
    expect(r.spreadBps).toBe(8000);
  });

  it('ignores a panelOutputs string that is an S3 pointer', () => {
    const r = normalizeReviewCase({ ...CASE, panelOutputs: 's3://panch/c-105/panel.json' })!;
    expect(r.judges).toEqual([]);
  });

  it('works out spread and median from the awards when the API omits them', () => {
    const r = normalizeReviewCase({ ...CASE, judges: [judge(9000), judge(1000), judge(4000)] })!;
    expect(r.spreadBps).toBe(8000);
    expect(r.spreadComputed).toBe(true);
    expect(r.medianBps).toBe(4000);
  });

  it('does not invent a spread from a single readable award', () => {
    const r = normalizeReviewCase({ ...CASE, judges: [judge(9000), { bad: true }] })!;
    expect(r.spreadBps).toBeUndefined();
    expect(r.medianBps).toBe(9000);
  });

  it('accepts a { case, ... } wrapper', () => {
    const r = normalizeReviewCase({ case: CASE, panelOutputs: { judges: [judge(1)] } })!;
    expect(r.caseId).toBe('c-105');
    expect(r.judges).toHaveLength(1);
  });

  it.each([
    ['caseSummary', { caseSummary: 'From caseSummary' }],
    ['panel summary', { panelOutputs: { summary: 'From panel' } }],
  ])('finds the summary under %s', (_, extra) => {
    expect(normalizeReviewCase({ ...CASE, ...extra })!.summary).toMatch(/^From/);
  });

  it.each([
    ['out-of-range spread', { spreadBps: 12000 }, 'spreadBps', undefined],
    ['fractional spread', { spreadBps: 12.5 }, 'spreadBps', undefined],
    ['string swap flag', { swapConsistent: 'false' }, 'swapConsistent', undefined],
    ['negative amount', { amountCents: -5 }, 'amountCents', 0],
    ['NaN amount', { amountCents: Number.NaN }, 'amountCents', 0],
    ['missing currency', { currency: '' }, 'currency', 'USD'],
    ['missing status', { status: undefined }, 'status', 'ESCALATED'],
  ])('sanitises %s', (_, extra, key, expected) => {
    expect(normalizeReviewCase({ ...CASE, ...extra })![key as 'spreadBps']).toBe(expected);
  });

  it.each([null, undefined, 'c-105', [], {}, { caseId: '' }, { caseId: '   ' }, { caseId: 42 }])('rejects %j', (item) => {
    expect(normalizeReviewCase(item)).toBeNull();
  });
});

describe('reviewItems', () => {
  it.each([
    ['array', [1, 2]],
    ['items', { items: [1, 2] }],
    ['reviews', { reviews: [1, 2] }],
    ['cases', { cases: [1, 2] }],
  ])('finds the list in %s', (_, body) => {
    expect(reviewItems(body)).toEqual([1, 2]);
  });

  it.each([null, undefined, 'oops', 42, { items: 'x' }, { message: 'Internal' }])('returns null for %j', (body) => {
    expect(reviewItems(body)).toBeNull();
  });
});

describe('median and spread', () => {
  it('matches the Aggregate task for odd and even panels', () => {
    expect(medianOf([10000, 0, 5000])).toBe(5000);
    expect(medianOf([1000, 9000])).toBe(9000); // sorted[floor(n/2)]
    expect(medianOf([])).toBeUndefined();
    expect(spreadOf([10000, 0, 5000])).toBe(10000);
    expect(spreadOf([4000])).toBeUndefined();
    expect(spreadOf([3000, 3000])).toBe(0);
  });
});

describe('swapCheck', () => {
  it.each([
    [8000, 2000, 8000, 0, 'consistent'], // perfect mirror
    [8000, 3500, 6500, 1500, 'consistent'], // same winner, moved
    [8000, 8000, 2000, 6000, 'flipped'], // favours whoever is labelled Claimant
    [5000, 5000, 5000, 0, 'consistent'], // even both ways
    [5000, 3000, 7000, 2000, 'shifted'],
    [7000, 5000, 5000, 2000, 'shifted'],
    [10000, 10000, 0, 10000, 'flipped'],
  ])('original %i, swap %i → mirrored %i, off %i, %s', (orig, swap, mirrored, deviation, verdict) => {
    expect(swapCheck(judge(orig), judge(swap))).toEqual({ mirroredBps: mirrored, deviationBps: deviation, verdict });
  });

  it('needs both outputs', () => {
    expect(swapCheck(null, judge(1))).toBeNull();
    expect(swapCheck(judge(1), null)).toBeNull();
  });

  it('classifies the winning side around the even split', () => {
    expect([5001, 5000, 4999].map(winningSide)).toEqual(['claimant', 'even', 'respondent']);
  });
});

describe('parsePercentToBps', () => {
  it.each([
    ['70', 7000],
    ['0', 0],
    ['100', 10000],
    ['100.00', 10000],
    ['33.33', 3333],
    ['12.5', 1250],
    ['0.01', 1],
    [' 45 ', 4500],
    ['45%', 4500],
    ['45 %', 4500],
    ['007', 700],
  ])('%j → %i', (input, bps) => {
    expect(parsePercentToBps(input)).toEqual({ ok: true, bps });
  });

  it.each([
    ['', 'Enter'],
    ['   ', 'Enter'],
    ['%', 'Enter'],
    ['-5', 'from 0 to 100'],
    ['abc', 'from 0 to 100'],
    ['12.345', 'at most two decimals'],
    ['1e2', 'from 0 to 100'],
    ['50,5', 'from 0 to 100'],
    ['.5', 'from 0 to 100'],
    ['100.01', 'more than 100%'],
    ['250', 'more than 100%'],
    ['Infinity', 'from 0 to 100'],
  ])('rejects %j', (input, message) => {
    const result = parsePercentToBps(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it('round-trips through bpsToInput', () => {
    for (const bps of [0, 1, 50, 3333, 5000, 7250, 9999, 10000]) {
      expect(parsePercentToBps(bpsToInput(bps))).toEqual({ ok: true, bps });
    }
  });
});

describe('splitAmount', () => {
  it.each([
    [40000, 7000, 28000, 12000],
    [40000, 0, 0, 40000],
    [40000, 10000, 40000, 0],
    [1, 5000, 1, 0], // rounding goes to the claimant, parts still sum to the whole
    [99999, 3333, 33330, 66669],
  ])('%i at %i bps', (amount, bps, claimant, respondent) => {
    const split = splitAmount(amount, bps);
    expect(split).toEqual({ claimantCents: claimant, respondentCents: respondent });
    expect(split.claimantCents + split.respondentCents).toBe(amount);
  });
});

describe('noteProblem and judgeLabel', () => {
  it('requires a note within the limit', () => {
    expect(noteProblem('')).toMatch(/Add a note/);
    expect(noteProblem('   \n ')).toMatch(/Add a note/);
    expect(noteProblem('Evidence e-2 shows delivery.')).toBeNull();
    expect(noteProblem('x'.repeat(MAX_NOTE_LENGTH))).toBeNull();
    expect(noteProblem(`  ${'x'.repeat(MAX_NOTE_LENGTH)}  `)).toBeNull();
    expect(noteProblem('x'.repeat(MAX_NOTE_LENGTH + 1))).toMatch(/under 1000/);
  });

  it('labels judge seats', () => {
    expect(['judge-1', 'judge_2', 'JUDGE 3', 'judge4', 'presiding'].map(judgeLabel)).toEqual(['Judge 1', 'Judge 2', 'Judge 3', 'Judge 4', 'presiding']);
  });
});
