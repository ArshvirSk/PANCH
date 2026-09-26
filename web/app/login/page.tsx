'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { authErrorMessage, passwordProblems, safeNextPath } from '../../lib/authErrors';
import { isAuthConfigured } from '../../lib/config';
import { isValidEmail } from '../../lib/format';
import { Notice } from '../../components/Notice';
import { Spinner } from '../../components/Spinner';

type Mode = 'signIn' | 'signUp' | 'confirm';

function LoginForm() {
  const { status, signIn, signUp, confirmCode, resendCode } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));

  const [mode, setMode] = useState<Mode>(searchParams.get('mode') === 'signUp' ? 'signUp' : 'signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
        setInfo(`We emailed a verification code to ${email.trim()}.`);
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

  return (
    <div className="auth-card card">
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
          <h1 className="h2">Confirm your email</h1>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} required />
          </label>
          <label className="field">
            <span>Verification code</span>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} disabled={busy} required data-testid="confirm-code" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Confirming…' : 'Confirm and continue'}</button>
          <div className="row-between">
            <button type="button" className="link-button" onClick={handleResend} disabled={busy}>Send a new code</button>
            <button type="button" className="link-button" onClick={() => switchMode('signIn')} disabled={busy}>Back to sign in</button>
          </div>
        </form>
      ) : (
        <form className="stack" onSubmit={mode === 'signIn' ? handleSignIn : handleSignUp} noValidate>
          <h1 className="h2">{mode === 'signIn' ? 'Welcome back' : 'Create your Panch account'}</h1>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} required data-testid="email" />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              required
              data-testid="password"
            />
            {mode === 'signUp' && (
              <small className="muted">At least 8 characters with upper and lower case letters, a number and a symbol.</small>
            )}
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="auth-submit">
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
    <Suspense fallback={<Spinner />}>
      <LoginForm />
    </Suspense>
  );
}
