import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  assistantResponseCardSchema,
  challengeStandingsCardV1Bounds,
  IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH,
  challengeStandingsResponseCardV1Schema,
  IMESSAGE_APP_CARD_URL_PREFIX,
  type ChallengeStandingsResponseCardV1,
} from "../src/index.ts";

const INDIVIDUAL_CARD: ChallengeStandingsResponseCardV1 = {
  kind: "challenge_standings",
  version: 1,
  format: "individual",
  title: "Weird Health Week",
  subtitle: "Day 4 of 7",
  objective: { kind: "ranking" },
  entries: [
    {
      label: "Maya",
      points: 120,
      coverage: "complete",
      detail: null,
    },
    {
      label: "Jon",
      points: 90,
      coverage: "partial",
      detail: null,
    },
    {
      label: "Priya",
      points: null,
      coverage: "unscored",
      detail: null,
    },
  ],
  footer: null,
};

const COLLECTIVE_CARD: ChallengeStandingsResponseCardV1 = {
  kind: "challenge_standings",
  version: 1,
  format: "collective",
  title: "Move Atlanta Together",
  subtitle: "Updated after Friday's check-in",
  objective: { kind: "target", targetPoints: 1_000 },
  collectivePoints: 640,
  coverage: "partial",
  coverageCounts: {
    completeParticipants: 1,
    partialParticipants: 1,
    totalParticipants: 3,
    unscoredParticipants: 1,
  },
  footer: null,
};

describe("challenge standings response-card contract", () => {
  it("accepts ranked individual, team, and collective snapshots", () => {
    expect(challengeStandingsResponseCardV1Schema.parse(INDIVIDUAL_CARD)).toEqual(
      INDIVIDUAL_CARD,
    );
    expect(assistantResponseCardSchema.parse(INDIVIDUAL_CARD)).toEqual(
      INDIVIDUAL_CARD,
    );

    const teamCard: ChallengeStandingsResponseCardV1 = {
      ...INDIVIDUAL_CARD,
      format: "teams",
      objective: { kind: "target", targetPoints: 250 },
      entries: [
        {
          label: "Cold Plungers",
          points: 210,
          coverage: "complete",
          detail: null,
        },
        {
          label: "Sauna Goblins",
          points: 180,
          coverage: "complete",
          detail: null,
        },
      ],
    };
    expect(challengeStandingsResponseCardV1Schema.parse(teamCard)).toEqual(
      teamCard,
    );
    expect(challengeStandingsResponseCardV1Schema.parse(COLLECTIVE_CARD)).toEqual(
      COLLECTIVE_CARD,
    );
  });

  it("keeps scored and unscored coverage honest", () => {
    for (const invalidEntry of [
      { ...INDIVIDUAL_CARD.entries[0]!, coverage: "unscored" as const },
      { ...INDIVIDUAL_CARD.entries[2]!, coverage: "partial" as const },
    ]) {
      expect(challengeStandingsResponseCardV1Schema.safeParse({
        ...INDIVIDUAL_CARD,
        entries: [invalidEntry],
      }).success).toBe(false);
    }

    expect(challengeStandingsResponseCardV1Schema.safeParse({
      ...COLLECTIVE_CARD,
      coverage: "unscored",
    }).success).toBe(false);
    expect(challengeStandingsResponseCardV1Schema.safeParse({
      ...COLLECTIVE_CARD,
      collectivePoints: null,
      coverage: "unscored",
      coverageCounts: {
        completeParticipants: 0,
        partialParticipants: 0,
        totalParticipants: 3,
        unscoredParticipants: 3,
      },
    }).success).toBe(true);
    expect(challengeStandingsResponseCardV1Schema.safeParse({
      ...INDIVIDUAL_CARD,
      entries: [{
        ...INDIVIDUAL_CARD.entries[0]!,
        detail: "Private evidence must not enter a group card.",
      }],
    }).success).toBe(false);

    for (const coverageCounts of [
      {
        completeParticipants: 1,
        partialParticipants: 1,
        totalParticipants: 4,
        unscoredParticipants: 1,
      },
      {
        completeParticipants: 0,
        partialParticipants: 0,
        totalParticipants: 0,
        unscoredParticipants: 0,
      },
    ]) {
      expect(challengeStandingsResponseCardV1Schema.safeParse({
        ...COLLECTIVE_CARD,
        coverageCounts,
      }).success).toBe(false);
    }
    expect(challengeStandingsResponseCardV1Schema.safeParse({
      ...COLLECTIVE_CARD,
      coverage: "complete",
    }).success).toBe(false);
  });

  it("requires descending ranked entries with unscored entries last", () => {
    expect(challengeStandingsResponseCardV1Schema.safeParse({
      ...INDIVIDUAL_CARD,
      entries: [INDIVIDUAL_CARD.entries[1]!, INDIVIDUAL_CARD.entries[0]!],
    }).success).toBe(false);
    expect(challengeStandingsResponseCardV1Schema.safeParse({
      ...INDIVIDUAL_CARD,
      entries: [INDIVIDUAL_CARD.entries[2]!, INDIVIDUAL_CARD.entries[0]!],
    }).success).toBe(false);

    expect(challengeStandingsResponseCardV1Schema.safeParse({
      ...INDIVIDUAL_CARD,
      entries: [
        INDIVIDUAL_CARD.entries[0]!,
        { ...INDIVIDUAL_CARD.entries[0]!, label: "Tied friend" },
      ],
    }).success).toBe(true);
  });

  it("requires collective challenges to use a positive target", () => {
    expect(challengeStandingsResponseCardV1Schema.safeParse({
      ...COLLECTIVE_CARD,
      objective: { kind: "ranking" },
    }).success).toBe(false);
    expect(challengeStandingsResponseCardV1Schema.safeParse({
      ...COLLECTIVE_CARD,
      objective: { kind: "target", targetPoints: 0 },
    }).success).toBe(false);
  });

  it("enforces compact shape, text, and URL bounds", () => {
    expect(challengeStandingsResponseCardV1Schema.safeParse({
      ...INDIVIDUAL_CARD,
      entries: Array.from(
        { length: challengeStandingsCardV1Bounds.entries + 1 },
        (_, index) => ({
          label: `Friend ${index + 1}`,
          points: 100 - index,
          coverage: "complete" as const,
          detail: null,
        }),
      ),
    }).success).toBe(false);

    for (const title of [
      " Weird Health Week",
      "Weird\nHealth Week",
      "Weird\u0085Health Week",
      "Weird\uFEFFHealth Week",
    ]) {
      expect(challengeStandingsResponseCardV1Schema.safeParse({
        ...INDIVIDUAL_CARD,
        title,
      }).success).toBe(false);
    }

    const maximumRankedCard: ChallengeStandingsResponseCardV1 = {
      ...INDIVIDUAL_CARD,
      title: "T".repeat(challengeStandingsCardV1Bounds.title),
      subtitle: "S".repeat(challengeStandingsCardV1Bounds.subtitle),
      entries: Array.from(
        { length: challengeStandingsCardV1Bounds.entries },
        (_, index) => ({
          label: `${String(index + 1).padStart(2, "0")}${"L".repeat(
            challengeStandingsCardV1Bounds.entryLabel - 2,
          )}`,
          points: challengeStandingsCardV1Bounds.entries - index,
          coverage: "complete" as const,
          detail: null,
        }),
      ),
      footer: "F".repeat(challengeStandingsCardV1Bounds.footer),
    };
    const encodedLength = (card: ChallengeStandingsResponseCardV1) =>
      `${IMESSAGE_APP_CARD_URL_PREFIX}${Buffer.from(JSON.stringify({
        schemaVersion: 5,
        card,
      }), "utf8").toString("base64url")}`.length;

    expect(encodedLength(maximumRankedCard)).toBe(1_945);
    expect(challengeStandingsResponseCardV1Schema.parse(maximumRankedCard)).toEqual(
      maximumRankedCard,
    );
  });

  it("keeps inline and static image URLs within their UTF-8 boundaries", () => {
    const makeBoundaryCard = (
      multibyteCharacters: number,
    ): ChallengeStandingsResponseCardV1 => {
      const titleMultibyteCharacters = Math.min(multibyteCharacters, 60);
      const subtitleMultibyteCharacters = Math.max(
        0,
        multibyteCharacters - titleMultibyteCharacters,
      );
      return {
        ...INDIVIDUAL_CARD,
        title: `${"é".repeat(titleMultibyteCharacters)}${"T".repeat(
          60 - titleMultibyteCharacters,
        )}`,
        subtitle: `${"é".repeat(subtitleMultibyteCharacters)}${"S".repeat(
          120 - subtitleMultibyteCharacters,
        )}`,
        objective: {
          kind: "target",
          targetPoints: Number.MAX_SAFE_INTEGER,
        },
        entries: Array.from({ length: 8 }, (_, index) => ({
          label: "L".repeat(40),
          points: Number.MAX_SAFE_INTEGER - index,
          coverage: "complete" as const,
          detail: null,
        })),
        footer: "F".repeat(120),
      };
    };
    const encodedLength = (card: ChallengeStandingsResponseCardV1) =>
      `${IMESSAGE_APP_CARD_URL_PREFIX}${Buffer.from(JSON.stringify({
        schemaVersion: 5,
        card,
      }), "utf8").toString("base64url")}`.length;
    const encodedPayloadLength = (card: ChallengeStandingsResponseCardV1) =>
      Buffer.from(JSON.stringify({ schemaVersion: 5, card }), "utf8")
        .toString("base64url").length;

    const acceptedCard = makeBoundaryCard(78);
    expect(encodedLength(acceptedCard)).toBe(2_037);
    expect(encodedPayloadLength(acceptedCard)).toBe(2_000);
    expect(encodedPayloadLength(acceptedCard)).toBeLessThanOrEqual(
      IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH,
    );
    expect(challengeStandingsResponseCardV1Schema.parse(acceptedCard)).toEqual(
      acceptedCard,
    );

    const rejectedCard = makeBoundaryCard(79);
    expect(encodedLength(rejectedCard)).toBe(2_039);
    expect(encodedPayloadLength(rejectedCard)).toBe(2_002);
    expect(challengeStandingsResponseCardV1Schema.safeParse(rejectedCard).success)
      .toBe(false);
  });

  it("rejects unknown fields and unsupported kinds", () => {
    expect(challengeStandingsResponseCardV1Schema.safeParse({
      ...INDIVIDUAL_CARD,
      extra: true,
    }).success).toBe(false);
    expect(assistantResponseCardSchema.safeParse({
      ...INDIVIDUAL_CARD,
      kind: "leaderboard",
    }).success).toBe(false);
  });
});
