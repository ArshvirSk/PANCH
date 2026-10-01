'use client';

import { Suspense, useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useAuth } from '../../lib/auth';
import { ApiError } from '../../lib/api';
import { getRole, type SessionUser } from '../../lib/caseLogic';
import { bpsToPercent, formatDateTime, formatMoney } from '../../lib/format';
import {
  MAX_NOTE_LENGTH,
  bpsToInput,
  judgeLabel,
  noteProblem,
  parsePercentToBps,
  splitAmount,
  swapCheck,
  type SwapCheck,
} from '../../lib/reviews';
import type { PanelJudge, ReviewCase, Ruling } from '../../lib/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CopyButton } from '../../components/CopyButton';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { Notice } from '../../components/Notice';
import { PageHeader } from '../../components/PageHeader';
import { RichText } from '../../components/RichText';
import { RequireAuth } from '../../components/RequireAuth';
import { PageSkeleton } from '../../components/Skeleton';
import { ButtonSpinner, Spinner } from '../../components/Spinner';
import { StatusBadge } from '../../components/StatusBadge';

type LoadState = { kind: 'loading' } | { kind: 'ready'; cases: ReviewCase[] } | { kind: 'error'; message: string };

interface Pending {
  review: ReviewCase;
  payeeShareBps: number;
  note: string;
}

/** 3000 bps of spread reads as "30 pts": the gap between two percentages. */
function points(bps: number): string {
  return `${Number((bps / 100).toFixed(2))} pts`;
}

function describeSplit(review: ReviewCase, bps: number): string {
  const { claimantCents, respondentCents } = splitAmount(review.amountCents, bps);
  return `Claimant receives ${bpsToPercent(bps)} (${formatMoney(claimantCents, review.currency)}), respondent ${bpsToPercent(10000 - bps)} (${formatMoney(respondentCents, review.currency)})`;
}

/**
 * Someone else already settled the case: 400 "Case must be ESCALATED" when it had
 * moved on before this request, 409 "Case already reviewed and settled" when two
 * reviews race into the ledger.
 */
function isAlreadyResolved(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 409) return true;
  return err.status === 400 && /escalated|transaction canceled|illegal transition|double-resolve/i.test(err.message);
}

/** Oldest first, so the queue is worked in the order cases arrived. */
function byAge(a: ReviewCase, b: ReviewCase): number {
  if (!a.createdAt || !b.createdAt) return a.createdAt ? -1 : b.createdAt ? 1 : 0;
  return a.createdAt.localeCompare(b.createdAt);
}

const SWAP_TEXT: Record<SwapCheck['verdict'], string> = {
  consistent: 'Consistent',
  shifted: 'Shifted',
  flipped: 'Flipped',
};

function SwapLine({ original, swap }: { original: Ruling | null; swap: PanelJudge | undefined }) {
  if (!swap) return <p className="muted small">No swap-test run for this judge.</p>;
  const check = swapCheck(original, swap.output);
  if (!check) return <p className="muted small">The swap-test output could not be read.</p>;
  return (
    <p className={`swap-line swap-${check.verdict}`} data-testid="swap-line">
      <Icon name="shuffle" size={14} />
      <span>
        Swap test: <strong>{SWAP_TEXT[check.verdict]}</strong>
        <span className="muted"> · mirrored {bpsToPercent(check.mirroredBps)}, off by {points(check.deviationBps)}</span>
      </span>
    </p>
  );
}

function JudgeColumn({ judge, swap }: { judge: PanelJudge; swap: PanelJudge | undefined }) {
  const r = judge.output;
  return (
    <article className="judge-card" data-testid="judge-card" aria-label={judgeLabel(judge.name)}>
      <header className="judge-head">
        <span className="judge-seat" aria-hidden="true"><Icon name="scale" size={15} /></span>
        <h4>{judgeLabel(judge.name)}</h4>
      </header>
      {!r ? (
        <p className="muted small">This judge&apos;s output could not be read.</p>
      ) : (
        <>
          <div>
            <p className="judge-award tabular" data-testid="judge-award">{bpsToPercent(r.payeeShareBps)}</p>
            <p className="muted small">to the claimant · confidence {Math.round(r.confidence * 100)}%</p>
          </div>
          <div className="split-bar split-bar-sm" role="img" aria-label={`Claimant ${bpsToPercent(r.payeeShareBps)}, respondent ${bpsToPercent(10000 - r.payeeShareBps)}`}>
            {r.payeeShareBps > 0 && <span className="split-claimant" style={{ width: `${r.payeeShareBps / 100}%` }} />}
            {r.payeeShareBps < 10000 && <span className="split-respondent" style={{ width: `${(10000 - r.payeeShareBps) / 100}%` }} />}
          </div>
          <SwapLine original={r} swap={swap} />
          <RichText className="judge-reasoning" text={r.reasoning} />
          <details className="judge-more">
            <summary>Findings ({r.findingsOfFact.length})</summary>
            {r.findingsOfFact.length === 0 ? (
              <p className="muted small">No findings with evidence citations.</p>
            ) : (
              <ul>
                {r.findingsOfFact.map((f, i) => (
                  <li key={i}>
                    {f.fact}{' '}
                    {f.evidenceIds.map((id) => <span key={id} className="chip">{id}</span>)}
                  </li>
                ))}
              </ul>
            )}
          </details>
          <details className="judge-more">
            <summary>Clauses ({r.clausesRelied.length})</summary>
            {r.clausesRelied.length === 0 ? (
              <p className="muted small">No clauses cited.</p>
            ) : (
              <ul>{r.clausesRelied.map((c, i) => <li key={i}><strong>{c.clauseRef}</strong>: {c.interpretation}</li>)}</ul>
            )}
          </details>
          {r.uncertainties.length > 0 && (
            <details className="judge-more">
              <summary>Uncertainties ({r.uncertainties.length})</summary>
              <ul>{r.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul>
            </details>
          )}
        </>
      )}
    </article>
  );
}

/**
 * The panel's own swap verdict, plus how many judges flipped on their own. The
 * Aggregate check compares medians, so it can pass while one judge flips.
 */
function swapSummary(review: ReviewCase): { text: string; tone: 'ok' | 'warn' | 'bad' | 'none'; note: string; noteTone?: 'bad' } {
  const flipped = review.judges.filter((j) => swapCheck(j.output, review.swapJudges.find((s) => s.name === j.name)?.output ?? null)?.verdict === 'flipped').length;
  const flipNote = flipped > 0 ? `${flipped} of ${review.judges.length} ${review.judges.length === 1 ? 'judge' : 'judges'} flipped on their own` : '';
  const base = 'labels mirrored, award should invert';
  if (review.swapConsistent === false) return { text: 'Inconsistent', tone: 'bad', note: flipNote || base, noteTone: flipNote ? 'bad' : undefined };
  if (review.swapConsistent === true) return { text: 'Consistent', tone: flipped > 0 ? 'warn' : 'ok', note: flipNote || base, noteTone: flipNote ? 'bad' : undefined };
  if (review.swapJudges.length > 0) return { text: 'Not reported', tone: flipped > 0 ? 'warn' : 'none', note: flipNote || 'see each judge below', noteTone: flipNote ? 'bad' : undefined };
  return { text: 'Not run', tone: 'none', note: base };
}

function DecisionForm({ review, busy, onSubmit }: { review: ReviewCase; busy: boolean; onSubmit(bps: number, note: string): void }) {
  const id = useId();
  const [share, setShare] = useState('');
  const [note, setNote] = useState('');
  const [shareError, setShareError] = useState('');
  const [noteError, setNoteError] = useState('');

  const parsed = parsePercentToBps(share);
  const presets: { label: string; bps: number }[] = [
    ...(review.medianBps !== undefined ? [{ label: 'Panel median', bps: review.medianBps }] : []),
    ...review.judges.flatMap((j) => (j.output ? [{ label: judgeLabel(j.name), bps: j.output.payeeShareBps }] : [])),
    { label: 'Even split', bps: 5000 },
  ];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const shareProblem = parsed.ok ? '' : parsed.error;
    const noteIssue = noteProblem(note) ?? '';
    setShareError(shareProblem);
    setNoteError(noteIssue);
    if (!parsed.ok || noteIssue) return;
    onSubmit(parsed.bps, note.trim());
  }

  return (
    <form className="decision stack" onSubmit={submit} noValidate data-testid="decision-form">
      <h3 className="review-subhead">Your decision</h3>
      <div className="decision-grid">
        <div className="field">
          <label className="field-label" htmlFor={`${id}-share`}>Claimant&apos;s share</label>
          <span className="input-suffix">
            <input
              id={`${id}-share`}
              value={share}
              onChange={(e) => { setShare(e.target.value); setShareError(''); }}
              inputMode="decimal"
              placeholder="e.g. 70"
              autoComplete="off"
              aria-invalid={shareError ? true : undefined}
              aria-describedby={`${id}-share-help`}
              data-testid="share-input"
              disabled={busy}
            />
            <span aria-hidden="true">%</span>
          </span>
          <small id={`${id}-share-help`} className="muted" aria-live="polite">
            {shareError ? <span className="field-error" role="alert">{shareError}</span> : parsed.ok ? describeSplit(review, parsed.bps) : 'The respondent receives the rest.'}
          </small>
          <div className="presets" role="group" aria-label="Fill in a suggested share">
            {presets.map((p) => (
              <button key={p.label} type="button" className="preset" disabled={busy} onClick={() => { setShare(bpsToInput(p.bps)); setShareError(''); }}>
                {p.label} <span className="tabular">{bpsToPercent(p.bps)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-note`}>Note</label>
          <textarea
            id={`${id}-note`}
            value={note}
            onChange={(e) => { setNote(e.target.value); setNoteError(''); }}
            rows={4}
            maxLength={MAX_NOTE_LENGTH + 200}
            placeholder="Why this split? Which evidence decided it?"
            aria-invalid={noteError ? true : undefined}
            aria-describedby={`${id}-note-help`}
            data-testid="note-input"
            disabled={busy}
          />
          <small id={`${id}-note-help`} className="muted row-between">
            {noteError ? <span className="field-error" role="alert">{noteError}</span> : <span>Kept with the ruling as the reviewer&apos;s reasons.</span>}
            <span className={note.trim().length > MAX_NOTE_LENGTH ? 'field-error tabular' : 'tabular'}>{note.trim().length}/{MAX_NOTE_LENGTH}</span>
          </small>
        </div>
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="resolve">
          {busy ? <ButtonSpinner /> : <Icon name="gavel" size={16} />} Resolve case
        </button>
      </div>
    </form>
  );
}

function ReviewCard({ review, user, busy, error, onSubmit }: {
  review: ReviewCase;
  user: SessionUser | undefined;
  busy: boolean;
  error: string;
  onSubmit(bps: number, note: string): void;
}) {
  const titleId = useId();
  const swap = swapSummary(review);
  const isParty = user ? getRole({ ...review, claimantId: review.claimantId ?? '', respondentId: review.respondentId ?? '', createdAt: review.createdAt ?? '' }, user) !== 'observer' : false;

  return (
    <section className="card stack review-card" aria-labelledby={titleId} data-testid="review-card" data-case-id={review.caseId}>
      <div className="review-head">
        <div>
          <p className="eyebrow">Case <span className="mono">{review.caseId}</span> <CopyButton value={review.caseId} label="Copy case ID" compact /></p>
          <h2 id={titleId} className="review-amount tabular">{formatMoney(review.amountCents, review.currency)}</h2>
        </div>
        <div className="case-meta">
          <StatusBadge status={review.status} />
          {review.createdAt && <span className="muted small">Opened {formatDateTime(review.createdAt)}</span>}
        </div>
      </div>

      {isParty && (
        <Notice tone="warning" title="You are a party to this case">
          A reviewer should be independent of both sides. Ask someone else to decide it.
        </Notice>
      )}

      <div className="review-summary">
        <h3 className="review-subhead">Case summary</h3>
        {review.summary ? <p className="prose-sm" data-testid="summary">{review.summary}</p> : <p className="muted" data-testid="summary">No written summary was sent with this case. The judges&apos; reasoning below describes the dispute.</p>}
        {review.escalationReason && <p className="small"><Icon name="alert" size={14} /> <strong>Why it escalated:</strong> {review.escalationReason}</p>}
      </div>

      <dl className="review-stats">
        <div>
          <dt>Panel median</dt>
          <dd className="tabular" data-testid="median">{review.medianBps !== undefined ? bpsToPercent(review.medianBps) : '—'}</dd>
          <dd className="stat-note">to the claimant</dd>
        </div>
        <div>
          <dt>Spread</dt>
          <dd className="tabular" data-testid="spread">{review.spreadBps !== undefined ? points(review.spreadBps) : '—'}</dd>
          <dd className="stat-note">{review.spreadBps === undefined ? 'not reported' : review.spreadComputed ? 'worked out from the awards' : 'highest minus lowest award'}</dd>
        </div>
        <div>
          <dt>Swap test</dt>
          <dd className={`swap-overall swap-overall-${swap.tone}`} data-testid="swap-overall">{swap.text}</dd>
          <dd className={swap.noteTone ? 'stat-note stat-note-bad' : 'stat-note'} data-testid="swap-note">{swap.note}</dd>
        </div>
      </dl>

      <div>
        <h3 className="review-subhead">The panel</h3>
        {review.judges.length === 0 ? (
          <p className="muted" data-testid="no-judges">The API did not send the judges&apos; outputs for this case.</p>
        ) : (
          <div className="judges-grid" data-testid="judges">
            {review.judges.map((j) => <JudgeColumn key={j.name} judge={j} swap={review.swapJudges.find((s) => s.name === j.name)} />)}
          </div>
        )}
      </div>

      <DecisionForm review={review} busy={busy} onSubmit={onSubmit} />
      <div aria-live="polite">{error && <Notice tone="error">{error}</Notice>}</div>
    </section>
  );
}

function ReviewQueue() {
  const { api, user } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState<string[]>([]);

  const load = useCallback(async (background = false) => {
    try {
      const cases = await api.getReviews();
      setState({ kind: 'ready', cases: [...cases].sort(byAge) });
      setRefreshWarning('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The review queue could not be loaded.';
      if (background) setRefreshWarning(`Could not refresh: ${message}`);
      else setState({ kind: 'error', message });
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load(state.kind === 'ready');
    setRefreshing(false);
  }

  async function resolve() {
    if (!pending || busyId) return;
    const { review, payeeShareBps, note } = pending;
    setBusyId(review.caseId);
    setErrors((e) => ({ ...e, [review.caseId]: '' }));
    try {
      await api.resolveReview(review.caseId, { payeeShareBps, note });
      setResolved((r) => [`Case ${review.caseId} resolved. ${describeSplit(review, payeeShareBps)}.`, ...r]);
      setState((s) => (s.kind === 'ready' ? { kind: 'ready', cases: s.cases.filter((c) => c.caseId !== review.caseId) } : s));
    } catch (err) {
      if (isAlreadyResolved(err)) {
        setResolved((r) => [`Case ${review.caseId} was already resolved by someone else, so nothing was changed.`, ...r]);
        await load(true);
      } else {
        setErrors((e) => ({ ...e, [review.caseId]: err instanceof Error ? err.message : 'The decision could not be saved.' }));
      }
    } finally {
      setPending(null);
      setBusyId(null);
    }
  }

  const cases = state.kind === 'ready' ? state.cases : [];

  return (
    <div className="container page stack-lg">
      <PageHeader
        eyebrow="Human review"
        title="Review queue"
        description="Cases the panel could not settle on its own: the judges disagreed too much, or the swap test changed the result. Read the panel record, then decide the split."
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={refreshing || state.kind === 'loading'} data-testid="refresh">
            {refreshing ? <ButtonSpinner /> : <Icon name="refresh" size={15} />} Refresh
          </button>
        }
      />

      <Notice tone="info">
        For this demo any signed-in account can act as the reviewer. Party names are withheld here, as they were from the judges.
      </Notice>

      <div aria-live="polite" className="stack-sm">
        {resolved.map((message) => <Notice key={message} tone="success">{message}</Notice>)}
        {refreshWarning && <Notice tone="warning">{refreshWarning}</Notice>}
      </div>

      {state.kind === 'loading' && <PageSkeleton label="Loading the review queue…" />}

      {state.kind === 'error' && (
        <div className="card narrow">
          <EmptyState
            icon="alert"
            title="Could not load the review queue"
            action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => { setState({ kind: 'loading' }); void load(); }}><Icon name="refresh" size={15} /> Try again</button>}
          >
            {state.message}
          </EmptyState>
        </div>
      )}

      {state.kind === 'ready' && cases.length === 0 && (
        <EmptyState icon="inbox" title="No cases waiting for review">
          A case lands here when its judges disagree by more than the escalation threshold, or when the swap test flips the winner.
        </EmptyState>
      )}

      {cases.length > 0 && (
        <>
          <p className="muted small" data-testid="queue-count">{cases.length === 1 ? '1 case waiting' : `${cases.length} cases waiting`}, oldest first.</p>
          {cases.map((review) => (
            <ReviewCard
              key={review.caseId}
              review={review}
              user={user}
              busy={busyId === review.caseId}
              error={errors[review.caseId] ?? ''}
              onSubmit={(payeeShareBps, note) => setPending({ review, payeeShareBps, note })}
            />
          ))}
        </>
      )}

      {/* One dialog for the whole queue, so the page never holds two confirm buttons. */}
      <ConfirmDialog
        open={pending !== null}
        busy={busyId !== null}
        title={pending ? `Resolve case ${pending.review.caseId}?` : 'Resolve case?'}
        icon="gavel"
        confirmLabel="Resolve and settle"
        onConfirm={() => void resolve()}
        onCancel={() => setPending(null)}
      >
        {pending && (
          <>
            {describeSplit(pending.review, pending.payeeShareBps)}. The escrow is released on these terms and the case closes. This cannot be undone.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

export default function ReviewsPage() {
  return (
    <Suspense fallback={<div className="container page"><Spinner /></div>}>
      <RequireAuth>
        <ReviewQueue />
      </RequireAuth>
    </Suspense>
  );
}
