import Link from 'next/link';
import { Icon } from '../components/Icon';

export default function NotFound() {
  return (
    <div className="container section-sm">
      <div className="card narrow center-text stack">
        <span className="empty-icon"><Icon name="search" size={26} /></span>
        <p className="eyebrow">Error 404</p>
        <h1 className="h2">Page not found</h1>
        <p className="muted">That page does not exist, or the link is incomplete.</p>
        <div className="row center wrap">
          <Link href="/" className="btn btn-primary">Go to the home page</Link>
          <Link href="/ruling/?id=c-104" className="btn btn-ghost">See a sample ruling</Link>
        </div>
      </div>
    </div>
  );
}
