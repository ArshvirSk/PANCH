export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="spinner-row" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** Small spinner for inside buttons. */
export function ButtonSpinner() {
  return <span className="spinner spinner-sm" aria-hidden="true" />;
}
