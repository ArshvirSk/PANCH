/** The Panch mark: five seats of the panchayat around a shared centre. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="logo-mark">
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <circle cx="16" cy="16" r="3.2" fill="var(--brand-ink)" opacity="0.9" />
      {[
        [16, 6.5],
        [25.04, 13.06],
        [21.59, 23.69],
        [10.41, 23.69],
        [6.96, 13.06],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.4" fill="#fff" />
      ))}
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span className="logo-word">Panch</span>
    </span>
  );
}
