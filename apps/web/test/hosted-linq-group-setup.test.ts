import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildHostedLinqGroupEmailRecoveryEffectId,
  buildHostedLinqGroupEmailRecoveryMessage,
  buildHostedLinqGroupSetupEffectId,
  issueHostedLinqGroupEmailRecoveryToken,
  openHostedLinqGroupEmailRecoveryToken,
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

  it("uses stable opaque setup and recovery identities", () => {
    const setupId = buildHostedLinqGroupSetupEffectId({
      chatId: "chat_group_123",
    });
    const recoveryId = buildHostedLinqGroupEmailRecoveryEffectId({
      chatId: "chat_group_123",
      participantEmail: "person@icloud.com",
      recipientPhone: "+15550000000",
    });

    expect(buildHostedLinqGroupSetupEffectId({
      chatId: "chat_group_123",
    })).toBe(setupId);
    expect(buildHostedLinqGroupEmailRecoveryEffectId({
      chatId: "chat_group_123",
      participantEmail: "PERSON@ICLOUD.COM",
      recipientPhone: "+1 (555) 000-0000",
    })).toBe(recoveryId);
    expect(`${setupId}:${recoveryId}`).not.toContain("icloud");
    expect(`${setupId}:${recoveryId}`).not.toContain("+1555");
  });
});
