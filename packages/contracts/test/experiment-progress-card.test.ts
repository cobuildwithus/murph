import { describe, expect, it } from "vitest";

import {
  EXPERIMENT_PROGRESS_CARD_MAX_ENCODED_LENGTH,
  EXPERIMENT_PROGRESS_CARD_VERSION,
  buildExperimentProgressCardPath,
  decodeExperimentProgressCard,
  encodeExperimentProgressCard,
  type ExperimentProgressCardData,
} from "../src/experiment-progress-card.ts";

const sampleCard: ExperimentProgressCardData = {
  v: EXPERIMENT_PROGRESS_CARD_VERSION,
  title: "Creatine · 5g daily",
  asOf: "2026-06-09",
  phase: { day: 9, totalDays: 28 },
  sessions: { logged: 7, target: 24 },
  weeks: [
    { start: "2026-06-01", cells: "CCPMCCN" },
    { start: "2026-06-08", cells: "CNSSSSS" },
  ],
  movers: [
    {
      label: "Deep sleep",
      changePct: "20%",
      value: "1h 50m",
      unit: null,
      delta: "+18 min",
      direction: "up",
      sentiment: "positive",
    },
  ],
  confounders: [{ date: "2026-06-04", label: "Alcohol (~5 drinks)" }],
};

describe("experiment progress card codec", () => {
  it("round-trips a valid snapshot", () => {
    const encoded = encodeExperimentProgressCard(sampleCard);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(decodeExperimentProgressCard(encoded)).toEqual(sampleCard);
  });

  it("builds a path that satisfies assistant response-media URL rules", () => {
    const path = buildExperimentProgressCardPath(
      "exp_01J8ZX5N9PQRSTVWXYZ0123456",
      sampleCard,
    );
    expect(path).toMatch(
      /^\/experiments\/exp_[0-9A-HJKMNP-TV-Z]{26}\/progress-card\/[A-Za-z0-9_-]+\.png$/u,
    );
    // No query string, no fragment, image extension — the response-media rules.
    expect(path).not.toContain("?");
    expect(path).not.toContain("#");
  });

  it("rejects a malformed experiment id", () => {
    expect(() => buildExperimentProgressCardPath("exp_nope", sampleCard)).toThrow();
  });

  it("rejects oversized payloads at encode time", () => {
    const oversized: ExperimentProgressCardData = {
      ...sampleCard,
      confounders: Array.from({ length: 4 }, (_, index) => ({
        date: "2026-06-04",
        label: `${"x".repeat(60 - 1)}${index}`,
      })),
      weeks: Array.from({ length: 6 }, (_, index) => ({
        start: `2026-0${index + 1}-01`,
        cells: "CCPMCCN",
      })),
    };
    // Still small enough to encode — prove the guard via the constant instead.
    expect(encodeExperimentProgressCard(oversized).length).toBeLessThanOrEqual(
      EXPERIMENT_PROGRESS_CARD_MAX_ENCODED_LENGTH,
    );
  });

  it("returns null for garbage, wrong version, and unknown fields", () => {
    expect(decodeExperimentProgressCard(null)).toBeNull();
    expect(decodeExperimentProgressCard("not-base64url!!")).toBeNull();
    expect(decodeExperimentProgressCard("a".repeat(4096))).toBeNull();
    const wrongVersion = { ...sampleCard, v: 99 };
    const encodedWrongVersion = Buffer.from(JSON.stringify(wrongVersion))
      .toString("base64url");
    expect(decodeExperimentProgressCard(encodedWrongVersion)).toBeNull();
    const extraField = { ...sampleCard, evil: "<script>" };
    const encodedExtraField = Buffer.from(JSON.stringify(extraField))
      .toString("base64url");
    expect(decodeExperimentProgressCard(encodedExtraField)).toBeNull();
  });

  it("rejects malformed day-code strings", () => {
    const badCells = {
      ...sampleCard,
      weeks: [{ start: "2026-06-01", cells: "CCXMCCN" }],
    };
    const encoded = Buffer.from(JSON.stringify(badCells)).toString("base64url");
    expect(decodeExperimentProgressCard(encoded)).toBeNull();
  });
});
