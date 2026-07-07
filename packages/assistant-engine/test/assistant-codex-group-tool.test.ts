import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import {
  HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
  SHARED_VAULT_SHARE_PROJECTIONS_SCHEMA,
} from "@murphai/hosted-execution/vault-share";
import { describe, expect, it, vi } from "vitest";

import type { AssistantHostedToolContext } from "../src/assistant/hosted-tool-context.ts";
import {
  executeMurphDynamicToolRequest,
  MURPH_GROUP_TOOL,
  MURPH_NEWSLETTER_TOOL,
  readMurphDynamicToolRequest,
} from "../src/assistant-codex/dynamic-tools.ts";

function groupToolCall(argumentsValue: unknown): Record<string, unknown> {
  return {
    method: "item/tool/call",
    params: {
      arguments: argumentsValue,
      namespace: "murph",
      tool: MURPH_GROUP_TOOL.name,
    },
  };
}

function newsletterToolCall(argumentsValue: unknown): Record<string, unknown> {
  return {
    method: "item/tool/call",
    params: {
      arguments: argumentsValue,
      namespace: "murph",
      tool: MURPH_NEWSLETTER_TOOL.name,
    },
  };
}

type NewsletterToolRequest = NonNullable<AssistantHostedToolContext["newsletterTool"]>["request"];

describe("murph.group dynamic tool", () => {
  it("advertises the supported actions", () => {
    expect(MURPH_GROUP_TOOL.inputSchema.properties.action.enum).toEqual([
      "read_current",
      "create_join_link",
      "post_join_offer",
      "post_call_circle_offer",
      "read_chat_participants",
      "share_contact_card",
      "revoke_own_email_share",
    ]);
    expect(MURPH_GROUP_TOOL.inputSchema.properties.requestedVaultShareProjectionKinds.items.enum)
      .toEqual([...HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS]);
    expect(MURPH_GROUP_TOOL.inputSchema.properties.projectionKinds.items.enum)
      .toEqual([...HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS]);
    expect(MURPH_GROUP_TOOL.inputSchema.properties.messageTemplate.description)
      .toContain("{{join_url}}");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.messageTemplate.description)
      .toContain("{{share_scope}}");
  });

  it("parses the chat-scoped actions without accepting a model-supplied thread target", () => {
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "read_chat_participants",
    }))).toEqual({
      kind: "group",
      request: { action: "read_chat_participants" },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "share_contact_card",
    }))).toEqual({
      kind: "group",
      request: { action: "share_contact_card" },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      messageTemplate:
        "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
      projectionKinds: ["sleep-times.v0"],
    }))).toEqual({
      kind: "group",
      request: {
        action: "post_join_offer",
        joinOffer: {
          messageTemplate:
            "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
          projectionKinds: ["sleep-times.v0"],
        },
      },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_call_circle_offer",
      message:
        "Like this to opt into Call Circle for this group. If needed, Murph may add you to the group and share your Murph profile name with the group. Murph will ask you privately for availability.",
    }))).toEqual({
      kind: "group",
      request: {
        action: "post_call_circle_offer",
        callCircleOffer: {
          message:
            "Like this to opt into Call Circle for this group. If needed, Murph may add you to the group and share your Murph profile name with the group. Murph will ask you privately for availability.",
        },
      },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "revoke_own_email_share",
    }))).toEqual({
      kind: "group",
      request: { action: "revoke_own_email_share" },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "share_contact_card",
      linqThread: { chatId: "chat_hijack" },
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      messageTemplate:
        "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
      linqThread: { chatId: "chat_hijack" },
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_call_circle_offer",
      linqThread: { chatId: "chat_hijack" },
      message: "Like this to opt in.",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_call_circle_offer",
      message: "Like this for a Call Circle update.",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_call_circle_offer",
      message:
        "Like this to opt into Call Circle for this group. Murph will ask you privately for availability.",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_call_circle_offer",
      message:
        "Like this to opt into Call Circle for this group and share your Murph profile name with the group. Murph will ask you privately for availability.",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_call_circle_offer",
      message:
        "Like this if you do not want to join Call Circle for this group and do not want Murph to privately ask about your availability.",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "read_chat_participants",
      chatId: "chat_hijack",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "revoke_own_email_share",
      selfOptOut: { senderHandle: "member@example.test", source: "email" },
    }))?.kind).toBe("invalid-group-arguments");
  });

  it("parses read_current arguments", () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_current",
    }));

    expect(request).toEqual({
      kind: "group",
      request: { action: "read_current" },
    });
  });

  it("parses create_join_link arguments into a bounded joinLink request", () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "create_join_link",
      displayName: "Sunday sleep crew",
      kind: "friends",
      requestedVaultShareProjectionKinds: ["sleep-times.v0", "activity-days.v0"],
    }));

    expect(request).toEqual({
      kind: "group",
      request: {
        action: "create_join_link",
        joinLink: {
          displayName: "Sunday sleep crew",
          kind: "friends",
          requestedVaultShareProjectionKinds: ["sleep-times.v0", "activity-days.v0"],
        },
      },
    });
  });

  it("parses a bare create_join_link request without joinLink details", () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "create_join_link",
    }));

    expect(request).toEqual({
      kind: "group",
      request: { action: "create_join_link" },
    });
  });

  it("rejects unsupported group kinds and projection kinds", () => {
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "create_join_link",
      kind: "everyone",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "create_join_link",
      requestedVaultShareProjectionKinds: ["all-health-data"],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      messageTemplate:
        "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
      intro: "Like this to join.",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      messageTemplate:
        "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
      projectionKinds: ["all-health-data"],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      messageTemplate: "React here to join. Details: {{join_url}}.",
      projectionKinds: ["sleep-times.v0"],
    }))?.kind).toBe("invalid-group-arguments");
  });
});

describe("murph.newsletter dynamic tool", () => {
  it("advertises the supported actions", () => {
    expect(MURPH_NEWSLETTER_TOOL.inputSchema.properties.action.enum).toEqual([
      "read_stats",
      "send",
    ]);
  });

  it("parses read and send requests without accepting model-supplied addresses", () => {
    expect(readMurphDynamicToolRequest(newsletterToolCall({
      action: "read_stats",
      groupId: "group_1",
    }))).toEqual({
      kind: "newsletter",
      request: {
        action: "read_stats",
        groupId: "group_1",
      },
    });

    expect(readMurphDynamicToolRequest(newsletterToolCall({
      action: "send",
      groupId: "group_1",
      html: "<p>Weekly</p>",
      subject: "Weekly note",
      text: "Weekly",
    }))).toEqual({
      kind: "newsletter",
      request: {
        action: "send",
        groupId: "group_1",
        html: "<p>Weekly</p>",
        subject: "Weekly note",
        text: "Weekly",
      },
    });

    expect(readMurphDynamicToolRequest(newsletterToolCall({
      action: "send",
      groupId: "group_1",
      html: "<p>Weekly</p>",
      subject: "Weekly note",
      to: ["one@example.test"],
    }))?.kind).toBe("invalid-newsletter-arguments");
  });

  it("reads scheduled newsletter stats from the occurrence week in the group timezone", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-newsletter-stats-"));
    vi.useFakeTimers();
    try {
      await writeFile(
        join(vaultRoot, "vault.json"),
        JSON.stringify({
          createdAt: "2026-07-01T00:00:00.000Z",
          formatVersion: CURRENT_VAULT_FORMAT_VERSION,
          timezone: "America/New_York",
          title: "Group Vault",
          vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
        }),
        "utf8",
      );
      await mkdir(join(vaultRoot, "derived", "vault-share"), { recursive: true });
      await writeFile(
        join(vaultRoot, "derived", "vault-share", "projections.json"),
        JSON.stringify({
          projections: {
            "profile-name.v0": newsletterProjection("profile-name.v0", {
              member_a: [
                newsletterDeliveryEntry({
                  data: { displayName: "Alex" },
                  occurredAt: "2026-07-01T00:00:00.000Z",
                  recordKey: "profile-name",
                }),
              ],
            }),
            "steps-days.v0": newsletterProjection("steps-days.v0", {
              member_a: [
                newsletterDeliveryEntry({
                  data: {
                    date: "2026-06-23",
                    metricKey: "steps",
                    unit: "count",
                    value: 5,
                  },
                  occurredAt: "2026-06-23T00:00:00.000Z",
                  recordKey: "2026-06-23",
                }),
                newsletterDeliveryEntry({
                  data: {
                    date: "2026-06-30",
                    metricKey: "steps",
                    unit: "count",
                    value: 7,
                  },
                  occurredAt: "2026-06-30T00:00:00.000Z",
                  recordKey: "2026-06-30",
                }),
                newsletterDeliveryEntry({
                  data: {
                    date: "2026-07-06",
                    metricKey: "steps",
                    unit: "count",
                    value: 99,
                  },
                  occurredAt: "2026-07-06T00:00:00.000Z",
                  recordKey: "2026-07-06",
                }),
              ],
            }),
          },
          schema: SHARED_VAULT_SHARE_PROJECTIONS_SCHEMA,
          updatedAt: "2026-07-07T12:00:00.000Z",
        }),
        "utf8",
      );

      const hostedToolContext = createNewsletterHostedToolContext();
      const request = readMurphDynamicToolRequest(newsletterToolCall({
        action: "read_stats",
        groupId: "group_1",
      }));
      if (!request || request.kind !== "newsletter") {
        throw new Error("Expected newsletter request.");
      }

      vi.setSystemTime(new Date("2026-07-06T12:00:00.000Z"));
      const first = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });
      vi.setSystemTime(new Date("2026-07-20T12:00:00.000Z"));
      const second = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(readNewsletterToolPayload(first)).toMatchObject({
        result: {
          participants: [
            {
              memberId: "member_a",
              weeklyStats: [
                {
                  currentWeekAvg: 7,
                  deltaPercent: 40,
                  previousWeekAvg: 5,
                  stream: "steps",
                  unit: "count",
                },
              ],
            },
          ],
        },
      });
      expect(readNewsletterToolPayload(second)).toEqual(readNewsletterToolPayload(first));
    } finally {
      vi.useRealTimers();
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("treats missing shared projections as ok-empty newsletter stats", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-newsletter-stats-missing-"));
    try {
      const hostedToolContext = createNewsletterHostedToolContext();
      const request = readMurphDynamicToolRequest(newsletterToolCall({
        action: "read_stats",
        groupId: "group_1",
      }));
      if (!request || request.kind !== "newsletter") {
        throw new Error("Expected newsletter request.");
      }

      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(result.rpcResult.success).toBe(true);
      expect(readNewsletterToolPayload(result)).toMatchObject({
        action: "read_stats",
        result: {
          participants: [
            {
              hasEmail: true,
              memberId: "member_a",
              weeklyStats: [],
            },
          ],
          status: "ok",
        },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("returns unavailable and blocks send when shared projections are corrupt", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-newsletter-stats-corrupt-"));
    try {
      await mkdir(join(vaultRoot, "derived", "vault-share"), { recursive: true });
      await writeFile(
        join(vaultRoot, "derived", "vault-share", "projections.json"),
        "{ not valid json",
        "utf8",
      );
      const newsletterRequest = vi.fn<NewsletterToolRequest>(async (request) =>
        request.action === "read_stats"
          ? {
              action: "read_stats" as const,
              result: {
                groupId: request.groupId,
                missingEmailParticipants: [],
                participants: [
                  { displayName: "Fallback", hasEmail: true, memberId: "member_a" },
                ],
                status: "ok" as const,
              },
            }
          : {
              action: "send" as const,
              result: {
                participantCount: 1,
                skippedNoEmailMemberIds: [],
                status: "sent" as const,
              },
            }
      );
      const hostedToolContext = createNewsletterHostedToolContext({
        newsletterRequest,
      });
      const readRequest = readMurphDynamicToolRequest(newsletterToolCall({
        action: "read_stats",
        groupId: "group_1",
      }));
      const sendRequest = readMurphDynamicToolRequest(newsletterToolCall({
        action: "send",
        groupId: "group_1",
        html: "<p>Weekly</p>",
        subject: "Weekly note",
        text: "Weekly",
      }));
      if (!readRequest || readRequest.kind !== "newsletter" || !sendRequest || sendRequest.kind !== "newsletter") {
        throw new Error("Expected newsletter requests.");
      }

      const readResult = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request: readRequest,
        vaultRoot,
      });
      const sendResult = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request: sendRequest,
        vaultRoot,
      });

      expect(readResult.rpcResult.success).toBe(true);
      expect(readNewsletterToolPayload(readResult)).toEqual({
        action: "read_stats",
        result: {
          status: "unavailable",
          unavailableReason: "shared_projection_unavailable",
        },
      });
      expect(sendResult.rpcResult.success).toBe(true);
      expect(readNewsletterToolPayload(sendResult)).toEqual({
        action: "send",
        result: {
          status: "unavailable",
          unavailableReason: "shared_projection_unavailable",
        },
      });
      expect(newsletterRequest).toHaveBeenCalledTimes(1);
      expect(newsletterRequest).toHaveBeenCalledWith({
        action: "read_stats",
        groupId: "group_1",
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("returns a failed tool result and records post-turn failure for all-recipient send failure", async () => {
    const recordNewsletterSendResult = vi.fn();
    const hostedToolContext = createNewsletterHostedToolContext({
      newsletterRequest: async (request) =>
        request.action === "send"
          ? {
              action: "send",
              result: {
                status: "unavailable",
                unavailableReason: "send_failed",
              },
            }
          : {
              action: "read_stats",
              result: {
                groupId: request.groupId,
                missingEmailParticipants: [],
                participants: [
                  { displayName: "Fallback", hasEmail: true, memberId: "member_a" },
                ],
                status: "ok",
              },
            },
      recordNewsletterSendResult,
    });
    const request = readMurphDynamicToolRequest(newsletterToolCall({
      action: "send",
      groupId: "group_1",
      html: "<p>Weekly</p>",
      subject: "Weekly note",
      text: "Weekly",
    }));
    if (!request || request.kind !== "newsletter") {
      throw new Error("Expected newsletter request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(readNewsletterToolPayload(result)).toEqual({
      action: "send",
      result: {
        status: "unavailable",
        unavailableReason: "send_failed",
      },
    });
    expect(recordNewsletterSendResult).toHaveBeenCalledWith({
      action: "send",
      result: {
        status: "unavailable",
        unavailableReason: "send_failed",
      },
    });
  });
});

function createNewsletterHostedToolContext(input: {
  newsletterRequest?: NewsletterToolRequest;
  recordNewsletterSendResult?: (result: unknown) => void;
} = {}): AssistantHostedToolContext {
  const context = {
    connectedApps: null,
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentPhoneCallToolRequestKeyScope: () => null,
    currentScheduledAutomationAuthority: () => ({
      automationId: "automation_newsletter",
      occurrenceAt: "2026-07-06T03:30:00.000Z",
    }),
    familyPlanTool: null,
    groupTool: null,
    newsletterTool: {
      request: input.newsletterRequest ?? (async (request) =>
        request.action === "read_stats"
          ? {
              action: "read_stats",
              result: {
                groupId: request.groupId,
                missingEmailParticipants: [],
                participants: [
                  { displayName: "Fallback", hasEmail: true, memberId: "member_a" },
                ],
                status: "ok",
              },
            }
          : {
              action: "send",
              result: {
                participantCount: 1,
                skippedNoEmailMemberIds: [],
                status: "sent",
              },
            }
      ),
    },
    phoneCalls: null,
    ...(input.recordNewsletterSendResult
      ? { recordNewsletterSendResult: input.recordNewsletterSendResult }
      : {}),
    sendVaultFile: async () => {
      throw new Error("Vault-file sending is unavailable for this test.");
    },
    vaultFileSendAvailable: false,
  };
  return context as AssistantHostedToolContext;
}

function readNewsletterToolPayload(
  result: Awaited<ReturnType<typeof executeMurphDynamicToolRequest>>,
): unknown {
  const item = result.rpcResult.contentItems[0];
  if (!item || item.type !== "inputText") {
    throw new Error("Expected text tool payload.");
  }
  return JSON.parse(item.text);
}

function newsletterProjection(
  projectionKind: string,
  memberRecords: Record<string, ReturnType<typeof newsletterDeliveryEntry>[]>,
) {
  return {
    grantors: Object.fromEntries(
      Object.entries(memberRecords).map(([grantorMemberId, records]) => [
        grantorMemberId,
        {
          grantorMemberId,
          projectionKind,
          records,
          shareId: "share_1",
          updatedAt: "2026-07-07T12:00:00.000Z",
        },
      ]),
    ),
  };
}

function newsletterDeliveryEntry(record: {
  data: unknown;
  occurredAt: string;
  recordKey: string;
}) {
  return {
    receivedEventId: `event_${record.recordKey}`,
    record,
    schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
    shareId: "share_1",
  };
}
