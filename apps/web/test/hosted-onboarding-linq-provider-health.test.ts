import { Buffer } from "node:buffer";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import {
  createHostedLinqChatLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  listHostedLinqChatHealthInventory,
  parseHostedLinqChatHealthInventoryRecord,
  syncHostedLinqChatHealthInventory,
} from "@/src/lib/hosted-onboarding/linq-chat-health-inventory";
import {
  evaluateHostedLinqEgressPolicy,
} from "@/src/lib/hosted-onboarding/linq-egress-policy";
import {
  resolveHostedLinqEgressPolicyForRuntime,
} from "@/src/lib/hosted-onboarding/linq-egress-engagement";
import {
  syncHostedLinqPhoneNumberInventory,
} from "@/src/lib/hosted-onboarding/linq-phone-number-inventory";
import {
  parseHostedLinqProviderHealthEvent,
} from "@/src/lib/hosted-onboarding/linq-provider-events";
import {
  projectHostedLinqChatHealthTx,
  projectHostedLinqLineProviderStateTx,
} from "@/src/lib/hosted-onboarding/linq-provider-health-store";
import {
  parseHostedLinqChatHealthStatus,
  parseHostedLinqLineReputationStatus,
  parseHostedLinqLineServiceStatus,
} from "@/src/lib/hosted-onboarding/linq-provider-status";

const inventoryMocks = vi.hoisted(() => ({
  fetchLinqApi: vi.fn(),
  upsertHostedLinqLineForPhoneTx: vi.fn(),
}));

vi.mock("@/src/lib/linq/api", () => ({
  fetchLinqApi: inventoryMocks.fetchLinqApi,
  LINQ_API_DEFAULT_TIMEOUT_MS: 10_000,
  LinqApiTimeoutError: class LinqApiTimeoutError extends Error {},
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingLinqConfig: () => ({
    apiBaseUrl: "https://provider.example.test/v3",
    apiToken: "test-token",
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq-line-store")
  >();
  return {
    ...actual,
    upsertHostedLinqLineForPhoneTx:
      inventoryMocks.upsertHostedLinqLineForPhoneTx,
  };
});

const TEST_PRIVACY_KEY = Buffer.alloc(32, 7).toString("base64");
let previousPrivacyKeys: string | undefined;
let previousPrivacyVersion: string | undefined;

beforeEach(() => {
  previousPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  previousPrivacyVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  process.env.HOSTED_CONTACT_PRIVACY_KEYS = `v1:${TEST_PRIVACY_KEY}`;
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
  clearHostedOnboardingEnvCache();
  inventoryMocks.fetchLinqApi.mockReset();
  inventoryMocks.upsertHostedLinqLineForPhoneTx.mockReset();
});

afterEach(() => {
  restoreEnv("HOSTED_CONTACT_PRIVACY_KEYS", previousPrivacyKeys);
  restoreEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", previousPrivacyVersion);
  clearHostedOnboardingEnvCache();
});

describe("Linq provider status parsing", () => {
  it("accepts only the documented independent status domains", () => {
    expect(parseHostedLinqLineServiceStatus(" active ")).toBe("ACTIVE");
    expect(parseHostedLinqLineServiceStatus("CRITICAL")).toBeNull();
    expect(parseHostedLinqLineReputationStatus("at_risk")).toBe("AT_RISK");
    expect(parseHostedLinqLineReputationStatus("FLAGGED")).toBeNull();
    expect(parseHostedLinqChatHealthStatus("opted_out")).toBe("OPTED_OUT");
    expect(parseHostedLinqChatHealthStatus("PAUSED")).toBeNull();
  });

  it("keeps line service and reputation independent in status webhooks", () => {
    expect(parseHostedLinqProviderHealthEvent(buildProviderEvent({
      data: {
        changed_at: "2026-07-29T16:00:00.000Z",
        new_reputation: "AT_RISK",
        new_status: "ACTIVE",
        phone_number: "+1 (202) 555-0123",
      },
      eventType: "phone_number.status_updated",
    }))).toEqual({
      chat: null,
      line: {
        eventId: "event-health",
        phoneNumber: "+12025550123",
        providerUpdatedAt: new Date("2026-07-29T16:00:00.000Z"),
        reputationStatus: "AT_RISK",
        serviceStatus: "ACTIVE",
      },
    });
  });

  it("extracts chat health without retaining message or participant content", () => {
    expect(parseHostedLinqProviderHealthEvent(buildProviderEvent({
      data: {
        chat: {
          health_status: {
            status: "AT_RISK",
            updated_at: "2026-07-29T16:01:00.000Z",
          },
          id: "chat-health",
          is_group: false,
          owner_handle: {
            handle: "+1 (202) 555-0123",
          },
          service: "iMessage",
        },
        message: {
          parts: [{ type: "text", value: "private message" }],
        },
      },
      eventType: "message.received",
    }))).toEqual({
      chat: {
        chatId: "chat-health",
        isGroup: false,
        linePhoneNumber: "+12025550123",
        providerStatus: "AT_RISK",
        providerUpdatedAt: new Date("2026-07-29T16:01:00.000Z"),
        service: "iMessage",
      },
      line: null,
    });
  });
});

describe("parseHostedLinqChatHealthInventoryRecord", () => {
  it("projects the documented chat health and one unambiguous sending line", () => {
    expect(parseHostedLinqChatHealthInventoryRecord({
      handles: [
        { handle: "+12025550123", is_me: true },
        { handle: "+15550100001", is_me: false },
      ],
      health_status: {
        status: "HEALTHY",
        updated_at: "2026-07-29T16:02:00.000Z",
      },
      id: "chat-1",
      is_group: true,
      service: "iMessage",
    })).toEqual({
      chatId: "chat-1",
      isGroup: true,
      linePhoneNumber: "+12025550123",
      providerStatus: "HEALTHY",
      providerUpdatedAt: new Date("2026-07-29T16:02:00.000Z"),
      service: "iMessage",
    });
  });

  it("keeps health while dropping an ambiguous sending-line attribution", () => {
    expect(parseHostedLinqChatHealthInventoryRecord({
      handles: [
        { handle: "+12025550123", is_me: true },
        { handle: "+15550100002", is_me: true },
      ],
      health_status: {
        status: "AT_RISK",
        updated_at: "2026-07-29T16:03:00.000Z",
      },
      id: "chat-2",
    })).toMatchObject({
      chatId: "chat-2",
      linePhoneNumber: null,
      providerStatus: "AT_RISK",
    });
  });
});

describe("listHostedLinqChatHealthInventory", () => {
  it("follows the global cursor beyond one hundred chats", async () => {
    inventoryMocks.fetchLinqApi
      .mockResolvedValueOnce(jsonResponse({
        chats: Array.from({ length: 100 }, (_, index) =>
          buildChatInventoryRecord(`chat-${index}`)),
        next_cursor: "page-2",
      }))
      .mockResolvedValueOnce(jsonResponse({
        chats: [buildChatInventoryRecord("chat-100")],
        next_cursor: null,
      }));

    await expect(listHostedLinqChatHealthInventory({
      maxChats: 101,
    })).resolves.toMatchObject({
      chats: { length: 101 },
      skippedCount: 0,
    });
    expect(inventoryMocks.fetchLinqApi).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ path: "chats?limit=100" }),
    );
    expect(inventoryMocks.fetchLinqApi).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: "chats?limit=100&cursor=page-2",
      }),
    );
  });

  it("fails visibly instead of returning a partial fleet snapshot", async () => {
    inventoryMocks.fetchLinqApi.mockResolvedValueOnce(jsonResponse({
      chats: [
        buildChatInventoryRecord("chat-1"),
        buildChatInventoryRecord("chat-2"),
      ],
      next_cursor: null,
    }));

    await expect(listHostedLinqChatHealthInventory({
      maxChats: 1,
    })).rejects.toMatchObject({
      code: "LINQ_CHAT_HEALTH_INVENTORY_LIMIT_EXCEEDED",
      retryable: false,
    });
  });
});

describe("Linq provider health inventory synchronization", () => {
  it("projects independent provider state for every inventoried line", async () => {
    const observedAt = new Date("2026-07-29T16:08:00.000Z");
    const queryRaw = vi.fn().mockResolvedValue([{ syncedCount: 1n }]);
    inventoryMocks.fetchLinqApi.mockResolvedValueOnce(jsonResponse({
      phone_numbers: [{
        id: "line-1",
        phone_number: "+1 (202) 555-0123",
        reputation: { status: "AT_RISK" },
        status: "ACTIVE",
      }],
    }));

    await expect(syncHostedLinqPhoneNumberInventory({
      observedAt,
      prisma: { $queryRaw: queryRaw } as never,
    })).resolves.toEqual({ syncedCount: 1 });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const query = queryRaw.mock.calls[0]?.[0] as { values: unknown[] };
    expect(query.values).toEqual(expect.arrayContaining([
      "line-1",
      "AT_RISK",
      "ACTIVE",
      observedAt,
    ]));
  });

  it("does not clear stored provider state from unknown inventory values", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ syncedCount: 1n }]);
    inventoryMocks.fetchLinqApi.mockResolvedValueOnce(jsonResponse({
      phone_numbers: [{
        id: "line-future",
        phone_number: "+1 (202) 555-0123",
        reputation: { status: "FUTURE_REPUTATION" },
        status: "FUTURE_SERVICE",
      }],
    }));

    await expect(syncHostedLinqPhoneNumberInventory({
      observedAt: new Date("2026-07-29T16:08:00.000Z"),
      prisma: { $queryRaw: queryRaw } as never,
    })).resolves.toEqual({ syncedCount: 1 });

    const query = queryRaw.mock.calls[0]?.[0] as { values: unknown[] };
    expect(query.values).not.toContain("FUTURE_REPUTATION");
    expect(query.values).not.toContain("FUTURE_SERVICE");
  });

  it("associates inventoried chat health with its resolved sending line", async () => {
    const observedAt = new Date("2026-07-29T16:09:00.000Z");
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      hostedLinqChatHealth: {
        createMany,
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
    } as never;
    inventoryMocks.fetchLinqApi.mockResolvedValueOnce(jsonResponse({
      chats: [buildChatInventoryRecord("chat-1")],
      next_cursor: null,
    }));
    inventoryMocks.upsertHostedLinqLineForPhoneTx.mockResolvedValueOnce({
      phoneNumberLookupKey: "line-key",
    });

    await expect(syncHostedLinqChatHealthInventory({
      observedAt,
      prisma,
    })).resolves.toEqual({
      skippedCount: 0,
      syncedCount: 1,
    });

    expect(inventoryMocks.upsertHostedLinqLineForPhoneTx).toHaveBeenCalledWith({
      observedAt,
      phoneNumber: "+12025550123",
      prisma,
      source: "provider",
    });
    expect(createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isGroup: false,
        phoneNumberLookupKey: "line-key",
        providerObservedAt: observedAt,
        providerStatus: "HEALTHY",
        providerUpdatedAt: new Date("2026-07-29T16:02:00.000Z"),
        service: "iMessage",
      }),
      skipDuplicates: true,
    });
  });
});

describe("Linq provider health projections", () => {
  it("orders same-timestamp line snapshots by the provider event key", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      hostedLinqLine: {
        updateMany,
      },
    } as never;

    await expect(projectHostedLinqLineProviderStateTx({
      eventId: "event-b",
      observedAt: new Date("2026-07-29T16:05:00.000Z"),
      phoneNumberLookupKey: "line-key",
      prisma,
      providerUpdatedAt: new Date("2026-07-29T16:04:00.000Z"),
      reputationStatus: "AT_RISK",
      serviceStatus: "ACTIVE",
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerServiceStatus: "ACTIVE",
        providerServiceUpdatedAt: new Date("2026-07-29T16:04:00.000Z"),
      }),
      where: {
        phoneNumberLookupKey: "line-key",
        OR: expect.arrayContaining([
          { providerServiceUpdatedAt: null },
          { providerServiceUpdatedAt: { lt: new Date("2026-07-29T16:04:00.000Z") } },
          expect.objectContaining({
            providerServiceUpdatedAt: new Date("2026-07-29T16:04:00.000Z"),
          }),
        ]),
      },
    }));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerReputationStatus: "AT_RISK",
        providerReputationUpdatedAt: new Date("2026-07-29T16:04:00.000Z"),
      }),
      where: {
        phoneNumberLookupKey: "line-key",
        OR: expect.arrayContaining([
          { providerReputationUpdatedAt: null },
          { providerReputationUpdatedAt: { lt: new Date("2026-07-29T16:04:00.000Z") } },
          expect.objectContaining({
            providerReputationUpdatedAt: new Date("2026-07-29T16:04:00.000Z"),
          }),
        ]),
      },
    }));
    expect(updateMany.mock.calls.every(([query]) =>
      !Object.hasOwn(query.data, "providerStatus")
      && !Object.hasOwn(query.data, "providerUpdatedAt")
      && !Object.hasOwn(query.data, "lastStatusEventId"),
    )).toBe(true);
  });

  it("does not clear an independent provider dimension for an unknown value", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });

    await expect(projectHostedLinqLineProviderStateTx({
      eventId: "event-future",
      phoneNumberLookupKey: "line-key",
      prisma: {
        hostedLinqLine: { updateMany },
      } as never,
      providerUpdatedAt: new Date("2026-07-29T16:05:00.000Z"),
      reputationStatus: "FUTURE_STATUS",
      serviceStatus: "ACTIVE",
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerServiceStatus: "ACTIVE",
        providerServiceUpdatedAt: new Date("2026-07-29T16:05:00.000Z"),
      }),
    }));
    expect(updateMany.mock.calls.some(([query]) =>
      Object.hasOwn(query.data, "providerReputationStatus"),
    )).toBe(false);
  });

  it("orders delayed service and reputation updates independently", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      hostedLinqLine: { updateMany },
    } as never;

    await projectHostedLinqLineProviderStateTx({
      eventId: "event-service",
      phoneNumberLookupKey: "line-key",
      prisma,
      providerUpdatedAt: new Date("2026-07-29T16:10:00.000Z"),
      serviceStatus: "ACTIVE",
    });
    await projectHostedLinqLineProviderStateTx({
      eventId: "event-reputation",
      phoneNumberLookupKey: "line-key",
      prisma,
      providerUpdatedAt: new Date("2026-07-29T16:05:00.000Z"),
      reputationStatus: "CRITICAL",
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerReputationStatus: "CRITICAL",
      }),
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { providerReputationUpdatedAt: null },
          {
            providerReputationUpdatedAt: {
              lt: new Date("2026-07-29T16:05:00.000Z"),
            },
          },
        ]),
      }),
    }));
    expect(updateMany.mock.calls.some(([query]) =>
      query.data.providerReputationStatus === "CRITICAL"
      && Object.hasOwn(query.data, "providerServiceStatus"),
    )).toBe(false);
  });

  it.each([
    {
      data: {
        changed_at: "2026-07-29T16:11:00.000Z",
        new_reputation: "HEALTHY",
        phone_number: "+1 (202) 555-0123",
      },
      expectedBlockCode: "line_flagged",
      initialReputationStatus: "AT_RISK",
      initialServiceStatus: "FLAGGED",
    },
    {
      data: {
        changed_at: "2026-07-29T16:11:00.000Z",
        new_status: "ACTIVE",
        phone_number: "+1 (202) 555-0123",
      },
      expectedBlockCode: "line_critical",
      initialReputationStatus: "CRITICAL",
      initialServiceStatus: "FLAGGED",
    },
  ] as const)(
    "preserves an independent $expectedBlockCode hard block through a partial webhook",
    async ({
      data,
      expectedBlockCode,
      initialReputationStatus,
      initialServiceStatus,
    }) => {
      const state: {
        reputationStatus: string;
        serviceStatus: string;
      } = {
        reputationStatus: initialReputationStatus,
        serviceStatus: initialServiceStatus,
      };
      const health = parseHostedLinqProviderHealthEvent(buildProviderEvent({
        data,
        eventType: "phone_number.status_updated",
      }));
      const updateMany = vi.fn(async (query: {
        data: Record<string, unknown>;
      }) => {
        if (typeof query.data.providerReputationStatus === "string") {
          state.reputationStatus = query.data.providerReputationStatus;
        }
        if (typeof query.data.providerServiceStatus === "string") {
          state.serviceStatus = query.data.providerServiceStatus;
        }
        return { count: 1 };
      });

      expect(health.line).not.toBeNull();
      await projectHostedLinqLineProviderStateTx({
        eventId: health.line?.eventId,
        phoneNumberLookupKey: "line-key",
        prisma: {
          hostedLinqLine: { updateMany },
        } as never,
        providerUpdatedAt: health.line?.providerUpdatedAt,
        reputationStatus: health.line?.reputationStatus,
        serviceStatus: health.line?.serviceStatus,
      });

      expect(evaluateHostedLinqEgressPolicy({
        chatHealthStatus: "HEALTHY",
        lineDeliveryHealthStatus: "healthy",
        lineEgressPolicy: "enabled",
        lineReputationStatus: state.reputationStatus,
        lineServiceStatus: state.serviceStatus,
        newConversation: false,
      })).toEqual({
        code: expectedBlockCode,
        kind: "block",
      });
    },
  );

  it("cannot let an older chat snapshot overwrite newer provider state", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      hostedLinqChatHealth: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([{
          linqChatLookupKey: "chat-key",
        }]),
        updateMany,
      },
    } as never;

    await expect(projectHostedLinqChatHealthTx({
      chatId: "chat-health",
      observedAt: new Date("2026-07-29T16:06:00.000Z"),
      prisma,
      providerStatus: "AT_RISK",
      providerUpdatedAt: new Date("2026-07-29T16:00:00.000Z"),
    })).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        providerUpdatedAt: { lte: new Date("2026-07-29T16:00:00.000Z") },
      }),
    }));
  });

  it("clears stale line attribution when the provider handle is ambiguous", async () => {
    const linqChatLookupKey = createHostedLinqChatLookupKey("chat-health");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    if (!linqChatLookupKey) {
      throw new Error("Expected a chat lookup key.");
    }

    await expect(projectHostedLinqChatHealthTx({
      chatId: "chat-health",
      phoneNumberLookupKey: null,
      prisma: {
        hostedLinqChatHealth: {
          createMany: vi.fn(),
          findMany: vi.fn().mockResolvedValue([{ linqChatLookupKey }]),
          updateMany,
        },
      } as never,
      providerStatus: "AT_RISK",
      providerUpdatedAt: new Date("2026-07-29T16:07:00.000Z"),
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phoneNumberLookupKey: null,
      }),
    }));
  });

  it("moves an existing logical chat row to the current privacy key", async () => {
    const restore = configureContactPrivacyKeyringForTest("v1");
    const legacyLookupKey = createHostedLinqChatLookupKey("chat-health");
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v2";
    clearHostedOnboardingEnvCache();
    const currentLookupKey = createHostedLinqChatLookupKey("chat-health");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn();

    if (!legacyLookupKey || !currentLookupKey) {
      throw new Error("Expected chat lookup keys.");
    }

    try {
      await expect(projectHostedLinqChatHealthTx({
        chatId: "chat-health",
        prisma: {
          hostedLinqChatHealth: {
            createMany,
            findMany: vi.fn().mockResolvedValue([{ linqChatLookupKey: legacyLookupKey }]),
            updateMany,
          },
        } as never,
        providerStatus: "HEALTHY",
        providerUpdatedAt: new Date("2026-07-29T16:10:00.000Z"),
      })).resolves.toBe(true);

      expect(createMany).not.toHaveBeenCalled();
      expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          linqChatLookupKey: currentLookupKey,
        }),
        where: expect.objectContaining({
          linqChatLookupKey: legacyLookupKey,
        }),
      }));
    } finally {
      restore();
    }
  });
});

describe("evaluateHostedLinqEgressPolicy", () => {
  const healthyLine = {
    lineDeliveryHealthStatus: "healthy",
    lineEgressPolicy: "enabled",
    lineReputationStatus: "HEALTHY",
    lineServiceStatus: "ACTIVE",
  } as const;

  it("allows a healthy existing thread normally", () => {
    expect(evaluateHostedLinqEgressPolicy({
      ...healthyLine,
      chatHealthStatus: "HEALTHY",
      newConversation: false,
    })).toEqual({
      kind: "allow",
      posture: "normal",
      signals: [],
    });
  });

  it("uses cautious posture for an at-risk line without dropping its route", () => {
    expect(evaluateHostedLinqEgressPolicy({
      ...healthyLine,
      chatHealthStatus: "HEALTHY",
      lineReputationStatus: "AT_RISK",
      newConversation: false,
    })).toEqual({
      kind: "allow",
      posture: "cautious",
      signals: ["line_at_risk"],
    });
  });

  it("uses recovery posture for an at-risk existing chat", () => {
    expect(evaluateHostedLinqEgressPolicy({
      ...healthyLine,
      chatHealthStatus: "AT_RISK",
      newConversation: false,
    })).toEqual({
      kind: "allow",
      posture: "recover",
      signals: ["chat_at_risk"],
    });
  });

  it("treats missing existing-chat health as cautious, not healthy", () => {
    expect(evaluateHostedLinqEgressPolicy({
      ...healthyLine,
      chatHealthStatus: null,
      newConversation: false,
    })).toEqual({
      kind: "allow",
      posture: "cautious",
      signals: ["chat_health_unknown"],
    });
  });

  it.each([
    ["operator_disabled", { chatHealthStatus: "HEALTHY", lineEgressPolicy: "disabled", newConversation: false }],
    ["line_flagged", { chatHealthStatus: "HEALTHY", lineServiceStatus: "FLAGGED", newConversation: false }],
    ["line_critical", { chatHealthStatus: "HEALTHY", lineReputationStatus: "CRITICAL", newConversation: false }],
    ["line_at_risk_new_conversation", { chatHealthStatus: null, lineReputationStatus: "AT_RISK", newConversation: true }],
    ["chat_critical", { chatHealthStatus: "CRITICAL", newConversation: false }],
    ["chat_opted_out", { chatHealthStatus: "OPTED_OUT", newConversation: false }],
    ["delivery_unhealthy", { chatHealthStatus: "HEALTHY", lineDeliveryHealthStatus: "unhealthy", newConversation: false }],
    ["delivery_warning_new_conversation", { chatHealthStatus: null, lineDeliveryHealthStatus: "warning", newConversation: true }],
  ] as const)("blocks %s deterministically", (code, override) => {
    expect(evaluateHostedLinqEgressPolicy({
      ...healthyLine,
      ...override,
    })).toEqual({ code, kind: "block" });
  });
});

describe("resolveHostedLinqEgressPolicyForRuntime", () => {
  it("uses the final chat projection's line instead of a stale sender input", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      egressPolicy: "enabled",
      healthStatus: "healthy",
      phoneNumberLookupKey: "line-current",
      providerReputationStatus: "CRITICAL",
      providerServiceStatus: "ACTIVE",
    });

    await expect(resolveHostedLinqEgressPolicyForRuntime({
      fromPhoneNumber: "+15550100099",
      prisma: {
        hostedLinqChatHealth: {
          findFirst: vi.fn().mockResolvedValue({
            linqChatLookupKey: "chat-current",
            phoneNumberLookupKey: "line-current",
            providerObservedAt: new Date("2026-07-29T16:00:00.000Z"),
            providerStatus: "HEALTHY",
            providerUpdatedAt: new Date("2026-07-29T15:59:00.000Z"),
          }),
        },
        hostedLinqLine: { findFirst },
      } as never,
      target: "chat-current",
      targetKind: "thread",
    })).resolves.toEqual({
      policy: {
        code: "line_critical",
        kind: "block",
      },
    });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        phoneNumberLookupKey: { in: ["line-current"] },
      },
    }));
  });
});

function buildProviderEvent(input: {
  data: unknown;
  eventType: string;
}): HostedLinqWebhookEvent {
  return {
    api_version: "2026-02-03",
    created_at: "2026-07-29T16:00:00.000Z",
    data: input.data,
    event_id: "event-health",
    event_type: input.eventType,
  };
}

function buildChatInventoryRecord(id: string) {
  return {
    handles: [{ handle: "+12025550123", is_me: true }],
    health_status: {
      status: "HEALTHY",
      updated_at: "2026-07-29T16:02:00.000Z",
    },
    id,
    is_group: false,
    service: "iMessage",
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function configureContactPrivacyKeyringForTest(currentVersion: string): () => void {
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  process.env.HOSTED_CONTACT_PRIVACY_KEYS = [
    `v1:${Buffer.from("1".repeat(32), "utf8").toString("base64")}`,
    `v2:${Buffer.from("2".repeat(32), "utf8").toString("base64")}`,
  ].join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = currentVersion;
  clearHostedOnboardingEnvCache();

  return () => {
    restoreEnv("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
    restoreEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", previousVersion);
    clearHostedOnboardingEnvCache();
  };
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
