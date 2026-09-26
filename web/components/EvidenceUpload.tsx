'use client';

import { useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { ACCEPT_ATTRIBUTE, EVIDENCE_TYPES, checkEvidenceFile } from '../lib/evidence';
import { formatBytes } from '../lib/format';
import type { StoredUpload } from '../lib/storage';
import type { EvidenceType, Party } from '../lib/types';
import { Icon } from './Icon';
import { Notice } from './Notice';
import { ButtonSpinner } from './Spinner';

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
  const inputId = useId();
  const [type, setType] = useState<EvidenceType>('contract');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [lastUploaded, setLastUploaded] = useState('');

  const busy = phase !== 'idle';

  function choose(next: File | null) {
    setError('');
    setLastUploaded('');
    if (next) {
      const check = checkEvidenceFile(next);
      if (!check.ok) {
        setFile(null);
        if (inputRef.current) inputRef.current.value = '';
        setError(check.error);
        return;
      }
    }
    setFile(next);
  }

  function clearFile() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const dropped = event.dataTransfer.files;
    if (dropped.length > 1) {
      setError('Drop one file at a time.');
      return;
    }
    choose(dropped[0] ?? null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
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
      clearFile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setPhase('idle');
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit} data-testid="evidence-form" noValidate>
      <div className="field">
        <span className="field-label">Evidence type</span>
        <div className="segmented" role="radiogroup" aria-label="Evidence type">
          {EVIDENCE_TYPES.map((t) => (
            <label key={t.value} className={type === t.value ? 'segment active' : 'segment'}>
              <input type="radio" name="evidence-type" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} disabled={busy} />
              {t.label}
            </label>
          ))}
        </div>
      </div>

      {file ? (
        <div className="file-chip" data-testid="selected-file">
          <span className="file-chip-icon"><Icon name="file" size={20} /></span>
          <span className="file-chip-text">
            <strong>{file.name}</strong>
            <span className="muted small">{formatBytes(file.size)}</span>
          </span>
          <button type="button" className="btn btn-ghost btn-icon" onClick={clearFile} disabled={busy} aria-label={`Remove ${file.name}`}>
            <Icon name="x" size={16} />
          </button>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className={dragging ? 'dropzone dragging' : 'dropzone'}
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-testid="dropzone"
        >
          <span className="dropzone-icon"><Icon name="upload" size={22} /></span>
          <span className="dropzone-title">Drop a file here or <u>browse</u></span>
          <span className="muted small">PDF, PNG, JPG or TXT · up to 10 MB</span>
        </label>
      )}
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={ACCEPT_ATTRIBUTE}
        onChange={(e) => choose(e.target.files?.[0] ?? null)}
        disabled={busy}
        data-testid="evidence-file"
        aria-label="Evidence file"
      />

      <div className="row wrap">
        <button type="submit" className="btn btn-secondary" disabled={busy || !file} data-testid="evidence-submit">
          {busy ? <ButtonSpinner /> : <Icon name="upload" size={16} />}
          {phase === 'requesting' ? 'Preparing secure upload…' : phase === 'uploading' ? 'Uploading…' : `Upload as ${party}`}
        </button>
        <span className="muted small row-gap"><Icon name="lock" size={14} /> Encrypted at rest · fingerprinted with SHA-256</span>
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
