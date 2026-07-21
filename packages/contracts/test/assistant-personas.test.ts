import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assistantBasePersonaIdValues,
  assistantBasePersonaOptions,
  assistantPersonaIdValues,
  assistantPersonaOptions,
  assistantPreferencesSchema,
  assistantVoiceOptions,
  isAssistantPersonaId,
  normalizeStoredAssistantPersonaId,
  resolveAssistantEffectiveStyle,
  resolveAssistantPersonaCombinationId,
  resolveAssistantPersonaParts,
  resolveAssistantPersonaRecommendedVoiceOptions,
} from "../src/index.ts";

test("assistant persona catalog contains exactly six bases and 36 ordered combinations", () => {
  assert.equal(assistantBasePersonaOptions.length, 6);
  assert.deepEqual(
    assistantBasePersonaOptions.map((option) => option.id),
    assistantBasePersonaIdValues,
  );
  const expectedCombinationIds = assistantBasePersonaIdValues.flatMap((mainId) => [
    mainId,
    ...assistantBasePersonaIdValues
      .filter((supportingId) => supportingId !== mainId)
      .map((supportingId) => `${mainId}-with-${supportingId}`),
  ]);

  assert.equal(assistantPersonaOptions.length, 36);
  assert.deepEqual(assistantPersonaIdValues, expectedCombinationIds);
  assert.deepEqual(
    assistantPersonaOptions.map((option) => option.id),
    expectedCombinationIds,
  );
  assert.equal(new Set(assistantPersonaOptions.map((option) => option.id)).size, 36);
  assert.equal(new Set(assistantPersonaOptions.map((option) => option.promptBody)).size, 36);

  for (const option of assistantPersonaOptions) {
    assert.equal(
      option.id,
      option.supportingId === null
        ? option.mainId
        : `${option.mainId}-with-${option.supportingId}`,
    );
  }

  for (const mainId of assistantBasePersonaIdValues) {
    const combinations = assistantPersonaOptions.filter(
      (option) => option.mainId === mainId,
    );
    assert.equal(combinations.length, 6);
    assert.deepEqual(
      new Set(combinations.map((option) => option.supportingId)),
      new Set([
        null,
        ...assistantBasePersonaIdValues.filter((supportingId) => supportingId !== mainId),
      ]),
    );
    assert.ok(combinations.every((option) => option.supportingId !== mainId));
  }
});

test("combination helpers preserve order and round trip every premade id", () => {
  for (const option of assistantPersonaOptions) {
    assert.equal(
      resolveAssistantPersonaCombinationId(option.mainId, option.supportingId),
      option.id,
    );
    assert.deepEqual(resolveAssistantPersonaParts(option.id), {
      id: option.id,
      mainId: option.mainId,
      supportingId: option.supportingId,
    });
  }

  assert.notEqual(
    resolveAssistantPersonaCombinationId("navy-seal", "classic"),
    resolveAssistantPersonaCombinationId("classic", "navy-seal"),
  );
  assert.throws(
    () => resolveAssistantPersonaCombinationId("scientist", "scientist"),
    /must differ/u,
  );
});

test("voice recommendations and defaults always follow the main personality", () => {
  const voiceIds = new Set(assistantVoiceOptions.map((voice) => voice.id));
  for (const persona of assistantPersonaOptions) {
    assert.equal(persona.recommendedVoiceIds.length, 5);
    assert.equal(new Set(persona.recommendedVoiceIds).size, 5);
    assert.equal(persona.recommendedVoiceIds[0], persona.defaultVoiceId);
    assert.ok(persona.recommendedVoiceIds.every((voiceId) => voiceIds.has(voiceId)));
    assert.deepEqual(
      resolveAssistantPersonaRecommendedVoiceOptions(persona.id).map((voice) => voice.id),
      persona.recommendedVoiceIds,
    );

    const main = assistantBasePersonaOptions.find((option) => option.id === persona.mainId);
    assert.ok(main);
    assert.equal(persona.defaultTone, main.defaultTone);
    assert.equal(persona.defaultVoiceId, main.defaultVoiceId);
    assert.deepEqual(persona.personality, main.personality);
  }
});

test("supported persona defaults resolve from the main personality", () => {
  assert.deepEqual(
    resolveAssistantEffectiveStyle({ persona: "navy-seal-with-classic" }),
    {
      persona: "navy-seal-with-classic",
      personality: { humor: 1, push: 10, detail: 2 },
      tone: "formal",
      voice: "drill-sergeant",
    },
  );
});

test("explicit tone, voice, and dial preferences override combination defaults", () => {
  assert.deepEqual(resolveAssistantEffectiveStyle({
    persona: "navy-seal-with-scientist",
    personality: { push: 6 },
    tone: "casual",
    voice: "warm",
  }), {
    persona: "navy-seal-with-scientist",
    personality: { humor: 1, push: 6, detail: 2 },
    tone: "casual",
    voice: "warm",
  });
});

test("legacy ids normalize only while reading persisted preferences", () => {
  const expectedLegacyMappings = new Map([
    ["wise-elder", "stoic-philosopher"],
    ["medical-detective", "scientist"],
    ["longevity-scientist", "scientist"],
    ["zen-monk", "stoic-philosopher"],
    ["best-friend", "straight-talking-friend"],
    ["championship-coach", "navy-seal"],
    ["science-professor", "scientist"],
    ["mountain-guide", "stoic-philosopher"],
    ["grandma", "classic"],
    ["biohacker", "scientist"],
    ["drill-sergeant", "navy-seal"],
  ]);

  for (const [legacyId, canonicalId] of expectedLegacyMappings) {
    assert.equal(normalizeStoredAssistantPersonaId(legacyId), canonicalId);
    assert.equal(isAssistantPersonaId(legacyId), false);
    assert.equal(
      assistantPreferencesSchema.safeParse({ persona: legacyId }).success,
      false,
    );
  }
  assert.equal(isAssistantPersonaId("scientist"), true);
});

test("missing persona preserves Classic Murph with existing overrides", () => {
  assert.deepEqual(resolveAssistantEffectiveStyle({
    personality: { humor: 9 },
    voice: "classic",
  }), {
    persona: "classic",
    personality: { humor: 9, push: 3, detail: 5 },
    tone: "formal",
    voice: "classic",
  });
});
