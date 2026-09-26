'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { parseCaseIdInput } from '../../lib/caseLogic';
import { createCaseMemory, type RecentCase } from '../../lib/storage';
import { formatDateTime, formatMoney } from '../../lib/format';
import { RequireAuth } from '../../components/RequireAuth';
import { ApiError } from '../../lib/api';
import { StatusBadge } from '../../components/StatusBadge';
import { ButtonSpinner, Spinner } from '../../components/Spinner';
import { Notice } from '../../components/Notice';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';

/** How many case refreshes run at once, so a long list does not flood the API. */
const REFRESH_CONCURRENCY = 4;

function CasesList() {
  const { api, user } = useAuth();
  const router = useRouter();
  const [recent, setRecent] = useState<RecentCase[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [staleCount, setStaleCount] = useState(0);
  const [lookupId, setLookupId] = useState('');
  const [lookupError, setLookupError] = useState('');

  // Show what this device remembers at once, then bring each status up to date from the API.
  useEffect(() => {
    if (!user) return;
    const memory = createCaseMemory();
    const remembered = memory.recentCases(user.sub);
    setRecent(remembered);
    if (remembered.length === 0) return;

    let active = true;
    let failed = 0;
    const queue = [...remembered];
    setRefreshing(true);
    async function worker() {
      for (let next = queue.shift(); next && active; next = queue.shift()) {
        try {
          const view = await api.getCase(next.caseId);
          if (!active || !user) return;
          memory.updateCase(user.sub, next.caseId, { status: view.case.status, amountCents: view.case.amountCents, currency: view.case.currency });
        } catch (err) {
          if (err instanceof ApiError && err.status === 404 && user) memory.forgetCase(user.sub, next.caseId);
          else failed += 1;
        }
      }
    }
    void Promise.all(Array.from({ length: REFRESH_CONCURRENCY }, worker)).then(() => {
      if (!active || !user) return;
      setRecent(memory.recentCases(user.sub));
      setStaleCount(failed);
      setRefreshing(false);
    });
    return () => {
      active = false;
    };
  }, [api, user]);

  function openCase(event: FormEvent) {
    event.preventDefault();
    const parsed = parseCaseIdInput(lookupId);
    if (!parsed.ok) return setLookupError(parsed.error);
    router.push(`/case/?id=${encodeURIComponent(parsed.id)}`);
  }

  return (
    <div className="container page stack-lg">
      <PageHeader
        eyebrow="Dashboard"
        title="My cases"
        description="Open a new case as the freelancer, or respond to one you were named in."
        actions={
          <Link href="/cases/new/" className="btn btn-primary">
            <Icon name="plus" size={16} /> New case
          </Link>
        }
      />

      <form className="card lookup" onSubmit={openCase} noValidate>
        <div className="field grow">
          <label className="field-label" htmlFor="lookup">Open a case by ID</label>
          <span className="input-icon">
            <Icon name="search" size={17} />
            <input
              id="lookup"
              value={lookupId}
              onChange={(e) => { setLookupId(e.target.value); setLookupError(''); }}
              placeholder="c-1a2b3c4d or a case link"
              aria-describedby="lookup-help"
              aria-invalid={lookupError ? true : undefined}
              data-testid="lookup-id"
              autoComplete="off"
              spellCheck={false}
            />
          </span>
          <small id="lookup-help" className="muted">
            {lookupError ? <span className="field-error">{lookupError}</span> : 'Named as the respondent? Ask the claimant for the case ID or link.'}
          </small>
        </div>
        <button type="submit" className="btn btn-secondary">Open case</button>
      </form>

      <section className="stack" aria-labelledby="recent-title">
        <div className="row-between">
          <h2 id="recent-title" className="h3">Recent on this device</h2>
          {recent.length > 0 && (
            <span className="muted small row-gap" aria-live="polite" data-testid="recent-meta">
              {refreshing ? <><ButtonSpinner /> Updating statuses…</> : `${recent.length} ${recent.length === 1 ? 'case' : 'cases'}`}
            </span>
          )}
        </div>
        {staleCount > 0 && !refreshing && (
          <Notice tone="warning">Could not refresh {staleCount === 1 ? 'one case' : `${staleCount} cases`}. The last known status is shown.</Notice>
        )}
        {recent.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="No cases yet"
            action={<Link href="/cases/new/" className="btn btn-primary btn-sm"><Icon name="plus" size={15} /> Create your first case</Link>}
          >
            Cases you create or open appear here.
          </EmptyState>
        ) : (
          <ul className="case-list">
            {recent.map((c) => (
              <li key={c.caseId}>
                <Link href={`/case/?id=${encodeURIComponent(c.caseId)}`} className="case-row">
                  <span className="case-row-icon" aria-hidden="true"><Icon name="scale" size={18} /></span>
                  <span className="case-row-main">
                    <span className="mono case-row-id">{c.caseId}</span>
                    <span className="muted small">You are the {c.role} · last viewed {formatDateTime(c.seenAt)}</span>
                  </span>
                  <span className="case-row-side">
                    <strong className="tabular">{formatMoney(c.amountCents, c.currency)}</strong>
                    <StatusBadge status={c.status} />
                    <Icon name="chevron-right" size={18} className="muted" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function CasesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <RequireAuth>
        <CasesList />
      </RequireAuth>
    </Suspense>
  );
}
