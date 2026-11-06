import assert from "node:assert/strict";

import { test } from "vitest";

import {
  HOSTED_ASSISTANT_PRODUCT_MODELS,
} from "../src/assistant-model.ts";
import {
  parseHostedWorkspaceReadResponse,
} from "../src/parsers/runtime-control.ts";

test("workspace reads preserve each supported OpenAI model for the next invocation", () => {
  for (const model of HOSTED_ASSISTANT_PRODUCT_MODELS) {
    assert.equal(parseHostedWorkspaceReadResponse({
      fetchedAt: "2026-09-04T00:00:00.000Z",
      hostedAssistantModelOverride: model,
      workspace: null,
    }).hostedAssistantModelOverride, model);
  }
});

test("workspace reads ignore unsupported model preferences", () => {
  assert.deepEqual(parseHostedWorkspaceReadResponse({
    fetchedAt: "2026-09-04T00:00:00.000Z",
    hostedAssistantModelOverride: "unsupported-model",
    workspace: null,
  }), {
    fetchedAt: "2026-09-04T00:00:00.000Z",
    workspace: null,
  });
});
