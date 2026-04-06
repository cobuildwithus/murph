import assert from "node:assert/strict";

import { test } from "vitest";

import { buildAssistantSystemPrompt } from "../src/assistant/system-prompt.js";

test("user-facing channel prompt bans markdown styling in replies", () => {
  const prompt = buildAssistantSystemPrompt({
    assistantCliContract: null,
    allowSensitiveHealthContext: true,
    assistantCliExecutorAvailable: false,
    assistantCronToolsAvailable: false,
    assistantHostedDeviceConnectAvailable: false,
    assistantMemoryDailyPath: "assistant-state/memory/2026-04-05.md",
    assistantMemoryLongTermPath: "assistant-state/MEMORY.md",
    assistantMemoryPrompt: null,
    assistantStateToolsAvailable: false,
    channel: "telegram",
    cliAccess: {
      rawCommand: "vault-cli",
      setupCommand: "murph",
    },
    firstTurnCheckIn: false,
  });

  assert.match(
    prompt,
    /Do not use Markdown styling in user-facing channel replies\./u,
  );
  assert.match(
    prompt,
    /Do not wrap words in backticks or asterisks, and do not use hash headings, bullet markers, or code fences just for presentation\./u,
  );
  assert.match(
    prompt,
    /If you need emphasis or structure, use plain sentences, short plain-text lines, or simple numbered lines without Markdown markers\./u,
  );
});

test("local chat prompt does not inject the user-facing no-markdown rule", () => {
  const prompt = buildAssistantSystemPrompt({
    assistantCliContract: null,
    allowSensitiveHealthContext: true,
    assistantCliExecutorAvailable: false,
    assistantCronToolsAvailable: false,
    assistantHostedDeviceConnectAvailable: false,
    assistantMemoryDailyPath: "assistant-state/memory/2026-04-05.md",
    assistantMemoryLongTermPath: "assistant-state/MEMORY.md",
    assistantMemoryPrompt: null,
    assistantStateToolsAvailable: false,
    channel: "local",
    cliAccess: {
      rawCommand: "vault-cli",
      setupCommand: "murph",
    },
    firstTurnCheckIn: false,
  });

  assert.doesNotMatch(
    prompt,
    /Do not use Markdown styling in user-facing channel replies\./u,
  );
});
