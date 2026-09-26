/** Turns Amplify/Cognito errors into messages a person can act on. */
export function authErrorMessage(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  const message = err instanceof Error ? err.message : '';

  switch (name) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
      return 'Incorrect email or password.';
    case 'UsernameExistsException':
      return 'An account with this email already exists. Sign in instead.';
    case 'InvalidPasswordException':
      return message || 'Choose a stronger password.';
    case 'CodeMismatchException':
      return 'That code is not correct. Check the email and try again.';
    case 'ExpiredCodeException':
      return 'That code has expired. Request a new one.';
    case 'LimitExceededException':
    case 'TooManyRequestsException':
    case 'TooManyFailedAttemptsException':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'CodeDeliveryFailureException':
      return 'We could not send the verification email. Try again shortly.';
    case 'UserNotConfirmedException':
      return 'Confirm your email before signing in.';
    case 'NetworkError':
      return 'Could not reach the sign-in service. Check your connection.';
    case 'AuthUserPoolException':
      return 'Sign-in is not configured for this site yet.';
    default:
      return message || 'Something went wrong. Please try again.';
  }
}

/** Password rules of the default Cognito policy used by AuthStack. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 8) problems.push('at least 8 characters');
  if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('an uppercase letter');
  if (!/\d/.test(password)) problems.push('a number');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('a symbol');
  return problems;
}

/** Only allow same-site relative redirects after sign-in. */
export function safeNextPath(next: string | null | undefined, fallback = '/cases/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
