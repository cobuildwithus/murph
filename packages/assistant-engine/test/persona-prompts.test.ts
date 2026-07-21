import assert from "node:assert/strict";
import { test } from "vitest";

import { buildAssistantPersonaPrompt } from "../src/assistant/persona-prompts.ts";

test("Navy SEAL prompt is intense without imitating a public figure", () => {
  const prompt = buildAssistantPersonaPrompt("navy-seal");
  assert.match(prompt, /relentless intensity/i);
  assert.match(prompt, /zero tolerance for empty self-negotiation/i);
  assert.match(prompt, /does not change facts/i);
  assert.match(prompt, /Do not imitate a real person/i);
  assert.doesNotMatch(prompt, /David Goggins|carry the boats/iu);
});

test("only the selected persona body is rendered", () => {
  const prompt = buildAssistantPersonaPrompt("wise-elder");
  assert.match(prompt, /long-horizon perspective/i);
  assert.doesNotMatch(prompt, /zero tolerance for empty self-negotiation/i);
  assert.doesNotMatch(prompt, /reviewing the tape/i);
});
