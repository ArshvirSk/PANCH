'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Amplify } from 'aws-amplify';
import {
  confirmSignUp,
  fetchAuthSession,
  resendSignUpCode,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  signUp as amplifySignUp,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { appConfig, isAuthConfigured } from './config';
import { createApiClient, type ApiClient } from './api';
import type { SessionUser } from './caseLogic';
import { normalizeEmail } from './format';

if (isAuthConfigured) {
  // The region is derived from the user pool ID, so it is not configured separately.
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: appConfig.userPoolId,
        userPoolClientId: appConfig.userPoolClientId,
        loginWith: { email: true },
        signUpVerificationMethod: 'code',
      },
    },
  });
}

/**
 * The AuthStack app client enables USER_PASSWORD_AUTH but not SRP, which is
 * Amplify's default, so every sign-in must ask for this flow explicitly.
 */
const AUTH_FLOW = 'USER_PASSWORD_AUTH' as const;

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

/** 'confirm' means Cognito needs the emailed verification code first. */
export type AuthStep = 'done' | 'confirm';

interface AuthContextValue {
  status: AuthStatus;
  user?: SessionUser;
  api: ApiClient;
  signIn(email: string, password: string): Promise<AuthStep>;
  signUp(email: string, password: string): Promise<AuthStep>;
  confirmCode(email: string, code: string): Promise<void>;
  resendCode(email: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function currentIdToken(): Promise<string | undefined> {
  if (!isAuthConfigured) return undefined;
  try {
    // Refreshes the tokens automatically when they are close to expiry.
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString();
  } catch {
    return undefined;
  }
}

async function loadUser(): Promise<SessionUser | undefined> {
  if (!isAuthConfigured) return undefined;
  try {
    const session = await fetchAuthSession();
    const payload = session.tokens?.idToken?.payload;
    if (!payload || typeof payload.sub !== 'string') return undefined;
    return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : '' };
  } catch {
    return undefined;
  }
}

function errorName(err: unknown): string {
  return err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | undefined>();

  const refresh = useCallback(async () => {
    const next = await loadUser();
    setUser(next);
    setStatus(next ? 'signedIn' : 'signedOut');
  }, []);

  useEffect(() => {
    void refresh();
    const stop = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn' || payload.event === 'signedOut' || payload.event === 'tokenRefresh_failure') {
        void refresh();
      }
    });
    return stop;
  }, [refresh]);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: appConfig.apiUrl,
        getIdToken: currentIdToken,
        onUnauthorized: () => {
          // A rejected token cannot be recovered in place. Clear it so pages send the user to sign in.
          void amplifySignOut().catch(() => undefined).finally(() => {
            setUser(undefined);
            setStatus('signedOut');
          });
        },
      }),
    [],
  );

  const signIn = useCallback(async (email: string, password: string): Promise<AuthStep> => {
    try {
      const result = await amplifySignIn({
        username: normalizeEmail(email),
        password,
        options: { authFlowType: AUTH_FLOW },
      });
      if (result.nextStep.signInStep === 'CONFIRM_SIGN_UP') return 'confirm';
      if (!result.isSignedIn) {
        throw new Error(`This account needs an extra step (${result.nextStep.signInStep}) that Panch does not support yet.`);
      }
    } catch (err) {
      if (errorName(err) === 'UserNotConfirmedException') return 'confirm';
      if (errorName(err) !== 'UserAlreadyAuthenticatedException') throw err;
    }
    await refresh();
    return 'done';
  }, [refresh]);

  const signUp = useCallback(async (email: string, password: string): Promise<AuthStep> => {
    const username = normalizeEmail(email);
    const result = await amplifySignUp({
      username,
      password,
      options: { userAttributes: { email: username } },
    });
    return result.nextStep.signUpStep === 'CONFIRM_SIGN_UP' ? 'confirm' : 'done';
  }, []);

  const confirmCode = useCallback(async (email: string, code: string) => {
    await confirmSignUp({ username: normalizeEmail(email), confirmationCode: code.trim() });
  }, []);

  const resendCode = useCallback(async (email: string) => {
    await resendSignUpCode({ username: normalizeEmail(email) });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await amplifySignOut();
    } finally {
      setUser(undefined);
      setStatus('signedOut');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, api, signIn, signUp, confirmCode, resendCode, signOut }),
    [status, user, api, signIn, signUp, confirmCode, resendCode, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
