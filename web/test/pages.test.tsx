// @vitest-environment jsdom
// next/link only adds the trailing slash when the Next config is loaded (real builds); unit tests accept both.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { KLAUS, RIYA, auth, freshAuth, makeCase, nav, setSearch } from './harness';

vi.mock('../lib/auth', async () => (await import('./harness')).authModule());
vi.mock('next/navigation', async () => (await import('./harness')).navigationModule());
vi.mock('../lib/config', async () => (await import('./harness')).configModule());

const { default: NewCasePage } = await import('../app/cases/new/page');
const { default: CasesPage } = await import('../app/cases/page');
const { default: RulingPage } = await import('../app/ruling/page');
const { DemoRunner } = await import('../components/DemoRunner');
const { Header } = await import('../components/Header');

beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
  auth.current = freshAuth();
});

const RULING = {
  findingsOfFact: [{ fact: 'Work delivered on time', evidenceIds: ['e-2', 'e-3'] }],
  clausesRelied: [{ clauseRef: '3.1', interpretation: 'Payment upon delivery' }],
  payeeShareBps: 10000,
  reasoning: 'The claimant delivered as specified.',
  confidence: 0.95,
  uncertainties: [],
};

describe('new case', () => {
  const fill = async (email: string, amount: string) => {
    const user = userEvent.setup();
    render(<NewCasePage />);
    await user.type(screen.getByTestId('respondent-email'), email);
    await user.clear(screen.getByTestId('amount'));
    if (amount) await user.type(screen.getByTestId('amount'), amount);
    return user;
  };

  it('creates with a normalized payload and opens the case', async () => {
    auth.current.api.createCase.mockResolvedValue(makeCase({ caseId: 'c-new1' }));
    const user = await fill('  Klaus@Example.COM ', '1,250.50');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'EUR');
    expect(screen.getByText('€1,250.50')).toBeInTheDocument(); // live preview
    await user.click(screen.getByTestId('create-case'));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/case/?id=c-new1'));
    expect(auth.current.api.createCase).toHaveBeenCalledWith({ respondentEmail: 'klaus@example.com', amountCents: 125050, currency: 'EUR' });
    expect(JSON.parse(localStorage.getItem(`panch:recent:${RIYA.sub}`)!)[0]).toMatchObject({ caseId: 'c-new1', role: 'claimant' });
  });

  it.each([
    ['not-an-email', '400', "Enter the client's email address."],
    ['RIYA@example.com', '400', 'The respondent must be someone else'],
    ['klaus@example.com', '', 'Enter an amount.'],
    ['klaus@example.com', '0', 'greater than zero'],
    ['klaus@example.com', '5000.01', 'up to 5,000'],
    ['klaus@example.com', '12.345', 'at most two decimal places'],
  ])('rejects %j / %j', async (email, amount, message) => {
    const user = await fill(email, amount);
    await user.click(screen.getByTestId('create-case'));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(auth.current.api.createCase).not.toHaveBeenCalled();
  });

  it('shows an API error and lets the user retry', async () => {
    auth.current.api.createCase.mockRejectedValueOnce(new ApiError(0, 'Could not reach the Panch API.'));
    auth.current.api.createCase.mockResolvedValueOnce(makeCase({ caseId: 'c-retry' }));
    const user = await fill('klaus@example.com', '400');
    await user.click(screen.getByTestId('create-case'));
    expect(await screen.findByText('Could not reach the Panch API.')).toBeInTheDocument();
    expect(screen.getByTestId('create-case')).toBeEnabled();
    await user.click(screen.getByTestId('create-case'));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/case/?id=c-retry'));
  });

  it('cannot be double-submitted', async () => {
    auth.current.api.createCase.mockReturnValue(new Promise(() => {}));
    const user = await fill('klaus@example.com', '400');
    await user.dblClick(screen.getByTestId('create-case'));
    expect(auth.current.api.createCase).toHaveBeenCalledOnce();
  });
});

describe('my cases', () => {
  it('shows an empty state', () => {
    render(<CasesPage />);
    expect(screen.getByText('No cases yet')).toBeInTheDocument();
  });

  it('lists cases remembered for this user only', () => {
    localStorage.setItem(`panch:recent:${RIYA.sub}`, JSON.stringify([{ caseId: 'c-mine', amountCents: 40000, currency: 'USD', status: 'FUNDED', role: 'claimant', seenAt: '2026-09-25T10:00:00Z' }]));
    localStorage.setItem(`panch:recent:${KLAUS.sub}`, JSON.stringify([{ caseId: 'c-theirs', amountCents: 1, currency: 'USD', status: 'CREATED', role: 'respondent', seenAt: 't' }]));
    render(<CasesPage />);
    const row = screen.getByRole('link', { name: /c-mine/ });
    expect(row).toHaveAttribute('href', expect.stringMatching(/^\/case\/?\?id=c-mine$/));
    expect(within(row).getByText('$400.00')).toBeInTheDocument();
    expect(within(row).getByTestId('status-badge')).toHaveTextContent('Funded');
    expect(screen.queryByText('c-theirs')).not.toBeInTheDocument();
  });

  it('refreshes stale statuses from the API, keeps order, drops deleted cases, warns on failures', async () => {
    const remembered = ['c-a', 'c-b', 'c-gone', 'c-down'].map((caseId) => ({ caseId, amountCents: 100, currency: 'USD', status: 'CREATED', role: 'claimant', seenAt: '2026-09-25T10:00:00Z' }));
    localStorage.setItem(`panch:recent:${RIYA.sub}`, JSON.stringify(remembered));
    auth.current.api.getCase.mockImplementation(async (id: string) => {
      if (id === 'c-gone') throw new ApiError(404, 'Not found');
      if (id === 'c-down') throw new ApiError(503, 'unavailable');
      return { case: makeCase({ caseId: id, status: id === 'c-a' ? 'RULED' : 'FUNDED' }), timeline: [] };
    });
    render(<CasesPage />);
    expect(screen.getByTestId('recent-meta')).toHaveTextContent('Updating statuses');
    await screen.findByText(/Could not refresh one case/);
    const rows = screen.getAllByRole('link', { name: /c-/ }).map((r) => r.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/c-a.*Ruled/);
    expect(rows[1]).toMatch(/c-b.*Funded/);
    expect(rows[2]).toMatch(/c-down.*Awaiting funding/); // last known status kept
    const stored = JSON.parse(localStorage.getItem(`panch:recent:${RIYA.sub}`)!).map((c: { caseId: string }) => c.caseId);
    expect(stored).toEqual(['c-a', 'c-b', 'c-down']);
  });

  it.each([
    ['c-1a2b3c4d', '/case/?id=c-1a2b3c4d'],
    ['https://panch.example/case/?id=c-9', '/case/?id=c-9'],
  ])('opens %j', async (input, target) => {
    const user = userEvent.setup();
    render(<CasesPage />);
    await user.type(screen.getByTestId('lookup-id'), input);
    await user.click(screen.getByRole('button', { name: 'Open case' }));
    expect(nav.push).toHaveBeenCalledWith(target);
  });

  it('explains an invalid ID', async () => {
    const user = userEvent.setup();
    render(<CasesPage />);
    await user.type(screen.getByTestId('lookup-id'), 'c 1 2');
    await user.click(screen.getByRole('button', { name: 'Open case' }));
    expect(screen.getByText(/only letters, numbers and dashes/)).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByTestId('lookup-id')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('public ruling page', () => {
  const show = async (ruling: unknown, id = 'c-104') => {
    setSearch(`id=${id}`, '/ruling/');
    auth.current = freshAuth({ status: 'signedOut', user: undefined });
    auth.current.api.getRuling.mockResolvedValue(ruling);
    render(<RulingPage />);
  };

  it('renders the award, findings, clauses and confidence without login', async () => {
    await show(RULING);
    await screen.findByTestId('ruling');
    expect(screen.getByTestId('claimant-share')).toHaveTextContent('100%');
    expect(screen.getByText('Award in full to the claimant', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('e-2')).toBeInTheDocument();
    expect(screen.getByText('e-3')).toBeInTheDocument();
    expect(screen.getByText('Clause 3.1')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '95');
    expect(screen.queryByText('Open uncertainties')).not.toBeInTheDocument();
  });

  it.each([
    [0, 'Claim dismissed in full', '0%', '100%'],
    [5000, 'Split award', '50%', '50%'],
    [7050, 'Split award', '70.5%', '29.5%'],
    [1, 'Split award', '0.01%', '99.99%'],
  ])('payeeShareBps %i reads "%s"', async (bps, outcome, claimant, respondent) => {
    await show({ ...RULING, payeeShareBps: bps });
    await screen.findByTestId('ruling');
    expect(screen.getByText(outcome, { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId('claimant-share')).toHaveTextContent(claimant);
    expect(screen.getByRole('img', { name: `Claimant receives ${claimant}, respondent receives ${respondent}` })).toBeInTheDocument();
  });

  it('shows uncertainties and low confidence', async () => {
    await show({ ...RULING, confidence: 0.4, uncertainties: ['Quality bar is ambiguous'] });
    await screen.findByTestId('ruling');
    expect(screen.getByText('Quality bar is ambiguous')).toBeInTheDocument();
    expect(screen.getByText(/40% · Low/)).toBeInTheDocument();
  });

  it('renders hostile ruling text inertly', async () => {
    await show({ ...RULING, reasoning: '<script>window.__pwned=1</script><img src=x onerror="window.__pwned=1">' });
    await screen.findByTestId('ruling');
    expect(document.querySelector('.award script, .award img')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('says a human reviewer decided a human-reviewed ruling, without a panel confidence', async () => {
    await show({ ...RULING, payeeShareBps: 6000, findingsOfFact: [], clausesRelied: [], reasoning: 'Late but used (e-3).', confidence: 1, humanReviewed: true });
    await screen.findByTestId('ruling');
    expect(screen.getByTestId('decided-by')).toHaveTextContent('Split award. Decided by a human reviewer after the panel of three judges escalated the case.');
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Reviewer's reasons/ })).toBeInTheDocument();
    expect(screen.getByText('Late but used (e-3).')).toBeInTheDocument();
  });

  it('keeps the panel wording and confidence for an AI ruling', async () => {
    await show(RULING);
    await screen.findByTestId('ruling');
    expect(screen.getByTestId('decided-by')).toHaveTextContent('Decided by a blinded panel of three judges and a presiding judge.');
    expect(screen.getByRole('heading', { name: /Reasoning/ })).toBeInTheDocument();
  });

  it('labels a failed demo run\'s cached fallback honestly and shows no award', async () => {
    // Field for field the body failHandler.ts copies into place (bench/demo/case-b/fallback-ruling.json).
    await show({
      caseId: 'demo-ba-b', payeeShareBps: 0, spreadBps: 0, swapConsistent: false, findingsOfFact: [], clausesRelied: [],
      reasoning: 'The live tribunal could not complete deliberation for this demo case, so no award was reached and escrow is unaffected.',
      confidence: 0, uncertainties: ['Tribunal failure — no ruling was reached'], fallback: true, publishedAt: '2026-09-28T00:00:00.000Z',
    }, 'demo-ba-b');
    const page = await screen.findByTestId('fallback-ruling');
    expect(page).toHaveTextContent('Cached fallback · not a ruling');
    expect(page).toHaveTextContent('This is a cached fallback, not a ruling');
    expect(page).toHaveTextContent('the escrow is untouched');
    expect(screen.queryByTestId('ruling')).not.toBeInTheDocument();
    expect(screen.queryByText('Claim dismissed in full', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByTestId('claimant-share')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('verify-panel')).not.toBeInTheDocument();
    expect(screen.getByText('Tribunal failure — no ruling was reached')).toBeInTheDocument();
  });

  it('renders the presiding judge\'s markdown as formatting, not asterisks', async () => {
    await show({ ...RULING, reasoning: 'The tribunal follows **judge-2** and **judge-3** (e-1#ARTIFACT_2).\n\n**judge-1** did not engage with `e-1`.\nA second line.' });
    const text = await screen.findByTestId('rich-text');
    expect(text.querySelectorAll('p')).toHaveLength(2);
    expect(within(text).getByText('judge-2').tagName).toBe('STRONG');
    expect(within(text).getByText('e-1').tagName).toBe('CODE');
    expect(text.textContent).not.toContain('**');
    expect(text.querySelector('br')).not.toBeNull();
  });

  it('leaves unbalanced markdown and hostile tags as plain text', async () => {
    await show({ ...RULING, reasoning: '**unclosed bold and <img src=x onerror="window.__pwned=1"> **<script>x</script>**' });
    const text = await screen.findByTestId('rich-text');
    expect(text.querySelector('img, script')).toBeNull();
    expect(text.textContent).toContain('<img src=x');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('says what a human reviewer\'s empty findings mean', async () => {
    await show({ ...RULING, findingsOfFact: [], clausesRelied: [], humanReviewed: true, confidence: 1 });
    expect(await screen.findByTestId('no-findings')).toHaveTextContent("The reviewer decided from the panel's full record");
    expect(screen.getByText('No clauses are restated by the reviewer.')).toBeInTheDocument();
  });

  describe('verify', () => {
    const VERIFIED = {
      caseId: 'c-104', match: true, reason: 'Ruling content matches the stored hash and the ledger chain recomputes clean from genesis.',
      content: { computedHash: 'a'.repeat(64), storedHash: 'a'.repeat(64), match: true, verified: true },
      ledger: { entries: [{ seq: 1, event: 'RESOLVE', entryHash: 'b'.repeat(64), valid: true }, { seq: 2, event: 'RELEASE', entryHash: 'c'.repeat(64), valid: true }], chainValid: true, terminalOk: true, consistent: true, lastEvent: 'RELEASE' },
    };

    it('shows a verified ruling with its content hash and ledger chain', async () => {
      await show(RULING);
      auth.current.api.verifyRuling.mockResolvedValue(VERIFIED);
      await userEvent.setup().click(await screen.findByTestId('verify-button'));
      const result = await screen.findByTestId('verify-result');
      expect(result).toHaveAttribute('data-match', 'true');
      expect(result).toHaveTextContent('Verified');
      expect(result).toHaveTextContent('Matches the signed hash');
      expect(result).toHaveTextContent('Chain of 2 entries recomputes cleanly, ends at RELEASE');
      expect(within(result).getAllByRole('listitem')).toHaveLength(2);
      expect(auth.current.api.verifyRuling).toHaveBeenCalledWith('c-104');
    });

    it('shows a failed verification with the server\'s reason and the bad entry', async () => {
      await show(RULING);
      auth.current.api.verifyRuling.mockResolvedValue({
        ...VERIFIED, match: false, reason: 'Ledger chain failed to recompute: an entry hash or link is invalid.',
        ledger: { ...VERIFIED.ledger, chainValid: false, entries: [{ seq: 1, event: 'FUND', entryHash: 'd'.repeat(64), valid: true }, { seq: 2, event: 'DISPUTE', entryHash: 'e'.repeat(64), valid: false }] },
      });
      await userEvent.setup().click(await screen.findByTestId('verify-button'));
      const result = await screen.findByTestId('verify-result');
      expect(result).toHaveAttribute('data-match', 'false');
      expect(result).toHaveTextContent('Not verified');
      expect(result).toHaveTextContent('Ledger chain failed to recompute');
      expect(result).toHaveTextContent('Chain does not recompute');
      expect(within(result).getByText(/2\. DISPUTE/).closest('li')).toHaveClass('ledger-bad');
    });

    it('says there is nothing to verify when no signed ruling exists', async () => {
      await show(RULING);
      auth.current.api.verifyRuling.mockResolvedValue(null);
      await userEvent.setup().click(await screen.findByTestId('verify-button'));
      expect(await screen.findByText('Nothing to verify yet')).toBeInTheDocument();
    });

    it('reports a verification error and allows another try', async () => {
      await show(RULING);
      auth.current.api.verifyRuling.mockRejectedValueOnce(new ApiError(0, 'Could not reach the Panch API.')).mockResolvedValueOnce(VERIFIED);
      const user = userEvent.setup();
      await user.click(await screen.findByTestId('verify-button'));
      expect(await screen.findByText('Verification could not run')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Verify again/ }));
      expect(await screen.findByTestId('verify-result')).toHaveAttribute('data-match', 'true');
    });
  });

  it('not published → friendly empty state', async () => {
    await show(null, 'c-new');
    expect(await screen.findByText('No published ruling yet')).toBeInTheDocument();
  });

  it('an error offers Try again, which refetches', async () => {
    const user = userEvent.setup();
    setSearch('id=c-104', '/ruling/');
    auth.current.api.getRuling.mockRejectedValueOnce(new ApiError(0, 'offline')).mockResolvedValueOnce(RULING);
    render(<RulingPage />);
    await screen.findByText('Could not load the ruling');
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByTestId('ruling')).toBeInTheDocument();
    expect(auth.current.api.getRuling).toHaveBeenCalledTimes(2);
  });

  it('an invalid id never calls the API', async () => {
    setSearch('id=%3Cscript%3E', '/ruling/');
    render(<RulingPage />);
    expect(await screen.findByText('This ruling link is not valid')).toBeInTheDocument();
    expect(auth.current.api.getRuling).not.toHaveBeenCalled();
  });
});

describe('demo runner', () => {
  const demoView = (status: string, extra: Record<string, unknown> = {}) => ({
    case: makeCase({ caseId: 'demo-1', status: status as never }),
    timeline: [] as string[],
    ...extra,
  });
  const start = async (view: unknown) => {
    const user = userEvent.setup();
    auth.current = freshAuth({ status: 'signedOut', user: undefined });
    auth.current.api.runDemo.mockResolvedValue({ message: 'Demo case started.', caseId: 'demo-1' });
    auth.current.api.getDemoCase.mockResolvedValue(view);
    render(<DemoRunner />);
    await user.click(screen.getByTestId('run-demo'));
    await screen.findByTestId('demo-progress');
    return user;
  };

  it('starts the demo once, even on a double click', async () => {
    const user = userEvent.setup();
    let release!: (v: unknown) => void;
    auth.current.api.runDemo.mockReturnValue(new Promise((r) => { release = r; }));
    auth.current.api.getDemoCase.mockResolvedValue(demoView('DELIBERATING'));
    render(<DemoRunner />);
    await user.dblClick(screen.getByTestId('run-demo'));
    expect(auth.current.api.runDemo).toHaveBeenCalledOnce();
    release({ message: 'Demo case started.', caseId: 'demo-1' });
    expect(await screen.findByTestId('demo-progress')).toHaveTextContent('demo-1');
    expect(screen.getByTestId('run-demo')).toBeDisabled(); // no second run while this one is followed
  });

  it('follows a logged-out run on the live timeline', async () => {
    await start(demoView('DELIBERATING', { timeline: ['INTAKE', 'BLIND', 'JUDGES'] }));
    await waitFor(() => expect(auth.current.api.getDemoCase).toHaveBeenCalledWith('demo-1'));
    expect(auth.current.api.getCase).not.toHaveBeenCalled(); // the signed-in read would 401 a visitor
    const timeline = await screen.findByTestId('tribunal-timeline');
    await waitFor(() => expect(within(timeline).getByText('Cross-examination').closest('li')).toHaveClass('timeline-current'));
    expect(within(timeline).getByText('Independent rulings').closest('li')).toHaveClass('timeline-done');
    expect(screen.getByText(/This usually takes one to three minutes/)).toBeInTheDocument();
  });

  it('links to the ruling once the panel has ruled', async () => {
    await start(demoView('SETTLED'));
    expect(await screen.findByText('The panel has ruled')).toBeInTheDocument();
    expect(screen.getByTestId('demo-ruling-link')).toHaveAttribute('href', expect.stringMatching(/^\/ruling\/?\?id=demo-1$/));
    expect(screen.getByTestId('run-demo')).toBeEnabled();
  });

  it('explains an escalated run instead of promising a ruling', async () => {
    await start(demoView('ESCALATED'));
    expect(await screen.findByText('Sent to human review')).toBeInTheDocument();
    expect(screen.getByText(/there is no ruling to read yet/)).toBeInTheDocument();
  });

  it('says a failed run made no award and the page shows a labelled fallback', async () => {
    await start(demoView('FAILED'));
    expect(await screen.findByText('The tribunal could not finish this run')).toBeInTheDocument();
    expect(screen.getByText(/escrow is untouched/)).toBeInTheDocument();
  });

  it('stops following a run that ended while the case still reads DELIBERATING', async () => {
    await start(demoView('DELIBERATING', { executionStatus: 'SUCCEEDED' }));
    expect(await screen.findByText('The run ended without an outcome')).toBeInTheDocument();
    const calls = auth.current.api.getDemoCase.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(auth.current.api.getDemoCase.mock.calls.length).toBe(calls);
  });

  it('shows the daily cap message the API sends, and allows another try', async () => {
    const user = userEvent.setup();
    auth.current.api.runDemo.mockRejectedValueOnce(new ApiError(429, 'Daily demo limit reached. Try again tomorrow.'));
    render(<DemoRunner />);
    await user.click(screen.getByTestId('run-demo'));
    expect(await screen.findByText('Daily demo limit reached. Try again tomorrow.')).toBeInTheDocument();
    expect(screen.getByTestId('run-demo')).toBeEnabled();
  });
});

describe('limitations', () => {
  it('lists the known gaps in plain language and is linked from the footer', async () => {
    const { default: LimitationsPage } = await import('../app/limitations/page');
    const { Footer } = await import('../components/Footer');
    render(<><LimitationsPage /><Footer /></>);
    const items = within(screen.getByTestId('limitations')).getAllByRole('listitem');
    const titles = items.map((li) => within(li).getByRole('heading').textContent);
    for (const gap of ['The escrow is simulated', 'There is no appeal window', 'A silent respondent is not timed out', 'Any signed-in account can act as a reviewer', 'Judges vary from run to run', 'The swap test has blind spots', 'Cases have no written summary', 'All data is synthetic']) {
      expect(titles.some((t) => t?.includes(gap))).toBe(true);
    }
    expect(screen.getByRole('link', { name: 'Limitations' })).toHaveAttribute('href', expect.stringMatching(/^\/limitations\/?$/));
  });

  it('a clauseRef that already says "Clause" is not doubled on the ruling page', async () => {
    setSearch('id=demo-1', '/ruling/');
    auth.current.api.getRuling.mockResolvedValue({ ...RULING, clausesRelied: [{ clauseRef: 'Clause 3.1', interpretation: 'Pay on delivery' }] });
    render(<RulingPage />);
    expect(await screen.findByText('Clause 3.1')).toBeInTheDocument();
    expect(screen.queryByText(/Clause Clause/)).not.toBeInTheDocument();
  });
});

describe('header', () => {
  it('signed out: sign in and get started', () => {
    auth.current = freshAuth({ status: 'signedOut', user: undefined });
    render(<Header />);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', expect.stringMatching(/^\/login\/?$/));
    expect(screen.queryByRole('link', { name: 'My cases' })).not.toBeInTheDocument();
  });

  it('signed in: avatar, email, sign out goes home', async () => {
    const user = userEvent.setup();
    render(<Header />);
    expect(screen.getByText('riya@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My cases' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Sign out/ }));
    expect(auth.current.signOut).toHaveBeenCalledOnce();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/'));
  });

  it('mobile menu toggle reports its state', async () => {
    const user = userEvent.setup();
    render(<Header />);
    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
  });
});
