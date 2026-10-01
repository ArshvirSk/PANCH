'use client';

import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { shortHash } from '../lib/format';
import type { RulingVerification } from '../lib/types';
import { Icon } from './Icon';
import { Notice } from './Notice';
import { ButtonSpinner } from './Spinner';

type State = { kind: 'idle' } | { kind: 'checking' } | { kind: 'done'; result: RulingVerification } | { kind: 'none' } | { kind: 'error'; message: string };

/**
 * "Verify ruling" (PRD F8). GET /rulings/{id}/verify recomputes the SHA-256 of the
 * published bytes and every ledger entry hash on the server; this shows what it found,
 * including a failure and its reason, rather than a badge that is always green.
 */
export function VerifyPanel({ caseId }: { caseId: string }) {
  const { api } = useAuth();
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function verify() {
    if (state.kind === 'checking') return;
    setState({ kind: 'checking' });
    try {
      const result = await api.verifyRuling(caseId);
      setState(result ? { kind: 'done', result } : { kind: 'none' });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Verification could not run.' });
    }
  }

  const result = state.kind === 'done' ? state.result : null;

  return (
    <section className="award-section verify" aria-labelledby="verify-title" data-testid="verify-panel">
      <div className="row-between wrap">
        <h2 id="verify-title" className="verify-title"><Icon name="hash" size={18} /> Verify this ruling</h2>
        <button type="button" className="btn btn-secondary btn-sm no-print" onClick={verify} disabled={state.kind === 'checking'} data-testid="verify-button">
          {state.kind === 'checking' ? <ButtonSpinner /> : <Icon name="shield" size={15} />}
          {result || state.kind === 'none' || state.kind === 'error' ? 'Verify again' : 'Verify ruling'}
        </button>
      </div>
      <p className="muted small">Recomputes the SHA-256 of the published ruling and every escrow ledger entry, and checks them against what was recorded when the case settled.</p>

      <div aria-live="polite">
        {state.kind === 'none' && (
          <Notice tone="info" title="Nothing to verify yet">
            No signed ruling is recorded for this case, so there is nothing to check. Escalated and unfinished cases have no ruling until they settle.
          </Notice>
        )}
        {state.kind === 'error' && <Notice tone="error" title="Verification could not run">{state.message}</Notice>}
        {result && (
          <div className="stack-sm" data-testid="verify-result" data-match={String(result.match)}>
            <Notice tone={result.match ? 'success' : 'warning'} title={result.match ? 'Verified' : 'Not verified'}>
              {result.reason}
            </Notice>
            <dl className="verify-facts">
              <div>
                <dt>Ruling content</dt>
                <dd>
                  {result.content.match === true ? 'Matches the signed hash' : result.content.match === false ? 'Does not match the signed hash' : 'No signed hash on record'}
                  <code className="verify-hash" title={result.content.computedHash}>{shortHash(result.content.computedHash, 10)}</code>
                </dd>
              </div>
              <div>
                <dt>Escrow ledger</dt>
                <dd>
                  {result.ledger.chainValid ? `Chain of ${result.ledger.entries.length} ${result.ledger.entries.length === 1 ? 'entry' : 'entries'} recomputes cleanly` : 'Chain does not recompute'}
                  {result.ledger.lastEvent && `, ends at ${result.ledger.lastEvent}`}
                </dd>
              </div>
            </dl>
            {result.ledger.entries.length > 0 && (
              <ol className="ledger verify-ledger" aria-label="Ledger entries">
                {result.ledger.entries.map((e) => (
                  <li key={e.seq} className={e.valid ? undefined : 'ledger-bad'}>
                    <span className="ledger-event">{e.seq}. {e.event}</span>
                    <span className="small">{e.valid ? <><Icon name="check" size={13} /> valid</> : <><Icon name="alert" size={13} /> invalid</>}</span>
                    <code className="ledger-hash" title={e.entryHash}>{shortHash(e.entryHash, 12)}</code>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
