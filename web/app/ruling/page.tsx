'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { parseCaseIdInput } from '../../lib/caseLogic';
import { bpsToPercent, clauseLabel } from '../../lib/format';
import type { Ruling } from '../../lib/types';
import { CopyButton } from '../../components/CopyButton';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { Notice } from '../../components/Notice';
import { RichText } from '../../components/RichText';
import { VerifyPanel } from '../../components/VerifyPanel';
import { PageSkeleton } from '../../components/Skeleton';
import { Spinner } from '../../components/Spinner';
import { SAMPLE_RULING_HREF } from '../../lib/samples';

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

/**
 * A failed demo run serves a cached body instead of a ruling (failHandler.ts): the
 * award is zeroed only because no award exists. Showing it as "Claim dismissed in full"
 * would be false, so it gets its own page that says what it is.
 */
function FallbackView({ caseId, ruling }: { caseId: string; ruling: Ruling }) {
  return (
    <article className="award" data-testid="fallback-ruling">
      <header className="award-head">
        <div className="award-seal award-seal-muted" aria-hidden="true"><Icon name="alert" size={26} /></div>
        <div className="award-title">
          <p className="eyebrow">Cached fallback · not a ruling</p>
          <h1>Case <span className="mono">{caseId}</span></h1>
          <p className="muted">The live tribunal did not finish this demo run, so no award was made.</p>
        </div>
      </header>
      <section className="award-section">
        <Notice tone="warning" title="This is a cached fallback, not a ruling">
          It is a pre-written placeholder shown because the run failed. No judge decided this case, no money moved, and the escrow is untouched: no RESOLVE or RELEASE was recorded.
        </Notice>
      </section>
      <section className="award-section" aria-labelledby="fallback-what">
        <h2 id="fallback-what">What happened</h2>
        <RichText className="prose" text={ruling.reasoning} />
        {ruling.uncertainties.length > 0 && (
          <ul className="uncertainties">
            {ruling.uncertainties.map((u, i) => <li key={i}><Icon name="info" size={15} />{u}</li>)}
          </ul>
        )}
      </section>
      <footer className="award-foot">
        <p className="row-gap wrap">
          <Link href="/#demo">Run the demo again</Link> · <Link href={SAMPLE_RULING_HREF}>See a published ruling</Link>
        </p>
      </footer>
    </article>
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
        <EmptyState icon="clock" title="No published ruling yet" action={<Link href={SAMPLE_RULING_HREF} className="btn btn-secondary btn-sm">See a sample ruling</Link>}>
          There is no published ruling for case <code>{caseId}</code>. If the panel is still deliberating, or the case went to human review, check back once it settles.
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
  if (r.fallback) return <FallbackView caseId={caseId} ruling={r} />;
  const claimantShare = r.payeeShareBps;
  const respondentShare = 10000 - claimantShare;
  const outcome = claimantShare === 10000 ? 'Award in full to the claimant' : claimantShare === 0 ? 'Claim dismissed in full' : 'Split award';
  const human = r.humanReviewed === true;

  return (
    <article className="award" data-testid="ruling">
      <header className="award-head">
        <div className="award-seal" aria-hidden="true"><Icon name="gavel" size={26} /></div>
        <div className="award-title">
          <p className="eyebrow">Arbitral award · Panch tribunal</p>
          <h1>Case <span className="mono">{caseId}</span></h1>
          <p className="muted" data-testid="decided-by">{outcome}. {human ? 'Decided by a human reviewer after the panel of three judges escalated the case.' : 'Decided by a blinded panel of three judges and a presiding judge.'}</p>
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
        {/* A human decision carries a fixed confidence of 1, which is not a panel measurement. */}
        {!human && <ConfidenceMeter value={r.confidence} />}
      </section>

      <VerifyPanel caseId={caseId} />

      <section className="award-section" aria-labelledby="reasoning-title">
        <h2 id="reasoning-title"><span className="numeral">I.</span> {human ? "Reviewer's reasons" : 'Reasoning'}</h2>
        <RichText className="prose" text={r.reasoning} />
      </section>

      <section className="award-section" aria-labelledby="findings-title">
        <h2 id="findings-title"><span className="numeral">II.</span> Findings of fact</h2>
        {r.findingsOfFact.length === 0 ? (
          <p className="muted" data-testid="no-findings">
            {human
              ? "The reviewer decided from the panel's full record; the reasons above are the decision, so no findings are restated here."
              : 'No findings with evidence citations were made.'}
          </p>
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
          <p className="muted">{human ? 'No clauses are restated by the reviewer.' : 'No contract clauses were cited.'}</p>
        ) : (
          <dl className="clauses">
            {r.clausesRelied.map((c, i) => (
              <div key={i} className="clause">
                <dt>{clauseLabel(c.clauseRef)}</dt>
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
        <EmptyState icon="search" title={raw.trim() ? 'This ruling link is not valid' : 'No case selected'} action={<Link href={SAMPLE_RULING_HREF} className="btn btn-secondary btn-sm">See a sample ruling</Link>}>
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
