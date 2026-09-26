'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { Icon } from './Icon';
import { Logo } from './Logo';

function initialOf(email: string | undefined): string {
  return (email?.trim()[0] ?? '?').toUpperCase();
}

export function Header() {
  const { status, user, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu whenever the route changes.
  useEffect(() => setMenuOpen(false), [pathname]);

  async function handleSignOut() {
    setMenuOpen(false);
    await signOut();
    router.push('/');
  }

  const isActive = (href: string) => (href === '/cases/' ? pathname.startsWith('/case') : pathname === href);

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand" aria-label="Panch home">
          <Logo />
        </Link>

        <button
          type="button"
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="site-nav"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name={menuOpen ? 'x' : 'menu'} size={22} />
        </button>

        <nav id="site-nav" className={menuOpen ? 'nav nav-open' : 'nav'} aria-label="Main">
          <Link href="/#how" className="nav-link">How it works</Link>
          <Link href="/#demo" className="nav-link">Demo</Link>
          <Link href="/ruling/?id=c-104" className={`nav-link${pathname === '/ruling/' ? ' active' : ''}`}>Sample ruling</Link>
          {status === 'signedIn' && (
            <Link href="/cases/" className={`nav-link${isActive('/cases/') ? ' active' : ''}`}>My cases</Link>
          )}
          <span className="nav-divider" aria-hidden="true" />
          {status === 'signedIn' ? (
            <span className="nav-user">
              <span className="avatar" aria-hidden="true">{initialOf(user?.email)}</span>
              <span className="nav-email" title={user?.email}>{user?.email}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleSignOut}>
                <Icon name="log-out" size={16} />
                Sign out
              </button>
            </span>
          ) : status === 'signedOut' ? (
            <span className="nav-user">
              <Link href="/login/" className="nav-link">Sign in</Link>
              <Link href="/login/?mode=signUp" className="btn btn-primary btn-sm">Get started</Link>
            </span>
          ) : (
            <span className="nav-user nav-user-loading" aria-hidden="true" />
          )}
        </nav>
      </div>
    </header>
  );
}
