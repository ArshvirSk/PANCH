'use client';

import Link from 'next/link';
import { Suspense, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { CURRENCIES, formatMoney, isValidEmail, normalizeEmail, parseAmountToCents } from '../../../lib/format';
import { createCaseMemory } from '../../../lib/storage';
import { RequireAuth } from '../../../components/RequireAuth';
import { Notice } from '../../../components/Notice';
import { ButtonSpinner, Spinner } from '../../../components/Spinner';
import { PageHeader } from '../../../components/PageHeader';
import { Icon } from '../../../components/Icon';

const NEXT_STEPS = [
  { title: 'The client funds escrow', body: 'They sign in with the email you enter and fund the agreed amount.' },
  { title: 'You deliver the work', body: 'If all goes well, the escrow releases to you. No dispute needed.' },
  { title: 'If not, open a dispute', body: 'Both sides upload evidence and the panel issues a reasoned ruling.' },
];

function NewCaseForm() {
  const { api, user } = useAuth();
  const router = useRouter();
  const [respondentEmail, setRespondentEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const parsed = amount.trim() ? parseAmountToCents(amount) : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');

    if (!isValidEmail(respondentEmail)) return setError("Enter the client's email address.");
    const email = normalizeEmail(respondentEmail);
    if (user && email === normalizeEmail(user.email)) {
      return setError('The respondent must be someone else. Use the email of the client you are working with.');
    }
    const amountResult = parseAmountToCents(amount);
    if (!amountResult.ok) return setError(amountResult.error);

    setBusy(true);
    try {
      const created = await api.createCase({ respondentEmail: email, amountCents: amountResult.cents, currency });
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
    <div className="container page stack-lg">
      <PageHeader
        back={<Link href="/cases/" className="back-link"><Icon name="arrow-left" size={15} /> My cases</Link>}
        eyebrow="New case"
        title="Set up a protected deal"
        description="You are the claimant, the person to be paid. The respondent is the client who funds escrow. Both of you agree that Panch decides any dispute."
      />

      <div className="split">
        <form className="card stack" onSubmit={handleSubmit} noValidate data-testid="new-case-form">
          <label className="field">
            <span className="field-label">Respondent (client) email</span>
            <span className="input-icon">
              <Icon name="mail" size={17} />
              <input type="email" autoComplete="off" placeholder="client@company.com" value={respondentEmail} onChange={(e) => setRespondentEmail(e.target.value)} disabled={busy} required data-testid="respondent-email" />
            </span>
            <small className="muted">They must sign in with this email to fund the escrow.</small>
          </label>

          <div className="field">
            <label className="field-label" htmlFor="amount">Amount in escrow</label>
            <div className="amount-input">
              <input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="400.00" disabled={busy} required data-testid="amount" aria-describedby="amount-help" />
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={busy} aria-label="Currency">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <small id="amount-help" className="muted">
              {parsed && parsed.ok ? <>Escrow of <strong>{formatMoney(parsed.cents, currency)}</strong>. Simulated, no real money moves.</> : 'Up to 5,000. Simulated escrow, no real money moves.'}
            </small>
          </div>

          <div className="consent">
            <Icon name="scale" size={18} />
            <p className="small">By creating this case you agree that disputes about this deal are decided by the Panch panel.</p>
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={busy} data-testid="create-case">
            {busy && <ButtonSpinner />}
            {busy ? 'Creating case…' : 'Create case'}
          </button>
          <div aria-live="polite">{error && <Notice tone="error">{error}</Notice>}</div>
        </form>

        <aside className="card card-muted stack" aria-labelledby="next-title">
          <h2 id="next-title" className="h3">What happens next</h2>
          <ol className="mini-steps">
            {NEXT_STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="mini-step-number">{i + 1}</span>
                <span><strong>{s.title}</strong><span className="muted small block">{s.body}</span></span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
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
