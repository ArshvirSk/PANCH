/**
 * Runtime configuration for the web app.
 *
 * Values come from NEXT_PUBLIC_* environment variables, which Next.js inlines
 * at build time. In the deployed site they are set on the Amplify app by
 * WebStack (from the Api and Auth stack outputs), so nothing is hardcoded here.
 * Locally, copy `.env.example` to `.env.local` and fill them in.
 */

export interface AppConfig {
  apiUrl: string;
  userPoolId: string;
  userPoolClientId: string;
}

export interface RawConfig {
  apiUrl?: string;
  userPoolId?: string;
  userPoolClientId?: string;
}

export interface ConfigResult {
  config: AppConfig;
  missing: string[];
}

const ENV_NAMES: Record<keyof AppConfig, string> = {
  apiUrl: 'NEXT_PUBLIC_API_URL',
  userPoolId: 'NEXT_PUBLIC_USER_POOL_ID',
  userPoolClientId: 'NEXT_PUBLIC_USER_POOL_CLIENT_ID',
};

/** Always ends with exactly one slash, so paths can be appended as `${apiUrl}cases`. */
export function normalizeApiUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '') + '/';
}

export function resolveConfig(raw: RawConfig): ConfigResult {
  const config: AppConfig = {
    apiUrl: normalizeApiUrl(raw.apiUrl ?? ''),
    userPoolId: (raw.userPoolId ?? '').trim(),
    userPoolClientId: (raw.userPoolClientId ?? '').trim(),
  };
  const missing = (Object.keys(ENV_NAMES) as (keyof AppConfig)[])
    .filter((key) => !config[key])
    .map((key) => ENV_NAMES[key]);
  return { config, missing };
}

// Each variable must be referenced literally so Next.js can inline it.
export const { config: appConfig, missing: missingConfig } = resolveConfig({
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID,
  userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID,
});

export const isAuthConfigured = Boolean(appConfig.userPoolId && appConfig.userPoolClientId);
