// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { normalizeReviewCase } from '../lib/reviews';
import type { ReviewCase, Ruling } from '../lib/types';
import { KLAUS, RIYA, auth, freshAuth, nav, setSearch } from './harness';

vi.mock('../lib/auth', async () => (await import('./harness')).authModule());
vi.mock('next/navigation', async () => (await import('./harness')).navigationModule());
vi.mock('../lib/config', async () => (await import('./harness')).configModule());

const { default: ReviewsPage } = await import('../app/reviews/page');
const { Header } = await import('../components/Header');

function judge(payeeShareBps: number, reasoning = `Reasoning for ${payeeShareBps}`): Ruling {
  return {
    findingsOfFact: [{ fact: 'Logo delivered on day 20', evidenceIds: ['e-2'] }],
    clausesRelied: [{ clauseRef: '3.1', interpretation: 'Payment due on delivery' }],
    payeeShareBps,
    reasoning,
    confidence: 0.62,
    uncertainties: ['Whether the revision round was agreed'],
  };
}

function review(overrides: Record<string, unknown> = {}): ReviewCase {
  return normalizeReviewCase({
    caseId: 'c-105',
    status: 'ESCALATED',
    amountCents: 40000,
    currency: 'USD',
    createdAt: '2026-09-25T10:00:00Z',
    claimantId: 'sub-someone',
    respondentId: 'client@example.com',
    summary: 'A logo package was delivered two weeks late; the client paid nothing.',
    panelOutputs: {
      finalPanelOutputs: { 'judge-1': judge(10000), 'judge-2': judge(0), 'judge-3': judge(5000) },
      swapOutputs: { 'judge-1': judge(0), 'judge-2': judge(0), 'judge-3': judge(5000) },
      medianPayeeShareBps: 5000,
      spreadBps: 10000,
      swapConsistent: false,
      escalationReason: 'High spread or swap inconsistency',
    },
    ...overrides,
  })!;
}

beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
  setSearch('', '/reviews/');
  auth.current = freshAuth();
});

async function renderQueue(cases: ReviewCase[] = [review()]) {
  auth.current.api.getReviews.mockResolvedValue(cases);
  render(<ReviewsPage />);
  await screen.findByText(cases.length === 0 ? 'No cases waiting for review' : /waiting, oldest first/);
  return userEvent.setup();
}

describe('the queue', () => {
  it('shows each escalated case with summary, amount, spread, median and swap result', async () => {
    await renderQueue();
    const card = screen.getByTestId('review-card');
    expect(within(card).getByText('c-105')).toBeInTheDocument();
    expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent('$400.00');
    expect(within(card).getByTestId('summary')).toHaveTextContent('delivered two weeks late');
    expect(within(card).getByText(/High spread or swap inconsistency/)).toBeInTheDocument();
    expect(within(card).getByTestId('median')).toHaveTextContent('50%');
    expect(within(card).getByTestId('spread')).toHaveTextContent('100 pts');
    expect(within(card).getByTestId('swap-overall')).toHaveTextContent(/^Inconsistent$/);
    expect(within(card).getByTestId('swap-note')).toHaveTextContent('1 of 3 judges flipped on their own');
    expect(screen.getByTestId('queue-count')).toHaveTextContent('1 case waiting');
  });

  it('puts the three judges side by side with award, confidence, reasoning and swap check', async () => {
    await renderQueue();
    const judges = within(screen.getByTestId('judges')).getAllByTestId('judge-card');
    expect(judges.map((j) => within(j).getByRole('heading').textContent)).toEqual(['Judge 1', 'Judge 2', 'Judge 3']);
    expect(judges.map((j) => within(j).getByTestId('judge-award').textContent)).toEqual(['100%', '0%', '50%']);
    expect(within(judges[0]).getByText(/confidence 62%/)).toBeInTheDocument();
    expect(within(judges[0]).getByText('Reasoning for 10000')).toBeInTheDocument();
    // judge-1 gave 100% and 0% in the mirror: consistent. judge-2 gave 0% both ways: it favours the "Respondent" label.
    expect(within(judges[0]).getByTestId('swap-line')).toHaveTextContent('Swap test: Consistent · mirrored 100%, off by 0 pts');
    expect(within(judges[1]).getByTestId('swap-line')).toHaveTextContent('Flipped · mirrored 100%, off by 100 pts');
    expect(within(judges[2]).getByTestId('swap-line')).toHaveTextContent('Consistent · mirrored 50%');
    expect(within(judges[0]).getByText('Findings (1)')).toBeInTheDocument();
    expect(within(judges[0]).getByText('e-2')).toBeInTheDocument();
    expect(within(judges[0]).getByText('Uncertainties (1)')).toBeInTheDocument();
  });

  it('never shows party identifiers, keeping the review blind', async () => {
    await renderQueue();
    expect(document.body.textContent).not.toContain('client@example.com');
    expect(document.body.textContent).not.toContain('sub-someone');
  });

  it('lists cases oldest first', async () => {
    await renderQueue([
      review({ caseId: 'c-new', createdAt: '2026-09-26T09:00:00Z' }),
      review({ caseId: 'c-undated', createdAt: undefined }),
      review({ caseId: 'c-old', createdAt: '2026-09-20T09:00:00Z' }),
    ]);
    expect(screen.getAllByTestId('review-card').map((c) => c.dataset.caseId)).toEqual(['c-old', 'c-new', 'c-undated']);
    expect(screen.getByTestId('queue-count')).toHaveTextContent('3 cases waiting');
  });

  it('copes with the current backend shape: spread only, no judges, no swap run', async () => {
    await renderQueue([review({ summary: undefined, panelOutputs: { spreadBps: 5000, judges: [] } })]);
    expect(screen.getByTestId('no-judges')).toHaveTextContent('did not send the judges');
    expect(screen.getByTestId('spread')).toHaveTextContent('50 pts');
    expect(screen.getByTestId('median')).toHaveTextContent('—');
    expect(screen.getByTestId('swap-overall')).toHaveTextContent('Not run');
    expect(screen.getByTestId('swap-note')).toHaveTextContent('labels mirrored, award should invert');
    expect(screen.getByTestId('summary')).toHaveTextContent('No written summary');
  });

  it('marks a spread worked out from the awards, and an unreadable judge', async () => {
    await renderQueue([review({ panelOutputs: { judges: [judge(9000), { broken: true }, judge(1000)] } })]);
    expect(screen.getByTestId('spread')).toHaveTextContent('80 pts');
    expect(screen.getByText('worked out from the awards')).toBeInTheDocument();
    expect(screen.getByText("This judge's output could not be read.")).toBeInTheDocument();
    expect(screen.getAllByText('No swap-test run for this judge.')).toHaveLength(2);
  });

  it('shows an empty state when nothing is escalated', async () => {
    await renderQueue([]);
    expect(screen.getByText(/judges disagree by more than the escalation threshold/)).toBeInTheDocument();
    expect(screen.queryByTestId('review-card')).not.toBeInTheDocument();
  });

  it('shows a load error and retries', async () => {
    auth.current.api.getReviews.mockRejectedValueOnce(new ApiError(0, 'Could not reach the Panch API.')).mockResolvedValueOnce([review()]);
    render(<ReviewsPage />);
    expect(await screen.findByText('Could not load the review queue')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByTestId('review-card')).toBeInTheDocument();
  });

  it('keeps the list when a refresh fails, and says so', async () => {
    const user = await renderQueue();
    auth.current.api.getReviews.mockRejectedValueOnce(new ApiError(503, 'The Panch service had a problem (error 503).'));
    await user.click(screen.getByTestId('refresh'));
    expect(await screen.findByText(/Could not refresh: The Panch service had a problem/)).toBeInTheDocument();
    expect(screen.getByTestId('review-card')).toBeInTheDocument();
  });

  it('renders hostile text from the panel as plain text', async () => {
    const attack = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    await renderQueue([review({ summary: attack, panelOutputs: { judges: [judge(5000, attack)] } })]);
    expect(screen.getByTestId('summary')).toHaveTextContent(attack);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('warns a reviewer who is a party to the case', async () => {
    await renderQueue([review({ claimantId: RIYA.sub }), review({ caseId: 'c-other', respondentId: 'someone@else.com' })]);
    const [own, other] = screen.getAllByTestId('review-card');
    expect(within(own).getByText('You are a party to this case')).toBeInTheDocument();
    expect(within(other).queryByText('You are a party to this case')).not.toBeInTheDocument();
  });

  it('also matches the respondent by email, ignoring case', async () => {
    auth.current = freshAuth({ user: KLAUS });
    await renderQueue([review({ respondentId: 'KLAUS@Example.com' })]);
    expect(screen.getByText('You are a party to this case')).toBeInTheDocument();
  });
});

describe('the decision form', () => {
  it('requires a share and a note before anything is sent', async () => {
    const user = await renderQueue();
    await user.click(screen.getByTestId('resolve'));
    expect(screen.getByText("Enter the claimant's share as a percentage.")).toBeInTheDocument();
    expect(screen.getByText(/Add a note explaining the decision/)).toBeInTheDocument();
    expect(screen.getByTestId('share-input')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('note-input')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('dialog-confirm')).not.toBeVisible();
    expect(auth.current.api.resolveReview).not.toHaveBeenCalled();
  });

  it.each([
    ['150', 'more than 100%'],
    ['-1', 'from 0 to 100'],
    ['33.333', 'at most two decimals'],
    ['half', 'from 0 to 100'],
  ])('rejects a share of %j', async (share, message) => {
    const user = await renderQueue();
    await user.type(screen.getByTestId('share-input'), share);
    await user.type(screen.getByTestId('note-input'), 'Reasons.');
    await user.click(screen.getByTestId('resolve'));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(auth.current.api.resolveReview).not.toHaveBeenCalled();
  });

  it('rejects a note over the limit and shows the count', async () => {
    const user = await renderQueue();
    await user.type(screen.getByTestId('share-input'), '70');
    await user.click(screen.getByTestId('note-input'));
    await user.paste('x'.repeat(1001));
    expect(screen.getByText('1001/1000')).toBeInTheDocument();
    await user.click(screen.getByTestId('resolve'));
    expect(screen.getByRole('alert')).toHaveTextContent('under 1000 characters');
  });

  it('previews the money split as the share is typed', async () => {
    const user = await renderQueue();
    await user.type(screen.getByTestId('share-input'), '70');
    expect(screen.getByText('Claimant receives 70% ($280.00), respondent 30% ($120.00)')).toBeInTheDocument();
  });

  it('fills the share from the panel median, a judge, or an even split', async () => {
    const user = await renderQueue();
    const presets = within(screen.getByRole('group', { name: 'Fill in a suggested share' }));
    expect(presets.getAllByRole('button').map((b) => b.textContent)).toEqual(['Panel median 50%', 'Judge 1 100%', 'Judge 2 0%', 'Judge 3 50%', 'Even split 50%']);
    await user.click(presets.getByRole('button', { name: /Judge 1/ }));
    expect(screen.getByTestId('share-input')).toHaveValue('100');
    await user.click(presets.getByRole('button', { name: /Judge 2/ }));
    expect(screen.getByTestId('share-input')).toHaveValue('0');
  });

  it('confirms, sends the award in basis points with a trimmed note, and clears the case', async () => {
    const user = await renderQueue();
    auth.current.api.resolveReview.mockResolvedValue({ caseId: 'c-105', status: 'SETTLED' });
    await user.type(screen.getByTestId('share-input'), '72.5');
    await user.type(screen.getByTestId('note-input'), '  Late delivery, but the work was used (e-2).  ');
    await user.click(screen.getByTestId('resolve'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Resolve case c-105?')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Claimant receives 72.5% ($290.00), respondent 27.5% ($110.00)');
    expect(auth.current.api.resolveReview).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(auth.current.api.resolveReview).toHaveBeenCalledWith('c-105', { payeeShareBps: 7250, note: 'Late delivery, but the work was used (e-2).' }));
    expect(await screen.findByText(/Case c-105 resolved\. Claimant receives 72\.5%/)).toBeInTheDocument();
    expect(screen.queryByTestId('review-card')).not.toBeInTheDocument();
    expect(screen.getByText('No cases waiting for review')).toBeInTheDocument();
  });

  it('can be cancelled from the dialog', async () => {
    const user = await renderQueue();
    await user.type(screen.getByTestId('share-input'), '40');
    await user.type(screen.getByTestId('note-input'), 'Reasons.');
    await user.click(screen.getByTestId('resolve'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(auth.current.api.resolveReview).not.toHaveBeenCalled();
    expect(screen.getByTestId('share-input')).toHaveValue('40');
  });

  it('sends one request however often the confirm button is pressed', async () => {
    const user = await renderQueue();
    let finish: (v: unknown) => void = () => {};
    auth.current.api.resolveReview.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await user.type(screen.getByTestId('share-input'), '60');
    await user.type(screen.getByTestId('note-input'), 'Reasons.');
    await user.click(screen.getByTestId('resolve'));
    const confirm = screen.getByTestId('dialog-confirm');
    await user.click(confirm);
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    expect(screen.getByTestId('share-input')).toBeDisabled();
    finish({ caseId: 'c-105', status: 'SETTLED' });
    await screen.findByText(/Case c-105 resolved/);
    expect(auth.current.api.resolveReview).toHaveBeenCalledOnce();
  });

  it('handles a case someone else already resolved by refreshing the queue', async () => {
    const user = await renderQueue();
    auth.current.api.resolveReview.mockRejectedValue(new ApiError(400, 'Case must be ESCALATED'));
    auth.current.api.getReviews.mockResolvedValue([]);
    await user.type(screen.getByTestId('share-input'), '60');
    await user.type(screen.getByTestId('note-input'), 'Reasons.');
    await user.click(screen.getByTestId('resolve'));
    await user.click(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText(/was already resolved by someone else, so nothing was changed/)).toBeInTheDocument();
    expect(auth.current.api.getReviews).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('No cases waiting for review')).toBeInTheDocument();
  });

  it('treats the real 409 race answer as already resolved too', async () => {
    const user = await renderQueue();
    auth.current.api.resolveReview.mockRejectedValue(new ApiError(409, 'Case already reviewed and settled'));
    auth.current.api.getReviews.mockResolvedValue([]);
    await user.type(screen.getByTestId('share-input'), '60');
    await user.type(screen.getByTestId('note-input'), 'Reasons.');
    await user.click(screen.getByTestId('resolve'));
    await user.click(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText(/was already resolved by someone else, so nothing was changed/)).toBeInTheDocument();
    expect(screen.queryByText('Case already reviewed and settled')).not.toBeInTheDocument();
    expect(auth.current.api.getReviews).toHaveBeenCalledTimes(2);
  });

  it('keeps the form filled in when saving fails, so the reviewer can retry', async () => {
    const user = await renderQueue();
    auth.current.api.resolveReview
      .mockRejectedValueOnce(new ApiError(0, 'Could not reach the Panch API. Check your connection and try again.'))
      .mockResolvedValueOnce({ caseId: 'c-105', status: 'SETTLED' });
    await user.type(screen.getByTestId('share-input'), '60');
    await user.type(screen.getByTestId('note-input'), 'Reasons.');
    await user.click(screen.getByTestId('resolve'));
    await user.click(screen.getByTestId('dialog-confirm'));
    expect(await within(screen.getByTestId('review-card')).findByText(/Could not reach the Panch API/)).toBeInTheDocument();
    expect(screen.getByTestId('share-input')).toHaveValue('60');
    expect(screen.getByTestId('note-input')).toHaveValue('Reasons.');
    await user.click(screen.getByTestId('resolve'));
    await user.click(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText(/Case c-105 resolved/)).toBeInTheDocument();
  });

  it('resolving one case leaves the others and their drafts alone', async () => {
    const user = await renderQueue([review({ caseId: 'c-a', createdAt: '2026-09-20T00:00:00Z' }), review({ caseId: 'c-b', createdAt: '2026-09-21T00:00:00Z' })]);
    auth.current.api.resolveReview.mockResolvedValue({ caseId: 'c-a', status: 'SETTLED' });
    const [first, second] = screen.getAllByTestId('review-card');
    await user.type(within(second).getByTestId('note-input'), 'Draft for b');
    await user.type(within(first).getByTestId('share-input'), '10');
    await user.type(within(first).getByTestId('note-input'), 'Reasons for a.');
    await user.click(within(first).getByTestId('resolve'));
    await user.click(screen.getByTestId('dialog-confirm'));
    await screen.findByText(/Case c-a resolved/);
    const remaining = screen.getAllByTestId('review-card');
    expect(remaining.map((c) => c.dataset.caseId)).toEqual(['c-b']);
    expect(within(remaining[0]).getByTestId('note-input')).toHaveValue('Draft for b');
    expect(screen.getAllByTestId('dialog-confirm')).toHaveLength(1);
  });
});

describe('access', () => {
  it('sends a signed-out visitor to sign in and back', async () => {
    auth.current = freshAuth({ status: 'signedOut', user: undefined });
    render(<ReviewsPage />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/login/?next=${encodeURIComponent('/reviews/')}`));
    expect(auth.current.api.getReviews).not.toHaveBeenCalled();
  });

  it('shows the Reviews link only when signed in', () => {
    const { unmount } = render(<Header />);
    expect(within(document.getElementById('site-nav')!).getByRole('link', { name: 'Reviews' })).toHaveAttribute('href', expect.stringMatching(/^\/reviews\/?$/));
    unmount();
    auth.current = freshAuth({ status: 'signedOut', user: undefined });
    render(<Header />);
    expect(within(document.getElementById('site-nav')!).queryByRole('link', { name: 'Reviews' })).not.toBeInTheDocument();
  });

  it('marks the Reviews link as current on the page', () => {
    setSearch('', '/reviews/');
    render(<Header />);
    expect(within(document.getElementById('site-nav')!).getByRole('link', { name: 'Reviews' })).toHaveClass('active');
    expect(within(document.getElementById('site-nav')!).getByRole('link', { name: 'My cases' })).not.toHaveClass('active');
  });
});
