import { validateTransition } from './ledger';
import { CaseStatus, LedgerEvent } from './types';
import { describe, it, expect } from 'vitest';
import { computeEntryHash } from './hashing';

describe('Ledger Transitions', () => {
  it('allows FUND only when CREATED', () => {
    expect(validateTransition(CaseStatus.CREATED, LedgerEvent.FUND)).toBe(CaseStatus.FUNDED);
    expect(() => validateTransition(CaseStatus.FUNDED, LedgerEvent.FUND)).toThrow('Illegal transition');
  });

  it('allows DISPUTE only when FUNDED', () => {
    expect(validateTransition(CaseStatus.FUNDED, LedgerEvent.DISPUTE)).toBe(CaseStatus.DISPUTED);
    expect(() => validateTransition(CaseStatus.CREATED, LedgerEvent.DISPUTE)).toThrow('Illegal transition');
  });

  it('allows RESOLVE from DELIBERATING or ESCALATED', () => {
    expect(validateTransition(CaseStatus.DELIBERATING, LedgerEvent.RESOLVE)).toBe(CaseStatus.RESOLVED);
    expect(validateTransition(CaseStatus.ESCALATED, LedgerEvent.RESOLVE)).toBe(CaseStatus.RESOLVED);
  });

  it('rejects double-resolve', () => {
    expect(() => validateTransition(CaseStatus.RESOLVED, LedgerEvent.RESOLVE)).toThrow('Double-resolve rejected');
    expect(() => validateTransition(CaseStatus.SETTLED, LedgerEvent.RESOLVE)).toThrow('Double-resolve rejected');
  });

  it('allows RELEASE only when RESOLVED', () => {
    expect(validateTransition(CaseStatus.RESOLVED, LedgerEvent.RELEASE)).toBe(CaseStatus.SETTLED);
    expect(() => validateTransition(CaseStatus.DELIBERATING, LedgerEvent.RELEASE)).toThrow('Illegal transition');
  });
});

describe('Hash chain integrity', () => {
  it('chains hashes correctly', () => {
    const hash1 = computeEntryHash('GENESIS', LedgerEvent.FUND, 1000, 'c-1');
    const hash2 = computeEntryHash(hash1, LedgerEvent.DISPUTE, 1000, 'c-1');
    expect(hash2).not.toBe(hash1);
    expect(hash2.length).toBe(64); // sha256 hex
  });
});
