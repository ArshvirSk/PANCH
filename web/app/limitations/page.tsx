import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../components/PageHeader';
import { SAMPLE_RULING_HREF } from '../../lib/samples';

export const metadata: Metadata = {
  title: 'Limitations',
  description: 'What Panch does not do yet, in plain language.',
};

/**
 * Honest limitations (sources: docs/SECURITY.md "Known gaps", LOG.md phases 10, 11,
 * 17 and 22). Plain statements only; keep this in step with those documents.
 */
const LIMITATIONS: { title: string; body: string }[] = [
  {
    title: 'The escrow is simulated',
    body: 'No real money is held or moved. Funding, disputes and payouts are recorded in a hash-chained ledger so they can be checked, but the funds themselves are pretend. Panch is arbitration by consent, not a court, and nothing here is legal advice or enforceable in any country.',
  },
  {
    title: 'There is no appeal window',
    body: 'Once the panel or a reviewer decides, the simulated escrow settles straight away. The 72-hour appeal window in the product plan is not built.',
  },
  {
    title: 'A silent respondent is not timed out',
    body: 'If the other side never responds, the case is flagged as overdue after its evidence deadline, but Panch does not decide it automatically. Deciding against a party for silence is a product rule we have not set.',
  },
  {
    title: 'Any signed-in account can act as a reviewer',
    body: 'Escalated cases go to a human review queue that any signed-in user can open and decide. There is no separate reviewer role or vetting yet. The queue withholds party identities and warns a reviewer who is a party to the case, but it does not stop them.',
  },
  {
    title: 'Judges vary from run to run',
    body: 'The same case can get different awards on different runs, mostly from the Amazon Nova judge. About 40% of demo runs have escalated to human review instead of publishing a ruling. Escalating is the intended safety behaviour when judges disagree, but it means one run is not a guarantee of the next.',
  },
  {
    title: 'The swap test has blind spots',
    body: 'The swap test reruns each judge with the parties mirrored and checks that the award inverts. The panel-level check compares medians, so one judge contradicting itself can be absorbed by the other two. The review queue shows each judge\'s swap result for this reason. Telling a model the roles are reversed can also push it toward a more literal reading of the contract, so the test measures bias imperfectly.',
  },
  {
    title: 'Cases have no written summary',
    body: 'A case stores its parties, amount, currency and dates, but no description of the dispute. Reviewers and readers rely on the judges\' reasoning and the evidence to understand what happened.',
  },
  {
    title: 'Human rulings restate no findings',
    body: 'When a reviewer settles an escalated case, the published ruling carries the reviewer\'s reasons and award, but not a list of findings or clauses. The judges\' full record stays with the case.',
  },
  {
    title: 'Some rulings cannot be fully verified yet',
    body: 'Anyone can verify a ruling from its page, which recomputes the ruling\'s hash and the ledger chain. It reports a failure when it finds one rather than hiding it. Rulings published before hashing existed cannot be content-checked, and a ledger bug that broke the chain for cases funded and disputed through the full flow has been fixed — cases decided before the fix still fail verification and say so.',
  },
  {
    title: 'Failed demo runs show a cached fallback',
    body: 'If the tribunal cannot finish a demo run, the ruling page shows a pre-written fallback, labelled as such. It is not a ruling, awards nothing and never touches the escrow. Since 29 September 2026, Amazon Bedrock model access has been blocked on the project\'s AWS account, so every live run ends this way until it is restored. A failed re-run never replaces a ruling that was already published. The published rulings from earlier runs are real.',
  },
  {
    title: 'All data is synthetic',
    body: 'Every demo case, contract, chat log, invoice and benchmark case was written for testing. No real people, businesses or disputes appear anywhere. Benchmark results will be published with their misses, not only their hits.',
  },
];

export default function LimitationsPage() {
  return (
    <div className="container page stack-lg">
      <PageHeader
        eyebrow="Honest limitations"
        title="What Panch does not do yet"
        description="Panch is a hackathon build. These are the gaps we know about, stated plainly so nobody has to find them the hard way."
      />
      <ol className="limitations" data-testid="limitations">
        {LIMITATIONS.map((item, i) => (
          <li key={item.title} className="card limitation">
            <h2 className="h3"><span className="numeral">{i + 1}.</span> {item.title}</h2>
            <p>{item.body}</p>
          </li>
        ))}
      </ol>
      <p className="muted small">
        Security notes live in the repository&apos;s <code>docs/SECURITY.md</code>. <Link href={SAMPLE_RULING_HREF}>See a sample ruling</Link> or <Link href="/#demo">run the demo</Link>.
      </p>
    </div>
  );
}
