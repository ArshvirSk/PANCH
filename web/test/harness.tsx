/**
 * Shared mocks for component tests: a controllable useAuth() and next/navigation.
 * Each test file calls vi.mock('../lib/auth', ...) and vi.mock('next/navigation', ...)
 * with these factories so pages render without Amplify or the Next router.
 */
import { vi } from 'vitest';
import type { ApiClient } from '../lib/api';
import type { SessionUser } from '../lib/caseLogic';
import type { Case } from '../lib/types';

export const RIYA: SessionUser = { sub: 'sub-riya', email: 'riya@example.com' };
export const KLAUS: SessionUser = { sub: 'sub-klaus', email: 'klaus@example.com' };
export const EVE: SessionUser = { sub: 'sub-eve', email: 'eve@example.com' };

export function makeCase(overrides: Partial<Case> = {}): Case {
  return {
    caseId: 'c-1234abcd',
    status: 'CREATED',
    claimantId: RIYA.sub,
    respondentId: KLAUS.email,
    amountCents: 40000,
    currency: 'USD',
    createdAt: '2026-09-25T10:00:00Z',
    ...overrides,
  };
}

export function mockApi(overrides: Partial<Record<keyof ApiClient, unknown>> = {}) {
  return {
    health: vi.fn().mockResolvedValue({ ok: true }),
    createCase: vi.fn(),
    getCase: vi.fn(),
    fundCase: vi.fn(),
    disputeCase: vi.fn(),
    requestEvidenceUpload: vi.fn(),
    uploadToPresignedUrl: vi.fn(),
    submitCase: vi.fn(),
    getRuling: vi.fn(),
    runDemo: vi.fn(),
    ...overrides,
  } as unknown as { [K in keyof ApiClient]: ReturnType<typeof vi.fn> };
}

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  user?: SessionUser;
  api: ReturnType<typeof mockApi>;
  signIn: ReturnType<typeof vi.fn>;
  signUp: ReturnType<typeof vi.fn>;
  confirmCode: ReturnType<typeof vi.fn>;
  resendCode: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
}

export const auth: { current: AuthState } = { current: freshAuth() };

export function freshAuth(partial: Partial<AuthState> = {}): AuthState {
  return {
    status: 'signedIn',
    user: RIYA,
    api: mockApi(),
    signIn: vi.fn().mockResolvedValue('done'),
    signUp: vi.fn().mockResolvedValue('confirm'),
    confirmCode: vi.fn().mockResolvedValue(undefined),
    resendCode: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...partial,
  };
}

export const nav = {
  push: vi.fn(),
  replace: vi.fn(),
  pathname: '/',
  search: new URLSearchParams(),
};

export function setSearch(query: string, pathname = nav.pathname) {
  nav.search = new URLSearchParams(query);
  nav.pathname = pathname;
}

export const authModule = () => ({
  useAuth: () => auth.current,
  AuthProvider: ({ children }: { children: unknown }) => children,
});

export const navigationModule = () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.search,
});

export const configModule = () => ({
  appConfig: { apiUrl: 'https://api.test/prod/', userPoolId: 'us-east-1_x', userPoolClientId: 'c' },
  missingConfig: [],
  isAuthConfigured: true,
});
