'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { bpsToPercent, formatDateTime } from '../lib/format';
import type { RulingSummary } from '../lib/types';
import { EmptyState } from './EmptyState';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

type LoadState = { kind: 'loading' } | { kind: 'ready'; rows: RulingSummary[] } | { kind: 'error'; message: string };

function awardLabel(row: RulingSummary): string {
  const claimant = bpsToPercent(row.payeeShareBps);
  const respondent = bpsToPercent(10000 - row.payeeShareBps);
  if (row.payeeShareBps === 10000) return 'Claimant awarded in full';
  if (row.payeeShareBps === 0) return 'Claim dismissed in full';
  return `Claimant ${claimant} · Respondent ${respondent}`;
}

function costLabel(row: RulingSummary): string | null {
  if (typeof row.costUsd !== 'number' || row.costUsd <= 0) return null;
  return `$${row.costUsd.toFixed(4)}`;
}

/**
 * The public ruling gallery (PRD section 5 ship gate: landing page, ruling
 * gallery and /demo/run must all work without a login). One row per published
 * ruling from `GET /rulings`, which reads the Rulings table — the same rows the
 * API serves today, so the gallery lists exactly what has been published and
 * nothing else. The row links to the ruling page, where the body, the hash and
 * the ledger chain can be checked.
 */
export function RulingsGallery() {
  const { api } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    api
      .listRulings()
      .then((rows) => active && setState({ kind: 'ready', rows }))
      .catch((err) => active && setState({ kind: 'error', message: err instanceof Error ? err.message : 'The rulings could not be loaded.' }));
    return () => {
      active = false;
    };
  }, [api, attempt]);

  if (state.kind === 'loading') {
    return (
      <p className="spinner-row" role="status">
        <Spinner /> Loading published rulings…
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="card narrow">
        <EmptyState
          icon="alert"
          title="Could not load the rulings"
          action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt((n) => n + 1)}><Icon name="refresh" size={15} /> Try again</button>}
        >
          {state.message}
        </EmptyState>
      </div>
    );
  }

  if (state.rows.length === 0) {
    return (
      <div className="card narrow">
        <EmptyState icon="clock" title="No rulings published yet" action={<Link href="/#demo" className="btn btn-secondary btn-sm">Run the demo</Link>}>
          When the panel finishes a case, its ruling is published here with a hash anyone can verify.
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <ul className="ruling-grid" data-testid="ruling-gallery">
        {state.rows.map((row) => (
          <li key={row.caseId} className="card ruling-card">
            <div className="row-between wrap">
              <Link href={`/ruling/?id=${encodeURIComponent(row.caseId)}`} className="ruling-card-id mono">
                {row.caseId}
              </Link>
              <span className={`badge ${row.humanReviewed ? 'badge-escalated' : 'badge-settled'}`}>
                <span className="badge-dot" aria-hidden="true" />
                {row.humanReviewed ? 'Human review' : 'Panel ruling'}
              </span>
            </div>
            <p className="ruling-card-award">{awardLabel(row)}</p>
            <p className="muted small tabular">
              {formatDateTime(row.publishedAt)}
              {typeof row.spreadBps === 'number' && <> · panel spread {bpsToPercent(row.spreadBps)}</>}
              {costLabel(row) && <> · {costLabel(row)}</>}
              {typeof row.tokens === 'number' && row.tokens > 0 && <> · {row.tokens.toLocaleString()} tokens</>}
            </p>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Every published ruling carries a SHA-256 hash and a hash-chained escrow ledger. Open one and use
        <strong> Verify ruling</strong> to recompute both. Rows with no cost figure were published before cost recording existed.
      </p>
    </>
  );
}
