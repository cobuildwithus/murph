import type { CSSProperties } from "react";

const DOT_OPACITY = [
  [0.15, 0.3, 0.45, 0.3, 0.15],
  [0.3, 0.6, 0.8, 0.6, 0.3],
  [0.45, 0.8, 1, 0.8, 0.45],
  [0.3, 0.6, 0.8, 0.6, 0.3],
  [0.15, 0.3, 0.45, 0.3, 0.15],
];
const DOT_SIZE = 14;
const DOT_STEP = 30;
const RIPPLE_STEP_MS = 120;

/** The logo's dot grid, large: the object on a page that is working on something. */
export function LinkPageDots() {
  const size = DOT_STEP * (DOT_OPACITY.length - 1) + DOT_SIZE;

  return (
    <svg
      aria-hidden="true"
      className="mx-auto block shrink-0"
      data-slot="link-page-dots"
      fill="#D9B969"
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
    >
      {DOT_OPACITY.flatMap((row, rowIndex) =>
        row.map((opacity, columnIndex) => (
          <circle
            className="murph-loader-dot"
            cx={DOT_SIZE / 2 + columnIndex * DOT_STEP}
            cy={DOT_SIZE / 2 + rowIndex * DOT_STEP}
            key={`${rowIndex}-${columnIndex}`}
            r={DOT_SIZE / 2}
            style={{
              "--dot-delay": `${(Math.abs(rowIndex - 2) + Math.abs(columnIndex - 2)) * RIPPLE_STEP_MS}ms`,
              "--dot-opacity": opacity,
              "--dot-opacity-peak": 1,
              "--dot-scale": 1.15,
            } as CSSProperties}
          />
        )),
      )}
    </svg>
  );
}
