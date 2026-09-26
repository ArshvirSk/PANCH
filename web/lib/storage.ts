import type { EvidenceType, LedgerReceipt, Status } from './types';

/**
 * Per-browser conveniences only. The API has no "list my cases" or "list evidence"
 * route yet, so the app remembers what this browser has seen. The API remains the
 * source of truth: every page re-reads the case from it.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStore(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function read<T>(key: string, store: KeyValueStore | null): T[] {
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, value: T[], store: KeyValueStore | null): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the app still works, it just forgets.
  }
}

export interface RecentCase {
  caseId: string;
  amountCents: number;
  currency: string;
  status: Status;
  role: string;
  seenAt: string;
}

export interface StoredReceipt extends LedgerReceipt {
  at: string;
}

export interface StoredUpload {
  evidenceId: string;
  fileName: string;
  type: EvidenceType;
  size: number;
  at: string;
}

const MAX_RECENT = 25;

export function createCaseMemory(store: KeyValueStore | null = browserStore()) {
  const recentKey = (sub: string) => `panch:recent:${sub}`;
  const receiptsKey = (caseId: string) => `panch:receipts:${caseId}`;
  const uploadsKey = (caseId: string) => `panch:uploads:${caseId}`;

  return {
    recentCases: (sub: string) => read<RecentCase>(recentKey(sub), store),

    rememberCase(sub: string, entry: RecentCase): void {
      const rest = read<RecentCase>(recentKey(sub), store).filter((c) => c.caseId !== entry.caseId);
      write(recentKey(sub), [entry, ...rest].slice(0, MAX_RECENT), store);
    },

    forgetCase(sub: string, caseId: string): void {
      write(recentKey(sub), read<RecentCase>(recentKey(sub), store).filter((c) => c.caseId !== caseId), store);
    },

    receipts: (caseId: string) => read<StoredReceipt>(receiptsKey(caseId), store),

    addReceipt(caseId: string, receipt: StoredReceipt): void {
      const rest = read<StoredReceipt>(receiptsKey(caseId), store).filter((r) => r.event !== receipt.event);
      write(receiptsKey(caseId), [...rest, receipt], store);
    },

    uploads: (caseId: string) => read<StoredUpload>(uploadsKey(caseId), store),

    addUpload(caseId: string, upload: StoredUpload): void {
      write(uploadsKey(caseId), [...read<StoredUpload>(uploadsKey(caseId), store), upload], store);
    },
  };
}

export type CaseMemory = ReturnType<typeof createCaseMemory>;
