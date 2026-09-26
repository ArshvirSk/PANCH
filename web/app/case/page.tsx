'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { ApiError } from '../../lib/api';
import { availableActions, getRole, parseCaseIdInput, shouldPoll, type Role } from '../../lib/caseLogic';
import { formatBytes, formatDateTime, formatMoney, shortHash } from '../../lib/format';
import { createCaseMemory, type StoredReceipt, type StoredUpload } from '../../lib/storage';
import type { CaseView, LedgerReceipt } from '../../lib/types';
import { RequireAuth } from '../../components/RequireAuth';
import { CaseProgress } from '../../components/CaseProgress';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CopyButton } from '../../components/CopyButton';
import { EmptyState } from '../../components/EmptyState';
import { EvidenceUpload } from '../../components/EvidenceUpload';
import { Icon } from '../../components/Icon';
import { Notice } from '../../components/Notice';
import { PageHeader } from '../../components/PageHeader';
import { PageSkeleton } from '../../components/Skeleton';
import { ButtonSpinner, Spinner } from '../../components/Spinner';
import { StatusBadge } from '../../components/StatusBadge';
import { TribunalTimeline } from '../../components/TribunalTimeline';

const POLL_MS = 5000;

type LoadState = { kind: 'loading' } | { kind: 'ready'; view: CaseView } | { kind: 'notFound' } | { kind: 'error'; message: string };
type Action = 'fund' | 'dispute' | 'submit';

/** Ledger conflicts come back as 400s with these phrases when the case moved on meanwhile. */
function isStaleStateError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /transaction canceled|illegal transition|double-resolve|must be disputed/i.test(err.message);
}

function roleLabel(role: Role): string {
  return role === 'observer' ? 'Viewing only' : `You are the ${role}`;
}

function CaseDetail({ caseId }: { caseId: string }) {
  const { api, user } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionInfo, setActionInfo] = useState('');
  const [refreshWarning, setRefreshWarning] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [receipts, setReceipts] = useState<StoredReceipt[]>([]);
  const [uploads, setUploads] = useState<StoredUpload[]>([]);
  const [checkedAt, setCheckedAt] = useState('');
  const hasView = useRef(false);

  /** `background` loads (polling, after actions) keep the current view if the request fails. */
  const load = useCallback(async (background = false) => {
    try {
      const view = await api.getCase(caseId);
      hasView.current = true;
      setState({ kind: 'ready', view });
      setRefreshWarning('');
      setCheckedAt(new Date().toISOString());
      if (user) {
        createCaseMemory().rememberCase(user.sub, {
          caseId: view.case.caseId,
          amountCents: view.case.amountCents,
          currency: view.case.currency,
          status: view.case.status,
          role: getRole(view.case, user),
          seenAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The case could not be loaded.';
      if (err instanceof ApiError && err.status === 404) setState({ kind: 'notFound' });
      else if (background && hasView.current) setRefreshWarning(`Could not refresh: ${message}`);
      else setState({ kind: 'error', message });
    }
  }, [api, caseId, user]);

  useEffect(() => {
    const memory = createCaseMemory();
    setReceipts(memory.receipts(caseId));
    setUploads(memory.uploads(caseId));
    void load();
  }, [caseId, load]);

  const status = state.kind === 'ready' ? state.view.case.status : undefined;

  useEffect(() => {
    if (!status || !shouldPoll(status)) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [status, load]);

  async function refresh() {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }

  async function act(kind: Action) {
    if (busy) return;
    setBusy(kind);
    setActionError('');
    setActionInfo('');
    try {
      let receipt: LedgerReceipt | null = null;
      if (kind === 'fund') receipt = await api.fundCase(caseId);
      else if (kind === 'dispute') receipt = await api.disputeCase(caseId);
      else await api.submitCase(caseId);

      if (receipt) {
        createCaseMemory().addReceipt(caseId, { ...receipt, at: new Date().toISOString() });
        setReceipts(createCaseMemory().receipts(caseId));
      }
      setActionInfo({
        fund: 'Escrow funded. The funds are held until the deal completes or the panel rules.',
        dispute: 'Dispute opened. Both sides can now upload evidence.',
        submit: 'Submitted. The panel is deliberating.',
      }[kind]);
    } catch (err) {
      setActionError(
        isStaleStateError(err)
          ? 'This case changed since you opened it, so nothing was done. The latest state is shown.'
          : err instanceof Error ? err.message : 'Something went wrong.',
      );
    } finally {
      setConfirming(null);
      setBusy(null);
      await load(true);
    }
  }

  function handleUploaded(upload: StoredUpload) {
    createCaseMemory().addUpload(caseId, upload);
    setUploads(createCaseMemory().uploads(caseId));
  }

  if (state.kind === 'loading') return <div className="container page"><PageSkeleton label="Loading case…" /></div>;
  if (state.kind === 'notFound') {
    return (
      <div className="container page">
        <div className="card narrow">
          <EmptyState icon="search" title="Case not found" action={<Link href="/cases/" className="btn btn-secondary btn-sm">Back to my cases</Link>}>
            No case has the ID <code>{caseId}</code>. Check the ID or link and try again.
          </EmptyState>
        </div>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="container page">
        <div className="card narrow">
          <EmptyState
            icon="alert"
            title="Could not load this case"
            action={
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setState({ kind: 'loading' }); void load(); }}>
                <Icon name="refresh" size={15} /> Try again
              </button>
            }
          >
            {state.message}
          </EmptyState>
        </div>
      </div>
    );
  }

  const c = state.view.case;
  const role = getRole(c, user);
  const actions = availableActions(c.status, role);
  const party = role === 'observer' ? null : role;
  const deliberating = c.status === 'DELIBERATING';
  const showTimeline = ['DELIBERATING', 'ESCALATED', 'RULED', 'SETTLED'].includes(c.status);
  const amount = formatMoney(c.amountCents, c.currency);

  return (
    <div className="container page stack-lg" data-testid="case-detail">
      <PageHeader
        back={<Link href="/cases/" className="back-link"><Icon name="arrow-left" size={15} /> My cases</Link>}
        eyebrow={<>Case <span className="mono" data-testid="case-id">{c.caseId}</span> <CopyButton value={c.caseId} label="Copy case ID" compact /></>}
        title={<span className="tabular">{amount}</span>}
        description={
          <span className="case-meta">
            <StatusBadge status={c.status} />
            <span className="pill" data-testid="role"><Icon name={role === 'observer' ? 'eye-off' : 'users'} size={14} />{roleLabel(role)}</span>
            <span className="muted small">Opened {formatDateTime(c.createdAt)}</span>
          </span>
        }
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={refreshing} data-testid="refresh">
            {refreshing ? <ButtonSpinner /> : <Icon name="refresh" size={15} />} Refresh
          </button>
        }
      />

      <div className="card stepper-card"><CaseProgress status={c.status} /></div>

      {refreshWarning && <Notice tone="warning">{refreshWarning}</Notice>}

      <div className="case-layout">
        <div className="stack-lg case-main">
          <section className="card stack" aria-labelledby="next-title">
            <div className="card-head">
              <h2 id="next-title" className="h3">Next step</h2>
            </div>

            {c.status === 'CREATED' && role === 'claimant' && (
              <div className="stack">
                <p>Waiting for <strong>{c.respondentId}</strong> to fund the escrow. Send them the case ID so they can open it after signing in with that email.</p>
                <div className="share-box">
                  <span className="mono">{c.caseId}</span>
                  <CopyButton value={c.caseId} label="Copy ID" />
                </div>
              </div>
            )}

            {actions.includes('fund') && (
              <div className="stack">
                <p>Fund <strong>{amount}</strong> into escrow. The funds are held until the deal completes or the panel rules on a dispute.</p>
                <div>
                  <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => setConfirming('fund')} data-testid="action-fund">
                    <Icon name="wallet" size={16} /> Fund escrow
                  </button>
                </div>
              </div>
            )}

            {actions.includes('dispute') && (
              <div className="stack">
                <p>Is something wrong with the work or the payment? Opening a dispute freezes the escrow and starts the evidence window for both sides.</p>
                <div>
                  <button type="button" className="btn btn-danger-outline" disabled={!!busy} onClick={() => setConfirming('dispute')} data-testid="action-dispute">
                    <Icon name="flag" size={16} /> Open dispute
                  </button>
                </div>
              </div>
            )}

            {actions.includes('submit') && (
              <div className="stack">
                <p>Upload your evidence below, then submit the case to the panel. Once submitted, no more evidence can be added by either side.</p>
                <div>
                  <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => setConfirming('submit')} data-testid="action-submit">
                    <Icon name="send" size={16} /> Submit for deliberation
                  </button>
                </div>
              </div>
            )}

            {c.status === 'CREATED' && role === 'observer' && <p className="muted">Waiting for the respondent to fund escrow. Only the parties can act on this case.</p>}
            {c.status === 'FUNDED' && role === 'observer' && <p className="muted">Escrow is funded. Only the parties can open a dispute.</p>}
            {c.status === 'DISPUTED' && role === 'observer' && <p className="muted">The parties are gathering evidence.</p>}

            {deliberating && (
              <div className="live-box">
                <span className="live-dot" aria-hidden="true" />
                <p>
                  The panel is reviewing the evidence. This page updates on its own.
                  {checkedAt && <span className="muted small block">Last checked {new Date(checkedAt).toLocaleTimeString()}</span>}
                </p>
              </div>
            )}
            {c.status === 'ESCALATED' && (
              <Notice tone="warning" title="Sent to human review">
                The judges disagreed too much, or the swap test flipped the result, so a human reviewer will decide this case with the full panel record.
              </Notice>
            )}
            {actions.includes('viewRuling') && (
              <div className="stack">
                <p>The panel has issued its ruling.</p>
                <div>
                  <Link href={`/ruling/?id=${encodeURIComponent(c.caseId)}`} className="btn btn-primary" data-testid="view-ruling">
                    <Icon name="gavel" size={16} /> Read the ruling
                  </Link>
                </div>
              </div>
            )}

            <div aria-live="polite">
              {actionError && <Notice tone="error">{actionError}</Notice>}
              {actionInfo && !actionError && <Notice tone="success">{actionInfo}</Notice>}
            </div>
          </section>

          {actions.includes('uploadEvidence') && party && (
            <section className="card stack" aria-labelledby="evidence-title">
              <div className="card-head">
                <h2 id="evidence-title" className="h3">Add evidence</h2>
                <p className="muted small">Contracts, chat logs, invoices or the deliverable. Judges see evidence with names and countries removed.</p>
              </div>
              <EvidenceUpload caseId={caseId} party={party} onUploaded={handleUploaded} />
            </section>
          )}

          {showTimeline && (
            <section className="card stack" aria-labelledby="timeline-title">
              <div className="card-head">
                <h2 id="timeline-title" className="h3">Tribunal</h2>
                <p className="muted small">How the panel reaches its decision.</p>
              </div>
              <TribunalTimeline completed={state.view.timeline} active={deliberating} />
            </section>
          )}
        </div>

        <aside className="stack-lg case-side">
          <section className="card stack" aria-labelledby="parties-title">
            <h2 id="parties-title" className="h3">Parties</h2>
            <ul className="party-list">
              <li>
                <span className="avatar avatar-claimant" aria-hidden="true">C</span>
                <span><span className="muted small block">Claimant</span>{role === 'claimant' ? 'You' : 'The freelancer who opened the case'}</span>
              </li>
              <li>
                <span className="avatar avatar-respondent" aria-hidden="true">R</span>
                <span className="break-anywhere"><span className="muted small block">Respondent</span>{role === 'respondent' ? `You (${c.respondentId})` : c.respondentId}</span>
              </li>
            </ul>
            {c.evidenceDeadline && (
              <p className="small"><Icon name="clock" size={14} /> Evidence deadline {formatDateTime(c.evidenceDeadline)}</p>
            )}
          </section>

          <section className="card stack" aria-labelledby="ledger-title">
            <h2 id="ledger-title" className="h3">Escrow ledger</h2>
            {receipts.length === 0 ? (
              <p className="muted small">Escrow events you make from this device appear here with their hash.</p>
            ) : (
              <>
                <ul className="ledger" data-testid="receipts">
                  {receipts.map((r) => (
                    <li key={r.event}>
                      <span className="ledger-event">{r.event}</span>
                      <span className="muted small">{formatDateTime(r.at)}</span>
                      {r.entryHash && <code className="ledger-hash" title={r.entryHash}>{shortHash(r.entryHash, 8)}</code>}
                    </li>
                  ))}
                </ul>
                <p className="muted small">Each event is chained to the previous one by its SHA-256 hash, so tampering is detectable.</p>
              </>
            )}
          </section>

          {uploads.length > 0 && (
            <section className="card stack" aria-labelledby="uploads-title">
              <h2 id="uploads-title" className="h3">Your evidence</h2>
              <ul className="file-list" data-testid="uploads">
                {uploads.map((u) => (
                  <li key={u.evidenceId}>
                    <Icon name="file" size={16} />
                    <span className="file-list-text">
                      <strong className="break-anywhere">{u.fileName}</strong>
                      <span className="muted small">{u.type} · {formatBytes(u.size)} · <span className="mono">{u.evidenceId}</span></span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {/* One dialog, so there is only ever one confirm button in the page. */}
      <ConfirmDialog
        open={confirming !== null}
        busy={busy !== null}
        onConfirm={() => confirming && act(confirming)}
        onCancel={() => setConfirming(null)}
        {...(confirming === 'dispute'
          ? { title: 'Open a dispute?', icon: 'flag' as const, tone: 'danger' as const, confirmLabel: 'Open dispute' }
          : confirming === 'submit'
            ? { title: 'Submit the case to the panel?', icon: 'send' as const, confirmLabel: 'Submit case' }
            : { title: `Fund ${amount} into escrow?`, icon: 'wallet' as const, confirmLabel: 'Fund escrow' })}
      >
        {confirming === 'fund' && 'The funds are held by Panch until the deal completes or the panel rules. This is a simulated escrow: no real money moves.'}
        {confirming === 'dispute' && `The escrow is frozen and both sides can upload evidence. The panel then decides how the ${amount} is split.`}
        {confirming === 'submit' && (
          <>
            After submitting, neither side can add more evidence. Make sure everything you want the judges to see is uploaded.
            {uploads.length === 0 && <strong className="block warn-text">You have not uploaded any evidence from this device.</strong>}
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

function CasePageInner() {
  const raw = useSearchParams().get('id') ?? '';
  const parsed = parseCaseIdInput(raw);
  if (!parsed.ok) {
    return (
      <div className="container page">
        <div className="card narrow">
          <EmptyState icon="search" title={raw.trim() ? 'This case link is not valid' : 'No case selected'} action={<Link href="/cases/" className="btn btn-secondary btn-sm">Go to my cases</Link>}>
            Open a case from your dashboard, or check the link you were sent.
          </EmptyState>
        </div>
      </div>
    );
  }
  return (
    <RequireAuth>
      <CaseDetail key={parsed.id} caseId={parsed.id} />
    </RequireAuth>
  );
}

export default function CasePage() {
  return (
    <Suspense fallback={<div className="container page"><Spinner /></div>}>
      <CasePageInner />
    </Suspense>
  );
}
