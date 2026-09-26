import type { Case, Party, Status } from './types';
import { normalizeEmail } from './format';

export type Role = Party | 'observer';

export interface SessionUser {
  sub: string;
  email: string;
}

/**
 * The claimant is whoever created the case (their Cognito sub). The respondent is
 * stored by email until they act on the case, so match on that.
 */
export function getRole(caseItem: Case, user: SessionUser | undefined): Role {
  if (!user) return 'observer';
  if (caseItem.claimantId === user.sub) return 'claimant';
  if (caseItem.respondentId && normalizeEmail(caseItem.respondentId) === normalizeEmail(user.email)) {
    return 'respondent';
  }
  return 'observer';
}

export interface Step {
  status: Status;
  label: string;
}

const HAPPY_PATH: Step[] = [
  { status: 'CREATED', label: 'Deal created' },
  { status: 'FUNDED', label: 'Escrow funded' },
  { status: 'DISPUTED', label: 'Dispute opened' },
  { status: 'DELIBERATING', label: 'Panel deliberating' },
  { status: 'RULED', label: 'Ruling issued' },
  { status: 'SETTLED', label: 'Funds settled' },
];

/** The step list for the progress bar. An escalated case swaps the ruling step for human review. */
export function stepsFor(status: Status): Step[] {
  if (status !== 'ESCALATED') return HAPPY_PATH;
  return HAPPY_PATH.map((step) =>
    step.status === 'RULED' ? { status: 'ESCALATED', label: 'Human review' } : step,
  );
}

export type StepState = 'done' | 'current' | 'upcoming';

export function stepState(steps: Step[], current: Status, index: number): StepState {
  // A failed case died mid-tribunal, so render it stuck at the deliberation step.
  const effective = current === 'FAILED' ? 'DELIBERATING' : current;
  const currentIndex = steps.findIndex((s) => s.status === effective);
  if (currentIndex === -1) return 'upcoming';
  if (index < currentIndex) return 'done';
  if (index === currentIndex) return current === 'SETTLED' ? 'done' : 'current';
  return 'upcoming';
}

export type CaseAction = 'fund' | 'dispute' | 'uploadEvidence' | 'submit' | 'viewRuling';

/**
 * What the signed-in user can do next. Mirrors the ledger state machine in
 * services/shared/ledger.ts, with roles from the PRD: the client (respondent)
 * funds escrow; either party can dispute, add evidence and submit.
 */
export function availableActions(status: Status, role: Role): CaseAction[] {
  if (status === 'RULED' || status === 'SETTLED') return ['viewRuling'];
  if (status === 'FAILED') return [];
  if (role === 'observer') return [];
  switch (status) {
    case 'CREATED':
      return role === 'respondent' ? ['fund'] : [];
    case 'FUNDED':
      return ['dispute'];
    case 'DISPUTED':
      return ['uploadEvidence', 'submit'];
    default:
      return [];
  }
}

/** Statuses where the tribunal is still working and the page should keep polling. */
export function shouldPoll(status: Status): boolean {
  return status === 'DELIBERATING';
}

export const STATUS_LABELS: Record<Status, string> = {
  CREATED: 'Awaiting funding',
  FUNDED: 'Funded',
  DISPUTED: 'In dispute',
  DELIBERATING: 'Deliberating',
  ESCALATED: 'Human review',
  RULED: 'Ruled',
  SETTLED: 'Settled',
  FAILED: 'Failed',
};

export type CaseIdResult = { ok: true; id: string } | { ok: false; error: string };

/** Accepts a bare case ID or a pasted Panch link (…?id=c-123). */
export function parseCaseIdInput(input: string): CaseIdResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Enter a case ID.' };
  const fromUrl = /[?&]id=([^&#\s]+)/.exec(trimmed);
  let id = fromUrl ? fromUrl[1] : trimmed;
  try {
    id = decodeURIComponent(id);
  } catch {
    // Malformed %-escape: validate the raw text instead.
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return { ok: false, error: 'Case IDs contain only letters, numbers and dashes, like c-1a2b3c4d.' };
  }
  return { ok: true, id };
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as Status] ?? status;
}
