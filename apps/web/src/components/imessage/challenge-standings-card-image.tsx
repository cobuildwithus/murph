import type {
  ChallengeStandingsEntryV1,
  ChallengeStandingsResponseCardV1,
  RankedChallengeStandingsResponseCardV1,
} from "@murphai/contracts";

import {
  IMessageCardBadge,
  IMESSAGE_CARD_COLOR,
} from "./card-image-chrome";
import {
  measureDmSans400Text,
  segmentDmSans400Text,
} from "./dm-sans-400-card-metrics";

export const IMESSAGE_CHALLENGE_STANDINGS_CARD_IMAGE_WIDTH = 1_200;

const ACCENT_COLOR = "#AA571F";
const CARD_CONTENT_WIDTH = 1_110;
const TITLE_FONT_SIZE = 64;
const SUBTITLE_FONT_SIZE = 56;
const FOOTER_FONT_SIZE = 49;
const SUBHEADLINE_FONT_SIZE = 56;
const CAPTION_FONT_SIZE = 45;
const CAPTION_2_FONT_SIZE = 41;
const NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  useGrouping: true,
});

type WrappedCardText = {
  lineCount: number;
  text: string;
};

type RankedRowLayout = {
  height: number;
  label: WrappedCardText;
};

type ChallengeStandingsLayout = {
  footer: WrappedCardText | null;
  headerHeight: number;
  height: number;
  rows: RankedRowLayout[];
  subtitle: WrappedCardText | null;
  title: WrappedCardText;
};

export function getChallengeStandingsCardImageSize(
  card: ChallengeStandingsResponseCardV1,
): { width: number; height: number } {
  return {
    width: IMESSAGE_CHALLENGE_STANDINGS_CARD_IMAGE_WIDTH,
    height: getChallengeStandingsLayout(card).height,
  };
}

/**
 * Static counterpart to the shipping SwiftUI challenge standings balloon.
 * Messages owns the outer corner mask; the bitmap owns Murph's canonical mark.
 */
export function ChallengeStandingsCardImage({
  card,
  logoSrc = "/icons/murph-mark.svg",
}: {
  card: ChallengeStandingsResponseCardV1;
  logoSrc?: string;
}) {
  const layout = getChallengeStandingsLayout(card);
  return (
    <div
      data-design-contract="imessage-native-challenge-standings-card"
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        flexDirection: "column",
        padding: "38px 45px 42px",
        backgroundColor: IMESSAGE_CARD_COLOR.balloon,
        color: IMESSAGE_CARD_COLOR.primary,
        fontFamily: "DM Sans",
      }}
    >
      <IMessageCardBadge logoSrc={logoSrc} />

      <div
        data-card-header="below-badge"
        style={{
          display: "flex",
          height: layout.headerHeight,
          flexDirection: "column",
          marginTop: 113,
          gap: 15,
        }}
      >
        <div
          data-card-text-lines={layout.title.lineCount}
          style={{
            display: "flex",
            fontSize: TITLE_FONT_SIZE,
            fontWeight: 600,
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
            whiteSpace: "pre-wrap",
          }}
        >
          {layout.title.text}
        </div>
        {layout.subtitle === null ? null : (
          <div
            data-card-text-lines={layout.subtitle.lineCount}
            style={{
              display: "flex",
              color: IMESSAGE_CARD_COLOR.secondary,
              fontSize: SUBTITLE_FONT_SIZE,
              lineHeight: 1.2,
              whiteSpace: "pre-wrap",
            }}
          >
            {layout.subtitle.text}
          </div>
        )}
      </div>

      {card.format === "collective"
        ? <CollectiveStandings card={card} />
        : <RankedStandings card={card} rows={layout.rows} />}

      {layout.footer === null ? null : (
        <div
          data-card-text-lines={layout.footer.lineCount}
          style={{
            display: "flex",
            marginTop: 53,
            color: IMESSAGE_CARD_COLOR.secondary,
            fontSize: FOOTER_FONT_SIZE,
            lineHeight: 1.25,
            whiteSpace: "pre-wrap",
          }}
        >
          {layout.footer.text}
        </div>
      )}
    </div>
  );
}

function RankedStandings({
  card,
  rows,
}: {
  card: RankedChallengeStandingsResponseCardV1;
  rows: RankedRowLayout[];
}) {
  const ranksVisible = rankingComplete(card.entries);
  return (
    <div
      data-ranking-state={ranksVisible ? "complete" : "withheld"}
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: 53,
      }}
    >
      {card.entries.map((entry, index) => (
        <div
          key={`${entry.label}:${index}`}
          style={{ display: "flex", flexDirection: "column" }}
        >
          <RankedStandingsRow
            card={card}
            entry={entry}
            index={index}
            layout={rows[index] ?? getRankedRowLayout(entry)}
            ranksVisible={ranksVisible}
          />
          {index === card.entries.length - 1 ? null : (
            <div
              aria-hidden="true"
              style={{
                display: "flex",
                height: 2,
                marginLeft: 143,
                backgroundColor: IMESSAGE_CARD_COLOR.divider,
              }}
            />
          )}
        </div>
      ))}
      {ranksVisible ? null : (
        <div
          style={{
            display: "flex",
            marginTop: 38,
            color: IMESSAGE_CARD_COLOR.secondary,
            fontSize: CAPTION_FONT_SIZE,
            lineHeight: 1.2,
          }}
        >
          Ranks appear when every score is complete.
        </div>
      )}
    </div>
  );
}

function RankedStandingsRow({
  card,
  entry,
  index,
  layout,
  ranksVisible,
}: {
  card: RankedChallengeStandingsResponseCardV1;
  entry: ChallengeStandingsEntryV1;
  index: number;
  layout: RankedRowLayout;
  ranksVisible: boolean;
}) {
  const rank = ranksVisible ? challengeRank(card.entries, index) : null;
  const target = card.objective.kind === "target"
    ? card.objective.targetPoints
    : null;
  const progress = target !== null && entry.points !== null
    ? Math.min(1, entry.points / target)
    : null;

  return (
    <div
      style={{
        display: "flex",
        minHeight: layout.height,
        alignItems: "center",
        gap: 38,
      }}
    >
      <div
        aria-hidden="true"
        data-rank={rank ?? "withheld"}
        style={{
          display: "flex",
          width: 105,
          height: 105,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          backgroundColor: rank === 1
            ? "rgba(170,87,31,0.18)"
            : IMESSAGE_CARD_COLOR.progressTrack,
          color: rank === 1 ? ACCENT_COLOR : IMESSAGE_CARD_COLOR.secondary,
          fontSize: 49,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {rank ?? "—"}
      </div>
      <div
        style={{
          display: "flex",
          minWidth: 0,
          flex: 1,
          alignItems: "center",
          justifyContent: "space-between",
          gap: 38,
        }}
      >
        <div
          data-card-text-lines={layout.label.lineCount}
          style={{
            display: "flex",
            minWidth: 0,
            flex: 1,
            fontSize: SUBHEADLINE_FONT_SIZE,
            fontWeight: 600,
            lineHeight: 1.15,
            whiteSpace: "pre-wrap",
          }}
        >
          {layout.label.text}
        </div>
        <div
          style={{
            display: "flex",
            width: 315,
            flexDirection: "column",
            flexShrink: 0,
            alignItems: "flex-end",
            gap: 11,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: SUBHEADLINE_FONT_SIZE,
              fontWeight: 600,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {entry.points === null
              ? "—"
              : `${formatPoints(entry.points)}${
                  entry.coverage === "partial" ? "+" : ""
                }`}
          </div>
          <div
            style={{
              display: "flex",
              color: IMESSAGE_CARD_COLOR.secondary,
              fontSize: CAPTION_2_FONT_SIZE,
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: "0.06em",
            }}
          >
            {target === null ? "PTS" : `OF ${formatPoints(target)} PTS`}
          </div>
          {progress === null ? null : (
            <div
              aria-hidden="true"
              style={{
                display: "flex",
                width: "100%",
                height: 15,
                overflow: "hidden",
                borderRadius: 999,
                backgroundColor: IMESSAGE_CARD_COLOR.progressTrack,
              }}
            >
              <div
                data-entry-progress={progress.toFixed(4)}
                style={{
                  display: "flex",
                  width: `${progress * 100}%`,
                  height: "100%",
                  borderRadius: 999,
                  backgroundColor: ACCENT_COLOR,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CollectiveStandings({
  card,
}: {
  card: Extract<ChallengeStandingsResponseCardV1, { format: "collective" }>;
}) {
  const points = card.collectivePoints;
  const target = card.objective.targetPoints;
  const progress = points === null ? null : Math.min(1, points / target);
  const scoredParticipants = card.coverageCounts.completeParticipants
    + card.coverageCounts.partialParticipants;
  const pointsText = points === null
    ? "—"
    : `${formatPoints(points)}${card.coverage === "partial" ? "+" : ""}`;
  const pointsFontSize = fitDmSansFontSize(pointsText, 760, 135, 74);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: 53,
        gap: 45,
      }}
    >
      <div
        style={{
          display: "flex",
          minHeight: 162,
          alignItems: "baseline",
          gap: 23,
        }}
      >
        <div
          data-points-font-size={pointsFontSize}
          style={{
            display: "flex",
            fontSize: pointsFontSize,
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: "-0.035em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {pointsText}
        </div>
        <div
          style={{
            display: "flex",
            color: IMESSAGE_CARD_COLOR.secondary,
            fontSize: SUBHEADLINE_FONT_SIZE,
            fontWeight: 500,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          / {formatPoints(target)} pts
        </div>
      </div>
      {progress === null ? null : (
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            width: "100%",
            height: 15,
            overflow: "hidden",
            borderRadius: 999,
            backgroundColor: IMESSAGE_CARD_COLOR.progressTrack,
          }}
        >
          <div
            data-collective-progress={progress.toFixed(4)}
            style={{
              display: "flex",
              width: `${progress * 100}%`,
              height: "100%",
              borderRadius: 999,
              backgroundColor: ACCENT_COLOR,
            }}
          />
        </div>
      )}
      <div
        style={{
          display: "flex",
          minHeight: 90,
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 38,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: SUBHEADLINE_FONT_SIZE,
            fontWeight: 600,
            lineHeight: 1.15,
          }}
        >
          {collectiveStatus(card)}
        </div>
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            color: ACCENT_COLOR,
            fontSize: CAPTION_2_FONT_SIZE,
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: "0.06em",
          }}
        >
          {formatPoints(scoredParticipants)}/{formatPoints(
            card.coverageCounts.totalParticipants,
          )} SCORED
        </div>
      </div>
    </div>
  );
}

function getChallengeStandingsLayout(
  card: ChallengeStandingsResponseCardV1,
): ChallengeStandingsLayout {
  const title = wrapCardText(card.title, CARD_CONTENT_WIDTH, TITLE_FONT_SIZE);
  const subtitle = card.subtitle === null
    ? null
    : wrapCardText(card.subtitle, CARD_CONTENT_WIDTH, SUBTITLE_FONT_SIZE);
  const footer = card.footer === null
    ? null
    : wrapCardText(card.footer, CARD_CONTENT_WIDTH, FOOTER_FONT_SIZE);
  const titleHeight = title.lineCount * TITLE_FONT_SIZE * 1.05;
  const subtitleHeight = subtitle === null
    ? 0
    : 15 + subtitle.lineCount * SUBTITLE_FONT_SIZE * 1.2;
  const headerHeight = Math.ceil(titleHeight + subtitleHeight);
  const footerHeight = footer === null
    ? 0
    : 53 + footer.lineCount * FOOTER_FONT_SIZE * 1.25;

  if (card.format === "collective") {
    const collectiveBodyHeight = 162 + 45 + 90
      + (card.collectivePoints === null ? 0 : 45 + 15);
    return {
      footer,
      headerHeight,
      height: Math.ceil(
        38 + 113 + headerHeight + 53 + collectiveBodyHeight + footerHeight + 42,
      ),
      rows: [],
      subtitle,
      title,
    };
  }

  const rows = card.entries.map(getRankedRowLayout);
  const rowsHeight = rows.reduce((total, row) => total + row.height, 0)
    + Math.max(0, rows.length - 1) * 2;
  const incompleteNoteHeight = rankingComplete(card.entries)
    ? 0
    : 38 + CAPTION_FONT_SIZE * 1.2;
  return {
    footer,
    headerHeight,
    height: Math.ceil(
      38 + 113 + headerHeight + 53 + rowsHeight + incompleteNoteHeight
        + footerHeight + 42,
    ),
    rows,
    subtitle,
    title,
  };
}

function getRankedRowLayout(entry: ChallengeStandingsEntryV1): RankedRowLayout {
  const label = wrapCardText(entry.label, 614, SUBHEADLINE_FONT_SIZE);
  return {
    height: Math.max(
      185,
      Math.ceil(68 + label.lineCount * SUBHEADLINE_FONT_SIZE * 1.15),
    ),
    label,
  };
}

function collectiveStatus(
  card: Extract<ChallengeStandingsResponseCardV1, { format: "collective" }>,
): string {
  const points = card.collectivePoints;
  const target = card.objective.targetPoints;
  if (points === null) return "Waiting for shared data";
  if (points >= target) return "Goal reached";
  if (card.coverage === "partial") return "More progress may be pending";
  return `${formatPoints(target - points)} points to go`;
}

function challengeRank(
  entries: readonly ChallengeStandingsEntryV1[],
  index: number,
): number | null {
  const entry = entries[index];
  if (entry === undefined || entry.points === null) return null;
  return entries.findIndex((candidate) => candidate.points === entry.points) + 1;
}

function rankingComplete(entries: readonly ChallengeStandingsEntryV1[]): boolean {
  return entries.every((entry) => entry.coverage === "complete");
}

function fitDmSansFontSize(
  value: string,
  width: number,
  preferredSize: number,
  minimumSize: number,
): number {
  if (measureDmSans400Text(value, preferredSize) <= width) {
    return preferredSize;
  }
  return Math.max(
    minimumSize,
    Math.floor(preferredSize * width / measureDmSans400Text(value, preferredSize)),
  );
}

function wrapCardText(
  value: string,
  width: number,
  fontSize: number,
  letterSpacingEm = 0,
): WrappedCardText {
  const words = value.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine === "" ? word : `${currentLine} ${word}`;
    if (measureDmSans400Text(candidate, fontSize, letterSpacingEm) <= width) {
      currentLine = candidate;
      continue;
    }
    if (currentLine !== "") lines.push(currentLine);
    const fragments = breakOverwideCardToken(
      word,
      width,
      fontSize,
      letterSpacingEm,
    );
    lines.push(...fragments.slice(0, -1));
    currentLine = fragments.at(-1) ?? "";
  }

  if (currentLine !== "" || lines.length === 0) lines.push(currentLine);
  return { lineCount: lines.length, text: lines.join("\n") };
}

function breakOverwideCardToken(
  token: string,
  width: number,
  fontSize: number,
  letterSpacingEm: number,
): string[] {
  const fragments: string[] = [];
  let currentFragment = "";
  for (const grapheme of segmentDmSans400Text(token)) {
    const candidate = `${currentFragment}${grapheme}`;
    if (
      currentFragment !== ""
      && measureDmSans400Text(candidate, fontSize, letterSpacingEm) > width
    ) {
      fragments.push(currentFragment);
      currentFragment = grapheme;
      continue;
    }
    currentFragment = candidate;
  }
  if (currentFragment !== "" || fragments.length === 0) {
    fragments.push(currentFragment);
  }
  return fragments;
}

function formatPoints(points: number): string {
  return NUMBER_FORMATTER.format(points);
}
