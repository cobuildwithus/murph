import { describe, expect, it } from "vitest";

import {
  assistantPersonalityPreferencesSchema,
  assistantPersonalityScoreSchema,
  assistantPersonalityScoresSchema,
  assistantPersonalitySettingIds,
  assistantPersonalitySettingSchema,
  defaultAssistantPersonalityScores,
  isAssistantPersonalityScore,
  isAssistantPersonalitySettingId,
  preferencesDocumentSchema,
  resolveAssistantPersonalityScores,
} from "../src/preferences.ts";

describe("assistant personality preference contracts", () => {
  it("publishes the fixed setting catalog and product defaults", () => {
    expect(assistantPersonalitySettingIds).toEqual(["humor", "push", "detail"]);
    expect(assistantPersonalitySettingSchema.options).toEqual(["humor", "push", "detail"]);
    expect(defaultAssistantPersonalityScores).toEqual({
      humor: 3,
      push: 3,
      detail: 5,
    });
    expect(Object.isFrozen(defaultAssistantPersonalityScores)).toBe(true);
  });

  it("accepts integer scores at both boundaries and rejects invalid scores", () => {
    expect(assistantPersonalityScoreSchema.parse(0)).toBe(0);
    expect(assistantPersonalityScoreSchema.parse(10)).toBe(10);
    expect(isAssistantPersonalityScore(0)).toBe(true);
    expect(isAssistantPersonalityScore(10)).toBe(true);

    for (const invalid of [-1, 11, 4.5, "5", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(assistantPersonalityScoreSchema.safeParse(invalid).success).toBe(false);
      expect(isAssistantPersonalityScore(invalid)).toBe(false);
    }
  });

  it("accepts sparse preferences but rejects unknown or invalid fields", () => {
    expect(assistantPersonalityPreferencesSchema.parse({})).toEqual({});
    expect(assistantPersonalityPreferencesSchema.parse({ humor: 0, detail: 10 })).toEqual({
      humor: 0,
      detail: 10,
    });
    expect(
      assistantPersonalityPreferencesSchema.safeParse({ humor: 3, surprise: 9 }).success,
    ).toBe(false);
    expect(assistantPersonalityPreferencesSchema.safeParse({ push: null }).success).toBe(false);
  });

  it("requires every score in the resolved score schema", () => {
    expect(
      assistantPersonalityScoresSchema.parse({ humor: 0, push: 5, detail: 10 }),
    ).toEqual({
      humor: 0,
      push: 5,
      detail: 10,
    });
    expect(assistantPersonalityScoresSchema.safeParse({ humor: 3 }).success).toBe(false);
    expect(
      assistantPersonalityScoresSchema.safeParse({
        humor: 3,
        push: 3,
        detail: 5,
        unknown: 1,
      }).success,
    ).toBe(false);
  });

  it("resolves sparse preferences over the defaults without changing the defaults", () => {
    expect(resolveAssistantPersonalityScores()).toEqual({
      humor: 3,
      push: 3,
      detail: 5,
    });
    expect(resolveAssistantPersonalityScores({ humor: 9, detail: 2 })).toEqual({
      humor: 9,
      push: 3,
      detail: 2,
    });
    expect(defaultAssistantPersonalityScores).toEqual({
      humor: 3,
      push: 3,
      detail: 5,
    });
  });

  it("recognizes only supported setting ids", () => {
    expect(isAssistantPersonalitySettingId("humor")).toBe(true);
    expect(isAssistantPersonalitySettingId("push")).toBe(true);
    expect(isAssistantPersonalitySettingId("detail")).toBe(true);
    expect(isAssistantPersonalitySettingId("intensity")).toBe(false);
    expect(isAssistantPersonalitySettingId(3)).toBe(false);
  });

  it("keeps old preference documents valid and accepts sparse personality overrides", () => {
    const oldDocument = {
      schemaVersion: 1,
      updatedAt: "2026-07-10T10:00:00.000Z",
      assistant: {
        tone: "casual",
        voice: "deep-calm",
      },
      workoutUnitPreferences: {},
      wearablePreferences: {
        desiredProviders: [],
      },
    };

    expect(preferencesDocumentSchema.parse(oldDocument)).toEqual(oldDocument);
    expect(
      preferencesDocumentSchema.parse({
        ...oldDocument,
        assistant: {
          ...oldDocument.assistant,
          personality: {
            humor: 9,
          },
        },
      }).assistant,
    ).toEqual({
      tone: "casual",
      voice: "deep-calm",
      personality: {
        humor: 9,
      },
    });
  });

  it("rejects unknown personality fields inside a preference document", () => {
    expect(
      preferencesDocumentSchema.safeParse({
        schemaVersion: 1,
        updatedAt: "2026-07-10T10:00:00.000Z",
        assistant: {
          personality: {
            humor: 9,
            sarcasm: 10,
          },
        },
        workoutUnitPreferences: {},
        wearablePreferences: {
          desiredProviders: [],
        },
      }).success,
    ).toBe(false);
  });

  it("accepts one bounded per-setting causal watermark map", () => {
    const document = {
      schemaVersion: 1,
      updatedAt: "2026-07-12T01:00:00.000Z",
      assistantMutationState: {
        applied: {
          detail: "0",
          humor: "2",
        },
      },
      workoutUnitPreferences: {},
      wearablePreferences: {
        desiredProviders: [],
      },
    };

    expect(preferencesDocumentSchema.parse(document)).toEqual(document);
    expect(
      preferencesDocumentSchema.safeParse({
        ...document,
        assistantMutationState: {
          applied: { humor: "01" },
        },
      }).success,
    ).toBe(false);
  });
});
