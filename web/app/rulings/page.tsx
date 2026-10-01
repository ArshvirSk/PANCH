import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../components/PageHeader';
import { RulingsGallery } from '../../components/RulingsGallery';
import { SAMPLE_RULING_HREF } from '../../lib/samples';

export const metadata: Metadata = {
  title: 'Published rulings',
  description: 'Every ruling Panch has published, with a hash and escrow ledger anyone can verify.',
};

/**
 * The public ruling gallery (PRD section 5 ship gate). No login: it lists
 * `GET /rulings`, which reads the Rulings table, and each row opens the ruling
 * page where the reasoning, citations and verification live.
 */
export default function RulingsPage() {
  return (
    <div className="container page stack-lg">
      <PageHeader
        eyebrow="Public record"
        title="Published rulings"
        description="Every case the panel or a human reviewer has settled, newest first. Rulings are public by design and carry no party names, countries or platforms — the judges never saw them either."
        actions={<Link href={SAMPLE_RULING_HREF} className="btn btn-secondary btn-sm">See a sample ruling</Link>}
      />
      <RulingsGallery />
    </div>
  );
}
