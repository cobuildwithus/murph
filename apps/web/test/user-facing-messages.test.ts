import { describe, expect, it } from "vitest";

import {
  renderUserFacingMessage,
  type UserFacingMessageContextByKey,
  type UserFacingMessageTemplateKey,
} from "@/src/lib/hosted-messages/user-facing-messages";

const USER_FACING_MESSAGE_MIN_VARIANT_COUNT = 20;
const HOME_REDIRECT_MIN_VARIANT_COUNT = 100;
const HOME_REDIRECT_EXPLICIT_RESEND_PATTERN =
  /\b(?:resend (?:(?:the|this|your)(?: last)? message|what you just wrote)|send (?:(?:the|this|your)(?: last)? message|that)(?: again)?|that message can't move between threads\. resend it to the number above)\b/iu;

/**
 * The thread notice has room for personality, but every variant still has to
 * say plainly that Murph has stopped rather than only joking around it.
 */
const THREAD_PAUSE_STATED =
  /paused|out\b|quiet|gone|nothing left|done|no more|zero|dark|silence|tapped|unsupervised|ran? out|time's up/iu;

const TEST_TEMPLATE_KEYS = [
  "assistant.signup_welcome",
  "assistant.family_welcome",
  "linq.invite_signup",
  "linq.daily_quota",
  "linq.home_redirect",
  "linq.ai_usage.starter_limit_reached",
  "linq.ai_usage.edge_limit_reached",
  "linq.ai_usage.family_limit_reached",
  "linq.ai_usage.group_upgrade_pulse",
  "linq.ai_usage.max_limit_reached",
  "linq.ai_usage.pulse_upgrade_edge",
  "linq.ai_usage.thread_limit_reached",
] as const satisfies readonly UserFacingMessageTemplateKey[];

const PERSONAL_USAGE_RECOVERY_TEMPLATE_KEYS = [
  "linq.ai_usage.starter_limit_reached",
  "linq.ai_usage.edge_limit_reached",
  "linq.ai_usage.family_limit_reached",
  "linq.ai_usage.group_upgrade_pulse",
  "linq.ai_usage.max_limit_reached",
  "linq.ai_usage.pulse_upgrade_edge",
] as const;
const GENERIC_USAGE_RECOVERY_TEMPLATE_KEYS = [
  "linq.ai_usage.starter_limit_reached",
  "linq.ai_usage.edge_limit_reached",
  "linq.ai_usage.max_limit_reached",
  "linq.ai_usage.pulse_upgrade_edge",
] as const;
const USAGE_RECOVERY_SETTINGS_URL =
  "https://withmurph.ai/settings?usageRecovery=true#subscription";

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
  "linq.ai_usage.starter_limit_reached": {
    settingsUrl: "https://withmurph.ai/settings?usageRecovery=true#subscription",
  },
  "linq.ai_usage.edge_limit_reached": {
    settingsUrl: "https://withmurph.ai/settings?usageRecovery=true#subscription",
  },
  "linq.ai_usage.family_limit_reached": {
    settingsUrl: "https://withmurph.ai/settings?usageRecovery=true#subscription",
  },
  "linq.ai_usage.group_upgrade_pulse": {
    settingsUrl: "https://withmurph.ai/settings?usageRecovery=true#subscription",
  },
  "linq.ai_usage.max_limit_reached": {
    settingsUrl: "https://withmurph.ai/settings?usageRecovery=true#subscription",
  },
  "linq.ai_usage.billing_inactive": {
    homeUrl: "https://withmurph.ai/home",
  },
  "linq.ai_usage.pulse_upgrade_edge": {
    settingsUrl: "https://withmurph.ai/settings?usageRecovery=true#subscription",
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

  it("keeps at least 100 distinct wrong-line redirect variants", () => {
    expect(collectRenderedTexts("linq.home_redirect").size).toBeGreaterThanOrEqual(
      HOME_REDIRECT_MIN_VARIANT_COUNT,
    );
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
    for (const key of PERSONAL_USAGE_RECOVERY_TEMPLATE_KEYS) {
      expectEveryVariantContains(key, USAGE_RECOVERY_SETTINGS_URL);
    }
  });

  it("tells the member to resend every unprocessed wrong-line message", () => {
    for (const text of collectRenderedTexts("linq.home_redirect")) {
      expect(text).toMatch(HOME_REDIRECT_EXPLICIT_RESEND_PATTERN);
      expect(text).not.toMatch(/https?:\/\//iu);
    }
  });

  it("identifies Murph in every phone signup invite", () => {
    expectEveryVariantMatches("linq.invite_signup", /Murph/u);
  });

  it("keeps thread allowance copy neutral while explaining the pause", () => {
    for (const text of collectRenderedTexts("linq.ai_usage.thread_limit_reached")) {
      expect(text).not.toMatch(/trial|upgrade|checkout|Edge|Pulse|top[ -]?up|payer|https?:\/\//iu);
      expect(text).toMatch(/resets\.$/u);
    }
  });

  it("speaks the thread pause as Murph, in first person, to the whole room", () => {
    for (const text of collectRenderedTexts("linq.ai_usage.thread_limit_reached")) {
      expect(text).toMatch(/\b(?:I|I'm|I've|me|my)\b/u);
      // Murph is the one who ran out, so no variant may narrate the chat's
      // account back at the room in the third person.
      expect(text).not.toMatch(/(?:^|\.\s)(?:this|the) chat\b/iu);
      expect(text).not.toMatch(/\bMurph (?:time|usage)\b/iu);
      expect(text).toMatch(/everyone|everybody|all of you|whole room|whole group/iu);
      expect(text).not.toMatch(/included|allowance|usage period|monthly amount/iu);
    }
  });



  it("keeps personal exhaustion notices short and first-party", () => {
    for (const key of PERSONAL_USAGE_RECOVERY_TEMPLATE_KEYS) {
      for (const text of collectRenderedTexts(key)) {
        expect(text).toMatch(/Murph.*paused/iu);
        expect(text).toContain(USAGE_RECOVERY_SETTINGS_URL);
        expect(text.length).toBeLessThan(260);
        expect(text).not.toMatch(
          /Family owner|member[_ -]?id|email|token|trial|starter|Core|Pulse|Edge|Max|price|\$|add usage|checkout|billing authority/iu,
        );
        expect(text.match(/https?:\/\//gu)).toHaveLength(1);
      }
    }
  });

  it("keeps direct exhaustion notices generic", () => {
    for (const key of GENERIC_USAGE_RECOVERY_TEMPLATE_KEYS) {
      for (const text of collectRenderedTexts(key)) {
        expect(text).not.toMatch(/Family|wearable|group updates/iu);
      }
    }
  });

  it("preserves the Core continuity boundary in every exhaustion notice", () => {
    for (const text of collectRenderedTexts("linq.ai_usage.group_upgrade_pulse")) {
      expect(text).toMatch(/new personal AI work pauses/iu);
      expect(text).toMatch(/wearable syncing/iu);
      expect(text).toMatch(/authorized group updates continue/iu);
    }
  });

  it("preserves individual Family allowance scope in every exhaustion notice", () => {
    for (const text of collectRenderedTexts("linq.ai_usage.family_limit_reached")) {
      expect(text).toMatch(/your individual Family allowance is used/iu);
      expect(text).toMatch(/other members' allowances are separate/iu);
    }
  });

  it("keeps the room-specific reset explanation separate", () => {
    for (const text of collectRenderedTexts("linq.ai_usage.thread_limit_reached")) {
      expect(text).toMatch(THREAD_PAUSE_STATED);
      expect(text).toMatch(/(?:until|when)\b.*resets/iu);
      expect(text).not.toMatch(/add usage|top[ -]?up/iu);
    }
  });

  it("does not describe blocked usage as advisory", () => {
    for (const key of [
      "linq.ai_usage.starter_limit_reached",
      "linq.ai_usage.edge_limit_reached",
      "linq.ai_usage.family_limit_reached",
      "linq.ai_usage.group_upgrade_pulse",
      "linq.ai_usage.max_limit_reached",
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
      "linq.ai_usage.starter_limit_reached",
      "linq.ai_usage.edge_limit_reached",
      "linq.ai_usage.family_limit_reached",
      "linq.ai_usage.group_upgrade_pulse",
      "linq.ai_usage.max_limit_reached",
      "linq.ai_usage.pulse_upgrade_edge",
    ] as const) {
      for (const text of collectRenderedTexts(key)) {
        expect(text).toMatch(/^.+ \(100% used\)\./u);
        expect(text).not.toMatch(/\$|USD|dollars?|\$\d+(?:\.\d+)?\s*\/\s*\$\d+/iu);
      }
    }

    // The group notice says the chat is out in plain words, so it carries no
    // percentage of its own and still never quotes currency.
    for (const text of collectRenderedTexts("linq.ai_usage.thread_limit_reached")) {
      expect(text).not.toMatch(/\d+%|\$|USD|dollars?/iu);
    }
  });

  it("keeps every direct welcome broad, private, context-aware, and reply-oriented", () => {
    expectEveryVariantMatches("assistant.signup_welcome", /\bMurph\b/u);
    expectEveryVariantDoesNotMatch(
      "assistant.signup_welcome",
      /personal health assistant/iu,
    );
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
