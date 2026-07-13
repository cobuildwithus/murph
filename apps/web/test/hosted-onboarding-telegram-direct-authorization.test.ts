import { describe, expect, it, vi } from "vitest";

import {
  verifyHostedTelegramDirectAuthorization,
} from "@/src/lib/hosted-onboarding/telegram-direct-authorization";

const PRODUCER_ENABLED_ENV = {
  HOSTED_TELEGRAM_BOT_BOUND_TARGET_PRODUCER_ENABLED: "1",
} as const;

describe("hosted Telegram direct authorization", () => {
  it("keeps bot-bound target production disabled by default", async () => {
    const authorizeTelegramDirectMessage = vi.fn();

    await expect(verifyHostedTelegramDirectAuthorization(
      {
        authorizationUserId: "did:privy:user_123",
        telegramUserId: "987654",
      },
      { controlClient: { authorizeTelegramDirectMessage }, env: {} },
    )).resolves.toBeUndefined();
    expect(authorizeTelegramDirectMessage).not.toHaveBeenCalled();
  });

  it("returns bot-bound authority only after the Worker confirms a direct write", async () => {
    const authorizeTelegramDirectMessage = vi.fn().mockResolvedValue({
      botId: "123456",
      status: "authorized",
    });

    await expect(verifyHostedTelegramDirectAuthorization(
      {
        authorizationUserId: "did:privy:user_123",
        telegramUserId: "987654",
      },
      { controlClient: { authorizeTelegramDirectMessage }, env: PRODUCER_ENABLED_ENV },
    )).resolves.toEqual({
      telegramThreadId: "987654:bot:123456",
      telegramUserId: "987654",
    });
    expect(authorizeTelegramDirectMessage).toHaveBeenCalledWith({
      request: { telegramUserId: "987654" },
      userId: "did:privy:user_123",
    });
  });

  it("fails closed when the Worker cannot confirm the write", async () => {
    const authorizeTelegramDirectMessage = vi.fn().mockResolvedValue({
      status: "unavailable",
    });

    await expect(verifyHostedTelegramDirectAuthorization(
      {
        authorizationUserId: "member_123",
        telegramUserId: "987654",
      },
      { controlClient: { authorizeTelegramDirectMessage }, env: PRODUCER_ENABLED_ENV },
    )).resolves.toBeNull();
  });

  it("fails closed when an authorized response lacks a valid bot identity", async () => {
    const authorizeTelegramDirectMessage = vi.fn().mockResolvedValue({
      botId: "not-numeric",
      status: "authorized",
    });

    await expect(verifyHostedTelegramDirectAuthorization(
      {
        authorizationUserId: "member_123",
        telegramUserId: "987654",
      },
      { controlClient: { authorizeTelegramDirectMessage }, env: PRODUCER_ENABLED_ENV },
    )).resolves.toBeNull();
  });

  it("fails closed when the Worker control request fails", async () => {
    const authorizeTelegramDirectMessage = vi.fn().mockRejectedValue(
      new Error("control unavailable"),
    );

    await expect(verifyHostedTelegramDirectAuthorization(
      {
        authorizationUserId: "member_123",
        telegramUserId: "987654",
      },
      { controlClient: { authorizeTelegramDirectMessage }, env: PRODUCER_ENABLED_ENV },
    )).resolves.toBeNull();
  });

  it("fails closed before control access for malformed identities or missing configuration", async () => {
    const authorizeTelegramDirectMessage = vi.fn();

    await expect(verifyHostedTelegramDirectAuthorization(
      {
        authorizationUserId: "member_123",
        telegramUserId: "not-numeric",
      },
      { controlClient: { authorizeTelegramDirectMessage }, env: PRODUCER_ENABLED_ENV },
    )).resolves.toBeNull();
    await expect(verifyHostedTelegramDirectAuthorization(
      {
        authorizationUserId: " ",
        telegramUserId: "987654",
      },
      { controlClient: { authorizeTelegramDirectMessage }, env: PRODUCER_ENABLED_ENV },
    )).resolves.toBeNull();
    await expect(verifyHostedTelegramDirectAuthorization(
      {
        authorizationUserId: "member_123",
        telegramUserId: "987654",
      },
      { controlClient: null, env: PRODUCER_ENABLED_ENV },
    )).resolves.toBeNull();
    expect(authorizeTelegramDirectMessage).not.toHaveBeenCalled();
  });
});
