'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { createCaseMemory, type RecentCase } from '../../lib/storage';
import { formatDateTime, formatMoney } from '../../lib/format';
import { RequireAuth } from '../../components/RequireAuth';
import { StatusBadge } from '../../components/StatusBadge';
import { Spinner } from '../../components/Spinner';

function CasesList() {
  const { user } = useAuth();
  const router = useRouter();
  const [recent, setRecent] = useState<RecentCase[]>([]);
  const [lookupId, setLookupId] = useState('');

  useEffect(() => {
    if (user) setRecent(createCaseMemory().recentCases(user.sub));
  }, [user]);

  function openCase(event: FormEvent) {
    event.preventDefault();
    const id = lookupId.trim();
    if (id) router.push(`/case/?id=${encodeURIComponent(id)}`);
  }

  return (
    <div className="stack-lg">
      <div className="row-between wrap">
        <h1>My cases</h1>
        <Link href="/cases/new/" className="btn btn-primary">New case</Link>
      </div>

      <form className="card lookup" onSubmit={openCase}>
        <label className="field grow">
          <span>Open a case by ID</span>
          <input
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="c-1a2b3c4d"
            aria-describedby="lookup-help"
            data-testid="lookup-id"
          />
        </label>
        <button type="submit" className="btn btn-secondary" disabled={!lookupId.trim()}>Open</button>
        <small id="lookup-help" className="muted full">
          Were you named as the respondent? Ask the claimant for the case ID and open it here.
        </small>
      </form>

      <section aria-labelledby="recent-title">
        <h2 id="recent-title" className="h3">Opened on this device</h2>
        {recent.length === 0 ? (
          <p className="muted">No cases yet. Create one, or open a case you were invited to by its ID.</p>
        ) : (
          <ul className="case-list">
            {recent.map((c) => (
              <li key={c.caseId}>
                <Link href={`/case/?id=${encodeURIComponent(c.caseId)}`} className="case-row card">
                  <span className="case-row-main">
                    <code>{c.caseId}</code>
                    <span className="muted small">You are the {c.role} · last seen {formatDateTime(c.seenAt)}</span>
                  </span>
                  <span className="case-row-side">
                    <strong>{formatMoney(c.amountCents, c.currency)}</strong>
                    <StatusBadge status={c.status} />
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
