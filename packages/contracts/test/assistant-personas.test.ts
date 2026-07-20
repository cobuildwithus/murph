import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assistantPersonaIdValues,
  assistantPersonaOptions,
  assistantVoiceOptions,
  resolveAssistantEffectiveStyle,
} from "../src/index.ts";

test("assistant persona catalog is complete and uses valid recommended voices", () => {
  assert.equal(assistantPersonaOptions.length, assistantPersonaIdValues.length);
  assert.deepEqual(
    new Set(assistantPersonaOptions.map((option) => option.id)),
    new Set(assistantPersonaIdValues),
  );
  const voiceIds = new Set(assistantVoiceOptions.map((voice) => voice.id));
  for (const persona of assistantPersonaOptions) {
    assert.equal(persona.recommendedVoiceIds.length, 5);
    assert.equal(new Set(persona.recommendedVoiceIds).size, 5);
    assert.equal(persona.recommendedVoiceIds[0], persona.defaultVoiceId);
    for (const voiceId of persona.recommendedVoiceIds) assert.ok(voiceIds.has(voiceId));
  }
});

test("persona defaults resolve without materializing dial preferences", () => {
  assert.deepEqual(resolveAssistantEffectiveStyle({ persona: "navy-seal" }), {
    persona: "navy-seal",
    personality: { humor: 1, push: 10, detail: 2 },
    tone: "formal",
    voice: "drill-sergeant",
  });
});

test("explicit tone, voice, and dial preferences override persona defaults", () => {
  assert.deepEqual(resolveAssistantEffectiveStyle({
    persona: "navy-seal",
    personality: { push: 6 },
    tone: "casual",
    voice: "warm",
  }), {
    persona: "navy-seal",
    personality: { humor: 1, push: 6, detail: 2 },
    tone: "casual",
    voice: "warm",
  });
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
