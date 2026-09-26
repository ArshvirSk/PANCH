/** Placeholder blocks shown while a page loads, so the layout does not jump. */
export function Skeleton({ width = '100%', height = 16, radius = 8 }: { width?: string | number; height?: number; radius?: number }) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="stack-lg" role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div className="stack-sm">
        <Skeleton width={120} height={14} />
        <Skeleton width="55%" height={38} />
        <Skeleton width={220} height={18} />
      </div>
      <Skeleton height={64} radius={16} />
      <div className="grid-2">
        <Skeleton height={220} radius={16} />
        <Skeleton height={220} radius={16} />
      </div>
    </div>
  );
}
