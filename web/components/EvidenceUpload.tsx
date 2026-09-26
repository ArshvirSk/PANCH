'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { ACCEPT_ATTRIBUTE, EVIDENCE_TYPES, checkEvidenceFile } from '../lib/evidence';
import type { StoredUpload } from '../lib/storage';
import type { EvidenceType, Party } from '../lib/types';
import { Notice } from './Notice';

interface Props {
  caseId: string;
  party: Party;
  onUploaded(upload: StoredUpload): void;
}

type Phase = 'idle' | 'requesting' | 'uploading';

/**
 * Two steps, as the API is designed: ask POST /cases/{id}/evidence for a presigned
 * URL, then PUT the file straight to S3. The backend hashes the object itself.
 */
export function EvidenceUpload({ caseId, party, onUploaded }: Props) {
  const { api } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<EvidenceType>('contract');
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [lastUploaded, setLastUploaded] = useState('');

  const busy = phase !== 'idle';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLastUploaded('');
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    const check = checkEvidenceFile(file);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    try {
      setPhase('requesting');
      const ticket = await api.requestEvidenceUpload(caseId, {
        party,
        type,
        contentType: check.contentType,
        contentLength: file.size,
      });
      setPhase('uploading');
      await api.uploadToPresignedUrl(ticket.uploadUrl, file, check.contentType);
      onUploaded({
        evidenceId: ticket.evidenceId,
        fileName: file.name,
        type,
        size: file.size,
        at: new Date().toISOString(),
      });
      setLastUploaded(file.name);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setPhase('idle');
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit} data-testid="evidence-form">
      <div className="field-row">
        <label className="field">
          <span>Evidence type</span>
          <select value={type} onChange={(e) => setType(e.target.value as EvidenceType)} disabled={busy}>
            {EVIDENCE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>File (PDF, PNG, JPG or TXT, up to 10 MB)</span>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
            data-testid="evidence-file"
          />
        </label>
      </div>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={busy || !file} data-testid="evidence-submit">
          {phase === 'requesting' ? 'Preparing upload…' : phase === 'uploading' ? 'Uploading…' : `Upload as ${party}`}
        </button>
      </div>
      <div aria-live="polite">
        {error && <Notice tone="error">{error}</Notice>}
        {lastUploaded && (
          <Notice tone="success">
            Uploaded <strong>{lastUploaded}</strong>. Its SHA-256 fingerprint is recorded on the server.
          </Notice>
        )}
      </div>
    </form>
  );
}
