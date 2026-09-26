'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { ApiError } from '../../lib/api';
import { availableActions, getRole, shouldPoll, type Role } from '../../lib/caseLogic';
import { formatBytes, formatDateTime, formatMoney, shortHash } from '../../lib/format';
import { createCaseMemory, type StoredReceipt, type StoredUpload } from '../../lib/storage';
import type { CaseView, LedgerReceipt } from '../../lib/types';
import { RequireAuth } from '../../components/RequireAuth';
import { CaseProgress } from '../../components/CaseProgress';
import { CopyButton } from '../../components/CopyButton';
import { EvidenceUpload } from '../../components/EvidenceUpload';
import { Notice } from '../../components/Notice';
import { Spinner } from '../../components/Spinner';
import { StatusBadge } from '../../components/StatusBadge';
import { TribunalTimeline } from '../../components/TribunalTimeline';

const POLL_MS = 5000;

type LoadState = { kind: 'loading' } | { kind: 'ready'; view: CaseView } | { kind: 'notFound' } | { kind: 'error'; message: string };
type Busy = '' | 'fund' | 'dispute' | 'submit';

/** Ledger conflicts come back as 400s with these phrases when the case moved on meanwhile. */
function isStaleStateError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /transaction canceled|illegal transition|must be disputed/i.test(err.message);
}

function roleLabel(role: Role): string {
  return role === 'observer' ? 'Viewing only' : `You are the ${role}`;
}

function CaseDetail({ caseId }: { caseId: string }) {
  const { api, user } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [busy, setBusy] = useState<Busy>('');
  const [actionError, setActionError] = useState('');
  const [actionInfo, setActionInfo] = useState('');
  const [receipts, setReceipts] = useState<StoredReceipt[]>([]);
  const [uploads, setUploads] = useState<StoredUpload[]>([]);
  const [readyToSubmit, setReadyToSubmit] = useState(false);
  const [checkedAt, setCheckedAt] = useState('');

  const load = useCallback(async () => {
    try {
      const view = await api.getCase(caseId);
      setState({ kind: 'ready', view });
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
      if (err instanceof ApiError && err.status === 404) setState({ kind: 'notFound' });
      else setState({ kind: 'error', message: err instanceof Error ? err.message : 'The case could not be loaded.' });
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
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [status, load]);

  async function act(kind: Exclude<Busy, ''>, run: () => Promise<LedgerReceipt | null>, success: string) {
    setBusy(kind);
    setActionError('');
    setActionInfo('');
    try {
      const receipt = await run();
      if (receipt) {
        const stored: StoredReceipt = { ...receipt, at: new Date().toISOString() };
        createCaseMemory().addReceipt(caseId, stored);
        setReceipts(createCaseMemory().receipts(caseId));
      }
      setActionInfo(success);
    } catch (err) {
      setActionError(
        isStaleStateError(err)
          ? 'This case changed since you opened it, so nothing was done. The latest state is shown below.'
          : err instanceof Error ? err.message : 'Something went wrong.',
      );
    } finally {
      setBusy('');
      await load();
    }
  }

  function handleUploaded(upload: StoredUpload) {
    createCaseMemory().addUpload(caseId, upload);
    setUploads(createCaseMemory().uploads(caseId));
  }

  if (state.kind === 'loading') return <Spinner label="Loading case…" />;
  if (state.kind === 'notFound') {
    return (
      <Notice tone="warning" title="Case not found">
        No case has the ID <code>{caseId}</code>. Check it and try again. <Link href="/cases/">Back to my cases</Link>
      </Notice>
    );
  }
  if (state.kind === 'error') {
    return (
      <Notice tone="error" title="Could not load this case">
        <p>{state.message}</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setState({ kind: 'loading' }); void load(); }}>
          Try again
        </button>
      </Notice>
    );
  }

  const c = state.view.case;
  const role = getRole(c, user);
  const actions = availableActions(c.status, role);
  const party = role === 'observer' ? null : role;
  const deliberating = c.status === 'DELIBERATING';
  const showTimeline = ['DELIBERATING', 'ESCALATED', 'RULED', 'SETTLED'].includes(c.status);

  return (
    <div className="stack-lg" data-testid="case-detail">
      <div>
        <Link href="/cases/" className="muted small">← My cases</Link>
        <div className="row-between wrap case-title">
          <h1 className="case-id">
            Case <code data-testid="case-id">{c.caseId}</code> <CopyButton value={c.caseId} label="Copy ID" />
          </h1>
          <StatusBadge status={c.status} />
        </div>
        <p className="case-meta">
          <strong className="amount">{formatMoney(c.amountCents, c.currency)}</strong>
          <span className="pill" data-testid="role">{roleLabel(role)}</span>
          <span className="muted small">Opened {formatDateTime(c.createdAt)}</span>
        </p>
      </div>

      <CaseProgress status={c.status} />

      <div className="grid-2">
        <section className="card stack" aria-labelledby="next-title">
          <h2 id="next-title" className="h3">Next step</h2>

          {c.status === 'CREATED' && role === 'claimant' && (
            <>
              <p>
                Waiting for <strong>{c.respondentId}</strong> to fund escrow. Send them the case ID so they can open it
                after signing in with that email.
              </p>
              <p><code>{c.caseId}</code> <CopyButton value={c.caseId} label="Copy ID" /></p>
            </>
          )}

          {actions.includes('fund') && (
            <>
              <p>Fund {formatMoney(c.amountCents, c.currency)} into escrow. The funds are held until the deal completes or Panch rules on a dispute.</p>
              <p className="muted small">Simulated escrow. No real money moves.</p>
              <div>
                <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => act('fund', () => api.fundCase(caseId), 'Escrow funded.')} data-testid="action-fund">
                  {busy === 'fund' ? 'Funding…' : 'Fund escrow'}
                </button>
              </div>
            </>
          )}

          {actions.includes('dispute') && (
            <>
              <p>Is something wrong with the work or the payment? Opening a dispute freezes the escrow and starts the evidence window for both sides.</p>
              <div>
                <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => act('dispute', () => api.disputeCase(caseId), 'Dispute opened. Both sides can now upload evidence.')} data-testid="action-dispute">
                  {busy === 'dispute' ? 'Opening…' : 'Open dispute'}
                </button>
              </div>
            </>
          )}

          {actions.includes('submit') && (
            <>
              <p>Upload your evidence below, then submit the case to the panel. After submitting, no more evidence can be added.</p>
              <label className="checkbox">
                <input type="checkbox" checked={readyToSubmit} onChange={(e) => setReadyToSubmit(e.target.checked)} disabled={!!busy} data-testid="ready-to-submit" />
                <span>I have uploaded all the evidence I want the panel to see.</span>
              </label>
              <div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!!busy || !readyToSubmit}
                  onClick={() => act('submit', async () => { await api.submitCase(caseId); return null; }, 'Submitted. The panel is deliberating.')}
                  data-testid="action-submit"
                >
                  {busy === 'submit' ? 'Submitting…' : 'Submit for deliberation'}
                </button>
              </div>
            </>
          )}

          {c.status === 'FUNDED' && role === 'observer' && <p>Escrow is funded. Only the parties can open a dispute.</p>}
          {c.status === 'CREATED' && role === 'observer' && <p>Waiting for the respondent to fund escrow.</p>}
          {c.status === 'DISPUTED' && role === 'observer' && <p>The parties are gathering evidence.</p>}

          {deliberating && (
            <p>
              The panel is reviewing the evidence. This page updates on its own.
              {checkedAt && <span className="muted small"> Last checked {new Date(checkedAt).toLocaleTimeString()}.</span>}
            </p>
          )}
          {c.status === 'ESCALATED' && (
            <p>The judges disagreed too much, or the swap test flipped the result, so a human reviewer will decide this case.</p>
          )}
          {actions.includes('viewRuling') && (
            <div>
              <Link href={`/ruling/?id=${encodeURIComponent(c.caseId)}`} className="btn btn-primary" data-testid="view-ruling">
                Read the ruling
              </Link>
            </div>
          )}

          <div aria-live="polite">
            {actionError && <Notice tone="error">{actionError}</Notice>}
            {actionInfo && !actionError && <Notice tone="success">{actionInfo}</Notice>}
          </div>
        </section>

        <section className="card stack" aria-labelledby="parties-title">
          <h2 id="parties-title" className="h3">Parties</h2>
          <dl className="details">
            <dt>Claimant</dt>
            <dd>{role === 'claimant' ? 'You' : 'The freelancer who opened the case'}</dd>
            <dt>Respondent</dt>
            <dd>{role === 'respondent' ? `You (${c.respondentId})` : c.respondentId}</dd>
            {c.evidenceDeadline && (
              <>
                <dt>Evidence deadline</dt>
                <dd>{formatDateTime(c.evidenceDeadline)}</dd>
              </>
            )}
          </dl>
        </section>
      </div>

      {actions.includes('uploadEvidence') && party && (
        <section className="card stack" aria-labelledby="evidence-title">
          <h2 id="evidence-title" className="h3">Add evidence</h2>
          <p className="muted small">
            Upload the contract, chat logs, invoices or the deliverable. Judges see the evidence with names and countries
            removed.
          </p>
          <EvidenceUpload caseId={caseId} party={party} onUploaded={handleUploaded} />
        </section>
      )}

      {uploads.length > 0 && (
        <section className="card stack" aria-labelledby="uploads-title">
          <h2 id="uploads-title" className="h3">Evidence uploaded from this device</h2>
          <ul className="plain-list" data-testid="uploads">
            {uploads.map((u) => (
              <li key={u.evidenceId} className="row-between wrap">
                <span>
                  <strong>{u.fileName}</strong> <span className="muted small">({u.type}, {formatBytes(u.size)})</span>
                </span>
                <code className="small">{u.evidenceId}</code>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showTimeline && (
        <section className="card stack" aria-labelledby="timeline-title">
          <h2 id="timeline-title" className="h3">Tribunal</h2>
          <TribunalTimeline completed={state.view.timeline} active={deliberating} />
        </section>
      )}

      {receipts.length > 0 && (
        <section className="card stack" aria-labelledby="ledger-title">
          <h2 id="ledger-title" className="h3">Escrow ledger receipts</h2>
          <p className="muted small">Each escrow event is chained to the previous one by its SHA-256 hash, so tampering is detectable.</p>
          <ul className="plain-list" data-testid="receipts">
            {receipts.map((r) => (
              <li key={r.event} className="row-between wrap">
                <span><strong>{r.event}</strong> <span className="muted small">{formatDateTime(r.at)}</span></span>
                {r.entryHash && <code className="small" title={r.entryHash}>{shortHash(r.entryHash)}</code>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CasePageInner() {
  const caseId = useSearchParams().get('id')?.trim() ?? '';
  if (!caseId) {
    return (
      <Notice tone="warning" title="No case selected">
        Open a case from <Link href="/cases/">My cases</Link>.
      </Notice>
    );
  }
  return (
    <RequireAuth>
      <CaseDetail key={caseId} caseId={caseId} />
    </RequireAuth>
  );
}

export default function CasePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <CasePageInner />
    </Suspense>
  );
}
