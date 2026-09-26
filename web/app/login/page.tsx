'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { PASSWORD_RULES, authErrorMessage, passwordProblems, safeNextPath } from '../../lib/authErrors';
import { isAuthConfigured } from '../../lib/config';
import { isValidEmail } from '../../lib/format';
import { Icon } from '../../components/Icon';
import { LogoMark } from '../../components/Logo';
import { Notice } from '../../components/Notice';
import { ButtonSpinner, Spinner } from '../../components/Spinner';

type Mode = 'signIn' | 'signUp' | 'confirm';

function LoginForm() {
  const { status, signIn, signUp, confirmCode, resendCode } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));

  const [mode, setMode] = useState<Mode>(searchParams.get('mode') === 'signUp' ? 'signUp' : 'signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (status === 'signedIn') router.replace(next);
  }, [status, next, router]);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError('');
    setInfo('');
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await action();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function validateCredentials(checkStrength: boolean): string {
    if (!isValidEmail(email)) return 'Enter a valid email address.';
    if (!password) return 'Enter your password.';
    if (checkStrength) {
      const problems = passwordProblems(password);
      if (problems.length) return `Your password needs ${problems.join(', ')}.`;
    }
    return '';
  }

  function handleSignIn(event: FormEvent) {
    event.preventDefault();
    const problem = validateCredentials(false);
    if (problem) return setError(problem);
    void run(async () => {
      const step = await signIn(email, password);
      if (step === 'confirm') {
        switchMode('confirm');
        setInfo('Your email is not confirmed yet. Enter the code we sent you, or request a new one.');
      }
    });
  }

  function handleSignUp(event: FormEvent) {
    event.preventDefault();
    const problem = validateCredentials(true);
    if (problem) return setError(problem);
    void run(async () => {
      const step = await signUp(email, password);
      if (step === 'confirm') {
        switchMode('confirm');
        setInfo(`We emailed a 6-digit verification code to ${email.trim()}.`);
      } else {
        await signIn(email, password);
      }
    });
  }

  function handleConfirm(event: FormEvent) {
    event.preventDefault();
    if (!isValidEmail(email)) return setError('Enter the email you signed up with.');
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the email.');
    void run(async () => {
      await confirmCode(email, code);
      if (password) {
        // Signing in right away saves the user retyping what they just chose.
        await signIn(email, password);
      } else {
        switchMode('signIn');
        setInfo('Email confirmed. Sign in to continue.');
      }
    });
  }

  function handleResend() {
    if (!isValidEmail(email)) return setError('Enter your email first.');
    void run(async () => {
      await resendCode(email);
      setInfo(`A new code is on its way to ${email.trim()}.`);
    });
  }

  if (!isAuthConfigured) {
    return (
      <Notice tone="error" title="Sign-in is not configured">
        This build has no Cognito settings. The demo and public rulings still work without an account.
      </Notice>
    );
  }
  if (status === 'loading' || status === 'signedIn') return <Spinner label="Checking your session…" />;

  const heading = mode === 'confirm' ? 'Confirm your email' : mode === 'signIn' ? 'Welcome back' : 'Create your account';
  const subheading =
    mode === 'confirm'
      ? 'Enter the 6-digit code we emailed you.'
      : mode === 'signIn'
        ? 'Sign in to open a case or respond to one.'
        : 'Free to try. Everything here runs on simulated funds.';

  return (
    <div className="auth-card">
      <div className="auth-card-head">
        <h1 className="h2">{heading}</h1>
        <p className="muted">{subheading}</p>
      </div>

      {mode !== 'confirm' && (
        <div className="tabs" role="tablist" aria-label="Account">
          <button type="button" role="tab" aria-selected={mode === 'signIn'} className={mode === 'signIn' ? 'tab active' : 'tab'} onClick={() => switchMode('signIn')}>
            Sign in
          </button>
          <button type="button" role="tab" aria-selected={mode === 'signUp'} className={mode === 'signUp' ? 'tab active' : 'tab'} onClick={() => switchMode('signUp')}>
            Create account
          </button>
        </div>
      )}

      {mode === 'confirm' ? (
        <form className="stack" onSubmit={handleConfirm} noValidate>
          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} required />
          </label>
          <label className="field">
            <span className="field-label">Verification code</span>
            <input
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              disabled={busy}
              required
              data-testid="confirm-code"
            />
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy && <ButtonSpinner />}
            {busy ? 'Confirming…' : 'Confirm and continue'}
          </button>
          <div className="row-between">
            <button type="button" className="link-button" onClick={handleResend} disabled={busy}>Send a new code</button>
            <button type="button" className="link-button" onClick={() => switchMode('signIn')} disabled={busy}>Back to sign in</button>
          </div>
        </form>
      ) : (
        <form className="stack" onSubmit={mode === 'signIn' ? handleSignIn : handleSignUp} noValidate>
          <label className="field">
            <span className="field-label">Email</span>
            <span className="input-icon">
              <Icon name="mail" size={17} />
              <input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} required data-testid="email" />
            </span>
          </label>
          <div className="field">
            <label className="field-label" htmlFor="password">Password</label>
            <span className="input-icon">
              <Icon name="lock" size={17} />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
                aria-describedby={mode === 'signUp' ? 'password-rules' : undefined}
                data-testid="password"
              />
              <button type="button" className="input-action" onClick={() => setShowPassword((s) => !s)} aria-pressed={showPassword} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </span>
            {mode === 'signUp' && (
              <ul className="password-rules" id="password-rules" aria-label="Password requirements">
                {PASSWORD_RULES.map((rule) => {
                  const met = rule.test(password);
                  return (
                    <li key={rule.label} className={met ? 'met' : undefined}>
                      <Icon name={met ? 'check-circle' : 'info'} size={14} />
                      {rule.label}
                      <span className="sr-only">{met ? ' (met)' : ' (not met)'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy} data-testid="auth-submit">
            {busy && <ButtonSpinner />}
            {busy ? 'Please wait…' : mode === 'signIn' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      )}

      <div aria-live="polite">
        {error && <Notice tone="error">{error}</Notice>}
        {info && <Notice tone="info">{info}</Notice>}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="auth-layout">
      <aside className="auth-aside" aria-hidden="true">
        <div className="auth-aside-inner">
          <LogoMark size={44} />
          <p className="auth-quote">“Five voices, one reasoned decision, and nothing hidden.”</p>
          <ul className="auth-points">
            <li><Icon name="users" size={18} /> Three judges from different model families</li>
            <li><Icon name="shuffle" size={18} /> Swap-tested for bias before any award</li>
            <li><Icon name="hash" size={18} /> Published rulings you can verify</li>
          </ul>
        </div>
      </aside>
      <div className="auth-main">
        <Suspense fallback={<Spinner />}>
          <LoginForm />
        </Suspense>
        <p className="muted small center-text">
          Just looking? <Link href="/#demo">Run the demo</Link> without an account.
        </p>
      </div>
    </div>
  );
}
