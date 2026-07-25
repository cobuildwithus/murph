import { describe, expect, it } from "vitest";

import {
  assistantPersonalityPreferencesSchema,
  assistantPersonalityScoreSchema,
  assistantPersonalityScoresSchema,
  assistantPersonalitySettingIds,
  assistantPersonalitySettingSchema,
  assistantWebPersonalityPreferencesSchema,
  assistantWebPersonalitySettingIds,
  assistantPreferenceCausalSeqSchema,
  assistantPreferenceMutationStateDocumentSchema,
  defaultAssistantPersonalityScores,
  isAssistantPersonalityScore,
  isAssistantPersonalitySettingId,
  preferencesDocumentSchema,
  resolveAssistantPersonalityScores,
} from "../src/preferences.ts";

describe("assistant personality preference contracts", () => {
  it("publishes the fixed setting catalog and product defaults", () => {
    expect(assistantPersonalitySettingIds).toEqual(["humor", "push", "detail", "unhinged"]);
    expect(assistantPersonalitySettingSchema.options).toEqual([
      "humor",
      "push",
      "detail",
      "unhinged",
    ]);
    expect(defaultAssistantPersonalityScores).toEqual({
      humor: 3,
      push: 3,
      detail: 5,
      unhinged: 0,
    });
    expect(Object.isFrozen(defaultAssistantPersonalityScores)).toBe(true);
  });

  it("keeps the conversational-only Unhinged dial out of the web-visible catalog", () => {
    expect(assistantWebPersonalitySettingIds).toEqual(["humor", "push", "detail"]);
    expect(assistantWebPersonalitySettingIds).not.toContain("unhinged");
    // Unhinged accepts the same 0-10 integer contract as every other dial.
    expect(assistantPersonalityPreferencesSchema.parse({ unhinged: 7 })).toEqual({
      unhinged: 7,
    });
    expect(assistantPersonalityPreferencesSchema.safeParse({ unhinged: 4.5 }).success).toBe(
      false,
    );
    // The web-visible personality schema rejects the conversational-only dial.
    expect(assistantWebPersonalityPreferencesSchema.safeParse({ unhinged: 7 }).success).toBe(
      false,
    );
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
      assistantPersonalityScoresSchema.parse({ humor: 0, push: 5, detail: 10, unhinged: 8 }),
    ).toEqual({
      humor: 0,
      push: 5,
      detail: 10,
      unhinged: 8,
    });
    expect(
      assistantPersonalityScoresSchema.safeParse({ humor: 3, push: 3, detail: 5 }).success,
    ).toBe(false);
    expect(
      assistantPersonalityScoresSchema.safeParse({
        humor: 3,
        push: 3,
        detail: 5,
        unhinged: 0,
        unknown: 1,
      }).success,
    ).toBe(false);
  });

  it("resolves sparse preferences over the defaults without changing the defaults", () => {
    expect(resolveAssistantPersonalityScores()).toEqual({
      humor: 3,
      push: 3,
      detail: 5,
      unhinged: 0,
    });
    expect(resolveAssistantPersonalityScores({ humor: 9, detail: 2, unhinged: 8 })).toEqual({
      humor: 9,
      push: 3,
      detail: 2,
      unhinged: 8,
    });
    expect(defaultAssistantPersonalityScores).toEqual({
      humor: 3,
      push: 3,
      detail: 5,
      unhinged: 0,
    });
  });

  it("recognizes only supported setting ids", () => {
    expect(isAssistantPersonalitySettingId("humor")).toBe(true);
    expect(isAssistantPersonalitySettingId("push")).toBe(true);
    expect(isAssistantPersonalitySettingId("detail")).toBe(true);
    expect(isAssistantPersonalitySettingId("unhinged")).toBe(true);
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

  it("keeps causal watermarks in a bounded companion document", () => {
    const mutationDocument = {
      schemaVersion: 1,
      applied: {
        detail: "0",
        humor: "2",
      },
    };

    expect(assistantPreferenceMutationStateDocumentSchema.parse(mutationDocument)).toEqual(
      mutationDocument,
    );
    expect(
      assistantPreferenceMutationStateDocumentSchema.safeParse({
        ...mutationDocument,
        applied: { humor: "01" },
      }).success,
    ).toBe(false);
    expect(
      preferencesDocumentSchema.safeParse({
        schemaVersion: 1,
        updatedAt: "2026-07-12T01:00:00.000Z",
        assistantMutationState: mutationDocument,
        workoutUnitPreferences: {},
        wearablePreferences: { desiredProviders: [] },
      }).success,
    ).toBe(false);
    expect(assistantPreferenceCausalSeqSchema.parse("9223372036854775807")).toBe(
      "9223372036854775807",
    );
    expect(
      assistantPreferenceCausalSeqSchema.safeParse("9223372036854775808").success,
    ).toBe(false);
  });
});
