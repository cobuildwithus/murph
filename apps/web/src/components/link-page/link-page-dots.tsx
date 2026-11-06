import type { CSSProperties } from "react";

const DOT_OPACITIES = [
  [0.15, 0.3, 0.45, 0.3, 0.15],
  [0.3, 0.6, 0.8, 0.6, 0.3],
  [0.45, 0.8, 1, 0.8, 0.45],
  [0.3, 0.6, 0.8, 0.6, 0.3],
  [0.15, 0.3, 0.45, 0.3, 0.15],
];

/** The logo's dots, large, for a page that is working on something. */
export function LinkPageDots() {
  return (
    <svg
      aria-hidden="true"
      className="mx-auto size-[134px] shrink-0"
      fill="none"
      viewBox="0 0 134 134"
    >
      {DOT_OPACITIES.flatMap((row, y) =>
        row.map((opacity, x) => (
          <circle
            className="murph-loader-dot"
            cx={7 + x * 30}
            cy={7 + y * 30}
            fill="#D9B969"
            key={`${x}-${y}`}
            r={7}
            style={{
              "--dot-delay": `${Math.round(Math.hypot(x - 2, y - 2) * 140)}ms`,
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
