import type { HostedPhoneCall } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createHostedPhoneCall } from "../src/lib/phone-calls/service";

const BRIEF = {
  allowTransferToUser: false,
  goal: "Confirm the reservation.",
  instructions: [],
  shareableFacts: {},
  successCriteria: "The reservation status is known.",
  timeZone: "America/New_York",
  to: {
    phoneNumber: "+14045550123",
  },
};

const TELEGRAM_DESTINATION = {
  conversationShape: "direct-member" as const,
  externalThreadRouteAuthority: null,
  route: {
    actorId: null,
    channel: "telegram" as const,
    delivery: {
      kind: "thread" as const,
      target: "telegram_thread_1",
    },
    identityId: null,
    threadId: "telegram_thread_hash_1",
    threadIsDirect: true as const,
  },
};

type CreatePhoneCallInput = Parameters<typeof createHostedPhoneCall>[0];
type PhoneCallStore = NonNullable<CreatePhoneCallInput["prisma"]>;
type PhoneCallRuntime = NonNullable<CreatePhoneCallInput["runtime"]>;
type NotificationDestinationResolver = NonNullable<
  CreatePhoneCallInput["notificationDestinationResolver"]
>;

describe("hosted phone-call direct result routing", () => {
  it("validates and persists Telegram before provider dispatch", async () => {
    let reservedCall: HostedPhoneCall | null = null;
    const reserve: PhoneCallStore["reserve"] = vi.fn(async (input) => {
      const now = new Date("2026-08-06T12:00:00.000Z");
      reservedCall = {
        analyzedAt: null,
        briefEncrypted: input.data.briefEncrypted,
        briefJson: null,
        createdAt: now,
        endedAt: null,
        id: input.data.id,
        memberId: input.data.memberId,
        originSessionId: input.data.originSessionId,
        provider: input.data.provider,
        providerCallId: null,
        requestKey: input.data.requestKey,
        resultEncrypted: null,
        resultJson: null,
        resultNotificationChannel: input.data.resultNotificationChannel,
        status: input.data.status,
        updatedAt: now,
      };
      return {
        call: reservedCall,
        created: true,
      };
    });
    const store: PhoneCallStore = {
      hostedPhoneCall: {
        findFirst: vi.fn(async () => null),
        findUnique: vi.fn(async () => null),
        findUniqueOrThrow: vi.fn(async () => {
          if (!reservedCall) {
            throw new Error("Expected a reserved phone call.");
          }
          return reservedCall;
        }),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      markCleanupEnded: vi.fn(async () => ({ count: 1 })),
      refreshDispatchAuthority: vi.fn(async () => ({ count: 1 })),
      reserve,
    };
    const runtime: PhoneCallRuntime = {
      resolveProviderCall: vi.fn(async () => ({ state: "not_found" })),
      start: vi.fn(async () => ({ providerCallId: "retell_call_1" })),
      stopIfActive: vi.fn(async () => undefined),
    };
    const notificationDestinationResolver: NotificationDestinationResolver =
      vi.fn(async () => TELEGRAM_DESTINATION);

    await expect(createHostedPhoneCall({
      brief: BRIEF,
      crypto: {
        encryptBrief: vi.fn(async () => "encrypted-brief"),
      } as unknown as NonNullable<CreatePhoneCallInput["crypto"]>,
      memberId: "member_telegram_call",
      notificationDestinationResolver,
      originSessionId: "session_telegram_call",
      prisma: store,
      reconciliationWorkflowStarter: vi.fn(async () => undefined),
      requestKey: "phone_call_telegram_request",
      resultNotificationChannel: "telegram",
      runtime,
      transferNumberResolver: vi.fn(async () => null),
    })).resolves.toEqual({
      phoneCallId: expect.stringMatching(/^hpc_[0-9a-f]{32}$/u),
      status: "calling",
    });

    expect(notificationDestinationResolver).toHaveBeenCalledWith({
      directChannel: "telegram",
      memberId: "member_telegram_call",
      signal: expect.any(AbortSignal),
    });
    expect(reserve).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultNotificationChannel: "telegram",
      }),
    });
    expect(runtime.start).toHaveBeenCalledTimes(1);
  });
});
