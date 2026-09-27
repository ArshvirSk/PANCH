import { parseRuling } from './ruling';
import type { PanelJudge, ReviewCase, Ruling, Status } from './types';

/*
 * The human review queue (TEAM_PLAN section H). GET /reviews is still settling
 * on the backend, so the reader below accepts every shape the contracts allow:
 * the panel record under `panelOutputs` or at the top level, judges as an
 * array, as `{ judgeName, output }` task results, or keyed by judge name, and
 * the aggregate fields flat or under `aggregate` (the escalated fixture).
 */

export const MAX_NOTE_LENGTH = 1000;

type Obj = Record<string, unknown>;

function asObject(value: unknown): Obj | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Obj;
  // RulingItem.panelOutputs is typed as a string; accept it when it holds JSON.
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asBps(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10000 ? value : undefined;
}

function firstDefined<T>(...values: (T | undefined)[]): T | undefined {
  return values.find((v) => v !== undefined);
}

/** 'judge-2' → 'Judge 2'. Other names are shown as sent. */
export function judgeLabel(name: string): string {
  const match = /^judge[-_ ]?(\d+)$/i.exec(name);
  return match ? `Judge ${match[1]}` : name;
}

function judgeFrom(entry: unknown, fallbackName: string): PanelJudge {
  const record = asObject(entry);
  // A Step Functions task result: { judgeName, output }.
  if (record && asObject(record.output)) {
    return { name: asText(record.judgeName) ?? fallbackName, output: parseRuling(record.output) };
  }
  return { name: fallbackName, output: parseRuling(entry) };
}

/** Reads a panel (or swap-test) record in any of the accepted shapes. */
export function readPanel(value: unknown): PanelJudge[] {
  if (Array.isArray(value)) return value.map((entry, i) => judgeFrom(entry, `judge-${i + 1}`));
  const record = asObject(value);
  if (!record) return [];
  return Object.keys(record)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((key) => judgeFrom(record[key], key));
}

function awards(judges: PanelJudge[]): number[] {
  return judges.flatMap((j) => (j.output ? [j.output.payeeShareBps] : []));
}

/** Same rule as the Aggregate task: the middle award of the sorted panel. */
export function medianOf(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function spreadOf(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  return Math.max(...values) - Math.min(...values);
}

/** Turns one GET /reviews item into a ReviewCase, or null when it has no usable case ID. */
export function normalizeReviewCase(item: unknown): ReviewCase | null {
  const outer = asObject(item);
  if (!outer) return null;
  const inner = asObject(outer.case) ?? {};
  const top: Obj = { ...inner, ...outer };
  const caseId = asText(top.caseId);
  if (!caseId) return null;

  const panel = asObject(top.panelOutputs) ?? {};
  const aggregate = asObject(panel.aggregate) ?? asObject(top.aggregate) ?? {};
  const pick = (key: string) => firstDefined(panel[key], aggregate[key], top[key]);

  const judges = readPanel(firstDefined(panel.judges, panel.finalPanelOutputs, top.finalPanelOutputs, top.judges));
  const swapJudges = readPanel(firstDefined(panel.swapOutputs, top.swapOutputs, panel.swapJudges));

  const sentSpread = asBps(pick('spreadBps'));
  const spreadBps = sentSpread ?? spreadOf(awards(judges));
  const medianBps = firstDefined(asBps(pick('medianPayeeShareBps')), asBps(aggregate.payeeShareBps), medianOf(awards(judges)));
  const swapConsistent = typeof pick('swapConsistent') === 'boolean' ? (pick('swapConsistent') as boolean) : undefined;

  return {
    caseId,
    status: (asText(top.status) ?? 'ESCALATED') as Status,
    amountCents: typeof top.amountCents === 'number' && Number.isFinite(top.amountCents) && top.amountCents >= 0 ? top.amountCents : 0,
    currency: asText(top.currency) ?? 'USD',
    createdAt: asText(top.createdAt),
    claimantId: asText(top.claimantId),
    respondentId: asText(top.respondentId),
    summary: firstDefined(asText(top.summary), asText(top.caseSummary), asText(panel.summary)),
    escalationReason: asText(pick('escalationReason')),
    judges,
    swapJudges,
    spreadBps,
    spreadComputed: sentSpread === undefined && spreadBps !== undefined,
    medianBps,
    swapConsistent,
  };
}

/** The list inside a GET /reviews body, or null when the body is not a list at all. */
export function reviewItems(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  const record = asObject(body);
  if (!record) return null;
  for (const key of ['items', 'reviews', 'cases']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return null;
}

export type Side = 'claimant' | 'respondent' | 'even';

export function winningSide(claimantBps: number): Side {
  if (claimantBps > 5000) return 'claimant';
  if (claimantBps < 5000) return 'respondent';
  return 'even';
}

export interface SwapCheck {
  /** The swap run's award mapped back onto the real Claimant: 10000 − swap award. */
  mirroredBps: number;
  /** How far the mapped-back award is from the judge's original award. */
  deviationBps: number;
  /** flipped: the winner changed sides. shifted: moved to or from an even split. */
  verdict: 'consistent' | 'shifted' | 'flipped';
}

/**
 * The swap test reruns a judge with the party roles mirrored, so an impartial
 * judge's swap award is roughly 10000 − its original award (swapTest.ts).
 */
export function swapCheck(original: Ruling | null, swapped: Ruling | null): SwapCheck | null {
  if (!original || !swapped) return null;
  const mirroredBps = 10000 - swapped.payeeShareBps;
  const before = winningSide(original.payeeShareBps);
  const after = winningSide(mirroredBps);
  const verdict = before === after ? 'consistent' : before === 'even' || after === 'even' ? 'shifted' : 'flipped';
  return { mirroredBps, deviationBps: Math.abs(original.payeeShareBps - mirroredBps), verdict };
}

export type BpsResult = { ok: true; bps: number } | { ok: false; error: string };

/** Parses the claimant's share typed as a percentage ("70", "33.5", "12.25%") into basis points. */
export function parsePercentToBps(input: string): BpsResult {
  const cleaned = input.trim().replace(/%$/, '').trim();
  if (!cleaned) return { ok: false, error: "Enter the claimant's share as a percentage." };
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { ok: false, error: 'Enter a number from 0 to 100, with at most two decimals.' };
  const [whole, fraction = ''] = cleaned.split('.');
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (bps > 10000) return { ok: false, error: 'The share cannot be more than 100%.' };
  return { ok: true, bps };
}

/** Basis points back to the text the percentage field shows: 7000 → "70", 3333 → "33.33". */
export function bpsToInput(bps: number): string {
  return String(Number((bps / 100).toFixed(2)));
}

/** How the escrow divides at a given award. Rounding goes to the claimant so the parts always sum to the whole. */
export function splitAmount(amountCents: number, claimantBps: number): { claimantCents: number; respondentCents: number } {
  const claimantCents = Math.round((amountCents * claimantBps) / 10000);
  return { claimantCents, respondentCents: amountCents - claimantCents };
}

export function noteProblem(note: string): string | null {
  const trimmed = note.trim();
  if (!trimmed) return 'Add a note explaining the decision. It is kept with the ruling.';
  if (trimmed.length > MAX_NOTE_LENGTH) return `Keep the note under ${MAX_NOTE_LENGTH} characters.`;
  return null;
}
