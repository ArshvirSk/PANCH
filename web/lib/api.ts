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

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current Cognito ID token, or undefined when signed out. */
  getIdToken: () => Promise<string | undefined>;
  /** Called when a protected route answers 401, so the app can drop the session. */
  onUnauthorized?: () => void;
  fetchImpl?: FetchLike;
}

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

    let res: Response;
    try {
      res = await fetchImpl(`${options.baseUrl}${path}`, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch {
      throw new ApiError(0, NETWORK_ERROR_MESSAGE);
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
        res = await fetchImpl(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: file,
        });
      } catch {
        throw new ApiError(0, 'The file upload could not reach storage. Check your connection and try again.');
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
