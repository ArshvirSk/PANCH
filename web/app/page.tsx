'use client';

import Link from 'next/link';
import { useAuth } from '../lib/auth';
import { DemoRunner } from '../components/DemoRunner';
import { Icon, type IconName } from '../components/Icon';
import { RulingPreview } from '../components/RulingPreview';

const STEPS: { title: string; body: string; icon: IconName }[] = [
  { title: 'Agree and fund', icon: 'wallet', body: 'Both sides accept Panch arbitration when they make the deal. The client funds a simulated escrow.' },
  { title: 'Submit evidence', icon: 'upload', body: 'If something goes wrong, either side opens a dispute and uploads the contract, chat logs and invoices.' },
  { title: 'The panel deliberates', icon: 'users', body: 'Three judges from different AI model families rule blind, then cross-examine each other’s reasoning.' },
  { title: 'Published ruling', icon: 'gavel', body: 'A presiding judge writes a reasoned award that cites the evidence. It is hashed, published and settled.' },
];

const SAFEGUARDS: { title: string; body: string; icon: IconName }[] = [
  { title: 'Blind judging', icon: 'eye-off', body: 'Names, countries and platforms become “Claimant” and “Respondent” before any judge reads the case.' },
  { title: 'Model diversity', icon: 'cpu', body: 'Each judge comes from a different model family, so one model’s blind spots cannot decide a case alone.' },
  { title: 'Cross-examination', icon: 'message', body: 'Judges must name concrete errors in each other’s rulings: misread clauses, unsupported inferences.' },
  { title: 'Swap test', icon: 'shuffle', body: 'The case is re-run with the parties swapped. If the winner flips, a human reviewer decides.' },
  { title: 'Cited findings', icon: 'file', body: 'Every finding must cite an evidence ID. Findings without one are dropped from the award.' },
  { title: 'Verifiable award', icon: 'hash', body: 'Each ruling is published with a SHA-256 hash, and every escrow event is hash-chained.' },
];

const PANEL = [
  { role: 'Judge I', detail: 'Independent ruling', family: 'Model family A' },
  { role: 'Judge II', detail: 'Independent ruling', family: 'Model family B' },
  { role: 'Judge III', detail: 'Independent ruling', family: 'Model family C' },
  { role: 'Presiding judge', detail: 'Writes the reasoned award', family: 'Strongest available model' },
  { role: 'Bias auditor', detail: 'Swap test and spread check', family: 'Escalates to a human' },
];

const FAQ = [
  {
    q: 'Is a Panch ruling legally binding?',
    a: 'Panch is arbitration by consent: both parties agree to it when they make the deal. It does not replace courts and makes no claim of enforceability in any specific jurisdiction. This demo runs on simulated funds.',
  },
  {
    q: 'What happens if the judges disagree?',
    a: 'If the judges’ awards are too far apart, or the swap test flips the winner, the case is escalated to a human reviewer with the full panel record instead of being auto-resolved.',
  },
  {
    q: 'Can someone game the AI with hidden instructions in their evidence?',
    a: 'Evidence is treated as untrusted data, never as instructions. It is screened for prompt-injection attempts before any judge sees it, and every finding must cite a specific piece of evidence.',
  },
  {
    q: 'What disputes does Panch handle?',
    a: 'Small cross-border freelance disputes up to 5,000: non-payment, scope creep, missed deadlines, quality disagreements, partial delivery and similar.',
  },
];

export default function HomePage() {
  const { status } = useAuth();
  const startHref = status === 'signedIn' ? '/cases/new/' : '/login/?mode=signUp&next=%2Fcases%2Fnew%2F';

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-glow" aria-hidden="true" />
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="hero-pill"><Icon name="sparkles" size={14} /> AI arbitration by consent</p>
            <h1 id="hero-title">
              The AI panchayat for disputes <em>no court will hear.</em>
            </h1>
            <p className="hero-lead">
              A freelancer in Mumbai finishes $400 of work for a client in Berlin, and the client stops paying. A lawyer
              costs more than the claim. Panch gives both sides a fair, fast, reasoned decision.
            </p>
            <div className="hero-actions">
              <Link href={startHref} className="btn btn-primary btn-lg">
                Open a case <Icon name="arrow-right" size={16} />
              </Link>
              <Link href="#demo" className="btn btn-on-dark btn-lg">
                <Icon name="play" size={15} /> Watch the demo case
              </Link>
            </div>
            <ul className="hero-trust">
              <li><Icon name="check" size={15} /> No login needed for the demo</li>
              <li><Icon name="check" size={15} /> Synthetic data, simulated escrow</li>
            </ul>
          </div>
          <RulingPreview />
        </div>
      </section>

      <section className="stats" aria-label="Design targets">
        <div className="container stats-grid">
          <div><p className="stat-value">3</p><p className="stat-label">independent model families</p></div>
          <div><p className="stat-value">2</p><p className="stat-label">rounds of cross-examination</p></div>
          <div><p className="stat-value">&lt; 5 min</p><p className="stat-label">target, dispute to ruling</p></div>
          <div><p className="stat-value">&lt; $1</p><p className="stat-label">target cost per case</p></div>
        </div>
      </section>

      <section className="section" id="how" aria-labelledby="how-title">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">How it works</p>
            <h2 id="how-title">From broken promise to published award</h2>
            <p className="section-lead">Four steps, all visible to both parties, with every decision explained.</p>
          </div>
          <ol className="steps">
            {STEPS.map((step, i) => (
              <li key={step.title} className="step-card">
                <span className="step-top">
                  <span className="step-icon"><Icon name={step.icon} size={20} /></span>
                  <span className="step-number">0{i + 1}</span>
                </span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section section-alt" aria-labelledby="panel-title">
        <div className="container panel-grid">
          <div className="section-head left">
            <p className="eyebrow">The panel of five</p>
            <h2 id="panel-title">A panchayat, rebuilt for the internet</h2>
            <p className="section-lead">
              The panchayat is the traditional council of five that settles disputes by open deliberation. Panch keeps the
              idea: five roles, each checking the others, and a decision anyone can read.
            </p>
          </div>
          <ol className="panel-list">
            {PANEL.map((p, i) => (
              <li key={p.role} className={i === 3 ? 'panel-seat panel-seat-lead' : 'panel-seat'}>
                <span className="panel-index">{i + 1}</span>
                <span className="panel-text">
                  <strong>{p.role}</strong>
                  <span className="muted small">{p.detail}</span>
                </span>
                <span className="panel-family">{p.family}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" aria-labelledby="fair-title">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">Safeguards</p>
            <h2 id="fair-title">Built to be fair, and to show its work</h2>
          </div>
          <ul className="feature-grid">
            {SAFEGUARDS.map((f) => (
              <li key={f.title} className="feature">
                <span className="feature-icon"><Icon name={f.icon} size={20} /></span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" id="demo" aria-labelledby="demo-title">
        <div className="container">
          <div className="demo-band">
            <div className="demo-copy">
              <p className="eyebrow eyebrow-on-dark">Live demo</p>
              <h2 id="demo-title">Run a demo case end to end</h2>
              <p>
                Start a pre-seeded dispute and follow it to a published ruling. No account needed. Every party and document is
                synthetic.
              </p>
            </div>
            <DemoRunner />
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="faq-title">
        <div className="container faq-grid">
          <div className="section-head left">
            <p className="eyebrow">Questions</p>
            <h2 id="faq-title">What people ask first</h2>
          </div>
          <div className="faq">
            {FAQ.map((item) => (
              <details key={item.q} className="faq-item">
                <summary>{item.q}<Icon name="plus" size={18} className="faq-icon" /></summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
