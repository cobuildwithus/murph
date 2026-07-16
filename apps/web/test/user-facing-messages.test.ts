import { describe, expect, it } from "vitest";

import {
  renderUserFacingMessage,
  type UserFacingMessageContextByKey,
  type UserFacingMessageTemplateKey,
} from "@/src/lib/hosted-messages/user-facing-messages";

const USER_FACING_MESSAGE_MIN_VARIANT_COUNT = 20;

const TEST_TEMPLATE_KEYS = [
  "assistant.signup_welcome",
  "assistant.family_welcome",
  "linq.invite_signup",
  "linq.daily_quota",
  "linq.home_redirect",
  "linq.ai_usage.trial_conversion_pending",
  "linq.ai_usage.trial_limit_reached",
  "linq.ai_usage.edge_limit_reached",
  "linq.ai_usage.family_limit_reached",
  "linq.ai_usage.pulse_upgrade_edge",
  "linq.ai_usage.thread_limit_reached",
] as const satisfies readonly UserFacingMessageTemplateKey[];

const TEST_CONTEXT_BY_KEY = {
  "assistant.signup_welcome": {},
  "assistant.family_welcome": {},
  "linq.invite_signup": {
    joinUrl: "https://withmurph.ai/join/test-code",
  },
  "linq.daily_quota": {
    dailyTextLimit: 12,
  },
  "linq.home_redirect": {
    homeRecipientPhone: "+15555550123",
  },
  "linq.ai_usage.trial_conversion_pending": {
    homeUrl: "https://withmurph.ai/home",
  },
  "linq.ai_usage.trial_limit_reached": {
    homeUrl: "https://withmurph.ai/home",
  },
  "linq.ai_usage.edge_limit_reached": {
    homeUrl: "https://withmurph.ai/home",
  },
  "linq.ai_usage.family_limit_reached": {
    homeUrl: "https://withmurph.ai/home",
  },
  "linq.ai_usage.pulse_upgrade_edge": {
    homeUrl: "https://withmurph.ai/home",
  },
  "linq.ai_usage.thread_limit_reached": {},
} satisfies {
  [K in UserFacingMessageTemplateKey]: UserFacingMessageContextByKey[K];
};

describe("user-facing message variants", () => {
  it("keeps at least 20 variants for every rotating message class", () => {
    for (const key of TEST_TEMPLATE_KEYS) {
      expect(collectRenderedTexts(key).size, key).toBeGreaterThanOrEqual(
        USER_FACING_MESSAGE_MIN_VARIANT_COUNT,
      );
    }
  });

  it("selects variants deterministically from the caller seed", () => {
    const input = {
      context: TEST_CONTEXT_BY_KEY["linq.invite_signup"],
      key: "linq.invite_signup",
      seed: "member-1:event-1",
    } as const;

    expect(renderUserFacingMessage(input)).toEqual(renderUserFacingMessage(input));
  });

  it("varies content across different seeds", () => {
    const texts = new Set<string>();

    for (let index = 0; index < 80; index += 1) {
      texts.add(renderUserFacingMessage({
        context: TEST_CONTEXT_BY_KEY["assistant.signup_welcome"],
        key: "assistant.signup_welcome",
        seed: `seed-${index}`,
      }).text);
    }

    expect(texts.size).toBeGreaterThan(1);
  });

  it("renders the seed corpus without leaving required placeholders behind", () => {
    for (const key of TEST_TEMPLATE_KEYS) {
      for (const text of collectRenderedTexts(key)) {
        expect(text).not.toMatch(/\{[a-z][a-zA-Z0-9]*\}/u);
        expect(text.trim()).toBe(text);
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps dynamic routing values in every relevant message", () => {
    expectEveryVariantContains("linq.invite_signup", "https://withmurph.ai/join/test-code");
    expectEveryVariantContains("linq.daily_quota", "12");
    expectEveryVariantContains("linq.home_redirect", "+15555550123");
    expectEveryVariantContains("linq.ai_usage.trial_conversion_pending", "https://withmurph.ai/home");
    expectEveryVariantContains("linq.ai_usage.trial_limit_reached", "https://withmurph.ai/home");
    expectEveryVariantContains("linq.ai_usage.family_limit_reached", "https://withmurph.ai/home");
  });

  it("identifies Murph in every phone signup invite", () => {
    expectEveryVariantMatches("linq.invite_signup", /Murph/u);
  });

  it("keeps thread allowance copy neutral while explaining the pause", () => {
    for (const text of collectRenderedTexts("linq.ai_usage.thread_limit_reached")) {
      expect(text).not.toMatch(/trial|upgrade|checkout|Edge|Pulse|top[ -]?up|payer|https?:\/\//iu);
      expect(text).toMatch(/AI usage is paused until .+ allowance resets/iu);
    }
  });

  it("keeps notice templates neutral about unprojected billing actions", () => {
    for (const key of [
      "linq.ai_usage.trial_conversion_pending",
      "linq.ai_usage.family_limit_reached",
    ] as const) {
      for (const text of collectRenderedTexts(key)) {
        expect(text).not.toMatch(/add usage|top[ -]?up|checkout|subscribe/iu);
      }
    }
  });

  it("points direct paid limits to the first-party usage settings", () => {
    for (const key of [
      "linq.ai_usage.edge_limit_reached",
      "linq.ai_usage.pulse_upgrade_edge",
    ] as const) {
      for (const text of collectRenderedTexts(key)) {
        expect(text).toMatch(/Murph is paused until .+ usage is added|Murph is paused until you add usage/iu);
        expect(text).toContain(
          "https://withmurph.ai/settings?addUsage=true#subscription",
        );
        expect(text).not.toMatch(/bit\.ly|tinyurl|less capable|lower-usage|lighter model/iu);
      }
    }
  });

  it("explains how each blocked non-top-up allowance can resume", () => {
    for (const text of collectRenderedTexts("linq.ai_usage.trial_limit_reached")) {
      expect(text).toMatch(/Murph is paused until .+ plan/iu);
      expect(text).toMatch(/plan/iu);
      expect(text).not.toMatch(/add usage|top[ -]?up/iu);
    }

    for (const key of [
      "linq.ai_usage.family_limit_reached",
      "linq.ai_usage.thread_limit_reached",
    ] as const) {
      for (const text of collectRenderedTexts(key)) {
        expect(text).toMatch(/AI usage is paused until .+ allowance resets/iu);
        expect(text).not.toMatch(/add usage|top[ -]?up/iu);
      }
    }
  });

  it("does not describe blocked usage as advisory", () => {
    for (const key of [
      "linq.ai_usage.trial_limit_reached",
      "linq.ai_usage.edge_limit_reached",
      "linq.ai_usage.family_limit_reached",
      "linq.ai_usage.pulse_upgrade_edge",
      "linq.ai_usage.thread_limit_reached",
    ] as const) {
      for (const text of collectRenderedTexts(key)) {
        expect(text).not.toMatch(
          /keep replying|replies continue|remain(?:s)? available|still available|chat stays open|conversation continues/iu,
        );
      }
    }
  });

  it("communicates every included-usage limit as a percentage without currency progress", () => {
    for (const key of [
      "linq.ai_usage.trial_limit_reached",
      "linq.ai_usage.edge_limit_reached",
      "linq.ai_usage.family_limit_reached",
      "linq.ai_usage.pulse_upgrade_edge",
      "linq.ai_usage.thread_limit_reached",
    ] as const) {
      for (const text of collectRenderedTexts(key)) {
        expect(text).toMatch(/^.+ \(100% used\)\./u);
        expect(text).not.toMatch(/\$|USD|dollars?|\$\d+(?:\.\d+)?\s*\/\s*\$\d+/iu);
      }
    }
  });

  it("keeps every direct welcome broad, private, context-aware, and reply-oriented", () => {
    expectEveryVariantMatches("assistant.signup_welcome", /personal health assistant/iu);
    expectEveryVariantMatches("assistant.signup_welcome", /private/iu);
    expectEveryVariantMatches("assistant.signup_welcome", /remember|keep|learn/iu);
    for (const text of collectRenderedTexts("assistant.signup_welcome")) {
      const contextSentence = text
        .split(/(?<=[.!?])\s+/u)
        .find((sentence) => /\b(?:remember|keep|learn)\b/iu.test(sentence));

      expect(contextSentence).toMatch(
        /\b(?:better|more (?:personal|useful)|don't have to|improves? over time)\b/iu,
      );
    }
    expectEveryVariantDoesNotMatch(
      "assistant.signup_welcome",
      /ask what I know|correct it|forget a saved memory/iu,
    );
    expectEveryVariantMatches(
      "assistant.signup_welcome",
      /Ready to (?:get started|start)\?$/u,
    );
    expectEveryVariantMatches("assistant.signup_welcome", /\?$/u);
    expectEveryVariantDoesNotMatch("assistant.signup_welcome", /signed up|signup|experiment/iu);
  });
});

function expectEveryVariantContains<K extends UserFacingMessageTemplateKey>(
  key: K,
  expected: string,
): void {
  for (const text of collectRenderedTexts(key)) {
    expect(text).toContain(expected);
  }
}

function expectEveryVariantMatches<K extends UserFacingMessageTemplateKey>(
  key: K,
  expected: RegExp,
): void {
  for (const text of collectRenderedTexts(key)) {
    expect(text).toMatch(expected);
  }
}

function expectEveryVariantDoesNotMatch<K extends UserFacingMessageTemplateKey>(
  key: K,
  expected: RegExp,
): void {
  for (const text of collectRenderedTexts(key)) {
    expect(text).not.toMatch(expected);
  }
}

function collectRenderedTexts<K extends UserFacingMessageTemplateKey>(key: K): Set<string> {
  const texts = new Set<string>();

  for (let index = 0; index < 400; index += 1) {
    texts.add(renderUserFacingMessage({
      context: TEST_CONTEXT_BY_KEY[key],
      key,
      seed: `${key}:seed-${index}`,
    }).text);
  }

  return texts;
}
