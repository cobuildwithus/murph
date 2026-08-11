import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildHostedLinqGroupEmailRecoveryEffectId,
  buildHostedLinqGroupEmailRecoveryMessage,
  buildHostedLinqGroupSetupEffectId,
  buildHostedLinqGroupSetupMessage,
  HOSTED_LINQ_GROUP_SETUP_ROOM_VARIANT_COUNT,
  issueHostedLinqGroupEmailRecoveryToken,
  openHostedLinqGroupEmailRecoveryToken,
  readHostedLinqGroupSetupRoomVariantTemplates,
} from "../src/lib/hosted-onboarding/linq-group-setup";

const TEST_SESSION_KEY = Buffer.alloc(32, 7).toString("base64url");

describe("Hosted Linq group setup", () => {
  const previousSessionKey = process.env.HOSTED_APP_SESSION_HMAC_KEY;
  const previousPublicBaseUrl = process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;

  beforeEach(() => {
    process.env.HOSTED_APP_SESSION_HMAC_KEY = TEST_SESSION_KEY;
    process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = "https://murph.example";
  });

  afterEach(() => {
    if (previousSessionKey === undefined) {
      delete process.env.HOSTED_APP_SESSION_HMAC_KEY;
    } else {
      process.env.HOSTED_APP_SESSION_HMAC_KEY = previousSessionKey;
    }
    if (previousPublicBaseUrl === undefined) {
      delete process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
    } else {
      process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = previousPublicBaseUrl;
    }
  });

  it("keeps 50 reviewed setup-room variants on one privacy-safe action contract", () => {
    const variants = readHostedLinqGroupSetupRoomVariantTemplates();

    expect(HOSTED_LINQ_GROUP_SETUP_ROOM_VARIANT_COUNT).toBe(50);
    expect(variants).toHaveLength(50);
    expect(new Set(variants).size).toBe(50);
    for (const variant of variants) {
      expect(countOccurrences(variant, "{groupSetupUrl}")).toBe(1);
      expect(variant).toMatch(
        /\b(?:active on Murph|active Murph member)\b/iu,
      );
      expect(variant).toContain("message");
      expect(variant).toMatch(
        /activate or finish setting up Murph, then message me here again:/u,
      );
      expect(variant).not.toMatch(
        /\b(?:account|access|billing|payment|subscription|trial|you|your)\b/iu,
      );
      expect(variant).not.toMatch(/https?:\/\//iu);
    }
  });

  it("selects canonical setup-room copy deterministically with broad rotation", () => {
    const first = buildHostedLinqGroupSetupMessage({
      seed: "linq-group-setup:stable-seed",
    });
    const rotated = new Set(
      Array.from({ length: 500 }, (_, index) =>
        buildHostedLinqGroupSetupMessage({
          seed: `linq-group-setup:seed-${index}`,
        })
      ),
    );

    expect(buildHostedLinqGroupSetupMessage({
      seed: "linq-group-setup:stable-seed",
    })).toBe(first);
    expect(rotated.size).toBe(50);
    expect(countOccurrences(first, "https://murph.example/groups/start")).toBe(1);
    expect(first).not.toContain("{groupSetupUrl}");
  });

  it("round-trips one private email recovery token", () => {
    const observedAt = new Date("2026-07-31T04:00:00.000Z");
    const token = issueHostedLinqGroupEmailRecoveryToken({
      chatId: "chat_group_123",
      now: observedAt,
      observedAt,
      participantEmail: " Person@iCloud.com ",
      recipientPhone: "+15550000000",
    });

    expect(openHostedLinqGroupEmailRecoveryToken({
      now: new Date("2026-07-31T05:00:00.000Z"),
      token,
    })).toMatchObject({
      chatId: "chat_group_123",
      observedAt,
      participantContact: {
        kind: "email",
        value: "person@icloud.com",
      },
      recipientPhone: "+15550000000",
    });
  });

  it("seals the same provider event to the same retry token", () => {
    const input = {
      chatId: "chat_group_123",
      now: new Date("2026-07-31T04:00:00.000Z"),
      observedAt: "2026-07-31T04:00:00.000Z",
      participantEmail: "person@icloud.com",
      recipientPhone: "+15550000000",
    };

    const first = issueHostedLinqGroupEmailRecoveryToken(input);
    expect(issueHostedLinqGroupEmailRecoveryToken(input)).toBe(first);
    expect(issueHostedLinqGroupEmailRecoveryToken({
      ...input,
      chatId: "chat_group_other",
    })).not.toBe(first);
  });

  it("keeps the private bearer token out of the request query", () => {
    const token = issueHostedLinqGroupEmailRecoveryToken({
      chatId: "chat_group_123",
      now: new Date("2026-07-31T04:00:00.000Z"),
      observedAt: "2026-07-31T04:00:00.000Z",
      participantEmail: "person@icloud.com",
      recipientPhone: "+15550000000",
    });
    const message = buildHostedLinqGroupEmailRecoveryMessage({
      recoveryToken: token,
    });
    const url = new URL(message.match(/https:\/\/\S+/u)?.[0] ?? "");

    expect(url.pathname).toBe("/groups/start");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("recover")).toBe(token);
  });

  it("rejects tampered, future, and expired recovery tokens", () => {
    const token = issueHostedLinqGroupEmailRecoveryToken({
      chatId: "chat_group_123",
      now: new Date("2026-07-31T04:00:00.000Z"),
      observedAt: "2026-07-31T04:00:00.000Z",
      participantEmail: "person@icloud.com",
      recipientPhone: "+15550000000",
    });

    expect(openHostedLinqGroupEmailRecoveryToken({
      now: new Date("2026-07-31T05:00:00.000Z"),
      token: `${token.slice(0, -1)}x`,
    })).toBeNull();
    expect(openHostedLinqGroupEmailRecoveryToken({
      now: new Date("2026-07-31T03:54:59.999Z"),
      token,
    })).toBeNull();
    expect(openHostedLinqGroupEmailRecoveryToken({
      now: new Date("2026-08-01T04:00:00.000Z"),
      token,
    })).toBeNull();
  });

  it("uses stable opaque setup and recovery identities within one UTC day", () => {
    const setupId = buildHostedLinqGroupSetupEffectId({
      chatId: "chat_group_123",
      occurredAt: "2026-07-31T04:00:00.000Z",
    });
    const recoveryId = buildHostedLinqGroupEmailRecoveryEffectId({
      chatId: "chat_group_123",
      occurredAt: "2026-07-31T04:00:00.000Z",
      participantEmail: "person@example.com",
      recipientPhone: "+15550000000",
    });

    expect(buildHostedLinqGroupSetupEffectId({
      chatId: "chat_group_123",
      occurredAt: "2026-07-31T22:15:00.000Z",
    })).toBe(setupId);
    expect(buildHostedLinqGroupEmailRecoveryEffectId({
      chatId: "chat_group_123",
      occurredAt: "2026-07-31T22:15:00.000Z",
      participantEmail: "PERSON@EXAMPLE.COM",
      recipientPhone: "+1 (555) 000-0000",
    })).toBe(recoveryId);
    expect(`${setupId}:${recoveryId}`).not.toContain("example");
    expect(`${setupId}:${recoveryId}`).not.toContain("+1555");
  });

  it("offers a new setup and recovery identity on the next UTC day", () => {
    // Keying on the chat alone would mute a group forever after one link: if
    // the wrong person redeems it, or nobody does, no further link is ever
    // sent. A day bucket bounds the repeats without making the chat a dead end.
    const nextDay = { occurredAt: "2026-08-01T00:00:00.000Z" } as const;

    expect(buildHostedLinqGroupSetupEffectId({
      chatId: "chat_group_123",
      ...nextDay,
    })).not.toBe(buildHostedLinqGroupSetupEffectId({
      chatId: "chat_group_123",
      occurredAt: "2026-07-31T23:59:59.999Z",
    }));
    expect(buildHostedLinqGroupEmailRecoveryEffectId({
      chatId: "chat_group_123",
      participantEmail: "person@example.com",
      recipientPhone: "+15550000000",
      ...nextDay,
    })).not.toBe(buildHostedLinqGroupEmailRecoveryEffectId({
      chatId: "chat_group_123",
      occurredAt: "2026-07-31T23:59:59.999Z",
      participantEmail: "person@example.com",
      recipientPhone: "+15550000000",
    }));
  });

  it("rejects an unusable occurrence time", () => {
    expect(() => buildHostedLinqGroupSetupEffectId({
      chatId: "chat_group_123",
      occurredAt: "not-a-time",
    })).toThrow(TypeError);
  });
});

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
