import { describe, expect, it, vi } from "vitest";

import { ExecutionOutboxStatus } from "@prisma/client";
import type { SharePack } from "@murph/contracts";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingSecretCodec: () => ({
    keyVersion: "v1",
    encrypt: (value: string) => value,
    decrypt: (value: string) => value,
  }),
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
}));

import { hydrateHostedExecutionDispatch } from "@/src/lib/hosted-execution/hydration";
import { serializeHostedExecutionOutboxPayload } from "@/src/lib/hosted-execution/outbox-payload";

function buildSharePack(): SharePack {
  return {
    schemaVersion: "murph.share-pack.v1",
    title: "Morning Smoothie",
    createdAt: "2026-03-26T12:00:00.000Z",
    entities: [
      {
        kind: "protocol",
        ref: "protocol:creatine",
        payload: {
          title: "Creatine monohydrate",
          kind: "supplement",
          status: "active",
          startedOn: "2026-03-01",
          group: "supplement",
        },
      },
      {
        kind: "food",
        ref: "food:morning-smoothie",
        payload: {
          title: "Morning Smoothie",
          status: "active",
          kind: "smoothie",
          attachedProtocolRefs: ["protocol:creatine"],
        },
      },
    ],
    afterImport: {
      logMeal: {
        foodRef: "food:morning-smoothie",
      },
    },
  };
}

function buildShareOutboxRecord(payloadJson: unknown) {
  const occurredAt = "2026-03-26T12:30:00.000Z";

  return {
    acceptedAt: null,
    attemptCount: 0,
    claimExpiresAt: null,
    claimToken: null,
    completedAt: null,
    createdAt: new Date(occurredAt),
    eventId: "evt_share_123",
    eventKind: "vault.share.accepted",
    failedAt: null,
    id: "execout_123",
    lastAttemptAt: null,
    lastError: null,
    lastStatusJson: null,
    nextAttemptAt: new Date(occurredAt),
    payloadJson,
    sourceId: "share_123",
    sourceType: "hosted_share_link",
    status: ExecutionOutboxStatus.pending,
    updatedAt: new Date(occurredAt),
    userId: "member_123",
  };
}

describe("hydrateHostedExecutionDispatch", () => {
  it("hydrates minimized share outbox refs from the hosted share link payload", async () => {
    const pack = buildSharePack();
    const prisma = {
      hostedShareLink: {
        findUnique: vi.fn().mockResolvedValue({
          encryptedPayload: JSON.stringify(pack),
        }),
      },
    };

    const dispatch = await hydrateHostedExecutionDispatch(
      buildShareOutboxRecord(
        serializeHostedExecutionOutboxPayload({
          event: {
            kind: "vault.share.accepted",
            pack,
            userId: "member_123",
          },
          eventId: "evt_share_123",
          occurredAt: "2026-03-26T12:30:00.000Z",
        }),
      ) as never,
      prisma as never,
    );

    expect(prisma.hostedShareLink.findUnique).toHaveBeenCalledWith({
      where: {
        id: "share_123",
      },
      select: {
        encryptedPayload: true,
      },
    });
    expect(dispatch).toEqual({
      event: {
        kind: "vault.share.accepted",
        pack,
        userId: "member_123",
      },
      eventId: "evt_share_123",
      occurredAt: "2026-03-26T12:30:00.000Z",
    });
  });

  it("rejects legacy full-payload outbox rows that do not carry a dispatch ref", async () => {
    const prisma = {
      hostedShareLink: {
        findUnique: vi.fn(),
      },
    };

    await expect(
      hydrateHostedExecutionDispatch(
        buildShareOutboxRecord({
          event: {
            kind: "vault.share.accepted",
            userId: "member_123",
          },
          eventId: "evt_share_123",
          occurredAt: "2026-03-26T12:30:00.000Z",
        }) as never,
        prisma as never,
      ),
    ).rejects.toThrow("missing a dispatch ref");
    expect(prisma.hostedShareLink.findUnique).not.toHaveBeenCalled();
  });
});
