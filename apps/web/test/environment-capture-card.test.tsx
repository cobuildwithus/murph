import assert from "node:assert/strict";

import { createElement } from "react";
import { test } from "vitest";

import {
  EnvironmentCaptureCard,
  EnvironmentEmptyState,
} from "../app/(dashboard)/environment/environment-page-client";
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
      title: "Your sleep setup",
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
      contactOptions: [],
      coverage: 30,
      known: 9,
      script: GAP_SCRIPT,
    }),
  );

  try {
    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /Complete the picture/);
    assert.match(bodyText, /Continue report/);
    assert.match(bodyText, /1 detail missing · 1 short topic/);
    assert.doesNotMatch(bodyText, /Update by voice/);
  } finally {
    await rendered.cleanup();
  }
});

test("complete reports offer a free-form update instead of more questions", async () => {
  const rendered = await renderClientComponent(
    createElement(EnvironmentCaptureCard, {
      contactOptions: [],
      coverage: 100,
      known: 30,
      script: UPDATE_SCRIPT,
    }),
  );

  try {
    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /All current details covered/);
    assert.match(bodyText, /Update by voice/);
    assert.doesNotMatch(bodyText, /Fill in what's missing/);
  } finally {
    await rendered.cleanup();
  }
});

test("an empty-looking profile still respects previously declined facts", async () => {
  const rendered = await renderClientComponent(
    createElement(EnvironmentEmptyState, {
      contactOptions: [],
      script: GAP_SCRIPT,
    }),
    {
      location: {
        href: "https://local.withmurph.ai/environment",
        origin: "https://local.withmurph.ai",
      },
    },
  );

  try {
    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /Continue report/);
    assert.doesNotMatch(bodyText, /Start report/);
  } finally {
    await rendered.cleanup();
  }
});

test("chat instead uses the channel picker when several chat channels are connected", async () => {
  const rendered = await renderClientComponent(
    createElement(EnvironmentCaptureCard, {
      contactOptions: [
        {
          href: "sms:+15550100001",
          kind: "text",
          label: "Messages",
        },
        {
          href: "https://t.me/withmurph_bot",
          kind: "telegram",
          label: "Telegram",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      ],
      coverage: 30,
      known: 9,
      script: GAP_SCRIPT,
    }),
  );

  try {
    const chatButton = [...rendered.container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.includes("Chat instead"),
    );
    assert.ok(chatButton);

    assert.equal(chatButton.tagName, "BUTTON");
    assert.equal(chatButton.closest("a"), null);
    assert.equal(rendered.container.querySelector('a[href^="sms:"]'), null);
  } finally {
    await rendered.cleanup();
  }
});
