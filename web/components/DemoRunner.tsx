'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { executionEnded } from '../lib/caseLogic';
import type { CaseView, DemoRunResult } from '../lib/types';
import { Icon } from './Icon';
import { Notice } from './Notice';
import { ButtonSpinner } from './Spinner';
import { TribunalTimeline } from './TribunalTimeline';
import { SAMPLE_RULING_HREF } from '../lib/samples';

const POLL_MS = 4000;
/** Stop following after this long; the ruling page still has the outcome. */
const MAX_FOLLOW_MS = 10 * 60 * 1000;

/**
 * "Run demo case" (PRD F10). Public: POST /demo/run needs no login, and a demo
 * case is readable without login, so the visitor watches the live timeline (F9)
 * here until the run settles, escalates or fails.
 */
export function DemoRunner() {
  const { api } = useAuth();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DemoRunResult | null>(null);
  const [view, setView] = useState<CaseView | null>(null);
  const [pollWarning, setPollWarning] = useState('');
  const [gaveUp, setGaveUp] = useState(false);
  const [error, setError] = useState('');
  const startedAt = useRef(0);

  async function run() {
    if (running) return;
    setRunning(true);
    setError('');
    setResult(null);
    setView(null);
    setGaveUp(false);
    try {
      const started = await api.runDemo();
      startedAt.current = Date.now();
      setResult(started);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The demo could not start.');
    } finally {
      setRunning(false);
    }
  }

  const caseId = result?.caseId;
  const status = view?.case.status;
  const stuck = status === 'DELIBERATING' && executionEnded(view?.executionStatus);
  const following = !!caseId && !gaveUp && !stuck && (!status || status === 'DELIBERATING' || status === 'DISPUTED');

  useEffect(() => {
    if (!caseId || !following) return;
    let active = true;
    async function poll() {
      if (Date.now() - startedAt.current > MAX_FOLLOW_MS) {
        setGaveUp(true);
        return;
      }
      if (document.visibilityState !== 'visible') return;
      try {
        const next = await api.getDemoCase(caseId!);
        if (!active) return;
        setView(next);
        setPollWarning('');
      } catch (err) {
        if (active) setPollWarning(`Could not refresh the timeline: ${err instanceof Error ? err.message : 'unknown error'}. Still trying.`);
      }
    }
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, caseId, following]);

  const rulingHref = caseId ? `/ruling/?id=${encodeURIComponent(caseId)}` : SAMPLE_RULING_HREF;

  return (
    <div className="demo-runner">
      <div className="demo-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={run} disabled={running || following} data-testid="run-demo">
          {running ? <ButtonSpinner /> : <Icon name="play" size={16} />}
          {running ? 'Starting demo…' : following ? 'Demo running…' : 'Run demo case'}
        </button>
        <Link href={SAMPLE_RULING_HREF} className="btn btn-on-dark btn-lg">
          See a sample ruling
          <Icon name="arrow-right" size={16} />
        </Link>
      </div>
      <div aria-live="polite">
        {error && <Notice tone="error" title="The demo could not start">{error}</Notice>}
      </div>
      {result && (
        <div className="demo-progress card" data-testid="demo-progress">
          <div className="row-between wrap">
            <p className="demo-progress-title">
              Demo case {caseId ? <code>{caseId}</code> : 'started'}
            </p>
            {following && <span className="timeline-live">Live</span>}
          </div>
          <div aria-live="polite" className="stack-sm">
            {status === 'SETTLED' || status === 'RULED' ? (
              <Notice tone="success" title="The panel has ruled">
                The ruling is published and the simulated escrow has settled. <Link href={rulingHref} data-testid="demo-ruling-link">Read the ruling</Link>
              </Notice>
            ) : status === 'ESCALATED' ? (
              <Notice tone="warning" title="Sent to human review">
                The judges disagreed too much, or the swap test changed the result, so the panel did not rule on its own. A human reviewer decides escalated cases; there is no ruling to read yet.
              </Notice>
            ) : status === 'FAILED' ? (
              <Notice tone="warning" title="The tribunal could not finish this run">
                No award was made and the escrow is untouched. The ruling page shows a cached fallback, clearly marked as not a ruling. <Link href={rulingHref}>See what happened</Link>
              </Notice>
            ) : stuck ? (
              <Notice tone="warning" title="The run ended without an outcome">
                The tribunal run finished but the case was not updated. Try the demo again.
              </Notice>
            ) : gaveUp ? (
              <Notice tone="info" title="Still working">
                This is taking longer than usual. The outcome will appear on the <Link href={rulingHref}>ruling page</Link> when the panel finishes.
              </Notice>
            ) : (
              <p className="muted small">Three judges from different model families are working on the case. This usually takes one to three minutes.</p>
            )}
            {pollWarning && <Notice tone="warning">{pollWarning}</Notice>}
          </div>
          <TribunalTimeline completed={view?.timeline ?? []} active={following} />
        </div>
      )}
    </div>
  );
}
