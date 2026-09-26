// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Status } from '../lib/types';
import { EVE, KLAUS, RIYA, auth, freshAuth, makeCase, nav, setSearch } from './harness';

vi.mock('../lib/auth', async () => (await import('./harness')).authModule());
vi.mock('next/navigation', async () => (await import('./harness')).navigationModule());
vi.mock('../lib/config', async () => (await import('./harness')).configModule());

const { default: CasePage } = await import('../app/case/page');

const USERS = { claimant: RIYA, respondent: KLAUS, observer: EVE };

function setup(status: Status, as: keyof typeof USERS = 'claimant', extra = {}) {
  auth.current = freshAuth({ user: USERS[as] });
  auth.current.api.getCase.mockResolvedValue({ case: makeCase({ status, ...extra }), timeline: [] });
  setSearch('id=c-1234abcd', '/case/');
  return auth.current.api;
}

async function renderCase() {
  render(<CasePage />);
  await screen.findByTestId('case-detail');
}

const buttons = () => ({
  fund: screen.queryByTestId('action-fund'),
  dispute: screen.queryByTestId('action-dispute'),
  submit: screen.queryByTestId('action-submit'),
  ruling: screen.queryByTestId('view-ruling'),
  upload: screen.queryByTestId('evidence-form'),
});

beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
});

describe('what each role sees in each status', () => {
  const matrix: [Status, keyof typeof USERS, string[]][] = [
    ['CREATED', 'claimant', []],
    ['CREATED', 'respondent', ['fund']],
    ['CREATED', 'observer', []],
    ['FUNDED', 'claimant', ['dispute']],
    ['FUNDED', 'respondent', ['dispute']],
    ['FUNDED', 'observer', []],
    ['DISPUTED', 'claimant', ['submit', 'upload']],
    ['DISPUTED', 'respondent', ['submit', 'upload']],
    ['DISPUTED', 'observer', []],
    ['DELIBERATING', 'claimant', []],
    ['DELIBERATING', 'observer', []],
    ['ESCALATED', 'respondent', []],
    ['RULED', 'claimant', ['ruling']],
    ['RULED', 'observer', ['ruling']],
    ['SETTLED', 'respondent', ['ruling']],
  ];
  it.each(matrix)('%s as %s → %j', async (status, as, visible) => {
    setup(status, as);
    await renderCase();
    const b = buttons();
    const shown = Object.entries(b).filter(([, el]) => el).map(([k]) => k).sort();
    expect(shown).toEqual([...visible].sort());
    expect(screen.getByTestId('status-badge')).toHaveAttribute('data-status', status);
    expect(screen.getByTestId('role')).toHaveTextContent(as === 'observer' ? 'Viewing only' : `You are the ${as}`);
  });

  it('tells the claimant to share the ID while waiting for funding', async () => {
    setup('CREATED', 'claimant');
    await renderCase();
    expect(screen.getByText(/Waiting for/)).toHaveTextContent('klaus@example.com');
  });

  it('shows the tribunal timeline once deliberating and a live box', async () => {
    setup('DELIBERATING');
    await renderCase();
    expect(screen.getByTestId('tribunal-timeline')).toBeInTheDocument();
    expect(screen.getByText(/This page updates on its own/)).toBeInTheDocument();
  });

  it('explains escalation to human review', async () => {
    setup('ESCALATED');
    await renderCase();
    expect(screen.getByText('Sent to human review')).toBeInTheDocument();
  });

  it('marks completed tribunal stages reported by the API', async () => {
    const api = setup('DELIBERATING');
    api.getCase.mockResolvedValue({ case: makeCase({ status: 'DELIBERATING' }), timeline: ['INTAKE', 'BLIND'] });
    await renderCase();
    const timeline = screen.getByTestId('tribunal-timeline');
    expect(within(timeline).getAllByText('(complete)', { exact: false })).toHaveLength(2);
    expect(within(timeline).getByText('In progress')).toBeInTheDocument();
  });
});

describe('actions go through a confirmation', () => {
  it('fund: cancel does nothing, confirm funds once and records the receipt', async () => {
    const user = userEvent.setup();
    const api = setup('CREATED', 'respondent');
    api.fundCase.mockResolvedValue({ event: 'FUND', newStatus: 'FUNDED', entryHash: 'f'.repeat(64) });
    await renderCase();

    await user.click(buttons().fund!);
    expect(screen.getByRole('dialog', { name: /Fund \$400\.00 into escrow/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.fundCase).not.toHaveBeenCalled();

    api.getCase.mockResolvedValue({ case: makeCase({ status: 'FUNDED' }), timeline: [] });
    await user.click(buttons().fund!);
    const confirm = screen.getByTestId('dialog-confirm');
    await user.dblClick(confirm);
    await screen.findByText(/The funds are held until the deal completes/);
    expect(api.fundCase).toHaveBeenCalledOnce();
    expect(api.fundCase).toHaveBeenCalledWith('c-1234abcd');
    await waitFor(() => expect(screen.getByTestId('status-badge')).toHaveAttribute('data-status', 'FUNDED'));
    expect(screen.getByTestId('receipts')).toHaveTextContent('FUND');
    expect(JSON.parse(localStorage.getItem('panch:receipts:c-1234abcd')!)[0].entryHash).toBe('f'.repeat(64));
  });

  it('dispute uses a danger confirmation', async () => {
    const user = userEvent.setup();
    const api = setup('FUNDED', 'claimant');
    api.disputeCase.mockResolvedValue({ event: 'DISPUTE', newStatus: 'DISPUTED', entryHash: 'd'.repeat(64) });
    await renderCase();
    await user.click(buttons().dispute!);
    const dialog = screen.getByRole('dialog', { name: 'Open a dispute?' });
    expect(within(dialog).getByTestId('dialog-confirm')).toHaveClass('btn-danger');
    await user.click(within(dialog).getByTestId('dialog-confirm'));
    await screen.findByText(/Both sides can now upload evidence/);
    expect(api.disputeCase).toHaveBeenCalledOnce();
  });

  it('submit warns when no evidence was uploaded from this device', async () => {
    const user = userEvent.setup();
    const api = setup('DISPUTED', 'claimant');
    api.submitCase.mockResolvedValue('DELIBERATING');
    await renderCase();
    await user.click(buttons().submit!);
    expect(screen.getByText(/have not uploaded any evidence/)).toBeInTheDocument();
    await user.click(screen.getByTestId('dialog-confirm'));
    await screen.findByText(/The panel is deliberating/);
    expect(api.submitCase).toHaveBeenCalledOnce();
  });

  it('a stale-state conflict explains itself and refreshes', async () => {
    const user = userEvent.setup();
    const api = setup('CREATED', 'respondent');
    api.fundCase.mockRejectedValue(new ApiError(400, 'Transaction canceled: status mismatch or sequence conflict (double-entry).'));
    await renderCase();
    api.getCase.mockResolvedValue({ case: makeCase({ status: 'FUNDED' }), timeline: [] });
    await user.click(buttons().fund!);
    await user.click(screen.getByTestId('dialog-confirm'));
    await screen.findByText(/This case changed since you opened it/);
    await waitFor(() => expect(screen.getByTestId('status-badge')).toHaveAttribute('data-status', 'FUNDED'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the server message for other failures and keeps the case on screen', async () => {
    const user = userEvent.setup();
    const api = setup('FUNDED', 'respondent');
    api.disputeCase.mockRejectedValue(new ApiError(0, 'Could not reach the Panch API. Check your connection and try again.'));
    await renderCase();
    await user.click(buttons().dispute!);
    await user.click(screen.getByTestId('dialog-confirm'));
    await screen.findByText(/Could not reach the Panch API/);
    expect(screen.getByTestId('case-detail')).toBeInTheDocument();
  });

  it('Escape closes a dialog without acting', async () => {
    const user = userEvent.setup();
    const api = setup('CREATED', 'respondent');
    await renderCase();
    await user.click(buttons().fund!);
    const dialog = screen.getByRole('dialog');
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.fundCase).not.toHaveBeenCalled();
  });
});

describe('loading and errors', () => {
  it('shows a skeleton, then the case', async () => {
    const api = setup('CREATED');
    let resolve!: (v: unknown) => void;
    api.getCase.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<CasePage />);
    expect(screen.getByRole('status', { name: 'Loading case…' })).toBeInTheDocument();
    await act(async () => resolve({ case: makeCase(), timeline: [] }));
    expect(await screen.findByTestId('case-detail')).toBeInTheDocument();
  });

  it('404 shows Case not found', async () => {
    const api = setup('CREATED');
    api.getCase.mockRejectedValue(new ApiError(404, 'Not found'));
    render(<CasePage />);
    expect(await screen.findByText('Case not found')).toBeInTheDocument();
  });

  it('a load error offers Try again, which recovers', async () => {
    const user = userEvent.setup();
    const api = setup('CREATED');
    api.getCase.mockRejectedValueOnce(new ApiError(500, 'The Panch service had a problem (error 500). Please try again shortly.'));
    render(<CasePage />);
    await screen.findByText('Could not load this case');
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByTestId('case-detail')).toBeInTheDocument();
  });

  it('a failed manual refresh keeps the case and warns', async () => {
    const user = userEvent.setup();
    const api = setup('FUNDED', 'claimant');
    await renderCase();
    api.getCase.mockRejectedValue(new ApiError(0, 'offline'));
    await user.click(screen.getByTestId('refresh'));
    await screen.findByText(/Could not refresh: offline/);
    expect(screen.getByTestId('case-detail')).toBeInTheDocument();
  });

  it.each([['', 'No case selected'], ['../etc', 'This case link is not valid'], ['<b>x</b>', 'This case link is not valid']])(
    'id=%j shows "%s" without calling the API',
    async (id, text) => {
      const api = setup('CREATED');
      setSearch(id ? `id=${encodeURIComponent(id)}` : '', '/case/');
      render(<CasePage />);
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(api.getCase).not.toHaveBeenCalled();
    },
  );

  it('renders hostile text from the API as text, not HTML', async () => {
    setup('CREATED', 'claimant', { respondentId: '<img src=x onerror="window.__xss=1">@evil.com' });
    await renderCase();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
    expect(screen.getAllByText(/<img src=x/).length).toBeGreaterThan(0);
  });

  it('remembers the case for the dashboard with the viewer’s role', async () => {
    setup('FUNDED', 'respondent');
    await renderCase();
    const recent = JSON.parse(localStorage.getItem(`panch:recent:${KLAUS.sub}`)!);
    expect(recent[0]).toMatchObject({ caseId: 'c-1234abcd', status: 'FUNDED', role: 'respondent' });
  });
});

describe('polling while deliberating', () => {
  it('polls every 5s, stops once ruled, and stops on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = setup('DELIBERATING');
      const view = render(<CasePage />);
      await screen.findByTestId('case-detail');
      expect(api.getCase).toHaveBeenCalledTimes(1);

      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(api.getCase).toHaveBeenCalledTimes(2);

      api.getCase.mockResolvedValue({ case: makeCase({ status: 'RULED' }), timeline: [] });
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      await screen.findByTestId('view-ruling');
      const afterRuled = api.getCase.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
      expect(api.getCase).toHaveBeenCalledTimes(afterRuled);

      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips polls while the tab is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      const api = setup('DELIBERATING');
      render(<CasePage />);
      await screen.findByTestId('case-detail');
      await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
      expect(api.getCase).toHaveBeenCalledTimes(1);
      visibility.mockReturnValue('visible');
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(api.getCase).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failed poll keeps the page and shows a warning', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = setup('DELIBERATING');
      render(<CasePage />);
      await screen.findByTestId('case-detail');
      api.getCase.mockRejectedValue(new ApiError(503, 'The Panch service had a problem (error 503). Please try again shortly.'));
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(await screen.findByText(/Could not refresh/)).toBeInTheDocument();
      expect(screen.getByTestId('case-detail')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('signed-out access', () => {
  it('redirects to login with the case as next', async () => {
    setup('CREATED');
    auth.current = freshAuth({ status: 'signedOut', user: undefined });
    render(<CasePage />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/login/?next=${encodeURIComponent('/case/?id=c-1234abcd')}`));
  });
});
