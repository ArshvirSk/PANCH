'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import type { DemoRunResult } from '../lib/types';
import { Notice } from './Notice';

/** "Run demo case" (PRD F10). Public: POST /demo/run needs no login. */
export function DemoRunner() {
  const { api } = useAuth();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DemoRunResult | null>(null);
  const [error, setError] = useState('');

  async function run() {
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
      <button type="button" className="btn btn-primary btn-lg" onClick={run} disabled={running} data-testid="run-demo">
        {running ? 'Starting demo…' : 'Run demo case'}
      </button>
      <div aria-live="polite">
        {error && <Notice tone="error" title="Demo failed to start">{error}</Notice>}
        {result && (
          <Notice tone="success" title={result.message}>
            {result.caseId && (
              <p>
                Case <code>{result.caseId}</code>.{' '}
                <Link href={`/ruling/?id=${encodeURIComponent(result.caseId)}`}>Open its ruling page</Link>
              </p>
            )}
            {result.executionArn && (
              <p className="muted small">
                Tribunal run: <code className="break">{result.executionArn}</code>
              </p>
            )}
            <p>
              <Link href="/ruling/?id=c-104">See a sample published ruling</Link>
            </p>
          </Notice>
        )}
      </div>
    </div>
  );
}
