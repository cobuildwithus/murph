import { describe, expect, it, vi } from "vitest";

import { sendPendingHostedLinqAlertsBestEffort } from "@/src/lib/hosted-onboarding/linq-alert-email";

describe("sendPendingHostedLinqAlertsBestEffort", () => {
  it("sends pending alerts through the Linq alert Resend config and stores the provider id", async () => {
    const fixture = createAlertEmailPrismaFixture();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: "email_provider_123",
    }), {
      status: 200,
    }));

    await sendPendingHostedLinqAlertsBestEffort({
      alertIds: ["hla_message_failed_123"],
      env: buildAlertEmailEnv(),
      fetchImpl,
      prisma: fixture.prisma as never,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        body: expect.stringContaining("Linq message failed"),
        headers: expect.objectContaining({
          "Idempotency-Key": "hosted-linq-alert/hla_message_failed_123",
        }),
        method: "POST",
      }),
    );
    expect(fixture.hostedLinqAlertUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptCount: { increment: 1 },
          status: "sending",
        }),
      }),
    );
    expect(fixture.hostedLinqAlertUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerMessageId: "email_provider_123",
        status: "sent",
      }),
      where: {
        id: "hla_message_failed_123",
      },
    });
  });

  it("marks alerts failed without throwing when Resend rejects the send", async () => {
    const fixture = createAlertEmailPrismaFixture();
    const fetchImpl = vi.fn(async () => new Response("nope", {
      status: 500,
    }));

    await expect(sendPendingHostedLinqAlertsBestEffort({
      alertIds: ["hla_message_failed_123"],
      env: buildAlertEmailEnv(),
      fetchImpl,
      prisma: fixture.prisma as never,
    })).resolves.toBeUndefined();

    expect(fixture.hostedLinqAlertUpdate).toHaveBeenCalledWith({
      data: {
        lastErrorCode: "RESEND_SEND_FAILED",
        lastProviderStatus: 500,
        status: "failed",
      },
      where: {
        id: "hla_message_failed_123",
      },
    });
  });

  it("does not send when another worker already claimed the alert", async () => {
    const fixture = createAlertEmailPrismaFixture({
      updateManyResult: { count: 0 },
    });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: "email_provider_123",
    }), {
      status: 200,
    }));

    await sendPendingHostedLinqAlertsBestEffort({
      alertIds: ["hla_message_failed_123"],
      env: buildAlertEmailEnv(),
      fetchImpl,
      prisma: fixture.prisma as never,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fixture.hostedLinqAlertUpdate).not.toHaveBeenCalled();
  });

  it("does not query alerts when Linq alert email recipients are not configured", async () => {
    const fixture = createAlertEmailPrismaFixture();

    await sendPendingHostedLinqAlertsBestEffort({
      alertIds: ["hla_message_failed_123"],
      env: {
        RESEND_API_KEY: "<REDACTED_SECRET>",
        HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph Alerts <alerts@example.test>",
      },
      fetchImpl: vi.fn(),
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqAlertFindMany).not.toHaveBeenCalled();
  });
});

function createAlertEmailPrismaFixture(input?: {
  updateManyResult?: { count: number };
}) {
  const hostedLinqAlertFindMany = vi.fn().mockResolvedValue([
    {
      attemptCount: 0,
      claimedAt: new Date("2026-03-26T12:00:00.000Z"),
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveryId: "hld_123",
      detailsJson: {
        eventIdSuffix: "led_123",
        eventType: "message.failed",
        failureCode: "30007",
        failureReason: "carrier filtered",
        providerCreatedAt: "2026-03-26T12:00:00.000Z",
      },
      eventId: "evt_failed_123",
      id: "hla_message_failed_123",
      kind: "message_failed",
      lastAttemptedAt: null,
      lastErrorCode: null,
      lastProviderStatus: null,
      phoneNumberHint: "***0000",
      phoneNumberLookupKey: "hbidx:phone:v1:test",
      providerMessageId: null,
      sentAt: null,
      status: "pending",
      subject: "[Murph] Linq message failed ***0000",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    },
  ]);
  const hostedLinqAlertUpdate = vi.fn().mockResolvedValue(undefined);
  const hostedLinqAlertUpdateMany = vi.fn().mockResolvedValue(input?.updateManyResult ?? { count: 1 });
  const prisma = {
    hostedLinqAlert: {
      findMany: hostedLinqAlertFindMany,
      update: hostedLinqAlertUpdate,
      updateMany: hostedLinqAlertUpdateMany,
    },
  };

  return {
    hostedLinqAlertFindMany,
    hostedLinqAlertUpdate,
    hostedLinqAlertUpdateMany,
    prisma,
  };
}

function buildAlertEmailEnv(): Record<string, string> {
  return {
    HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph Alerts <alerts@example.test>",
    HOSTED_LINQ_ALERT_EMAIL_TIMEOUT_MS: "5000",
    HOSTED_LINQ_ALERT_EMAILS: "ops@example.test",
    RESEND_API_KEY: "<REDACTED_SECRET>",
  };
}
