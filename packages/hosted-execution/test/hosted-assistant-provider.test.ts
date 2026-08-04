import assert from "node:assert/strict";

import { test } from "vitest";

import {
  HOSTED_ASSISTANT_VENICE_PROVIDER_MODELS,
  parseHostedAssistantProviderOverride,
} from "../src/assistant-model.ts";
import {
  parseHostedWorkspaceReadResponse,
} from "../src/parsers/runtime-control.ts";

test("hosted assistant provider override accepts only Venice", () => {
  assert.equal(parseHostedAssistantProviderOverride("venice"), "venice");
  assert.equal(parseHostedAssistantProviderOverride("openai"), null);
  assert.equal(parseHostedAssistantProviderOverride("other"), null);
});

test("Venice provider models stay pinned to their priced GPT-5.6 ids", () => {
  assert.deepEqual(HOSTED_ASSISTANT_VENICE_PROVIDER_MODELS, {
    "gpt-5.6-luna": "openai-gpt-56-luna",
    "gpt-5.6-sol": "openai-gpt-56-sol",
    "gpt-5.6-terra": "openai-gpt-56-terra",
  });
});

test("workspace reads preserve an additive Venice provider override", () => {
  assert.deepEqual(parseHostedWorkspaceReadResponse({
    fetchedAt: "2026-07-29T04:30:00.000Z",
    hostedAssistantProviderOverride: "venice",
    workspace: null,
  }), {
    fetchedAt: "2026-07-29T04:30:00.000Z",
    hostedAssistantProviderOverride: "venice",
    workspace: null,
  });
});
