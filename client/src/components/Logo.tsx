interface Props {
  size?: number;
}

/**
 * One node branching into two — the shape the DAG view draws for a THEN or IF,
 * with the taken branch in the accent colour. `currentColor` on the parent node
 * keeps it legible if this is ever used on a light surface.
 */
export default function Logo({ size = 20 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="pg_durable dashboard"
    >
      <path
        d="M12 9.5 C12 13, 4.75 11.9, 4.75 15"
        stroke="var(--text-muted)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M12 9.5 C12 13, 19.25 11.9, 19.25 15"
        stroke="var(--accent)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <rect
        x="8.25"
        y="1.75"
        width="7.5"
        height="7.5"
        rx="2.3"
        fill="var(--surface)"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <rect
        x="1"
        y="14.9"
        width="7.5"
        height="7.5"
        rx="2.3"
        fill="var(--surface)"
        stroke="var(--text-muted)"
        strokeWidth="1.9"
      />
      <rect
        x="15.5"
        y="14.9"
        width="7.5"
        height="7.5"
        rx="2.3"
        fill="var(--accent)"
      />
    </svg>
  );
}
