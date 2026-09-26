'use client';

import { useState } from 'react';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); the value is still on screen.
    }
  }

  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={copy} aria-live="polite">
      {copied ? 'Copied' : label}
    </button>
  );
}
