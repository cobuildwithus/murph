import assert from "node:assert/strict";

import { test } from "vitest";

import { buildAssistantSystemPrompt } from "../src/assistant/system-prompt.js";

test("buildAssistantSystemPrompt tells Murph to gather personal supplement and lab context before generic advice", () => {
  const prompt = buildAssistantSystemPrompt({
    allowSensitiveHealthContext: true,
    assistantCliExecutorAvailable: true,
    assistantCronToolsAvailable: true,
    assistantHostedDeviceConnectAvailable: false,
    assistantMemoryDailyPath: "assistant-state/memory/2026-04-05.md",
    assistantMemoryLongTermPath: "assistant-state/MEMORY.md",
    assistantMemoryPrompt: null,
    assistantStateToolsAvailable: true,
    channel: "telegram",
    cliAccess: {
      rawCommand: "vault-cli",
      setupCommand: "murph",
    },
    firstTurnCheckIn: false,
  });

  assert.match(
    prompt,
    /Start with the user's concrete ask and the smallest relevant context that can still answer it well\./u,
  );
  assert.match(
    prompt,
    /prefer targeted vault reads over generic advice when the answer could materially change based on the user's own recent data\./u,
  );
  assert.match(
    prompt,
    /When the user appears to be asking about their own body, habits, treatment choices, or results, default to a targeted vault check before answering if personal context is reasonably likely to matter\./u,
  );
  assert.match(
    prompt,
    /For questions about supplements, medications, deficiencies, biomarkers, symptoms, recovery, diet, or whether the user should be doing or taking something, prefer the user's own context over generic advice\./u,
  );
  assert.match(
    prompt,
    /If the user is asking about themselves and a recent lab, active protocol, profile snapshot, symptom history, wearable trend, or prior log could change the answer, err on the side of a quick targeted read before responding\./u,
  );
  assert.match(
    prompt,
    /For supplement, medication, biomarker, or lab-driven questions, gather the smallest personal context that could change the answer before replying\./u,
  );
  assert.match(
    prompt,
    /Usually that means the active supplement or medication records, the derived current profile when relevant, and recent blood-test or history reads that bear directly on the question\./u,
  );
});
