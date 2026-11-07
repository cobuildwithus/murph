import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assistantPersonaOptions,
  assistantPreferencesSchema,
  normalizeStoredAssistantPersonaId,
  isAssistantPersonaId,
  resolveAssistantEffectiveStyle,
} from "../src/index.ts";

test("Classic is the only available persona", () => {
  assert.deepEqual(assistantPersonaOptions.map((option) => option.id), ["classic"]);
  for (const retired of ["scientist", "navy-seal-with-classic", "wise-elder"]) {
    assert.equal(isAssistantPersonaId(retired), false);
    assert.equal(assistantPreferencesSchema.safeParse({ persona: retired }).success, true);
    assert.equal(normalizeStoredAssistantPersonaId(retired), "classic");
  }
  assert.equal(normalizeStoredAssistantPersonaId("unknown"), null);
  assert.equal(normalizeStoredAssistantPersonaId(null), null);
});

test("Classic preserves explicit tone, voice, and dial preferences", () => {
  assert.deepEqual(resolveAssistantEffectiveStyle({
    persona: "navy-seal-with-scientist",
    personality: { humor: 9, push: 6 },
    tone: "casual",
    voice: "warm",
  }), {
    persona: "classic",
    personality: { humor: 9, push: 6, detail: 5, unhinged: 0 },
    tone: "casual",
    voice: "warm",
  });
});
