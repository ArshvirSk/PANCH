import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="narrow stack">
      <h1>Page not found</h1>
      <p className="muted">That page does not exist.</p>
      <p><Link href="/" className="btn btn-primary">Go to the home page</Link></p>
    </div>
  );
}
