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
  top: 30,
  width: 135,
} as const;

const IMESSAGE_CARD_BADGE_CONTENT_GAP = 40;
const IMESSAGE_CARD_HEADER_BADGE_GAP = 30;
const IMESSAGE_CARD_HEADER_LEFT_OFFSET =
  BADGE.left - IMESSAGE_CARD_HORIZONTAL_PADDING;
const IMESSAGE_CARD_HEADER_TOP_OFFSET =
  BADGE.top - IMESSAGE_CARD_VERTICAL_PADDING;

export const IMESSAGE_CARD_HEADER_BESIDE_BADGE_INSET =
  BADGE.left + BADGE.width + IMESSAGE_CARD_HEADER_BADGE_GAP
  - IMESSAGE_CARD_HORIZONTAL_PADDING;
export const IMESSAGE_CARD_HEADER_TITLE_ROW_HEIGHT = BADGE.height;
export const IMESSAGE_CARD_HEADER_TEXT_GAP = 15;
export const IMESSAGE_CARD_HEADER_TITLE_FONT_SIZE = 64;
export const IMESSAGE_CARD_HEADER_SUBTITLE_FONT_SIZE = 56;
export const IMESSAGE_CARD_BADGE_CONTENT_TOP =
  BADGE.top + BADGE.height + IMESSAGE_CARD_BADGE_CONTENT_GAP;

type IMessageCardHeaderText = {
  lineCount: number;
  text: string;
};

/**
 * Empty footprint for the Messages-owned transcript badge.
 *
 * The native Studio reserves a 36×27 point badge at (8, 8). Linq app cards
 * carry Murph's App Store id, so Messages draws Murph's app art there on the
 * static fallback too; painting a mark into the bitmap would show it twice.
 */
function IMessageCardBadgeSpace() {
  return (
    <div
      aria-hidden="true"
      data-imessage-card-badge-space="true"
      style={{
        display: "flex",
        width: BADGE.width,
        height: BADGE.height,
        flexShrink: 0,
      }}
    />
  );
}

/** Shared heading and optional subtitle hierarchy beside the badge space. */
export function IMessageCardHeader({
  height,
  subtitle,
  title,
}: {
  height: number;
  subtitle: IMessageCardHeaderText | null;
  title: IMessageCardHeaderText;
}) {
  return (
    <div
      data-card-header="beside-badge"
      data-imessage-card-header="true"
      style={{
        display: "flex",
        height,
        flexDirection: "column",
        marginLeft: IMESSAGE_CARD_HEADER_LEFT_OFFSET,
        gap: IMESSAGE_CARD_HEADER_TEXT_GAP,
        transform: `translateY(${IMESSAGE_CARD_HEADER_TOP_OFFSET}px)`,
      }}
    >
      <div
        data-imessage-card-title-row="true"
        style={{
          display: "flex",
          minHeight: IMESSAGE_CARD_HEADER_TITLE_ROW_HEIGHT,
          alignItems: "center",
          gap: IMESSAGE_CARD_HEADER_BADGE_GAP,
        }}
      >
        <IMessageCardBadgeSpace />
        <h1
          data-card-text-lines={title.lineCount}
          style={{
            display: "flex",
            flex: 1,
            margin: 0,
            fontSize: IMESSAGE_CARD_HEADER_TITLE_FONT_SIZE,
            fontWeight: 600,
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
            whiteSpace: "pre-wrap",
          }}
        >
          {title.text}
        </h1>
      </div>
      {subtitle === null ? null : (
        <div
          data-card-text-lines={subtitle.lineCount}
          style={{
            display: "flex",
            marginLeft: IMESSAGE_CARD_HORIZONTAL_PADDING - BADGE.left,
            color: IMESSAGE_CARD_COLOR.secondary,
            fontSize: IMESSAGE_CARD_HEADER_SUBTITLE_FONT_SIZE,
            lineHeight: 1.2,
            whiteSpace: "pre-wrap",
          }}
        >
          {subtitle.text}
        </div>
      )}
    </div>
  );
}
