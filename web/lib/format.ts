/** PRD non-goal: disputes above $5,000 are out of scope for v1. */
export const MAX_AMOUNT_CENTS = 500_000;

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'] as const;

export function formatMoney(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency}`;
  }
}

export type AmountResult = { ok: true; cents: number } | { ok: false; error: string };

/** Parses a user-typed amount like "400" or "1,250.50" into integer cents. */
export function parseAmountToCents(input: string): AmountResult {
  const cleaned = input.trim().replace(/,/g, '');
  if (!cleaned) return { ok: false, error: 'Enter an amount.' };
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: 'Enter a number with at most two decimal places.' };
  }
  const [whole, fraction = ''] = cleaned.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents <= 0) return { ok: false, error: 'The amount must be greater than zero.' };
  if (cents > MAX_AMOUNT_CENTS) {
    return { ok: false, error: 'Panch handles disputes up to 5,000 in v1.' };
  }
  return { ok: true, cents };
}

/** 10000 bps = 100%. Shows up to two decimals, so 1 bps reads 0.01% rather than rounding to 0. */
export function bpsToPercent(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

export function shortHash(hash: string, size = 10): string {
  if (hash.length <= size * 2 + 1) return hash;
  return `${hash.slice(0, size)}…${hash.slice(-size)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}
