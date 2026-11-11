import assert from "node:assert/strict";
import { assistantPersonaOptions } from "@murphai/contracts";
import { test } from "vitest";

import { buildAssistantPersonaPrompt } from "../src/assistant/persona-prompts.ts";

test("the persona block ends with the persona body from contracts", () => {
  const prompt = buildAssistantPersonaPrompt();
  assert.ok(assistantPersonaOptions.length > 0);
  for (const option of assistantPersonaOptions) {
    assert.ok(prompt.endsWith(option.promptBody));
  }
});

test("the persona block never announces a persona id", () => {
  const prompt = buildAssistantPersonaPrompt();
  for (const option of assistantPersonaOptions) {
    assert.doesNotMatch(prompt, new RegExp(option.id.replaceAll("-", "[ -]"), "iu"));
  }
});
