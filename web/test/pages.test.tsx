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
  it('starts the demo once, even on a double click', async () => {
    const user = userEvent.setup();
    let release!: (v: unknown) => void;
    auth.current.api.runDemo.mockReturnValue(new Promise((r) => { release = r; }));
    render(<DemoRunner />);
    await user.dblClick(screen.getByTestId('run-demo'));
    expect(auth.current.api.runDemo).toHaveBeenCalledOnce();
    release({ message: 'Demo run started', caseId: 'c-demo', executionArn: 'arn:aws:states:x' });
    expect(await screen.findByText('Demo run started')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open its ruling page' })).toHaveAttribute('href', expect.stringMatching(/^\/ruling\/?\?id=c-demo$/));
  });

  it('shows a failure and allows another try', async () => {
    const user = userEvent.setup();
    auth.current.api.runDemo.mockRejectedValueOnce(new ApiError(429, 'Too many requests right now. Please wait a moment and try again.'));
    render(<DemoRunner />);
    await user.click(screen.getByTestId('run-demo'));
    expect(await screen.findByText(/Too many requests/)).toBeInTheDocument();
    expect(screen.getByTestId('run-demo')).toBeEnabled();
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
