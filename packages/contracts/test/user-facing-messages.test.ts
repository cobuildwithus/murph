import { describe, expect, it } from "vitest";

import {
  renderUserFacingMessage,
  renderUserFacingMessageVariant,
  readUserFacingMessageVariantCount,
  USER_FACING_MESSAGE_MIN_VARIANT_COUNT,
  USER_FACING_MESSAGE_TEMPLATE_KEYS,
  type UserFacingMessageContextByKey,
  type UserFacingMessageTemplateKey,
} from "../src/user-facing-messages.ts";

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
    for (const key of USER_FACING_MESSAGE_TEMPLATE_KEYS) {
      expect(readUserFacingMessageVariantCount(key)).toBeGreaterThanOrEqual(
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
    const variantIds = new Set<string>();

    for (let index = 0; index < 80; index += 1) {
      variantIds.add(renderUserFacingMessage({
        context: TEST_CONTEXT_BY_KEY["assistant.signup_welcome"],
        key: "assistant.signup_welcome",
        seed: `seed-${index}`,
      }).variantId);
    }

    expect(variantIds.size).toBeGreaterThan(1);
  });

  it("renders every variant without leaving required placeholders behind", () => {
    for (const key of USER_FACING_MESSAGE_TEMPLATE_KEYS) {
      for (let variantIndex = 0; variantIndex < readUserFacingMessageVariantCount(key); variantIndex += 1) {
        const rendered = renderUserFacingMessageVariant({
          context: TEST_CONTEXT_BY_KEY[key],
          key,
          variantIndex,
        });

        expect(rendered.text).not.toMatch(/\{[a-z][a-zA-Z0-9]*\}/u);
        expect(rendered.text.trim()).toBe(rendered.text);
        expect(rendered.text.length).toBeGreaterThan(0);
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
  for (let variantIndex = 0; variantIndex < readUserFacingMessageVariantCount(key); variantIndex += 1) {
    expect(renderUserFacingMessageVariant({
      context: TEST_CONTEXT_BY_KEY[key],
      key,
      variantIndex,
    }).text).toContain(expected);
  }
}
