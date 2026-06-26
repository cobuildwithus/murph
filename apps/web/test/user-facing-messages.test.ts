import { describe, expect, it } from "vitest";

import {
  renderUserFacingMessage,
  type UserFacingMessageContextByKey,
  type UserFacingMessageTemplateKey,
} from "@/src/lib/hosted-messages/user-facing-messages";

const USER_FACING_MESSAGE_MIN_VARIANT_COUNT = 20;

const TEST_TEMPLATE_KEYS = [
  "assistant.signup_welcome",
  "linq.invite_signup",
  "linq.daily_quota",
  "linq.home_redirect",
  "linq.ai_usage.trial_conversion_pending",
  "linq.ai_usage.trial_limit_reached",
  "linq.ai_usage.edge_limit_reached",
  "linq.ai_usage.pulse_upgrade_edge",
] as const satisfies readonly UserFacingMessageTemplateKey[];

const TEST_CONTEXT_BY_KEY = {
  "assistant.signup_welcome": {},
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
  "linq.ai_usage.pulse_upgrade_edge": {
    homeUrl: "https://withmurph.ai/home",
  },
} satisfies {
  [K in UserFacingMessageTemplateKey]: UserFacingMessageContextByKey[K];
};

describe("user-facing message variants", () => {
  it("keeps at least 20 variants for every rotating message class", () => {
    for (const key of TEST_TEMPLATE_KEYS) {
      expect(collectRenderedTexts(key).size).toBeGreaterThanOrEqual(USER_FACING_MESSAGE_MIN_VARIANT_COUNT);
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
    expectEveryVariantContains("linq.ai_usage.edge_limit_reached", "https://withmurph.ai/home");
    expectEveryVariantContains("linq.ai_usage.pulse_upgrade_edge", "https://withmurph.ai/home");
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
