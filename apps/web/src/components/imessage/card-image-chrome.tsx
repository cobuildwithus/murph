export const IMESSAGE_CARD_COLOR = {
  balloon: "#FFF5E6",
  primary: "#141217",
  secondary: "#666163",
  divider: "rgba(20,18,23,0.10)",
  progressTrack: "rgba(102,97,99,0.12)",
  systemAccent: "#007AFF",
} as const;

export const IMESSAGE_CARD_SCALE = 3.75;
export const IMESSAGE_CARD_HORIZONTAL_PADDING = 45;
export const IMESSAGE_CARD_VERTICAL_PADDING = 38;

const BADGE = {
  height: 101,
  left: 30,
  markHeight: 53,
  markWidth: 75,
  top: 30,
  width: 135,
} as const;

/**
 * Static stand-in for the Messages-owned transcript badge.
 *
 * The native Studio reserves a 36×27 point badge at (8, 8). Linq does not
 * provide an app badge when the extension is absent, so the fallback bitmap
 * fills that exact footprint with Murph's checked-in SVG mark.
 */
export function IMessageCardBadge({ logoSrc }: { logoSrc: string }) {
  return (
    <div
      aria-hidden="true"
      data-murph-card-badge="svg"
      style={{
        position: "absolute",
        top: BADGE.top,
        left: BADGE.left,
        display: "flex",
        width: BADGE.width,
        height: BADGE.height,
        alignItems: "center",
        justifyContent: "center",
        border: "2px solid rgba(20,18,23,0.08)",
        borderRadius: 999,
        backgroundColor: "#FCFAF5",
        boxShadow: "0 2px 4px rgba(20,18,23,0.08)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders the embedded SVG data URI directly. */}
      <img
        alt=""
        data-murph-card-logo="true"
        height={BADGE.markHeight}
        src={logoSrc}
        width={BADGE.markWidth}
        style={{
          width: BADGE.markWidth,
          height: BADGE.markHeight,
          objectFit: "contain",
        }}
      />
    </div>
  );
}
