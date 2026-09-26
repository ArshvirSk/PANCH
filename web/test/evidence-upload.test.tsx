// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { auth, freshAuth } from './harness';

vi.mock('../lib/auth', async () => (await import('./harness')).authModule());

const { EvidenceUpload } = await import('../components/EvidenceUpload');

function setup() {
  auth.current = freshAuth();
  const api = auth.current.api;
  api.requestEvidenceUpload.mockResolvedValue({ evidenceId: 'ev-1', uploadUrl: 'https://s3.test/put?sig=1' });
  api.uploadToPresignedUrl.mockResolvedValue(undefined);
  const onUploaded = vi.fn();
  render(<EvidenceUpload caseId="c-1" party="claimant" onUploaded={onUploaded} />);
  return { api, onUploaded, user: userEvent.setup({ applyAccept: false }) };
}

const input = () => screen.getByTestId('evidence-file') as HTMLInputElement;
const file = (name: string, type: string, size = 12) => new File([new Uint8Array(size)], name, { type });

describe('EvidenceUpload', () => {
  it('uploads a valid file: presign with the right metadata, then PUT', async () => {
    const { api, onUploaded, user } = setup();
    await user.click(screen.getByRole('radio', { name: 'Chat log' }));
    await user.upload(input(), file('chat.txt', 'text/plain', 79));
    expect(screen.getByTestId('selected-file')).toHaveTextContent('chat.txt');
    await user.click(screen.getByTestId('evidence-submit'));
    await screen.findByText(/Uploaded/);
    expect(api.requestEvidenceUpload).toHaveBeenCalledWith('c-1', { party: 'claimant', type: 'chat', contentType: 'text/plain', contentLength: 79 });
    expect(api.uploadToPresignedUrl).toHaveBeenCalledWith('https://s3.test/put?sig=1', expect.any(File), 'text/plain');
    expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ evidenceId: 'ev-1', fileName: 'chat.txt', type: 'chat', size: 79 }));
    expect(screen.queryByTestId('selected-file')).not.toBeInTheDocument(); // reset for the next file
  });

  it('infers the type of a .txt the browser left untyped', async () => {
    const { api, user } = setup();
    await user.upload(input(), file('log.txt', ''));
    await user.click(screen.getByTestId('evidence-submit'));
    await screen.findByText(/Uploaded/);
    expect(api.requestEvidenceUpload.mock.calls[0][1].contentType).toBe('text/plain');
  });

  it.each([
    ['tool.exe', 'application/x-msdownload', 10, 'Use a PDF, PNG, JPG or TXT file.'],
    ['empty.pdf', 'application/pdf', 0, 'This file is empty.'],
    ['huge.pdf', 'application/pdf', 10 * 1024 * 1024 + 1, 'Files must be 10 MB or smaller.'],
    ['vector.svg', 'image/svg+xml', 10, 'Use a PDF, PNG, JPG or TXT file.'],
  ])('rejects %s at selection time without calling the API', async (name, type, size, message) => {
    const { api, user } = setup();
    await user.upload(input(), file(name, type, size));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByTestId('evidence-submit')).toBeDisabled();
    expect(api.requestEvidenceUpload).not.toHaveBeenCalled();
  });

  it('a presign failure shows the message and never PUTs', async () => {
    const { api, user } = setup();
    api.requestEvidenceUpload.mockRejectedValue(new ApiError(400, 'Case is not accepting evidence'));
    await user.upload(input(), file('a.pdf', 'application/pdf'));
    await user.click(screen.getByTestId('evidence-submit'));
    expect(await screen.findByText('Case is not accepting evidence')).toBeInTheDocument();
    expect(api.uploadToPresignedUrl).not.toHaveBeenCalled();
    expect(screen.getByTestId('selected-file')).toBeInTheDocument(); // kept so the user can retry
  });

  it('an S3 failure is reported and the file is kept for retry', async () => {
    const { api, onUploaded, user } = setup();
    api.uploadToPresignedUrl.mockRejectedValue(new ApiError(403, 'Upload failed: The request signature we calculated does not match'));
    await user.upload(input(), file('a.png', 'image/png'));
    await user.click(screen.getByTestId('evidence-submit'));
    expect(await screen.findByText(/signature we calculated/)).toBeInTheDocument();
    expect(onUploaded).not.toHaveBeenCalled();
    api.uploadToPresignedUrl.mockResolvedValue(undefined);
    await user.click(screen.getByTestId('evidence-submit'));
    await screen.findByText(/Uploaded/);
    expect(onUploaded).toHaveBeenCalledOnce();
  });

  it('disables everything while uploading and ignores double submits', async () => {
    const { api, user } = setup();
    let release!: () => void;
    api.uploadToPresignedUrl.mockReturnValue(new Promise<void>((r) => { release = r; }));
    await user.upload(input(), file('a.pdf', 'application/pdf'));
    const submit = screen.getByTestId('evidence-submit');
    await user.click(submit);
    await screen.findByText('Uploading…');
    expect(submit).toBeDisabled();
    fireEvent.submit(screen.getByTestId('evidence-form'));
    expect(api.requestEvidenceUpload).toHaveBeenCalledOnce();
    release();
    await screen.findByText(/Uploaded/);
  });

  it('accepts a dropped file and rejects dropping several', async () => {
    const { user } = setup();
    const zone = screen.getByTestId('dropzone');
    fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
    expect(zone).toHaveClass('dragging');
    fireEvent.drop(zone, { dataTransfer: { files: [file('a.pdf', 'application/pdf'), file('b.pdf', 'application/pdf')] } });
    expect(await screen.findByText('Drop one file at a time.')).toBeInTheDocument();
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file('a.pdf', 'application/pdf')] } });
    await waitFor(() => expect(screen.getByTestId('selected-file')).toHaveTextContent('a.pdf'));
    await user.click(screen.getByRole('button', { name: 'Remove a.pdf' }));
    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
  });

  it('labels the upload with the party', () => {
    setup();
    expect(screen.getByTestId('evidence-submit')).toHaveTextContent('Upload as claimant');
  });
});
