'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { parseCaseIdInput } from '../../lib/caseLogic';
import { bpsToPercent } from '../../lib/format';
import type { Ruling } from '../../lib/types';
import { CopyButton } from '../../components/CopyButton';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { PageSkeleton } from '../../components/Skeleton';
import { Spinner } from '../../components/Spinner';

type LoadState = { kind: 'loading' } | { kind: 'ready'; ruling: Ruling } | { kind: 'missing' } | { kind: 'error'; message: string };

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const level = pct >= 85 ? 'High' : pct >= 60 ? 'Moderate' : 'Low';
  return (
    <div className="confidence">
      <div className="row-between small">
        <span className="muted">Panel confidence</span>
        <strong>{pct}% · {level}</strong>
      </div>
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Panel confidence">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RulingView({ caseId }: { caseId: string }) {
  const { api } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    api
      .getRuling(caseId)
      .then((ruling) => active && setState(ruling ? { kind: 'ready', ruling } : { kind: 'missing' }))
      .catch((err) => active && setState({ kind: 'error', message: err instanceof Error ? err.message : 'The ruling could not be loaded.' }));
    return () => {
      active = false;
    };
  }, [api, caseId, attempt]);

  if (state.kind === 'loading') return <PageSkeleton label="Loading ruling…" />;
  if (state.kind === 'missing') {
    return (
      <div className="card narrow">
        <EmptyState icon="clock" title="No published ruling yet" action={<Link href="/ruling/?id=c-104" className="btn btn-secondary btn-sm">See a sample ruling</Link>}>
          There is no published ruling for case <code>{caseId}</code>. If the panel is still deliberating, check back soon.
        </EmptyState>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="card narrow">
        <EmptyState
          icon="alert"
          title="Could not load the ruling"
          action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt((n) => n + 1)}><Icon name="refresh" size={15} /> Try again</button>}
        >
          {state.message}
        </EmptyState>
      </div>
    );
  }

  const r = state.ruling;
  const claimantShare = r.payeeShareBps;
  const respondentShare = 10000 - claimantShare;
  const outcome = claimantShare === 10000 ? 'Award in full to the claimant' : claimantShare === 0 ? 'Claim dismissed in full' : 'Split award';

  return (
    <article className="award" data-testid="ruling">
      <header className="award-head">
        <div className="award-seal" aria-hidden="true"><Icon name="gavel" size={26} /></div>
        <div className="award-title">
          <p className="eyebrow">Arbitral award · Panch tribunal</p>
          <h1>Case <span className="mono">{caseId}</span></h1>
          <p className="muted">{outcome}. Decided by a blinded panel of three judges and a presiding judge.</p>
        </div>
        <div className="award-actions no-print">
          <CopyButton value={typeof window !== 'undefined' ? window.location.href : ''} label="Copy link" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>
            <Icon name="printer" size={15} /> Print
          </button>
        </div>
      </header>

      <section className="award-split" aria-labelledby="award-title">
        <h2 id="award-title" className="sr-only">Award</h2>
        <div className="split-figures">
          <div>
            <p className="split-party"><span className="swatch swatch-claimant" aria-hidden="true" /> Claimant receives</p>
            <p className="split-value" data-testid="claimant-share">{bpsToPercent(claimantShare)}</p>
          </div>
          <div className="right">
            <p className="split-party">Respondent receives <span className="swatch swatch-respondent" aria-hidden="true" /></p>
            <p className="split-value">{bpsToPercent(respondentShare)}</p>
          </div>
        </div>
        <div
          className="split-bar"
          role="img"
          aria-label={`Claimant receives ${bpsToPercent(claimantShare)}, respondent receives ${bpsToPercent(respondentShare)}`}
        >
          {claimantShare > 0 && <span className="split-claimant" style={{ width: `${claimantShare / 100}%` }} />}
          {respondentShare > 0 && <span className="split-respondent" style={{ width: `${respondentShare / 100}%` }} />}
        </div>
        <ConfidenceMeter value={r.confidence} />
      </section>

      <section className="award-section" aria-labelledby="reasoning-title">
        <h2 id="reasoning-title"><span className="numeral">I.</span> Reasoning</h2>
        <p className="prose">{r.reasoning}</p>
      </section>

      <section className="award-section" aria-labelledby="findings-title">
        <h2 id="findings-title"><span className="numeral">II.</span> Findings of fact</h2>
        {r.findingsOfFact.length === 0 ? (
          <p className="muted">No findings with evidence citations were made.</p>
        ) : (
          <ol className="findings">
            {r.findingsOfFact.map((f, i) => (
              <li key={i}>
                <p>{f.fact}</p>
                <p className="chips" aria-label="Evidence cited">
                  {f.evidenceIds.map((id) => <span key={id} className="chip"><Icon name="file" size={12} />{id}</span>)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="award-section" aria-labelledby="clauses-title">
        <h2 id="clauses-title"><span className="numeral">III.</span> Contract clauses relied on</h2>
        {r.clausesRelied.length === 0 ? (
          <p className="muted">No contract clauses were cited.</p>
        ) : (
          <dl className="clauses">
            {r.clausesRelied.map((c, i) => (
              <div key={i} className="clause">
                <dt>Clause {c.clauseRef}</dt>
                <dd>{c.interpretation}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {r.uncertainties.length > 0 && (
        <section className="award-section" aria-labelledby="uncertain-title">
          <h2 id="uncertain-title"><span className="numeral">IV.</span> Open uncertainties</h2>
          <ul className="uncertainties">
            {r.uncertainties.map((u, i) => <li key={i}><Icon name="info" size={15} />{u}</li>)}
          </ul>
        </section>
      )}

      <footer className="award-foot">
        <p>
          <Icon name="shield" size={15} /> Arbitration by consent on simulated funds. Parties were blinded as Claimant and Respondent.
          Every finding cites evidence. This is not legal advice.
        </p>
      </footer>
    </article>
  );
}

function RulingPageInner() {
  const raw = useSearchParams().get('id') ?? '';
  const parsed = parseCaseIdInput(raw);
  if (!parsed.ok) {
    return (
      <div className="card narrow">
        <EmptyState icon="search" title={raw.trim() ? 'This ruling link is not valid' : 'No case selected'} action={<Link href="/ruling/?id=c-104" className="btn btn-secondary btn-sm">See a sample ruling</Link>}>
          Rulings are opened from a case, or from the link shared with the parties.
        </EmptyState>
      </div>
    );
  }
  return <RulingView key={parsed.id} caseId={parsed.id} />;
}

export default function RulingPage() {
  return (
    <div className="container page">
      <Suspense fallback={<Spinner />}>
        <RulingPageInner />
      </Suspense>
    </div>
  );
}
