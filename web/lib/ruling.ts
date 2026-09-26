import type { Ruling } from './types';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Checks a ruling against the judge output contract (TRD section 6).
 * Returns null for an empty or malformed body, so the page can say
 * "not published" instead of rendering half a ruling.
 */
export function parseRuling(body: unknown): Ruling | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as Record<string, unknown>;

  const bps = r.payeeShareBps;
  if (typeof bps !== 'number' || !Number.isInteger(bps) || bps < 0 || bps > 10000) return null;
  if (typeof r.reasoning !== 'string') return null;

  const confidence = r.confidence;
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) return null;

  if (!Array.isArray(r.findingsOfFact) || !Array.isArray(r.clausesRelied)) return null;
  const findingsOk = r.findingsOfFact.every(
    (f) => f && typeof f === 'object' && typeof (f as Record<string, unknown>).fact === 'string'
      && isStringArray((f as Record<string, unknown>).evidenceIds),
  );
  const clausesOk = r.clausesRelied.every(
    (c) => c && typeof c === 'object' && typeof (c as Record<string, unknown>).clauseRef === 'string'
      && typeof (c as Record<string, unknown>).interpretation === 'string',
  );
  if (!findingsOk || !clausesOk) return null;

  return {
    // The TRD rule: findings without an evidence ID are dropped.
    findingsOfFact: (r.findingsOfFact as Ruling['findingsOfFact']).filter((f) => f.evidenceIds.length > 0),
    clausesRelied: r.clausesRelied as Ruling['clausesRelied'],
    payeeShareBps: bps,
    reasoning: r.reasoning,
    confidence,
    uncertainties: isStringArray(r.uncertainties) ? r.uncertainties : [],
  };
}
