'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Icon } from '../components/Icon';

/** Last-resort boundary: an unexpected render error shows this instead of a blank page. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container section-sm">
      <div className="card narrow center-text stack">
        <span className="empty-icon empty-icon-danger"><Icon name="alert" size={26} /></span>
        <h1 className="h2">Something went wrong</h1>
        <p className="muted">An unexpected error stopped this page from loading. Your case data is safe on the server.</p>
        <div className="row center wrap">
          <button type="button" className="btn btn-primary" onClick={reset}>
            <Icon name="refresh" size={16} /> Try again
          </button>
          <Link href="/" className="btn btn-ghost">Go home</Link>
        </div>
      </div>
    </div>
  );
}
