import assert from "node:assert/strict";

import { createElement } from "react";
import { test } from "vitest";

import { EnvironmentCaptureCard } from "../app/(dashboard)/environment/environment-page-client";
import type { EnvironmentVoiceScript } from "../app/(dashboard)/environment/environment-voice-script";
import { renderClientComponent } from "./render-client-component";

const GAP_SCRIPT: EnvironmentVoiceScript = {
  dialogTitle: "Fill the gaps in your report",
  flow: "fill-gaps",
  idleDescription: "One short topic.",
  idleTitle: "Only the missing details",
  topics: [
    {
      eyebrow: "Sleep",
      focus: ["Night temperature"],
      id: "sleep",
      prompt: "Cover only what is missing.",
      title: "Your remaining sleep details",
    },
  ],
};

const UPDATE_SCRIPT: EnvironmentVoiceScript = {
  dialogTitle: "Update your environment",
  flow: "update",
  idleDescription: "Mention only what changed.",
  idleTitle: "Record what changed",
  topics: [
    {
      eyebrow: "Quick update",
      id: "update",
      prompt: "Describe what changed.",
      title: "What changed?",
    },
  ],
};

test("partial reports offer to fill only what is missing", async () => {
  const rendered = await renderClientComponent(
    createElement(EnvironmentCaptureCard, {
      contactAction: null,
      coverage: 30,
      known: 9,
      script: GAP_SCRIPT,
      total: 30,
    }),
  );

  try {
    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /Complete the picture/);
    assert.match(bodyText, /Fill in what's missing/);
    assert.match(bodyText, /21 details still missing/);
    assert.doesNotMatch(bodyText, /Update by voice/);
  } finally {
    await rendered.cleanup();
  }
});

test("complete reports offer a free-form update instead of more questions", async () => {
  const rendered = await renderClientComponent(
    createElement(EnvironmentCaptureCard, {
      contactAction: null,
      coverage: 100,
      known: 30,
      script: UPDATE_SCRIPT,
      total: 30,
    }),
  );

  try {
    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /Keep your environment current/);
    assert.match(bodyText, /Update by voice/);
    assert.doesNotMatch(bodyText, /Fill in what's missing/);
  } finally {
    await rendered.cleanup();
  }
});
