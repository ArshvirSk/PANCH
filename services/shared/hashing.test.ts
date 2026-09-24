import { expect, test } from 'vitest';
import { computeEntryHash } from './hashing';
import { LedgerEvent } from './types';

test('computeEntryHash produces consistent output', () => {
  const hash1 = computeEntryHash('prev123', LedgerEvent.FUND, 40000, 'case1');
  const hash2 = computeEntryHash('prev123', LedgerEvent.FUND, 40000, 'case1');
  expect(hash1).toBe(hash2);
});

test('computeEntryHash changes when inputs change', () => {
  const hash1 = computeEntryHash('prev123', LedgerEvent.FUND, 40000, 'case1');
  const hash2 = computeEntryHash('prev123', LedgerEvent.DISPUTE, 40000, 'case1');
  expect(hash1).not.toBe(hash2);
});
