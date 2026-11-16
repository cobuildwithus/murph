import type { CSSProperties } from "react";

const OLIVE = "#5c6b4f";
const TAN = "#c4956a";
const BROWN = "#a07a4e";

/**
 * The logo mark's dots, as drawn in public/logo-dark.svg: center x, center y,
 * radius, color and the logo's own opacity.
 */
const MARK_DOTS: ReadonlyArray<readonly [number, number, number, string, number]> = [
  [6.5, 5.5, 2, OLIVE, 0.35], [16.5, 5.5, 2, OLIVE, 0.35], [27, 5.5, 2.5, TAN, 0.55],
  [38, 5.5, 2.5, TAN, 0.55], [48.5, 5.5, 2, OLIVE, 0.35], [58.5, 5.5, 2, OLIVE, 0.35],
  [4.5, 15.5, 2, OLIVE, 0.35], [14.5, 15.5, 2, OLIVE, 0.35], [26, 15.5, 3.5, BROWN, 1],
  [39, 15.5, 3.5, BROWN, 1], [50.5, 15.5, 2, OLIVE, 0.35], [60.5, 15.5, 2, OLIVE, 0.35],
  [2, 27.5, 2, OLIVE, 0.35], [12.5, 27.5, 2.5, TAN, 0.55], [25, 27.5, 4, TAN, 1],
  [39.5, 27.5, 4.5, TAN, 1], [52.5, 27.5, 2.5, TAN, 0.55], [63, 27.5, 2, OLIVE, 0.35],
  [6.5, 38.5, 2, OLIVE, 0.35], [16.5, 38.5, 2, OLIVE, 0.35], [27, 38.5, 2.5, TAN, 0.55],
  [38, 38.5, 2.5, TAN, 0.55], [48.5, 38.5, 2, OLIVE, 0.35], [58.5, 38.5, 2, OLIVE, 0.35],
];
const MARK_CENTER = { x: 32.5, y: 22 };
/** How long a ripple takes to travel one unit of the mark outward from its center. */
const RIPPLE_MS_PER_UNIT = 22;
/** On the night ground the logo's faintest dots need a little more light to read at this size. */
const RESTING_LIFT = 0.15;
const WIDTH = 168;

/** The logo mark, large, with a ripple running out from its center: a page that is working on something. */
export function LinkPageDots() {
  const viewBox = { x: -2, y: 1, width: 69, height: 42 };
  return (
    <svg
      aria-hidden="true"
      className="mx-auto block shrink-0"
      data-slot="link-page-dots"
      height={Math.round((WIDTH * viewBox.height) / viewBox.width)}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      width={WIDTH}
    >
      {MARK_DOTS.map(([cx, cy, r, fill, opacity]) => {
        const distance = Math.hypot(cx - MARK_CENTER.x, cy - MARK_CENTER.y);
        const resting = Math.min(1, opacity + RESTING_LIFT);
        return (
          <circle
            className="murph-loader-dot"
            cx={cx}
            cy={cy}
            fill={fill}
            key={`${cx}-${cy}`}
            r={r}
            style={{
              "--dot-delay": `${Math.round(distance * RIPPLE_MS_PER_UNIT)}ms`,
              "--dot-opacity": resting,
              "--dot-opacity-peak": Math.min(1, resting + 0.4),
              "--dot-scale": r < 3 ? 1.35 : 1.12,
              "--murph-loader-duration": "1.6s",
            } as CSSProperties}
          />
        );
      })}
    </svg>
  );
}
