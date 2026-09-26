import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type Tone = 'info' | 'success' | 'error' | 'warning';

const ICONS: Record<Tone, IconName> = { info: 'info', success: 'check-circle', error: 'alert', warning: 'alert' };

export function Notice({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={ICONS[tone]} size={18} className="notice-icon" />
      <div className="notice-content">
        {title && <p className="notice-title">{title}</p>}
        {children && <div className="notice-body">{children}</div>}
      </div>
    </div>
  );
}
