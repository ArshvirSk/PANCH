import type {
  Case,
  CaseView,
  CreateCaseInput,
  DemoRunResult,
  EvidenceUploadRequest,
  EvidenceUploadTicket,
  HealthResult,
  LedgerReceipt,
  Ruling,
  Status,
  TimelineStage,
} from './types';
import { parseRuling } from './ruling';

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const NETWORK_ERROR_MESSAGE =
  'Could not reach the Panch API. Check your connection and try again.';
export const TIMEOUT_MESSAGE = 'The Panch API took too long to respond. Please try again.';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current Cognito ID token, or undefined when signed out. */
  getIdToken: () => Promise<string | undefined>;
  /** Called when a protected route answers 401, so the app can drop the session. */
  onUnauthorized?: () => void;
  fetchImpl?: FetchLike;
  /** Per-request timeout for API calls (uploads get longer). */
  timeoutMs?: number;
  /** Wait before the single retry of a failed GET. */
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  auth?: boolean;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(status: number, body: unknown): string {
  if (status === 429) return 'Too many requests right now. Please wait a moment and try again.';
  // Server-side failures can carry internal details (SDK errors); never show those to users.
  if (status >= 500) return `The Panch service had a problem (error ${status}). Please try again shortly.`;
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    // API Gateway's answer for a route that does not exist.
    if (record.message === 'Missing Authentication Token') return 'This action is not available on the server yet.';
  }
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.error === 'string' && record.error) return record.error;
    if (typeof record.message === 'string' && record.message) return record.message;
  }
  if (typeof body === 'string' && body.trim()) {
    const s3Message = /<Message>([^<]+)<\/Message>/.exec(body);
    if (s3Message) return s3Message[1];
  }
  return `Request failed with status ${status}.`;
}

function asObject(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * GET /cases/{id} currently returns the Cases item itself. The mock server (and
 * the planned timeline shape) wrap it as `{ case, timeline }`. Accept both.
 */
export function normalizeCaseView(body: unknown): CaseView {
  const record = asObject(body);
  const inner = record.case && typeof record.case === 'object' ? record.case : record;
  const caseItem = inner as Case;
  if (!caseItem.caseId || !caseItem.status) {
    throw new ApiError(502, 'The API returned an unexpected case shape.');
  }
  const timeline = Array.isArray(record.timeline)
    ? (record.timeline.filter((s) => typeof s === 'string') as TimelineStage[])
    : [];
  return { case: caseItem, timeline };
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? 600;

  /** fetch with a timeout. Network failures and timeouts become ApiError(0). */
  async function send(url: string, init: RequestInit, limitMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limitMs);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch {
      throw new ApiError(0, controller.signal.aborted ? TIMEOUT_MESSAGE : NETWORK_ERROR_MESSAGE);
    } finally {
      clearTimeout(timer);
    }
  }

  async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    if (!options.baseUrl) {
      throw new ApiError(0, 'The API URL is not configured (NEXT_PUBLIC_API_URL).');
    }
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    if (opts.auth) {
      const token = await options.getIdToken();
      if (!token) {
        options.onUnauthorized?.();
        throw new ApiError(401, 'Please sign in to continue.');
      }
      // The API Gateway Cognito authorizer expects the raw ID token.
      headers.Authorization = token;
    }

    const method = opts.method ?? 'GET';
    const init: RequestInit = {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    };
    const url = `${options.baseUrl}${path}`;

    // Reads are safe to repeat, so a GET gets one retry on a network blip or gateway error.
    // Writes are never retried: a POST that timed out may still have been applied.
    let res: Response;
    try {
      res = await send(url, init, timeoutMs);
      if (method === 'GET' && RETRYABLE_STATUSES.has(res.status)) throw new ApiError(res.status, '');
    } catch (err) {
      if (method !== 'GET') throw err;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      res = await send(url, init, timeoutMs);
    }

    const body = await readBody(res);
    if (!res.ok) {
      if (res.status === 401 && opts.auth) {
        options.onUnauthorized?.();
        throw new ApiError(401, 'Your session has expired. Please sign in again.');
      }
      throw new ApiError(res.status, errorMessage(res.status, body));
    }
    return body as T;
  }

  const casePath = (caseId: string) => `cases/${encodeURIComponent(caseId)}`;

  async function transition(caseId: string, action: 'fund' | 'dispute'): Promise<LedgerReceipt> {
    const body = asObject(await request(`${casePath(caseId)}/${action}`, { method: 'POST', auth: true }));
    return {
      event: action === 'fund' ? 'FUND' : 'DISPUTE',
      newStatus: (asString(body.newStatus) ?? (action === 'fund' ? 'FUNDED' : 'DISPUTED')) as Status,
      entryHash: asString(body.entryHash) ?? '',
    };
  }

  return {
    async health(): Promise<HealthResult> {
      const body = asObject(await request('health'));
      return {
        ok: body.status === 'ok' || body.ok === true,
        timestamp: asString(body.timestamp),
      };
    },

    async createCase(input: CreateCaseInput): Promise<Case> {
      const body = await request('cases', { method: 'POST', body: input, auth: true });
      return normalizeCaseView(body).case;
    },

    async getCase(caseId: string): Promise<CaseView> {
      return normalizeCaseView(await request(casePath(caseId), { auth: true }));
    },

    fundCase: (caseId: string) => transition(caseId, 'fund'),
    disputeCase: (caseId: string) => transition(caseId, 'dispute'),

    async requestEvidenceUpload(caseId: string, input: EvidenceUploadRequest): Promise<EvidenceUploadTicket> {
      const body = asObject(
        await request(`${casePath(caseId)}/evidence`, { method: 'POST', body: input, auth: true }),
      );
      const evidenceId = asString(body.evidenceId);
      const uploadUrl = asString(body.uploadUrl);
      if (!evidenceId || !uploadUrl) {
        throw new ApiError(502, 'The API did not return an upload URL.');
      }
      return { evidenceId, uploadUrl, key: asString(body.key) };
    },

    /** PUT the file straight to S3. Content-Type must match what was presigned. */
    async uploadToPresignedUrl(uploadUrl: string, file: Blob, contentType: string): Promise<void> {
      let res: Response;
      try {
        res = await send(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file }, UPLOAD_TIMEOUT_MS);
      } catch (err) {
        const timedOut = err instanceof ApiError && err.message === TIMEOUT_MESSAGE;
        throw new ApiError(0, timedOut
          ? 'The file upload timed out. Try again on a faster connection or with a smaller file.'
          : 'The file upload could not reach storage. Check your connection and try again.');
      }
      if (!res.ok) {
        const body = await readBody(res);
        throw new ApiError(res.status, `Upload failed: ${errorMessage(res.status, body)}`);
      }
    },

    async submitCase(caseId: string): Promise<Status> {
      const body = asObject(await request(`${casePath(caseId)}/submit`, { method: 'POST', auth: true }));
      return (asString(body.status) ?? 'DELIBERATING') as Status;
    },

    /** Public. Returns null when no ruling has been published for this case. */
    async getRuling(caseId: string): Promise<Ruling | null> {
      try {
        return parseRuling(await request(`rulings/${encodeURIComponent(caseId)}`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },

    /** Public, no login. */
    async runDemo(): Promise<DemoRunResult> {
      const body = asObject(await request('demo/run', { method: 'POST' }));
      return {
        message: asString(body.message) ?? 'Demo case started.',
        caseId: asString(body.caseId),
        executionArn: asString(body.executionArn),
      };
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
