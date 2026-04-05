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
  assert.match(
    prompt,
    /When the target is fuzzy, remembered by phrase, or likely to require lexical recall across notes and record bodies, use `vault-cli search query`\./u,
  );
  assert.match(
    prompt,
    /When the user asks what changed, what happened over a window, or what stands out across record types, prefer `vault-cli timeline` first and then drill into a few supporting records\./u,
  );
  assert.match(
    prompt,
    /For the user's current synthesized health snapshot, prefer `vault-cli profile show current` over reconstructing that state from older snapshots by hand\./u,
  );
  assert.match(
    prompt,
    /For wearable questions, prefer `vault-cli wearables day` or the relevant `vault-cli wearables sleep\|activity\|recovery\|body\|sources list` command before inspecting raw events or samples\./u,
  );
  assert.match(
    prompt,
    /For imported-record provenance or original source payloads, prefer family-specific `manifest` reads such as `vault-cli meal manifest`, `vault-cli document manifest`, `vault-cli intake manifest`, and `vault-cli workout manifest` before scanning raw files directly\./u,
  );
  assert.match(
    prompt,
    /Many registry families follow `list\/show\/scaffold\/upsert`\. Artifact-backed families often use `add` or `import`, then `show\/list`, `manifest`, and `edit\/delete`\./u,
  );
  assert.match(
    prompt,
    /Generic `vault-cli show` expects a query-layer record id\. For family-specific lookup ids such as `meal_\*` or `doc_\*`, prefer the matching family `show` or `manifest` surface\./u,
  );
  assert.match(
    prompt,
    /Derived knowledge tools are exposed directly in this session as `assistant\.knowledge\.search`, `assistant\.knowledge\.get`, `assistant\.knowledge\.list`, `assistant\.knowledge\.upsert`, `assistant\.knowledge\.lint`, and `assistant\.knowledge\.rebuildIndex`\./u,
  );
  assert.match(
    prompt,
    /For wiki tasks, read `derived\/knowledge\/index\.md` first through `vault\.fs\.readText`, then use knowledge search and one to three targeted page reads before synthesizing anything new\./u,
  );
  assert.match(
    prompt,
    /Murph's knowledge system has two layers: `bank\/library` is the stable health reference layer, while `derived\/knowledge` is the user-specific compiled wiki/u,
  );
  assert.match(
    prompt,
    /When a derived page clearly builds on stable health reference entities under `bank\/library`, attach those stable links through `librarySlugs` metadata\./u,
  );
  assert.match(
    prompt,
    /Do not silently overwrite prior conclusions when new evidence is mixed or contradictory\./u,
  );
  assert.match(
    prompt,
    /Every knowledge upsert appends an entry to `derived\/knowledge\/log\.md`/u,
  );
  assert.match(
    prompt,
    /If no close existing page exists, and the current turn produced a reusable synthesis that would likely save work or improve continuity later, create a new knowledge page in the same turn\./u,
  );
  assert.match(
    prompt,
    /Good candidates for a new page include any reusable synthesis that Murph is likely to benefit from later, including durable topic summaries, recurring user-context dossiers, protocol or experiment summaries, decision histories, open questions or active hypotheses, recurring symptom or biomarker pattern syntheses, wearable-trend summaries, research digests, and concise reference pages for recurring entities such as supplements, medications, foods, labs, or conditions\./u,
  );
  assert.match(
    prompt,
    /Do not create a knowledge page for lightweight chat, one-off operational answers, weakly supported guesses, or single-record readbacks that are unlikely to matter again\./u,
  );
});
