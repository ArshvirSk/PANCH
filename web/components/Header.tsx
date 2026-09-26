'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';

export function Header() {
  const { status, user, signOut } = useAuth();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push('/');
  }

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand" aria-label="Panch home">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>Panch</span>
        </Link>
        <nav className="nav" aria-label="Main">
          <Link href="/#demo">Demo</Link>
          <Link href="/ruling/?id=c-104">Sample ruling</Link>
          {status === 'signedIn' && <Link href="/cases/">My cases</Link>}
          {status === 'signedIn' ? (
            <span className="nav-user">
              <span className="nav-email" title={user?.email}>{user?.email}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleSignOut}>
                Sign out
              </button>
            </span>
          ) : status === 'signedOut' ? (
            <Link href="/login/" className="btn btn-primary btn-sm">Sign in</Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
