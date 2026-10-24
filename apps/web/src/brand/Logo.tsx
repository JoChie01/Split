/*
 * brand/Logo.tsx
 *
 * WHAT: The Split logo. The mark is a receipt cut in two.
 * WHY A COMPONENT: Every screen uses the same SVG, and its colours come from the theme.
 *   Note the mark is a close redraw of the logo. Swap in the exact SVG file when you have it.
 */

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 60 60" aria-hidden="true">
      <path className="mark-paper" d="M2 6 H30 V50 L27 47 L24 50 L21 47 L18 50 L15 47 L12 50 L9 47 L6 50 L2 47 Z" />
      <path className="mark-paper" d="M30 12 H58 V56 L55 53 L52 56 L49 53 L46 56 L43 53 L40 56 L37 53 L34 56 L30 53 Z" />
      <rect className="mark-line" x="7" y="13" width="18" height="3" rx="1.5" />
      <rect className="mark-line" x="7" y="21" width="13" height="3" rx="1.5" />
      <rect className="mark-line" x="7" y="29" width="18" height="3" rx="1.5" />
      <rect className="mark-line" x="7" y="37" width="9" height="3" rx="1.5" />
      <rect className="mark-line" x="35" y="20" width="16" height="3" rx="1.5" />
      <rect className="mark-line" x="35" y="28" width="11" height="3" rx="1.5" />
      <rect className="mark-line" x="35" y="36" width="16" height="3" rx="1.5" />
    </svg>
  );
}

export function Wordmark() {
  return <span className="wordmark">Split</span>;
}