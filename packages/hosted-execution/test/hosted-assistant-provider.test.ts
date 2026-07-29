import assert from "node:assert/strict";

import { test } from "vitest";

import {
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
