import { statusLabel } from '../lib/caseLogic';

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`} data-testid="status-badge" data-status={status}>
      {statusLabel(status)}
    </span>
  );
}
