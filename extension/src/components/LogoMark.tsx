/**
 * Thundrly logo mark — four signal-dots converging into one accent verdict.
 * Mirrors the geometric SVG used by the landing site so the extension shell
 * (panel + popup) reads as the same product.
 *
 * Color: lines + outer dots inherit `currentColor` from the host (typically
 * the deep-space-blue ink), and the verdict circle uses the cerulean accent.
 */

interface LogoMarkProps {
  size?: number;
  /** Optional explicit color for the accent circle (overrides the default). */
  accent?: string;
  className?: string;
}

const INPUT_Y = [9, 16.5, 23.5, 31];

export function LogoMark({ size = 28, accent = "#007ea7", className }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className={className}
      style={{ display: "block" }}
    >
      {INPUT_Y.map((y) => (
        <line
          key={`l-${y}`}
          x1="11.5"
          y1={y}
          x2="29"
          y2="20"
          stroke="currentColor"
          strokeOpacity="0.32"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      ))}
      {INPUT_Y.map((y) => (
        <circle key={`d-${y}`} cx="11" cy={y} r="2.1" fill="currentColor" />
      ))}
      <circle cx="29" cy="20" r="5" fill={accent} />
    </svg>
  );
}
