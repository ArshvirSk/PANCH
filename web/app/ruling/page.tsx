'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { bpsToPercent } from '../../lib/format';
import type { Ruling } from '../../lib/types';
import { Notice } from '../../components/Notice';
import { Spinner } from '../../components/Spinner';

type LoadState = { kind: 'loading' } | { kind: 'ready'; ruling: Ruling } | { kind: 'missing' } | { kind: 'error'; message: string };

function RulingView({ caseId }: { caseId: string }) {
  const { api } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    api
      .getRuling(caseId)
      .then((ruling) => active && setState(ruling ? { kind: 'ready', ruling } : { kind: 'missing' }))
      .catch((err) => active && setState({ kind: 'error', message: err instanceof Error ? err.message : 'The ruling could not be loaded.' }));
    return () => {
      active = false;
    };
  }, [api, caseId]);

  if (state.kind === 'loading') return <Spinner label="Loading ruling…" />;
  if (state.kind === 'missing') {
    return (
      <Notice tone="info" title="No published ruling yet">
        There is no published ruling for case <code>{caseId}</code>. If the panel is still deliberating, check back soon.
      </Notice>
    );
  }
  if (state.kind === 'error') return <Notice tone="error" title="Could not load the ruling">{state.message}</Notice>;

  const r = state.ruling;
  const claimantShare = r.payeeShareBps;
  const respondentShare = 10000 - claimantShare;

  return (
    <article className="stack-lg" data-testid="ruling">
      <header>
        <p className="eyebrow">Published ruling</p>
        <h1>Case <code>{caseId}</code></h1>
      </header>

      <section className="card stack" aria-labelledby="award-title">
        <h2 id="award-title" className="h3">Award</h2>
        <div
          className="split-bar"
          role="img"
          aria-label={`Claimant receives ${bpsToPercent(claimantShare)}, respondent receives ${bpsToPercent(respondentShare)}`}
        >
          {claimantShare > 0 && <span className="split-claimant" style={{ width: `${claimantShare / 100}%` }} />}
          {respondentShare > 0 && <span className="split-respondent" style={{ width: `${respondentShare / 100}%` }} />}
        </div>
        <div className="row-between">
          <span><span className="swatch swatch-claimant" aria-hidden="true" /> Claimant <strong data-testid="claimant-share">{bpsToPercent(claimantShare)}</strong></span>
          <span><span className="swatch swatch-respondent" aria-hidden="true" /> Respondent <strong>{bpsToPercent(respondentShare)}</strong></span>
        </div>
        <p className="muted small">Panel confidence {Math.round(r.confidence * 100)}%</p>
      </section>

      <section className="card stack" aria-labelledby="reasoning-title">
        <h2 id="reasoning-title" className="h3">Reasoning</h2>
        <p className="prose">{r.reasoning}</p>
      </section>

      <div className="grid-2">
        <section className="card stack" aria-labelledby="findings-title">
          <h2 id="findings-title" className="h3">Findings of fact</h2>
          {r.findingsOfFact.length === 0 ? (
            <p className="muted">No cited findings.</p>
          ) : (
            <ol className="findings">
              {r.findingsOfFact.map((f, i) => (
                <li key={i}>
                  <p>{f.fact}</p>
                  <p className="chips">
                    {f.evidenceIds.map((id) => <span key={id} className="chip" title="Evidence ID">{id}</span>)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card stack" aria-labelledby="clauses-title">
          <h2 id="clauses-title" className="h3">Contract clauses relied on</h2>
          {r.clausesRelied.length === 0 ? (
            <p className="muted">None cited.</p>
          ) : (
            <dl className="details">
              {r.clausesRelied.map((c, i) => (
                <div key={i} className="clause">
                  <dt>Clause {c.clauseRef}</dt>
                  <dd>{c.interpretation}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>

      {r.uncertainties.length > 0 && (
        <section className="card stack" aria-labelledby="uncertain-title">
          <h2 id="uncertain-title" className="h3">Open uncertainties</h2>
          <ul>
            {r.uncertainties.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </section>
      )}

      <p className="muted small">
        Arbitration by consent on simulated funds. Parties are blinded as Claimant and Respondent. This is not legal advice.
      </p>
    </article>
  );
}

function RulingPageInner() {
  const caseId = useSearchParams().get('id')?.trim() ?? '';
  if (!caseId) {
    return (
      <Notice tone="warning" title="No case selected">
        Add a case ID to the link, or <Link href="/ruling/?id=c-104">see a sample ruling</Link>.
      </Notice>
    );
  }
  return <RulingView key={caseId} caseId={caseId} />;
}

export default function RulingPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <RulingPageInner />
    </Suspense>
  );
}
