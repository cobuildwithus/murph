import assert from "node:assert/strict";

import { test } from "vitest";

import type { AssistantSession } from "../src/assistant-cli-contracts.js";
import { extractAssistantSessionSecretsForPersistence } from "../src/assistant/state-secrets.ts";

test("session secret persistence uses canonical target headers for openai-compatible sessions", () => {
  const session = {
    schema: "murph.assistant-session.v4",
    sessionId: "sessionSecretFix1",
    target: {
      adapter: "openai-compatible",
      apiKeyEnv: "OPENAI_API_KEY",
      endpoint: "https://api.example.test/v1",
      headers: {
        Authorization: "Bearer canonical-secret",
        "X-Visible": "public-header",
      },
      model: "gpt-4.1-mini",
      providerName: "example",
      reasoningEffort: null,
    },
    resumeState: null,
    alias: null,
    binding: {
      conversationKey: null,
      channel: null,
      identityId: null,
      actorId: null,
      threadId: null,
      threadIsDirect: null,
      delivery: null,
    },
    createdAt: "2026-04-05T00:00:00.000Z",
    updatedAt: "2026-04-05T00:00:00.000Z",
    lastTurnAt: null,
    turnCount: 0,
    provider: "openai-compatible",
    providerOptions: {
      model: "gpt-4.1-mini",
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
      baseUrl: "https://api.example.test/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      providerName: "example",
      headers: {
        Authorization: "Bearer stale-secret",
        "X-Visible": "stale-visible",
      },
    },
    providerBinding: null,
  } satisfies AssistantSession;

  const result = extractAssistantSessionSecretsForPersistence(session);

  assert.deepEqual(result.persisted.target, {
    adapter: "openai-compatible",
    apiKeyEnv: "OPENAI_API_KEY",
    endpoint: "https://api.example.test/v1",
    headers: {
      "X-Visible": "public-header",
    },
    model: "gpt-4.1-mini",
    providerName: "example",
    reasoningEffort: null,
  });
  assert.deepEqual(result.secrets?.providerHeaders, {
    Authorization: "Bearer canonical-secret",
  });
});
