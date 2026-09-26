'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../lib/auth';
import { isAuthConfigured } from '../lib/config';
import { Notice } from './Notice';
import { Spinner } from './Spinner';

/** Renders children only for a signed-in user; otherwise sends them to /login/ and back. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (status !== 'signedOut' || !isAuthConfigured) return;
    const query = searchParams.toString();
    const next = `${pathname}${query ? `?${query}` : ''}`;
    router.replace(`/login/?next=${encodeURIComponent(next)}`);
  }, [status, pathname, searchParams, router]);

  if (!isAuthConfigured) {
    return (
      <Notice tone="error" title="Sign-in is not configured">
        This build is missing the Cognito settings, so signed-in pages are unavailable. The demo and
        public rulings still work.
      </Notice>
    );
  }
  if (status !== 'signedIn') return <Spinner label="Checking your session…" />;
  return <>{children}</>;
}
