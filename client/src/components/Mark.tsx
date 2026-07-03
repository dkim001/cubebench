/**
 * The 3×3 brand mark — the same shape as the favicon. One source of truth;
 * color comes from CSS currentColor at the call site.
 */
export function Mark({
  size = 15,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <g fill="currentColor">
        <rect x="2" y="2" width="8" height="8" rx="2" />
        <rect x="12" y="2" width="8" height="8" rx="2" />
        <rect x="22" y="2" width="8" height="8" rx="2" />
        <rect x="2" y="12" width="8" height="8" rx="2" />
        <rect x="12" y="12" width="8" height="8" rx="2" />
        <rect x="22" y="12" width="8" height="8" rx="2" />
        <rect x="2" y="22" width="8" height="8" rx="2" />
        <rect x="12" y="22" width="8" height="8" rx="2" />
        <rect x="22" y="22" width="8" height="8" rx="2" />
      </g>
    </svg>
  );
}
