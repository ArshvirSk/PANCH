import type { EvidenceType } from './types';

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

/** PRD F3: PDF, image, chat log text. */
const ALLOWED: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
};

export const ACCEPT_ATTRIBUTE = '.pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain';

export const EVIDENCE_TYPES: { value: EvidenceType; label: string }[] = [
  { value: 'contract', label: 'Contract' },
  { value: 'chat', label: 'Chat log' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'deliverable', label: 'Deliverable' },
  { value: 'other', label: 'Other' },
];

/**
 * The content type is signed into the presigned URL, so the same value must be
 * used for the request and the PUT. Browsers sometimes leave `file.type` empty
 * (notably for .txt on Windows), so fall back to the extension.
 */
export function resolveContentType(fileName: string, browserType: string): string | null {
  const allowedTypes = new Set(Object.values(ALLOWED));
  if (browserType && allowedTypes.has(browserType)) return browserType;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return ALLOWED[ext] ?? null;
}

export type EvidenceCheck = { ok: true; contentType: string } | { ok: false; error: string };

export function checkEvidenceFile(file: { name: string; type: string; size: number }): EvidenceCheck {
  const contentType = resolveContentType(file.name, file.type);
  if (!contentType) return { ok: false, error: 'Use a PDF, PNG, JPG or TXT file.' };
  if (file.size === 0) return { ok: false, error: 'This file is empty.' };
  if (file.size > MAX_EVIDENCE_BYTES) return { ok: false, error: 'Files must be 10 MB or smaller.' };
  return { ok: true, contentType };
}
