import assert from "node:assert/strict";
import { assistantPersonaOptions } from "@murphai/contracts";
import { test } from "vitest";

import { buildAssistantPersonaPrompt } from "../src/assistant/persona-prompts.ts";

test("every premade combination renders its bespoke body with global invariants", () => {
  for (const option of assistantPersonaOptions) {
    const prompt = buildAssistantPersonaPrompt(option.id);
    assert.match(prompt, /relationship and delivery style/iu);
    assert.match(prompt, /never changes facts, evidence standards, safety, privacy/iu);
    assert.match(prompt, /Do not mention or announce/iu);
    assert.match(prompt, /military authority, or a family relationship/iu);
    assert.match(prompt, /Do not demean, manipulate, diagnose, or perform false intimacy/iu);
    assert.match(prompt, /conversational and reciprocal/iu);
    assert.match(prompt, /broadcast, acquisition, signup, notification, or exact-send/iu);
    assert.ok(prompt.endsWith(option.promptBody));
    assert.doesNotMatch(
      option.promptBody,
      /\b(?:main|persona|personality|supporting)\b|(?:75\s*[/:-]\s*25)|%/iu,
    );
  }
});

test("ordered support produces materially different prompt copy", () => {
  const disciplinedWarm = buildAssistantPersonaPrompt("navy-seal-with-classic");
  const warmDisciplined = buildAssistantPersonaPrompt("classic-with-navy-seal");

  assert.notEqual(disciplinedWarm, warmDisciplined);
  assert.match(disciplinedWarm, /discipline, urgency, and accountability in the lead/iu);
  assert.match(warmDisciplined, /warmth, balance, and adaptability/iu);
});

test("no prompt announces an id or retains an obsolete persona body", () => {
  const obsoleteTerms = [
    "wise elder",
    "medical detective",
    "longevity scientist",
    "zen monk",
    "best friend",
    "championship coach",
    "science professor",
    "mountain guide",
    "grandma",
    "biohacker",
    "drill sergeant",
  ];

  for (const option of assistantPersonaOptions) {
    const prompt = buildAssistantPersonaPrompt(option.id);
    assert.doesNotMatch(prompt, new RegExp(option.id.replaceAll("-", "[ -]"), "iu"));
    for (const term of obsoleteTerms) {
      assert.doesNotMatch(prompt, new RegExp(term, "iu"));
    }
  }
});
