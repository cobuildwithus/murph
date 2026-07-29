import { describe, expect, it, vi } from "vitest";

import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import {
  parseHostedLinqChatHealthInventoryRecord,
} from "@/src/lib/hosted-onboarding/linq-chat-health-inventory";
import {
  evaluateHostedLinqEgressPolicy,
} from "@/src/lib/hosted-onboarding/linq-egress-policy";
import {
  parseHostedLinqProviderHealthEvent,
} from "@/src/lib/hosted-onboarding/linq-provider-health-event";
import {
  projectHostedLinqChatHealthTx,
  projectHostedLinqLineProviderStateTx,
} from "@/src/lib/hosted-onboarding/linq-provider-health-store";
import {
  parseHostedLinqChatHealthStatus,
  parseHostedLinqLineReputationStatus,
  parseHostedLinqLineServiceStatus,
} from "@/src/lib/hosted-onboarding/linq-provider-status";

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
        phone_number: "+1 (404) 379-0351",
      },
      eventType: "phone_number.status_updated",
    }))).toEqual({
      chat: null,
      line: {
        eventId: "event-health",
        phoneNumber: "+14043790351",
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
          owner_handle: {
            handle: "+1 (404) 379-0351",
          },
        },
        message: {
          parts: [{ type: "text", value: "private message" }],
        },
      },
      eventType: "message.received",
    }))).toEqual({
      chat: {
        chatId: "chat-health",
        linePhoneNumber: "+14043790351",
        providerStatus: "AT_RISK",
        providerUpdatedAt: new Date("2026-07-29T16:01:00.000Z"),
      },
      line: null,
    });
  });
});

describe("parseHostedLinqChatHealthInventoryRecord", () => {
  it("projects the documented chat health and one unambiguous sending line", () => {
    expect(parseHostedLinqChatHealthInventoryRecord({
      handles: [
        { handle: "+14043790351", is_me: true },
        { handle: "+15550100001", is_me: false },
      ],
      health_status: {
        status: "HEALTHY",
        updated_at: "2026-07-29T16:02:00.000Z",
      },
      id: "chat-1",
    })).toEqual({
      chatId: "chat-1",
      linePhoneNumber: "+14043790351",
      providerStatus: "HEALTHY",
      providerUpdatedAt: new Date("2026-07-29T16:02:00.000Z"),
    });
  });

  it("keeps health while dropping an ambiguous sending-line attribution", () => {
    expect(parseHostedLinqChatHealthInventoryRecord({
      handles: [
        { handle: "+14043790351", is_me: true },
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

describe("Linq provider health projections", () => {
  it("orders same-timestamp line snapshots by the provider event key", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      hostedLinqLineProviderState: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
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
        reputationStatus: "AT_RISK",
        serviceStatus: "ACTIVE",
      }),
      where: {
        phoneNumberLookupKey: "line-key",
        OR: expect.arrayContaining([
          { providerUpdatedAt: null },
          { providerUpdatedAt: { lt: new Date("2026-07-29T16:04:00.000Z") } },
          expect.objectContaining({
            providerUpdatedAt: new Date("2026-07-29T16:04:00.000Z"),
          }),
        ]),
      },
    }));
  });

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
    ["line_flagged", { chatHealthStatus: "HEALTHY", lineServiceStatus: "FLAGGED", newConversation: false }],
    ["line_critical", { chatHealthStatus: "HEALTHY", lineReputationStatus: "CRITICAL", newConversation: false }],
    ["line_at_risk_new_conversation", { chatHealthStatus: null, lineReputationStatus: "AT_RISK", newConversation: true }],
    ["chat_critical", { chatHealthStatus: "CRITICAL", newConversation: false }],
    ["chat_opted_out", { chatHealthStatus: "OPTED_OUT", newConversation: false }],
  ] as const)("blocks %s deterministically", (code, override) => {
    expect(evaluateHostedLinqEgressPolicy({
      ...healthyLine,
      ...override,
    })).toEqual({ code, kind: "block" });
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
