import type {
  ChallengeStandingsEntryV1,
  ChallengeStandingsResponseCardV1,
  RankedChallengeStandingsResponseCardV1,
} from "@murphai/contracts";

import { IMESSAGE_CARD_COLOR } from "./card-image-chrome";

export const IMESSAGE_CHALLENGE_STANDINGS_CARD_IMAGE_WIDTH = 1_200;

const ACCENT_COLOR = "#AA571F";
const NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  useGrouping: true,
});

export function getChallengeStandingsCardImageSize(
  card: ChallengeStandingsResponseCardV1,
): { width: number; height: number } {
  const headerExtraHeight = getHeaderExtraHeight(card);
  if (card.format === "collective") {
    return {
      width: IMESSAGE_CHALLENGE_STANDINGS_CARD_IMAGE_WIDTH,
      height: (card.footer === null ? 568 : 625) + headerExtraHeight,
    };
  }

  const rankingNoteHeight = rankingComplete(card.entries) ? 0 : 58;
  const footerHeight = card.footer === null ? 0 : 58;
  return {
    width: IMESSAGE_CHALLENGE_STANDINGS_CARD_IMAGE_WIDTH,
    height: Math.max(
      568,
      250
        + headerExtraHeight
        + card.entries.length * 102
        + rankingNoteHeight
        + footerHeight,
    ),
  };
}

/**
 * Static counterpart to the shipping SwiftUI challenge standings balloon.
 * Messages owns the outer corner mask, so the bitmap remains rectangular.
 */
export function ChallengeStandingsCardImage({
  card,
}: {
  card: ChallengeStandingsResponseCardV1;
}) {
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
      <div
        style={{
          display: "flex",
          minHeight: 105,
          flexDirection: "column",
          justifyContent: "center",
          marginLeft: 155,
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 48,
            fontWeight: 600,
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
          }}
        >
          {card.title}
        </div>
        {card.subtitle === null ? null : (
          <div
            style={{
              display: "flex",
              color: IMESSAGE_CARD_COLOR.secondary,
              fontSize: 28,
              lineHeight: 1.2,
            }}
          >
            {card.subtitle}
          </div>
        )}
      </div>

      {card.format === "collective"
        ? <CollectiveStandings card={card} />
        : <RankedStandings card={card} />}

      {card.footer === null ? null : (
        <div
          style={{
            display: "flex",
            marginTop: 20,
            color: IMESSAGE_CARD_COLOR.secondary,
            fontSize: 24,
            lineHeight: 1.25,
          }}
        >
          {card.footer}
        </div>
      )}
    </div>
  );
}

function RankedStandings({
  card,
}: {
  card: RankedChallengeStandingsResponseCardV1;
}) {
  const ranksVisible = rankingComplete(card.entries);
  return (
    <div
      data-ranking-state={ranksVisible ? "complete" : "withheld"}
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: 26,
      }}
    >
      {card.entries.map((entry, index) => (
        <RankedStandingsRow
          key={`${entry.label}:${index}`}
          card={card}
          entry={entry}
          index={index}
          ranksVisible={ranksVisible}
        />
      ))}
      {ranksVisible ? null : (
        <div
          style={{
            display: "flex",
            marginTop: 18,
            color: IMESSAGE_CARD_COLOR.secondary,
            fontSize: 24,
            lineHeight: 1.25,
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
  ranksVisible,
}: {
  card: RankedChallengeStandingsResponseCardV1;
  entry: ChallengeStandingsEntryV1;
  index: number;
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
        minHeight: 102,
        alignItems: "center",
        borderBottom: `2px solid ${IMESSAGE_CARD_COLOR.divider}`,
        gap: 24,
      }}
    >
      <div
        aria-hidden="true"
        data-rank={rank ?? "withheld"}
        style={{
          display: "flex",
          width: 58,
          height: 58,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          backgroundColor: rank === 1
            ? "rgba(170,87,31,0.18)"
            : IMESSAGE_CARD_COLOR.progressTrack,
          color: rank === 1 ? ACCENT_COLOR : IMESSAGE_CARD_COLOR.secondary,
          fontSize: 28,
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
          flexDirection: "column",
          justifyContent: "center",
          gap: 11,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              minWidth: 0,
              flex: 1,
              fontSize: entry.label.length > 45
                ? 24
                : entry.label.length > 30
                  ? 28
                  : 34,
              fontWeight: 600,
              lineHeight: 1.1,
            }}
          >
            {entry.label}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              alignItems: "flex-end",
              gap: 2,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 34,
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
                fontSize: 19,
                fontWeight: 600,
                lineHeight: 1,
                letterSpacing: "0.06em",
              }}
            >
              {target === null ? "PTS" : `OF ${formatPoints(target)} PTS`}
            </div>
          </div>
        </div>
        {progress === null ? null : (
          <div
            aria-hidden="true"
            style={{
              display: "flex",
              width: "100%",
              height: 10,
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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: 34,
        gap: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 88,
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: "-0.035em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {points === null
            ? "—"
            : `${formatPoints(points)}${card.coverage === "partial" ? "+" : ""}`}
        </div>
        <div
          style={{
            display: "flex",
            color: IMESSAGE_CARD_COLOR.secondary,
            fontSize: 32,
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
            height: 16,
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
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 32,
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
            fontSize: 21,
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

function getHeaderExtraHeight(card: ChallengeStandingsResponseCardV1): number {
  const titleExtraHeight = card.title.length > 32 ? 52 : 0;
  const subtitleExtraHeight = card.subtitle !== null && card.subtitle.length > 60
    ? 34
    : 0;
  return titleExtraHeight + subtitleExtraHeight;
}

function formatPoints(points: number): string {
  return NUMBER_FORMATTER.format(points);
}
