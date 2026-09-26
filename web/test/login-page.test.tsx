// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auth, freshAuth, nav, setSearch } from './harness';

vi.mock('../lib/auth', async () => (await import('./harness')).authModule());
vi.mock('next/navigation', async () => (await import('./harness')).navigationModule());
vi.mock('../lib/config', async () => (await import('./harness')).configModule());

const { default: LoginPage } = await import('../app/login/page');

beforeEach(() => {
  nav.replace.mockReset();
  auth.current = freshAuth({ status: 'signedOut', user: undefined });
  setSearch('', '/login/');
});

const email = () => screen.getByTestId('email');
const password = () => screen.getByTestId('password');
const submit = () => screen.getByTestId('auth-submit');
// Synthetic value that meets each PASSWORD_RULES check (length, upper, number, symbol); not a credential.
const VALID_PASSWORD = ['A', 'a'.repeat(7), '1', '!'].join(''); // ggignore

describe('sign in', () => {
  it('validates before calling Cognito', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(submit());
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    await user.type(email(), 'riya@example.com');
    await user.click(submit());
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(auth.current.signIn).not.toHaveBeenCalled();
  });

  it('shows the mapped Cognito error', async () => {
    const user = userEvent.setup();
    auth.current.signIn.mockRejectedValue({ name: 'NotAuthorizedException', message: 'Incorrect username or password.' });
    render(<LoginPage />);
    await user.type(email(), 'riya@example.com');
    await user.type(password(), 'nope');
    await user.click(submit());
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
  });

  it('an unconfirmed account goes to the code step', async () => {
    const user = userEvent.setup();
    auth.current.signIn.mockResolvedValue('confirm');
    render(<LoginPage />);
    await user.type(email(), 'riya@example.com');
    await user.type(password(), VALID_PASSWORD);
    await user.click(submit());
    expect(await screen.findByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
    expect(screen.getByText(/not confirmed yet/)).toBeInTheDocument();
  });

  it('only submits once while busy', async () => {
    const user = userEvent.setup();
    auth.current.signIn.mockReturnValue(new Promise(() => {}));
    render(<LoginPage />);
    await user.type(email(), 'riya@example.com');
    await user.type(password(), 'x');
    await user.click(submit());
    await user.click(submit());
    expect(auth.current.signIn).toHaveBeenCalledOnce();
    expect(submit()).toBeDisabled();
  });

  it('show/hide toggles the password field', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    expect(password()).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password()).toHaveAttribute('type', 'text');
  });

  it.each([
    ['next=%2Fcase%2F%3Fid%3Dc-1', '/case/?id=c-1'],
    ['next=https%3A%2F%2Fevil.example', '/cases/'],
    ['next=%2F%2Fevil.example', '/cases/'],
    ['', '/cases/'],
  ])('once signed in, ?%s sends the user to %s', async (query, target) => {
    setSearch(query, '/login/');
    auth.current = freshAuth({ status: 'signedIn' });
    render(<LoginPage />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(target));
  });
});

describe('create account', () => {
  it('shows live password rules and blocks weak passwords', async () => {
    const user = userEvent.setup();
    setSearch('mode=signUp', '/login/');
    render(<LoginPage />);
    const rules = screen.getByRole('list', { name: 'Password requirements' });
    expect(rules.querySelectorAll('li.met')).toHaveLength(0);
    await user.type(email(), 'riya@example.com');
    await user.type(password(), 'abc');
    expect(rules.querySelectorAll('li.met')).toHaveLength(1);
    await user.click(submit());
    expect(screen.getByText(/Your password needs at least 8 characters, an uppercase letter, a number, a symbol/)).toBeInTheDocument();
    expect(auth.current.signUp).not.toHaveBeenCalled();
    await user.clear(password());
    await user.type(password(), VALID_PASSWORD);
    expect(rules.querySelectorAll('li.met')).toHaveLength(5);
  });

  it('sign up → code → confirm → signed in with the same password', async () => {
    const user = userEvent.setup();
    setSearch('mode=signUp', '/login/');
    render(<LoginPage />);
    await user.type(email(), 'Riya@Example.com');
    await user.type(password(), VALID_PASSWORD);
    await user.click(submit());
    expect(await screen.findByText(/We emailed a 6-digit verification code/)).toBeInTheDocument();
    await user.type(screen.getByTestId('confirm-code'), '12a3456');
    expect(screen.getByTestId('confirm-code')).toHaveValue('123456'); // digits only
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    await waitFor(() => expect(auth.current.signIn).toHaveBeenCalledWith('Riya@Example.com', VALID_PASSWORD));
    expect(auth.current.confirmCode).toHaveBeenCalledWith('Riya@Example.com', '123456');
  });

  it('rejects a short code and maps a wrong one', async () => {
    const user = userEvent.setup();
    setSearch('mode=signUp', '/login/');
    auth.current.confirmCode.mockRejectedValue({ name: 'CodeMismatchException' });
    render(<LoginPage />);
    await user.type(email(), 'riya@example.com');
    await user.type(password(), VALID_PASSWORD);
    await user.click(submit());
    await screen.findByTestId('confirm-code');
    await user.type(screen.getByTestId('confirm-code'), '123');
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    expect(screen.getByText('Enter the 6-digit code from the email.')).toBeInTheDocument();
    await user.type(screen.getByTestId('confirm-code'), '456');
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    expect(await screen.findByText(/That code is not correct/)).toBeInTheDocument();
  });

  it('resends the code', async () => {
    const user = userEvent.setup();
    setSearch('mode=signUp', '/login/');
    render(<LoginPage />);
    await user.type(email(), 'riya@example.com');
    await user.type(password(), VALID_PASSWORD);
    await user.click(submit());
    await screen.findByTestId('confirm-code');
    await user.click(screen.getByRole('button', { name: 'Send a new code' }));
    expect(await screen.findByText(/A new code is on its way/)).toBeInTheDocument();
    expect(auth.current.resendCode).toHaveBeenCalledWith('riya@example.com');
  });

  it('an existing account is told to sign in', async () => {
    const user = userEvent.setup();
    setSearch('mode=signUp', '/login/');
    auth.current.signUp.mockRejectedValue({ name: 'UsernameExistsException' });
    render(<LoginPage />);
    await user.type(email(), 'riya@example.com');
    await user.type(password(), VALID_PASSWORD);
    await user.click(submit());
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
  });

  it('switching tabs clears old errors', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(submit());
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Create account' }));
    expect(screen.queryByText('Enter a valid email address.')).not.toBeInTheDocument();
  });
});
