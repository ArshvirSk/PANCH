import Link from 'next/link';
import { ApiStatus } from './ApiStatus';
import { Logo } from './Logo';

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Logo />
          <p>Reasoned, published decisions for small cross-border disputes that no court will hear.</p>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <p className="footer-heading">Product</p>
          <Link href="/#how">How it works</Link>
          <Link href="/#demo">Run the demo</Link>
          <Link href="/ruling/?id=c-104">Sample ruling</Link>
        </nav>
        <nav className="footer-links" aria-label="Account">
          <p className="footer-heading">Account</p>
          <Link href="/login/">Sign in</Link>
          <Link href="/login/?mode=signUp">Create account</Link>
          <Link href="/cases/">My cases</Link>
        </nav>
      </div>
      <div className="container footer-bottom">
        <p>Arbitration by consent on simulated funds. Demo data is synthetic. Not legal advice.</p>
        <ApiStatus />
      </div>
    </footer>
  );
}
