'use client';

import Link from 'next/link';
import { Suspense, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { CURRENCIES, isValidEmail, normalizeEmail, parseAmountToCents } from '../../../lib/format';
import { createCaseMemory } from '../../../lib/storage';
import { RequireAuth } from '../../../components/RequireAuth';
import { Notice } from '../../../components/Notice';
import { Spinner } from '../../../components/Spinner';

function NewCaseForm() {
  const { api, user } = useAuth();
  const router = useRouter();
  const [respondentEmail, setRespondentEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (!isValidEmail(respondentEmail)) return setError("Enter the client's email address.");
    const email = normalizeEmail(respondentEmail);
    if (user && email === normalizeEmail(user.email)) {
      return setError('The respondent must be someone else. Use the email of the client you are working with.');
    }
    const parsed = parseAmountToCents(amount);
    if (!parsed.ok) return setError(parsed.error);

    setBusy(true);
    try {
      const created = await api.createCase({ respondentEmail: email, amountCents: parsed.cents, currency });
      if (user) {
        createCaseMemory().rememberCase(user.sub, {
          caseId: created.caseId,
          amountCents: created.amountCents,
          currency: created.currency,
          status: created.status,
          role: 'claimant',
          seenAt: new Date().toISOString(),
        });
      }
      router.push(`/case/?id=${encodeURIComponent(created.caseId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The case could not be created.');
      setBusy(false);
    }
  }

  return (
    <div className="narrow stack-lg">
      <div>
        <Link href="/cases/" className="muted small">← My cases</Link>
        <h1>New case</h1>
        <p className="muted">
          You are the claimant, the person to be paid. The respondent is the client who funds escrow. Both of you
          agree that Panch decides any dispute.
        </p>
      </div>

      <form className="card stack" onSubmit={handleSubmit} noValidate data-testid="new-case-form">
        <label className="field">
          <span>Respondent (client) email</span>
          <input type="email" autoComplete="off" value={respondentEmail} onChange={(e) => setRespondentEmail(e.target.value)} disabled={busy} required data-testid="respondent-email" />
        </label>
        <div className="field-row">
          <label className="field grow">
            <span>Amount</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="400.00" disabled={busy} required data-testid="amount" />
          </label>
          <label className="field">
            <span>Currency</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={busy}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">Escrow is simulated. No real money moves. Panch handles claims up to 5,000.</p>
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="create-case">
          {busy ? 'Creating…' : 'Create case'}
        </button>
        <div aria-live="polite">{error && <Notice tone="error">{error}</Notice>}</div>
      </form>
    </div>
  );
}

export default function NewCasePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <RequireAuth>
        <NewCaseForm />
      </RequireAuth>
    </Suspense>
  );
}
