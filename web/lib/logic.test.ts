import { describe, expect, it } from 'vitest';
import { availableActions, getRole, shouldPoll, stepState, stepsFor } from './caseLogic';
import { checkEvidenceFile, resolveContentType } from './evidence';
import { bpsToPercent, formatMoney, isValidEmail, parseAmountToCents, shortHash } from './format';
import { authErrorMessage, passwordProblems, safeNextPath } from './authErrors';
import { normalizeApiUrl, resolveConfig } from './config';
import { parseRuling } from './ruling';
import { createCaseMemory, type KeyValueStore } from './storage';
import type { Case } from './types';

const baseCase: Case = {
  caseId: 'c-1',
  status: 'CREATED',
  claimantId: 'sub-riya',
  respondentId: 'Klaus@Example.com',
  amountCents: 40000,
  currency: 'USD',
  createdAt: '2026-09-25T10:00:00Z',
};

describe('roles', () => {
  it('identifies the claimant by Cognito sub', () => {
    expect(getRole(baseCase, { sub: 'sub-riya', email: 'riya@example.com' })).toBe('claimant');
  });
  it('identifies the respondent by email, case-insensitively', () => {
    expect(getRole(baseCase, { sub: 'sub-klaus', email: 'klaus@example.com' })).toBe('respondent');
  });
  it('treats everyone else as an observer', () => {
    expect(getRole(baseCase, { sub: 'sub-x', email: 'x@example.com' })).toBe('observer');
    expect(getRole(baseCase, undefined)).toBe('observer');
  });
});

describe('actions follow the ledger state machine', () => {
  it('only the respondent funds a new case', () => {
    expect(availableActions('CREATED', 'respondent')).toEqual(['fund']);
    expect(availableActions('CREATED', 'claimant')).toEqual([]);
  });
  it('either party can dispute a funded case', () => {
    expect(availableActions('FUNDED', 'claimant')).toEqual(['dispute']);
    expect(availableActions('FUNDED', 'respondent')).toEqual(['dispute']);
  });
  it('a disputed case takes evidence and can be submitted', () => {
    expect(availableActions('DISPUTED', 'claimant')).toEqual(['uploadEvidence', 'submit']);
  });
  it('no actions while deliberating or escalated', () => {
    expect(availableActions('DELIBERATING', 'claimant')).toEqual([]);
    expect(availableActions('ESCALATED', 'respondent')).toEqual([]);
  });
  it('anyone can read the ruling once issued', () => {
    expect(availableActions('RULED', 'observer')).toEqual(['viewRuling']);
    expect(availableActions('SETTLED', 'claimant')).toEqual(['viewRuling']);
  });
  it('observers cannot act', () => {
    expect(availableActions('FUNDED', 'observer')).toEqual([]);
    expect(availableActions('DISPUTED', 'observer')).toEqual([]);
  });
  it('polls only while deliberating', () => {
    expect(shouldPoll('DELIBERATING')).toBe(true);
    expect(shouldPoll('DISPUTED')).toBe(false);
  });
});

describe('progress steps', () => {
  it('marks earlier steps done and the current one active', () => {
    const steps = stepsFor('DISPUTED');
    expect(steps.map((_, i) => stepState(steps, 'DISPUTED', i))).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming']);
  });
  it('shows a settled case as fully done', () => {
    const steps = stepsFor('SETTLED');
    expect(steps.every((_, i) => stepState(steps, 'SETTLED', i) === 'done')).toBe(true);
  });
  it('replaces the ruling step with human review when escalated', () => {
    const steps = stepsFor('ESCALATED');
    expect(steps.map((s) => s.status)).toContain('ESCALATED');
    expect(steps.map((s) => s.status)).not.toContain('RULED');
    expect(stepState(steps, 'ESCALATED', 4)).toBe('current');
  });
});

describe('amounts and formatting', () => {
  it('parses amounts into integer cents', () => {
    expect(parseAmountToCents('400')).toEqual({ ok: true, cents: 40000 });
    expect(parseAmountToCents('1,250.5')).toEqual({ ok: true, cents: 125050 });
    expect(parseAmountToCents('0.07')).toEqual({ ok: true, cents: 7 });
  });
  it('rejects bad amounts', () => {
    expect(parseAmountToCents('').ok).toBe(false);
    expect(parseAmountToCents('0').ok).toBe(false);
    expect(parseAmountToCents('-5').ok).toBe(false);
    expect(parseAmountToCents('1.234').ok).toBe(false);
    expect(parseAmountToCents('abc').ok).toBe(false);
    expect(parseAmountToCents('5000.01').ok).toBe(false);
    expect(parseAmountToCents('5000')).toEqual({ ok: true, cents: 500000 });
  });
  it('formats money, basis points and hashes', () => {
    expect(formatMoney(40000, 'USD')).toBe('$400.00');
    expect(formatMoney(100, 'NOPE')).toBe('1.00 NOPE');
    expect(bpsToPercent(10000)).toBe('100%');
    expect(bpsToPercent(7050)).toBe('70.5%');
    expect(shortHash('a'.repeat(64), 4)).toBe('aaaa…aaaa');
    expect(shortHash('short')).toBe('short');
  });
  it('validates emails', () => {
    expect(isValidEmail(' klaus@example.com ')).toBe(true);
    expect(isValidEmail('klaus@')).toBe(false);
  });
});

describe('evidence files', () => {
  it('falls back to the extension when the browser gives no type', () => {
    expect(resolveContentType('chat.txt', '')).toBe('text/plain');
    expect(resolveContentType('scan.JPG', '')).toBe('image/jpeg');
    expect(resolveContentType('invoice.pdf', 'application/pdf')).toBe('application/pdf');
  });
  it('rejects unsupported, empty and oversized files', () => {
    expect(checkEvidenceFile({ name: 'a.exe', type: 'application/x-msdownload', size: 10 }).ok).toBe(false);
    expect(checkEvidenceFile({ name: 'a.txt', type: 'text/plain', size: 0 }).ok).toBe(false);
    expect(checkEvidenceFile({ name: 'a.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 }).ok).toBe(false);
    expect(checkEvidenceFile({ name: 'a.png', type: 'image/png', size: 2048 })).toEqual({ ok: true, contentType: 'image/png' });
  });
});

describe('auth helpers', () => {
  it('maps Cognito errors to plain messages', () => {
    expect(authErrorMessage({ name: 'NotAuthorizedException' })).toBe('Incorrect email or password.');
    expect(authErrorMessage({ name: 'UsernameExistsException' })).toMatch(/already exists/);
    expect(authErrorMessage(new Error('boom'))).toBe('boom');
  });
  it('checks the Cognito default password policy', () => {
    expect(passwordProblems('Password123!')).toEqual([]);
    expect(passwordProblems('password')).toEqual(['an uppercase letter', 'a number', 'a symbol']);
  });
  it('only redirects to same-site paths after sign-in', () => {
    expect(safeNextPath('/case/?id=c-1')).toBe('/case/?id=c-1');
    expect(safeNextPath('https://evil.example')).toBe('/cases/');
    expect(safeNextPath('//evil.example')).toBe('/cases/');
    expect(safeNextPath('/\\evil.example')).toBe('/cases/');
    expect(safeNextPath(null)).toBe('/cases/');
  });
});

describe('config', () => {
  it('normalizes the API URL to one trailing slash', () => {
    expect(normalizeApiUrl('https://x/prod')).toBe('https://x/prod/');
    expect(normalizeApiUrl('https://x/prod///')).toBe('https://x/prod/');
    expect(normalizeApiUrl('  ')).toBe('');
  });
  it('lists missing variables by name', () => {
    expect(resolveConfig({ apiUrl: 'https://x' }).missing).toEqual(['NEXT_PUBLIC_USER_POOL_ID', 'NEXT_PUBLIC_USER_POOL_CLIENT_ID']);
    expect(resolveConfig({ apiUrl: 'https://x', userPoolId: 'p', userPoolClientId: 'c' }).missing).toEqual([]);
  });
});

describe('ruling contract', () => {
  const valid = {
    findingsOfFact: [
      { fact: 'Delivered', evidenceIds: ['e-2'] },
      { fact: 'Uncited claim', evidenceIds: [] },
    ],
    clausesRelied: [{ clauseRef: '3.1', interpretation: 'Pay on delivery' }],
    payeeShareBps: 7000,
    reasoning: 'Mostly delivered.',
    confidence: 0.8,
    uncertainties: ['quality bar'],
  };
  it('drops findings that cite no evidence', () => {
    expect(parseRuling(valid)?.findingsOfFact).toEqual([{ fact: 'Delivered', evidenceIds: ['e-2'] }]);
  });
  it('rejects out-of-range or missing fields', () => {
    expect(parseRuling(undefined)).toBeNull();
    expect(parseRuling({ ...valid, payeeShareBps: 12000 })).toBeNull();
    expect(parseRuling({ ...valid, payeeShareBps: 50.5 })).toBeNull();
    expect(parseRuling({ ...valid, confidence: 2 })).toBeNull();
    expect(parseRuling({ ...valid, findingsOfFact: 'x' })).toBeNull();
  });
});

describe('case memory', () => {
  function memoryStore(): KeyValueStore {
    const data = new Map<string, string>();
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }

  it('keeps recent cases per user, newest first, without duplicates', () => {
    const memory = createCaseMemory(memoryStore());
    const entry = { amountCents: 1, currency: 'USD', status: 'CREATED' as const, role: 'claimant', seenAt: 't' };
    memory.rememberCase('u1', { caseId: 'a', ...entry });
    memory.rememberCase('u1', { caseId: 'b', ...entry });
    memory.rememberCase('u1', { caseId: 'a', ...entry, status: 'FUNDED' });
    expect(memory.recentCases('u1').map((c) => [c.caseId, c.status])).toEqual([['a', 'FUNDED'], ['b', 'CREATED']]);
    expect(memory.recentCases('u2')).toEqual([]);
  });

  it('survives corrupt or unavailable storage', () => {
    const store = memoryStore();
    store.setItem('panch:recent:u1', '{not json');
    expect(createCaseMemory(store).recentCases('u1')).toEqual([]);
    const blocked = createCaseMemory(null);
    blocked.addUpload('c', { evidenceId: 'e', fileName: 'f', type: 'chat', size: 1, at: 't' });
    expect(blocked.uploads('c')).toEqual([]);
  });

  it('keeps one receipt per ledger event', () => {
    const memory = createCaseMemory(memoryStore());
    memory.addReceipt('c', { event: 'FUND', newStatus: 'FUNDED', entryHash: 'h1', at: 't1' });
    memory.addReceipt('c', { event: 'FUND', newStatus: 'FUNDED', entryHash: 'h2', at: 't2' });
    memory.addReceipt('c', { event: 'DISPUTE', newStatus: 'DISPUTED', entryHash: 'h3', at: 't3' });
    expect(memory.receipts('c').map((r) => r.entryHash)).toEqual(['h2', 'h3']);
  });
});
