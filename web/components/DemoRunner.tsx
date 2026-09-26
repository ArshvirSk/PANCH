'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import type { DemoRunResult } from '../lib/types';
import { Icon } from './Icon';
import { Notice } from './Notice';
import { ButtonSpinner } from './Spinner';

/** "Run demo case" (PRD F10). Public: POST /demo/run needs no login. */
export function DemoRunner() {
  const { api } = useAuth();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DemoRunResult | null>(null);
  const [error, setError] = useState('');

  async function run() {
    if (running) return;
    setRunning(true);
    setError('');
    setResult(null);
    try {
      setResult(await api.runDemo());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The demo could not start.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="demo-runner">
      <div className="demo-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={run} disabled={running} data-testid="run-demo">
          {running ? <ButtonSpinner /> : <Icon name="play" size={16} />}
          {running ? 'Starting demo…' : 'Run demo case'}
        </button>
        <Link href="/ruling/?id=c-104" className="btn btn-on-dark btn-lg">
          See a sample ruling
          <Icon name="arrow-right" size={16} />
        </Link>
      </div>
      <div aria-live="polite">
        {error && <Notice tone="error" title="The demo could not start">{error}</Notice>}
        {result && (
          <Notice tone="success" title={result.message}>
            <p>The pre-seeded case is on its way through intake, the three judges, cross-examination and the swap test.</p>
            {result.caseId && (
              <p>
                Case <code>{result.caseId}</code>.{' '}
                <Link href={`/ruling/?id=${encodeURIComponent(result.caseId)}`}>Open its ruling page</Link>
              </p>
            )}
            {result.executionArn && (
              <p className="small muted">Tribunal run <code className="break">{result.executionArn}</code></p>
            )}
            <p><Link href="/ruling/?id=c-104">See a sample published ruling</Link></p>
          </Notice>
        )}
      </div>
    </div>
  );
}
