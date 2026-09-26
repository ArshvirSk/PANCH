'use client';

import Link from 'next/link';
import { useAuth } from '../lib/auth';
import { DemoRunner } from '../components/DemoRunner';

const STEPS = [
  {
    title: 'Agree and fund',
    body: 'Both sides accept Panch arbitration when they sign the deal. The client funds a simulated escrow.',
  },
  {
    title: 'Submit evidence',
    body: 'If something goes wrong, either side opens a dispute and uploads the contract, chat logs and invoices.',
  },
  {
    title: 'The panel deliberates',
    body: 'Three judges from different AI model families rule blind, cross-examine each other, and face a swap test for bias.',
  },
  {
    title: 'Published ruling',
    body: 'The presiding judge writes a reasoned ruling that cites the evidence. Its hash is published and escrow settles.',
  },
];

export default function HomePage() {
  const { status } = useAuth();
  const startHref = status === 'signedIn' ? '/cases/new/' : '/login/?next=%2Fcases%2Fnew%2F';

  return (
    <>
      <section className="hero">
        <p className="eyebrow">AI arbitration by consent</p>
        <h1>The AI panchayat for disputes no court will hear.</h1>
        <p className="lead">
          A freelancer in Mumbai finishes $400 of work for a client in Berlin, and the client stops paying. A
          lawyer costs more than the claim. Panch gives both sides a fair, fast, reasoned decision.
        </p>
        <div className="hero-actions">
          <Link href={startHref} className="btn btn-primary btn-lg">Open a case</Link>
          <Link href="#demo" className="btn btn-secondary btn-lg">Try the demo</Link>
        </div>
      </section>

      <section className="section" aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol className="steps">
          {STEPS.map((step, i) => (
            <li key={step.title} className="card step">
              <span className="step-number" aria-hidden="true">{i + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section card demo-card" id="demo" aria-labelledby="demo-title">
        <h2 id="demo-title">Run a demo case</h2>
        <p>
          Start a pre-seeded dispute and follow it to a ruling. No account needed. All parties and documents are
          synthetic.
        </p>
        <DemoRunner />
      </section>

      <section className="section" aria-labelledby="fair">
        <h2 id="fair">Built to be fair</h2>
        <ul className="grid-3">
          <li className="card">
            <h3>Blind judging</h3>
            <p>Names, countries and platforms become “Claimant” and “Respondent” before any judge reads the case.</p>
          </li>
          <li className="card">
            <h3>Swap test</h3>
            <p>The case is re-run with the parties swapped. If the winner flips, a human reviews it.</p>
          </li>
          <li className="card">
            <h3>Cited findings</h3>
            <p>Every finding must cite an evidence ID. Findings without one are dropped from the ruling.</p>
          </li>
        </ul>
      </section>
    </>
  );
}
