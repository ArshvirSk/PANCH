'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export function CopyButton({ value, label = 'Copy', compact = false }: { value: string; label?: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); the value is still on screen.
    }
  }

  return (
    <button
      type="button"
      className={compact ? 'btn btn-ghost btn-icon' : 'btn btn-ghost btn-sm'}
      onClick={copy}
      aria-label={compact ? (copied ? 'Copied' : label) : undefined}
      title={compact ? label : undefined}
    >
      <Icon name={copied ? 'check' : 'copy'} size={15} />
      {!compact && <span aria-live="polite">{copied ? 'Copied' : label}</span>}
    </button>
  );
}
