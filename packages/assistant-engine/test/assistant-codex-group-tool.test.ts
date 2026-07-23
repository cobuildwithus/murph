import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initializeVault } from "@murphai/core";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_JOIN_OFFER_LEGACY_MESSAGE_TEMPLATE,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
} from "@murphai/hosted-execution/vault-share";
import { describe, expect, it, vi } from "vitest";

import type { AssistantHostedToolContext } from "../src/assistant/hosted-tool-context.ts";
import type {
  AssistantHostedGeneratedImageUploadInput,
  AssistantHostedGroupSharedReader,
} from "../src/assistant/execution-context.ts";
import {
  executeMurphDynamicToolRequest,
  MURPH_DYNAMIC_TOOLS,
  MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL,
  MURPH_GROUP_SHARED_READ_TOOL,
  MURPH_GROUP_TOOL,
  MURPH_NEWSLETTER_TOOL,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.ts";

function groupToolCall(
  argumentsValue: unknown,
  options: { callId?: string; id?: number } = {},
): Record<string, unknown> {
  return {
    ...(options.id !== undefined ? { id: options.id } : {}),
    method: "item/tool/call",
    params: {
      arguments: argumentsValue,
      ...(options.callId ? { callId: options.callId } : {}),
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
const NEWSLETTER_AUTHORIZATION_PROOF = "a".repeat(64);
type GroupToolRequest = NonNullable<AssistantHostedToolContext["groupTool"]>["request"];
type GroupPermissionOfferRequest = NonNullable<
  AssistantHostedToolContext["groupPermissionOfferTool"]
>["request"];
type GroupSharedReadRequest = AssistantHostedGroupSharedReader["request"];

const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46,
  0x00, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
]);
const EARLIER_ASSISTANT_INPUT_ID = `ain_${"1".repeat(32)}`;
const FRESH_ASSISTANT_INPUT_ID = `ain_${"2".repeat(32)}`;

describe("murph.group dynamic tool", () => {
  it("advertises the supported actions", () => {
    expect(MURPH_DYNAMIC_TOOLS).not.toContain(MURPH_GROUP_SHARED_READ_TOOL);
    expect(MURPH_DYNAMIC_TOOLS)
      .not.toContain(MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL);
    expect(MURPH_GROUP_TOOL.inputSchema.properties.action.enum).toEqual([
      "ask",
      "ask_member",
      "post_disclosure_request",
      "revoke_disclosure_grant",
      "read_shared",
      "read_current",
      "read_usage",
      "list_memberships",
      "leave_membership",
      "update_display_name",
      "create_join_link",
      "post_join_offer",
      "read_chat_participants",
      "set_chat_avatar",
      "share_contact_card",
      "revoke_own_email_share",
    ]);
    expect(MURPH_GROUP_TOOL.inputSchema.properties.question.maxLength)
      .toBe(HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS);
    expect(MURPH_GROUP_TOOL.inputSchema.properties.groupLabel.maxLength)
      .toBe(HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS);
    expect(MURPH_GROUP_TOOL.inputSchema.properties.permissionText.maxLength)
      .toBe(HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS);
    expect(MURPH_GROUP_TOOL.inputSchema.properties.requestedVaultShareProjectionScopes.maxItems)
      .toBe(HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.length);
    expect(MURPH_GROUP_TOOL.inputSchema.properties.projectionScopes.maxItems)
      .toBe(HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.length);
    const [
      fixedScopeSchema,
      minutesScopeSchema,
      distanceScopeSchema,
      sessionCountScopeSchema,
    ] = MURPH_GROUP_TOOL.inputSchema.properties.projectionScopes.items.oneOf;
    expect(fixedScopeSchema.properties.projectionKind.enum)
      .toEqual(expect.arrayContaining(["sleep-times.v0", "steps-days.v0"]));
    expect(minutesScopeSchema.properties.projectionKind.enum)
      .toEqual([HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND]);
    expect(distanceScopeSchema.properties.projectionKind.enum)
      .toEqual([HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND]);
    expect(sessionCountScopeSchema.properties.projectionKind.enum)
      .toEqual([HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND]);
    expect(minutesScopeSchema.properties.selector.properties.activityKind.enum)
      .toEqual([...HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_SELECTOR_ACTIVITY_KINDS]);
    expect(distanceScopeSchema.properties.selector.properties.activityKind.enum)
      .toEqual([...HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ACTIVITY_KINDS]);
    expect(sessionCountScopeSchema.properties.selector.properties.activityKind.enum)
      .toEqual([...HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ACTIVITY_KINDS]);
    expect(distanceScopeSchema.properties.selector.properties.activityKind.enum)
      .not.toContain("sleep");
    expect(sessionCountScopeSchema.properties.selector.properties.activityKind.enum)
      .not.toContain("sleep");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.displayName.description)
      .toContain("the name the group chose");
    expect(MURPH_GROUP_TOOL.inputSchema.properties).not.toHaveProperty("messageTemplate");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.projectionScopes.description)
      .toContain("Existing membership and other grants remain unchanged");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.projectionScopes.description)
      .toContain("Web writes the complete causal consent sentence");
    expect(MURPH_GROUP_TOOL.description).toContain('action="list_memberships"');
    expect(MURPH_GROUP_TOOL.description).toContain("top-level disclosureGrants");
    expect(MURPH_GROUP_TOOL.description).toContain('action="leave_membership"');
    expect(MURPH_GROUP_TOOL.description).toContain("call list_memberships first");
    expect(MURPH_GROUP_TOOL.description).toContain("exact nonempty membershipId");
    expect(MURPH_GROUP_TOOL.description).toContain("Never guess a membershipId");
    expect(MURPH_GROUP_TOOL.description).toContain("construct, use, or expose a join URL to leave");
    expect(MURPH_GROUP_TOOL.description).not.toContain("temporarily unavailable");
    expect(MURPH_GROUP_TOOL.description).toContain("does not remove them from the iMessage chat");
    expect(MURPH_GROUP_TOOL.description).toContain("Owners cannot leave");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.membershipId.description)
      .toContain("immediately preceding list_memberships result");
    expect(MURPH_GROUP_TOOL.description).toContain("permission only");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("percentage of the current period's usage remaining");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("floored and clamped to 0-100");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("means under 1 percent remains");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("share the returned remainingPercent and periodEnd");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("Never infer or disclose internal currency accounting");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("contributor identity, purchase history, or payment status");
    expect(MURPH_GROUP_TOOL.description).toContain("use ordinary shell waits and exact replay");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("poll every accepted ask_member call until it returns completed or unavailable");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("existing server request expiry bounds the polling loop");
    expect(MURPH_GROUP_TOOL.description).not.toContain("sleep 60");
    expect(MURPH_GROUP_TOOL.description).not.toContain("resumes the automation");
    expect(MURPH_GROUP_TOOL.description)
      .toContain('In a connected group-chat turn, if read_current returns status="none"');
    expect(MURPH_GROUP_TOOL.description)
      .toContain("no hosted group record exists yet");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("continue with create_join_link or post_join_offer");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("instead of claiming that an external workspace-linking step is required");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("When an existing group adds a permission, default to post_join_offer");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("do not tell members to join again or make the link the primary action");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("pass the exact projectionScopes");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("Web owns the full canonical consent copy");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("Never supply offer text");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("existing members keep their membership and other grants");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("When these actions are available for the current connected group-chat turn");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("whether each participant already uses Murph");
    expect(MURPH_GROUP_TOOL.description).not.toContain("their own Murph");
  });

  it("advertises the least-privileged group surface for the available ports", () => {
    const readerOnlyGroupTools = resolveMurphDynamicTools({
      groupAvailable: false,
      groupSharedReadAvailable: true,
    }).filter((tool) => tool.namespace === "murph" && tool.name === "group");

    expect(readerOnlyGroupTools).toEqual([MURPH_GROUP_SHARED_READ_TOOL]);
    expect(MURPH_GROUP_SHARED_READ_TOOL.inputSchema.properties.action.enum).toEqual([
      "read_shared",
    ]);

    const scheduledGroupTools = resolveMurphDynamicTools({
      groupAvailable: false,
      groupPermissionOfferAvailable: true,
      groupSharedReadAvailable: true,
    }).filter((tool) => tool.namespace === "murph" && tool.name === "group");
    expect(scheduledGroupTools).toEqual([
      MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL,
    ]);
    expect(
      MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL
        .inputSchema.properties.action.enum,
    ).toEqual(["read_shared", "post_join_offer"]);
    expect(
      Object.keys(
        MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL.inputSchema.properties,
      ),
    ).toEqual(["action", "projectionScopes"]);

    expect(resolveMurphDynamicTools({
      groupAvailable: false,
      groupPermissionOfferAvailable: true,
      groupSharedReadAvailable: false,
    }).filter((tool) => tool.namespace === "murph" && tool.name === "group"))
      .toEqual([]);

    const fullGroupTools = resolveMurphDynamicTools({
      groupAvailable: true,
      groupSharedReadAvailable: true,
    }).filter((tool) => tool.namespace === "murph" && tool.name === "group");
    expect(fullGroupTools).toEqual([MURPH_GROUP_TOOL]);
  });

  it("parses the chat-scoped actions without accepting a model-supplied thread target", () => {
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "read_usage",
    }))).toEqual({
      kind: "group",
      request: { action: "read_usage" },
    });

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
      displayName: "Sunday Sleep Crew",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }))).toEqual({
      kind: "group",
      request: {
        action: "post_join_offer",
        joinOffer: {
          displayName: "Sunday Sleep Crew",
          messageTemplate: HOSTED_RUNTIME_GROUP_JOIN_OFFER_LEGACY_MESSAGE_TEMPLATE,
          projectionScopes: [{ projectionKind: "sleep-times.v0" }],
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
      messageTemplate: "Model-authored consent copy must not cross the boundary.",
      linqThread: { chatId: "chat_hijack" },
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

  it("parses set_chat_avatar arguments without accepting model-supplied URLs or targets", () => {
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "set_chat_avatar",
      avatarSource: "generate",
      prompt: "A clean square badge for our running group",
      referenceImageRefs: ["raw/inbox/reference.png"],
    }))).toEqual({
      kind: "group",
      request: {
        action: "set_chat_avatar",
        avatar: {
          source: "generate",
          args: {
            alt: null,
            outputFormat: "webp",
            prompt: "A clean square badge for our running group",
            quality: "medium",
            referenceImageRefs: ["raw/inbox/reference.png"],
            size: "1024x1024",
          },
        },
      },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "set_chat_avatar",
      alt: "Group avatar",
      avatarSource: "image_ref",
      imageRef: "raw/inbox/avatar.png",
    }))).toEqual({
      kind: "group",
      request: {
        action: "set_chat_avatar",
        avatar: {
          alt: "Group avatar",
          imageRef: "raw/inbox/avatar.png",
          source: "image_ref",
        },
      },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "set_chat_avatar",
      avatarSource: "generate",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "set_chat_avatar",
      avatarSource: "image_ref",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "set_chat_avatar",
      avatarSource: "image_ref",
      groupChatIconUrl: "https://example.com/avatar.png",
      imageRef: "raw/inbox/avatar.png",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "set_chat_avatar",
      avatarSource: "image_ref",
      chatId: "chat_hijack",
      imageRef: "raw/inbox/avatar.png",
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
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "read_current",
      linqSenderHandles: ["member@example.test"],
    }))?.kind).toBe("invalid-group-arguments");
  });

  it("redacts member identity from a successful read_current result", async () => {
    const groupRequest = vi.fn<GroupToolRequest>(async () => ({
      action: "read_current",
      result: {
        group: {
          displayName: "Challenge group",
          id: "group_challenge",
          kind: "friends",
          memberCount: 1,
          members: [{
            disclosureGrants: [],
            grantedVaultShareProjectionKinds: ["steps-days.v0"],
            grantedVaultShareProjectionScopes: [{ projectionKind: "steps-days.v0" }],
            handle: "+15551110003",
            memberId: "global_member_id",
            role: "owner",
          }],
          requestedVaultShareProjectionKinds: ["steps-days.v0"],
          requestedVaultShareProjectionScopes: [{ projectionKind: "steps-days.v0" }],
          status: "active",
        },
        status: "ok",
      },
    }));
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_current",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({ groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(readGroupToolPayload(result)).toEqual({
      action: "read_current",
      result: {
        group: {
          displayName: "Challenge group",
          id: "group_challenge",
          kind: "friends",
          memberCount: 1,
          members: [{
            grantedVaultShareProjectionKinds: ["steps-days.v0"],
            grantedVaultShareProjectionScopes: [{ projectionKind: "steps-days.v0" }],
            role: "owner",
          }],
          requestedVaultShareProjectionKinds: ["steps-days.v0"],
          requestedVaultShareProjectionScopes: [{ projectionKind: "steps-days.v0" }],
          status: "active",
        },
        status: "ok",
      },
    });
    const modelPayload = JSON.stringify(readGroupToolPayload(result));
    expect(modelPayload).not.toContain("global_member_id");
    expect(modelPayload).not.toContain("memberId");
    expect(modelPayload).not.toContain("+15551110003");
    expect(modelPayload).not.toContain("handle");
  });

  it("parses a bounded exact shared-data read without model-supplied authority", () => {
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "read_shared",
      projectionScopes: [
        { projectionKind: "steps-days.v0" },
        { projectionKind: "device-sync-status.v0" },
      ],
    }))).toEqual({
      kind: "group",
      request: {
        action: "read_shared",
        projectionScopes: [
          { projectionKind: "steps-days.v0" },
          { projectionKind: "device-sync-status.v0" },
        ],
      },
    });

    for (const invalid of [
      { action: "read_shared", projectionScopes: [] },
      {
        action: "read_shared",
        projectionScopes: [
          { projectionKind: "steps-days.v0" },
          { projectionKind: "sleep-times.v0" },
          { projectionKind: "device-sync-status.v0" },
          { projectionKind: "hrv-days.v0" },
        ],
      },
      {
        action: "read_shared",
        projectionScopes: [
          { projectionKind: "steps-days.v0" },
          { projectionKind: "steps-days.v0" },
        ],
      },
      {
        action: "read_shared",
        projectionScopes: [{ projectionKind: "profile-name.v0" }],
      },
      {
        action: "read_shared",
        linqSenderHandles: ["member@example.test"],
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      },
      {
        action: "read_shared",
        memberId: "member_hijack",
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      },
      {
        action: "read_shared",
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
        shareId: "share_hijack",
      },
      {
        action: "read_shared",
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
        runtimeMemberId: "runtime_hijack",
      },
    ]) {
      expect(readMurphDynamicToolRequest(groupToolCall(invalid))?.kind)
        .toBe("invalid-group-arguments");
    }
  });

  it("returns scoped participant keys for exact joins without exposing global member ids", async () => {
    const response = {
      members: [
        {
          currentTurnHandles: ["+15551110001"],
          displayName: "Alex",
          memberId: "member_a",
          participantId: "participant_a",
          trustedOnlyMemberField: "shared_member_internal",
          projections: [
            {
              dataStatus: "available" as const,
              grantStatus: "granted" as const,
              projectionScope: { projectionKind: "steps-days.v0" as const },
              projectionScopeKey: "steps-days.v0",
              records: [{
                data: {
                  date: "2026-07-18",
                  metricKey: "steps" as const,
                  unit: "count",
                  value: 8_001,
                },
                occurredAt: "2026-07-18T00:00:00.000Z",
                recordKey: "2026-07-18",
              }],
            },
            {
              dataStatus: "missing" as const,
              grantStatus: "not_granted" as const,
              projectionScope: { projectionKind: "device-sync-status.v0" as const },
              projectionScopeKey: "device-sync-status.v0",
              records: [],
            },
          ],
        },
        {
          currentTurnHandles: ["member-b@example.test"],
          displayName: "Alex",
          memberId: "member_b",
          participantId: "participant_b",
          projections: [
            {
              dataStatus: "missing" as const,
              grantStatus: "granted" as const,
              projectionScope: { projectionKind: "steps-days.v0" as const },
              projectionScopeKey: "steps-days.v0",
              records: [],
            },
            {
              dataStatus: "available" as const,
              grantStatus: "granted" as const,
              projectionScope: { projectionKind: "device-sync-status.v0" as const },
              projectionScopeKey: "device-sync-status.v0",
              records: [{
                data: {
                  observedAt: "2026-07-18T00:00:00.000Z",
                  sources: [],
                },
                occurredAt: "2026-07-18T00:00:00.000Z",
                recordKey: "device-sync-status",
              }],
            },
          ],
        },
      ],
      requestedProjectionScopeKeys: [
        "steps-days.v0",
        "device-sync-status.v0",
      ],
      status: "ok" as const,
      trustedOnlyResultField: "shared_result_internal",
    };
    const groupSharedReadRequest = vi.fn(async () => response);
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_shared",
      projectionScopes: [
        { projectionKind: "steps-days.v0" },
        { projectionKind: "device-sync-status.v0" },
      ],
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        groupSharedReadRequest,
        groupToolAvailable: false,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult.success).toBe(true);
    expect(groupSharedReadRequest).toHaveBeenCalledWith({
      projectionScopes: [
        { projectionKind: "steps-days.v0" },
        { projectionKind: "device-sync-status.v0" },
      ],
    });
    const toolText = result.rpcResult.contentItems[0];
    if (!toolText || toolText.type !== "inputText") {
      throw new Error("Expected text tool payload.");
    }
    expect(toolText.text).not.toContain("member_a");
    expect(toolText.text).not.toContain("member_b");
    expect(toolText.text).not.toContain("memberId");
    expect(toolText.text).not.toContain("shared_member_internal");
    expect(toolText.text).not.toContain("shared_result_internal");
    expect(toolText.text).toContain('"participantId":"participant_a"');
    expect(toolText.text).toContain('"participantId":"participant_b"');
    const payload = readGroupToolPayload(result);
    expect(payload).toMatchObject({
      action: "read_shared",
      result: {
        members: [
          {
            currentTurnHandles: ["+15551110001"],
            displayName: "Alex",
            participantId: "participant_a",
            projections: [
              {
                dataStatus: "available",
                grantStatus: "granted",
                projectionScopeKey: "steps-days.v0",
              },
              {
                dataStatus: "missing",
                grantStatus: "not_granted",
                projectionScopeKey: "device-sync-status.v0",
              },
            ],
          },
          {
            currentTurnHandles: ["member-b@example.test"],
            displayName: "Alex",
            participantId: "participant_b",
            projections: [
              { dataStatus: "missing", grantStatus: "granted" },
              { dataStatus: "available", grantStatus: "granted" },
            ],
          },
        ],
        status: "ok",
      },
    });
  });

  it("strips global member ids from every group-summary mutation result", async () => {
    const group = {
      displayName: "Challenge group",
      id: "group_challenge",
      kind: "friends",
      memberCount: 2,
      members: [
        {
          disclosureGrants: [],
          grantedVaultShareProjectionKinds: [],
          grantedVaultShareProjectionScopes: [],
          handle: null,
          memberId: "global_member_id",
          role: "owner",
          trustedOnlyMemberField: "summary_member_internal",
        },
        {
          disclosureGrants: [],
          grantedVaultShareProjectionKinds: [],
          grantedVaultShareProjectionScopes: [],
          handle: "+15551110003",
          memberId: "legacy_global_member_id",
          role: "member",
        },
      ],
      requestedVaultShareProjectionKinds: [],
      requestedVaultShareProjectionScopes: [],
      status: "active",
      trustedOnlyGroupField: "summary_group_internal",
    };
    const groupRequest = vi.fn<GroupToolRequest>(async (request) => {
      if (request.action === "create_join_link") {
        return {
          action: request.action,
          result: { group, joinUrl: "https://example.test/join/code", status: "ok" },
        };
      }
      if (request.action === "update_display_name") {
        return {
          action: request.action,
          result: { group, status: "ok" },
        };
      }
      if (request.action === "post_join_offer") {
        return {
          action: request.action,
          result: { group, joinUrl: "https://example.test/join/code", status: "sent" },
        };
      }
      throw new Error(`Unexpected group action ${request.action}.`);
    });
    const modelRequests = [
      { action: "create_join_link" },
      { action: "update_display_name", displayName: "Challenge group" },
      {
        action: "post_join_offer",
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      },
    ];

    for (const modelRequest of modelRequests) {
      const request = readMurphDynamicToolRequest(groupToolCall(modelRequest));
      if (!request || request.kind !== "group") {
        throw new Error("Expected group mutation request.");
      }
      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext: createGroupHostedToolContext({ groupRequest }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot: null,
      });
      const resultText = result.rpcResult.contentItems[0];
      if (!resultText || resultText.type !== "inputText") {
        throw new Error("Expected group mutation text payload.");
      }
      expect(resultText.text).not.toContain("global_member_id");
      expect(resultText.text).not.toContain("legacy_global_member_id");
      expect(resultText.text).not.toContain("memberId");
      expect(resultText.text).not.toContain("+15551110003");
      expect(resultText.text).not.toContain("handle");
      expect(resultText.text).not.toContain("summary_group_internal");
      expect(resultText.text).not.toContain("summary_member_internal");
      expect(resultText.text).toContain("group_challenge");
    }
  });

  it("fails the whole shared read closed when its bounded result is too large", async () => {
    const groupSharedReadRequest = vi.fn<GroupSharedReadRequest>(async () => ({
      members: [{
        currentTurnHandles: [],
        displayName: `Member ${"x".repeat(49_000)}`,
        memberId: "member_oversized",
        participantId: "participant_oversized",
        projections: [{
          dataStatus: "missing",
          grantStatus: "granted",
          projectionScope: { projectionKind: "steps-days.v0" },
          projectionScopeKey: "steps-days.v0",
          records: [],
        }],
      }],
      requestedProjectionScopeKeys: ["steps-days.v0"],
      status: "ok",
    }));
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        groupSharedReadRequest,
        groupToolAvailable: false,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(readGroupToolPayload(result)).toEqual({
      action: "read_shared",
      result: {
        status: "unavailable",
        unavailableReason: "group_shared_result_too_large",
      },
    });
  });

  it("parses one bounded group ask without accepting model-supplied authority", () => {
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "ask",
      groupLabel: "  Morning Movers  ",
      question: "  What exercises are assigned today?  ",
    }))).toEqual({
      kind: "group",
      request: {
        action: "ask",
        groupLabel: "Morning Movers",
        question: "What exercises are assigned today?",
      },
    });

    const hiddenAuthorityFields = [
      "memberId",
      "membershipId",
      "groupId",
      "runtimeMemberId",
      "originAssistantInputId",
      "acceptedInputIds",
      "requestId",
      "mailboxItemId",
      "inboundMailboxItemIds",
      "sessionId",
      "conversationId",
      "recipientKey",
      "callback",
      "callbackUrl",
      "route",
      "routeId",
      "authority",
    ] as const;
    for (const field of hiddenAuthorityFields) {
      expect(readMurphDynamicToolRequest(groupToolCall({
        action: "ask",
        [field]: "model-supplied",
        question: "What exercises are assigned today?",
      }))?.kind).toBe("invalid-group-arguments");
    }
  });

  it("enforces group ask bounds in Unicode code points", () => {
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "ask",
      groupLabel: "🏃".repeat(
        HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
      ),
      question: "🏋️".repeat(
        HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS / 2,
      ),
    }))?.kind).toBe("group");

    for (const invalid of [
      { action: "ask", question: " " },
      {
        action: "ask",
        question: "x".repeat(
          HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS + 1,
        ),
      },
      {
        action: "ask",
        groupLabel: "x".repeat(
          HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS + 1,
        ),
        question: "What exercises are assigned today?",
      },
    ]) {
      expect(readMurphDynamicToolRequest(groupToolCall(invalid))?.kind)
        .toBe("invalid-group-arguments");
    }
  });

  it("injects the latest fresh direct input as hidden group ask authority", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "ask",
      groupLabel: "Morning Movers",
      question: "What exercises are assigned today?",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }

    const groupRequest = vi.fn<GroupToolRequest>(async () => ({
      action: "ask",
      result: { status: "accepted", targetLabel: "Morning Movers" },
    }));
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentUserActionScope: () => ({
          acceptedInputIds: [
            EARLIER_ASSISTANT_INPUT_ID,
            FRESH_ASSISTANT_INPUT_ID,
          ],
          conversationId: "conversation_private",
          conversationScope: "direct",
          inboundMailboxItemIds: ["mailbox_private"],
          originSessionId: "session_private",
          recipientKey: "recipient_private",
        }),
        groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult.success).toBe(true);
    expect(readGroupToolPayload(result)).toEqual({
      action: "ask",
      result: { status: "accepted", targetLabel: "Morning Movers" },
    });
    expect(groupRequest).toHaveBeenCalledWith({
      action: "ask",
      groupLabel: "Morning Movers",
      originAssistantInputId: FRESH_ASSISTANT_INPUT_ID,
      originSessionId: "session_private",
      question: "What exercises are assigned today?",
    });
  });

  it("returns only safe group ask failure diagnostics", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "ask",
      groupLabel: "Morning Movers",
      question: "What exercises are assigned today?",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const requestId = `aask_req_${"b".repeat(64)}`;
    const groupRequest = vi.fn<GroupToolRequest>(async () => {
      throw Object.assign(
        new Error("Private upstream detail must stay hidden."),
        {
          code: "P2010",
          requestId,
          statusCode: 500,
        },
      );
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentUserActionScope: () => ({
          acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
          conversationId: "conversation_private",
          conversationScope: "direct",
          inboundMailboxItemIds: ["mailbox_private"],
          originSessionId: "session_private",
          recipientKey: "recipient_private",
        }),
        groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(readGroupToolPayload(result)).toEqual({
      errorCode: "P2010",
      message: "group tool request failed",
      requestId,
      status: "request_failed",
      statusCode: 500,
    });
    expect(JSON.stringify(result)).not.toContain("Private upstream detail");
  });

  it("falls back to a generic group ask failure for malformed diagnostics", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "ask",
      groupLabel: "Morning Movers",
      question: "What exercises are assigned today?",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const groupRequest = vi.fn<GroupToolRequest>(async () => {
      throw Object.assign(
        new Error("Private upstream detail must stay hidden."),
        {
          code: "provider_error_with_private_detail",
          requestId: "aask_req_not-a-valid-correlation-id",
          statusCode: 700,
        },
      );
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentUserActionScope: () => ({
          acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
          conversationId: "conversation_private",
          conversationScope: "direct",
          inboundMailboxItemIds: ["mailbox_private"],
          originSessionId: "session_private",
          recipientKey: "recipient_private",
        }),
        groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems).toEqual([
      { type: "inputText", text: "group tool request failed" },
    ]);
    expect(JSON.stringify(result)).not.toContain("Private upstream detail");
    expect(JSON.stringify(result)).not.toContain("provider_error");
    expect(JSON.stringify(result)).not.toContain("not-a-valid-correlation-id");
  });

  it.each([
    ["INTERNAL_ERROR", 500, null],
    [
      "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
      401,
      `aask_req_${"c".repeat(64)}`,
    ],
  ])(
    "does not expose non-Prisma group ask code %s",
    async (code, statusCode, requestId) => {
      const request = readMurphDynamicToolRequest(groupToolCall({
        action: "ask",
        groupLabel: "Morning Movers",
        question: "What exercises are assigned today?",
      }));
      if (!request || request.kind !== "group") {
        throw new Error("Expected group request.");
      }
      const groupRequest = vi.fn<GroupToolRequest>(async () => {
        throw Object.assign(new Error("Private upstream detail must stay hidden."), {
          code,
          requestId,
          statusCode,
        });
      });

      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext: createGroupHostedToolContext({
          currentUserActionScope: () => ({
            acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
            conversationId: "conversation_private",
            conversationScope: "direct",
            inboundMailboxItemIds: ["mailbox_private"],
            originSessionId: "session_private",
            recipientKey: "recipient_private",
          }),
          groupRequest,
        }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot: null,
      });

      expect(result.rpcResult.success).toBe(false);
      expect(readGroupToolPayload(result)).toEqual({
        errorCode: null,
        message: "group tool request failed",
        requestId,
        status: "request_failed",
        statusCode,
      });
      expect(JSON.stringify(result)).not.toContain(code);
      expect(JSON.stringify(result)).not.toContain("Private upstream detail");
    },
  );

  it.each([
    ["missing", () => null],
    [
      "group",
      () => ({
        acceptedInputIds: ["assistant_input_group"],
        conversationId: "conversation_group",
        conversationScope: "group" as const,
        inboundMailboxItemIds: ["mailbox_group"],
        originSessionId: "session_group",
        recipientKey: "recipient_group",
      }),
    ],
  ])("does not admit a group ask with %s direct-user authority", async (
    _case,
    currentUserActionScope,
  ) => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "ask",
      question: "What exercises are assigned today?",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const groupRequest = vi.fn<GroupToolRequest>();

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentUserActionScope,
        groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(groupRequest).not.toHaveBeenCalled();
  });

  it("parses bounded disclosure actions without model-supplied authority", () => {
    const valid = [
      [{ action: "ask_member", grantId: " grant ", question: " Question? " },
        { action: "ask_member", grantId: "grant", question: "Question?" }],
      [{ action: "post_disclosure_request", permissionText: " Permission " },
        { action: "post_disclosure_request", permissionText: "Permission" }],
      [{ action: "revoke_disclosure_grant", grantId: " grant " },
        { action: "revoke_disclosure_grant", grantId: "grant" }],
    ] as const;
    for (const [input, expected] of valid) {
      expect(readMurphDynamicToolRequest(groupToolCall(input))).toMatchObject({
        kind: "group",
        request: expected,
      });
    }

    for (const invalid of [
      { action: "ask_member", grantId: "grant", memberId: "model", question: "Question?" },
      {
        action: "ask_member",
        grantId: "g".repeat(HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_MAX_CODE_POINTS + 1),
        question: "Question?",
      },
      { action: "post_disclosure_request", linqThread: "model", permissionText: "Permission" },
      {
        action: "post_disclosure_request",
        originAssistantInputId: "model",
        permissionText: "Permission",
      },
      { action: "post_disclosure_request", permissionText: "x".repeat(
        HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS + 1,
      ) },
      {
        action: "revoke_disclosure_grant",
        grantId: "g".repeat(HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_MAX_CODE_POINTS + 1),
      },
    ]) {
      expect(readMurphDynamicToolRequest(groupToolCall(invalid))?.kind)
        .toBe("invalid-group-arguments");
    }
  });

  it("injects fresh group authority and rejects direct member asks", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "ask_member",
      grantId: "hdg_member_sleep",
      question: "How much sleep did they get last night?",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }

    const groupRequest = vi.fn<GroupToolRequest>(async () => ({
      action: "ask_member",
      result: { status: "accepted" },
    }));
    const run = async (conversationScope: "direct" | "group") =>
      await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext: createGroupHostedToolContext({
          currentUserActionScope: () => ({
            acceptedInputIds: [EARLIER_ASSISTANT_INPUT_ID, FRESH_ASSISTANT_INPUT_ID],
            conversationId: `conversation_${conversationScope}`,
            conversationScope,
            inboundMailboxItemIds: ["mailbox_group"],
            originSessionId: "session_group",
            recipientKey: "recipient_group",
          }),
          groupRequest,
        }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot: null,
      });

    expect((await run("group")).rpcResult.success).toBe(true);
    expect(groupRequest).toHaveBeenCalledWith({
      action: "ask_member",
      grantId: "hdg_member_sleep",
      origin: {
        assistantInputId: FRESH_ASSISTANT_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
      question: "How much sleep did they get last night?",
    });
    groupRequest.mockClear();
    expect((await run("direct")).rpcResult.success).toBe(false);
    expect(groupRequest).not.toHaveBeenCalled();
  });

  it("injects scheduled occurrence authority for an internal member ask", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "ask_member",
      grantId: "hdg_member_availability",
      question: "Which coarse call windows work over the next week?",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const groupRequest = vi.fn<GroupToolRequest>(async () => ({
      action: "ask_member",
      result: { status: "accepted" },
    }));
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentInvocationScope: () => ({
          conversationScope: null,
          origin: {
            automationId: "automation_call_circle",
            kind: "automation_occurrence",
            occurrenceAt: "2026-07-20T13:00:00.000Z",
          },
        }),
        groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult.success).toBe(true);
    expect(groupRequest).toHaveBeenCalledWith({
      action: "ask_member",
      grantId: "hdg_member_availability",
      origin: {
        automationId: "automation_call_circle",
        kind: "automation_occurrence",
        occurrenceAt: "2026-07-20T13:00:00.000Z",
      },
      question: "Which coarse call windows work over the next week?",
    });
  });

  it("keeps scheduled permission offers on the existing bounded port", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const groupRequest = vi.fn<GroupToolRequest>();
    const groupPermissionOfferRequest = vi.fn<GroupPermissionOfferRequest>(
      async () => ({
        action: "post_join_offer",
        result: {
          group: null,
          status: "unavailable",
          unavailableReason: "permission_offer_unavailable",
        },
      }),
    );
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentInvocationScope: () => ({
          conversationScope: null,
          origin: {
            automationId: "automation_call_circle",
            kind: "automation_occurrence",
            occurrenceAt: "2026-07-20T13:00:00.000Z",
          },
        }),
        groupPermissionOfferRequest,
        groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult.success).toBe(true);
    expect(groupPermissionOfferRequest).toHaveBeenCalledWith({
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    });
    expect(groupRequest).not.toHaveBeenCalled();
  });

  it("rejects unrelated regular group mutations from scheduled invocations", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "update_display_name",
      displayName: "Not allowed from cron",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const groupRequest = vi.fn<GroupToolRequest>();
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentInvocationScope: () => ({
          conversationScope: null,
          origin: {
            automationId: "automation_call_circle",
            kind: "automation_occurrence",
            occurrenceAt: "2026-07-20T13:00:00.000Z",
          },
        }),
        groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(groupRequest).not.toHaveBeenCalled();
  });

  it("keeps posting group-only and revocation direct-only", async () => {
    const groupScope = () => ({
      acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
      conversationId: "conversation_group",
      conversationScope: "group" as const,
      inboundMailboxItemIds: ["mailbox_group"],
      originSessionId: "session_group",
      recipientKey: "recipient_group",
    });
    const directScope = () => ({
      acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
      conversationId: "conversation_private",
      conversationScope: "direct" as const,
      inboundMailboxItemIds: ["mailbox_private"],
      originSessionId: "session_private",
      recipientKey: "recipient_private",
    });
    const postRequest = readMurphDynamicToolRequest(groupToolCall({
      action: "post_disclosure_request",
      permissionText: "Sleep duration from the previous night.",
    }));
    const revokeRequest = readMurphDynamicToolRequest(groupToolCall({
      action: "revoke_disclosure_grant",
      grantId: "hdg_member_sleep",
    }));
    if (
      !postRequest || postRequest.kind !== "group"
      || !revokeRequest || revokeRequest.kind !== "group"
    ) {
      throw new Error("Expected disclosure group requests.");
    }

    const groupRequest = vi.fn<GroupToolRequest>(async (request) => {
      if (request.action === "post_disclosure_request") {
        return { action: "post_disclosure_request", result: { status: "sent" } };
      }
      return { action: "revoke_disclosure_grant", result: { status: "revoked" } };
    });
    const run = async (
      request: typeof postRequest | typeof revokeRequest,
      currentUserActionScope: typeof groupScope | typeof directScope,
      requestHandler: GroupToolRequest,
    ) => await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentUserActionScope,
        groupRequest: requestHandler,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });
    for (const [request, currentUserActionScope] of [
      [postRequest, groupScope],
      [revokeRequest, directScope],
    ] as const) {
      const result = await run(request, currentUserActionScope, groupRequest);
      expect(result.rpcResult.success).toBe(true);
    }
    expect(groupRequest).toHaveBeenCalledWith({
      action: 'post_disclosure_request',
      originAssistantInputId: FRESH_ASSISTANT_INPUT_ID,
      permissionText: 'Sleep duration from the previous night.',
    })

    const rejectedGroupRequest = vi.fn<GroupToolRequest>();
    for (const [request, currentUserActionScope] of [
      [postRequest, directScope],
      [revokeRequest, groupScope],
    ] as const) {
      const result = await run(request, currentUserActionScope, rejectedGroupRequest);
      expect(result.rpcResult.success).toBe(false);
    }
    expect(rejectedGroupRequest).not.toHaveBeenCalled();
  });

  it("parses and executes an opaque private-membership leave", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "leave_membership",
      membershipId: "hgm_self_123",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    expect(request.request).toEqual({
      action: "leave_membership",
      membershipId: "hgm_self_123",
    });

    const groupRequest = vi.fn<GroupToolRequest>(async () => ({
      action: "leave_membership",
      result: { status: "left" },
    }));
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({ groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult.success).toBe(true);
    expect(readGroupToolPayload(result)).toEqual({
      action: "leave_membership",
      result: { status: "left" },
    });
    expect(groupRequest).toHaveBeenCalledWith({
      action: "leave_membership",
      membershipId: "hgm_self_123",
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "leave_membership",
    }))?.kind).toBe("invalid-group-arguments");
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "leave_membership",
      groupId: "hgrp_hijack",
      membershipId: "hgm_self_123",
    }))?.kind).toBe("invalid-group-arguments");
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "leave_membership",
      membershipId: "hgm_self_123",
      permissionsUrl: "https://example.test/groups/join/reusable",
    }))?.kind).toBe("invalid-group-arguments");
  });

  it("parses and executes personal membership reads", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "list_memberships",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    expect(request.request).toEqual({ action: "list_memberships" });

    const response = {
      action: "list_memberships" as const,
      result: {
        disclosureGrants: [],
        memberships: [{
          displayName: "Fun-loving runners",
          grantedVaultShareProjectionScopes: [{ projectionKind: "profile-name.v0" as const }],
          kind: "friends",
          memberCount: 7,
          membershipId: "hgm_self_123",
          permissionsUrl: "https://www.withmurph.ai/groups/join/abc123",
          requestedVaultShareProjectionScopes: [{ projectionKind: "hrv-days.v0" as const }],
          role: "member",
        }],
        status: "ok" as const,
        truncated: false,
      },
    };
    const groupRequest = vi.fn<GroupToolRequest>(async () => response);
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({ groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult.success).toBe(true);
    expect(readGroupToolPayload(result)).toEqual(response);
    expect(groupRequest).toHaveBeenCalledWith({ action: "list_memberships" });
  });

  it("parses update_display_name arguments into a bounded rename request", () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "update_display_name",
      displayName: "Weekly Health Crew",
    }));

    expect(request).toEqual({
      kind: "group",
      request: {
        action: "update_display_name",
        updateDisplayName: {
          displayName: "Weekly Health Crew",
        },
      },
    });
  });

  it("rejects invalid update_display_name arguments", () => {
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "update_display_name",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "update_display_name",
      displayName: " ",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "update_display_name",
      displayName: "x".repeat(121),
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "update_display_name",
      displayName: "Valid name",
      groupId: "hgrp_hijack",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "update_display_name",
      displayName: "Valid name",
      linqThread: { chatId: "chat_hijack" },
    }))?.kind).toBe("invalid-group-arguments");
  });

  it("parses create_join_link arguments into a bounded joinLink request", () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "create_join_link",
      displayName: "Sunday sleep crew",
      kind: "friends",
      requestedVaultShareProjectionScopes: [
        { projectionKind: "sleep-times.v0" },
        {
          projectionKind: "activity-minutes-days.v1",
          selector: { activityKind: "running" },
        },
        {
          projectionKind: "activity-distance-days.v1",
          selector: { activityKind: "running" },
        },
        {
          projectionKind: "activity-session-count-days.v1",
          selector: { activityKind: "running" },
        },
      ],
    }));

    expect(request).toEqual({
      kind: "group",
      request: {
        action: "create_join_link",
        joinLink: {
          displayName: "Sunday sleep crew",
          kind: "friends",
          requestedVaultShareProjectionScopes: [
            { projectionKind: "sleep-times.v0" },
            {
              projectionKind: "activity-minutes-days.v1",
              selector: { activityKind: "running" },
            },
            {
              projectionKind: "activity-distance-days.v1",
              selector: { activityKind: "running" },
            },
            {
              projectionKind: "activity-session-count-days.v1",
              selector: { activityKind: "running" },
            },
          ],
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

  it("keeps displayName optional on post_join_offer", () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }));

    expect(request).toEqual({
      kind: "group",
      request: {
        action: "post_join_offer",
        joinOffer: {
          messageTemplate: HOSTED_RUNTIME_GROUP_JOIN_OFFER_LEGACY_MESSAGE_TEMPLATE,
          projectionScopes: [{ projectionKind: "sleep-times.v0" }],
        },
      },
    });
  });

  it("rejects unsupported group kinds and projection kinds", () => {
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "create_join_link",
      kind: "everyone",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "create_join_link",
      requestedVaultShareProjectionScopes: [{ projectionKind: "all-health-data" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "create_join_link",
      requestedVaultShareProjectionScopes: [{ projectionKind: "activity-minutes-days.v1" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "create_join_link",
      requestedVaultShareProjectionScopes: [{ projectionKind: "activity-distance-days.v1" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "create_join_link",
      requestedVaultShareProjectionScopes: [{
        projectionKind: "activity-session-count-days.v1",
        selector: { activityKind: "running+walking" },
      }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "create_join_link",
      requestedVaultShareProjectionScopes: [{
        projectionKind: "activity-distance-days.v1",
        selector: { activityKind: "sleep" },
      }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "create_join_link",
      requestedVaultShareProjectionScopes: [{
        projectionKind: "activity-session-count-days.v1",
        selector: { activityKind: "sleep" },
      }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      intro: "Like this to join.",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      displayName: "   ",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      displayName: "a".repeat(121),
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      projectionScopes: [{ projectionKind: "all-health-data" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      messageTemplate: "Model-authored offer copy.",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }))?.kind).toBe("invalid-group-arguments");
  });

  it("forwards only the runtime-owned legacy offer template", async () => {
    const modelAuthoredCopy = "Model-authored consent copy must never be forwarded.";
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      messageTemplate: modelAuthoredCopy,
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    }))?.kind).toBe("invalid-group-arguments");

    const groupRequest = vi.fn<GroupToolRequest>(async () => ({
      action: "post_join_offer",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "test_unavailable",
      },
    }));
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }

    await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedGeneratedImageUploader: null,
      hostedToolContext: createGroupHostedToolContext({
        groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(groupRequest).toHaveBeenCalledWith({
      action: "post_join_offer",
      joinOffer: {
        messageTemplate: HOSTED_RUNTIME_GROUP_JOIN_OFFER_LEGACY_MESSAGE_TEMPLATE,
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      },
    });
    expect(JSON.stringify(groupRequest.mock.calls)).not.toContain(modelAuthoredCopy);
  });

  it("routes the narrow scheduled offer without exposing group metadata", async () => {
    const groupPermissionOfferRequest = vi.fn<GroupPermissionOfferRequest>(
      async () => ({
        action: "post_join_offer",
        result: {
          group: {
            displayName: "Private label",
            id: "private-group-id",
            kind: "challenge",
            memberCount: 0,
            members: [],
            requestedVaultShareProjectionKinds: ["steps-days.v0"],
            requestedVaultShareProjectionScopes: [
              { projectionKind: "steps-days.v0" },
            ],
            status: "active",
          },
          joinUrl: "https://example.test/private-offer",
          status: "sent",
        },
      }),
    );
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected a scheduled permission-offer request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        groupPermissionOfferRequest,
        groupToolAvailable: false,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(groupPermissionOfferRequest).toHaveBeenCalledWith({
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
    expect(readGroupToolPayload(result)).toEqual({
      action: "post_join_offer",
      result: { status: "sent" },
    });
    expect(JSON.stringify(readGroupToolPayload(result))).not.toContain("private");
  });

  it("keeps non-offer group mutations unavailable without the full group port", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_current",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        groupToolAvailable: false,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult).toEqual({
      success: false,
      contentItems: [{
        type: "inputText",
        text: "group tools are unavailable for this turn",
      }],
    });
  });

  it("uploads a user-sent image ref before setting the group avatar", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-group-avatar-"));
    try {
      await mkdir(join(vaultRoot, "raw", "inbox"), { recursive: true });
      await writeFile(
        join(vaultRoot, "raw", "inbox", "avatar.png"),
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
          "base64",
        ),
      );

      const groupRequest = vi.fn<GroupToolRequest>(async (request) =>
        request.action === "preflight_set_chat_avatar"
          ? {
              action: "preflight_set_chat_avatar",
              result: { status: "ok" },
            }
          : {
              action: "set_chat_avatar",
              result: { status: "requested" },
            });
      const uploadGeneratedImage = vi.fn(async (
        input: AssistantHostedGeneratedImageUploadInput,
      ) => ({
        alt: input.alt,
        kind: "image" as const,
        source: input.source,
        url: "https://imagedelivery.net/account/avatar/public",
      }));
      const request = readMurphDynamicToolRequest(groupToolCall({
        action: "set_chat_avatar",
        alt: "Our group avatar",
        avatarSource: "image_ref",
        imageRef: "raw/inbox/avatar.png",
      }));
      if (!request || request.kind !== "group") {
        throw new Error("Expected group request.");
      }

      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedGeneratedImageUploader: { uploadGeneratedImage },
        hostedToolContext: createGroupHostedToolContext({ groupRequest }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(result.rpcResult.success).toBe(true);
      expect(readGroupToolPayload(result)).toEqual({
        action: "set_chat_avatar",
        result: { status: "requested" },
      });
      expect(result.responseMediaPatch).toBeUndefined();
      expect(groupRequest).toHaveBeenNthCalledWith(1, {
        action: "preflight_set_chat_avatar",
      });
      expect(groupRequest).toHaveBeenNthCalledWith(2, {
        action: "set_chat_avatar",
        groupChatIconUrl: "https://imagedelivery.net/account/avatar/public",
      });
      expect(uploadGeneratedImage).toHaveBeenCalledWith(
        expect.objectContaining({
          alt: "Our group avatar",
          contentType: "image/png",
          filename: "group-avatar.png",
          metadata: expect.objectContaining({
            imageSha256: expect.any(String),
            schema: "murph.group-avatar.v1",
            sourceRefSha256: expect.any(String),
          }),
          source: "murph.group-avatar",
        }),
      );
      expect(uploadGeneratedImage.mock.calls[0]?.[0].metadata).not.toHaveProperty("sourceRef");
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("saves generated group avatars to the vault before setting the group avatar", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-group-avatar-generated-"));
    try {
      await initializeVault({ vaultRoot });

      const groupRequest = vi.fn<GroupToolRequest>(async (request) =>
        request.action === "preflight_set_chat_avatar"
          ? {
              action: "preflight_set_chat_avatar",
              result: { status: "ok" },
            }
          : {
              action: "set_chat_avatar",
              result: { status: "requested" },
            });
      const uploadGeneratedImage = vi.fn(async (
        input: AssistantHostedGeneratedImageUploadInput,
      ) => ({
        alt: input.alt,
        kind: "image" as const,
        source: input.source,
        url: "https://imagedelivery.net/account/generated-avatar/public",
      }));
      const fetchImpl = vi.fn(async () =>
        jsonResponse({
          data: [{ b64_json: Buffer.from(webpBytes).toString("base64") }],
          usage: {
            input_tokens: 4,
            output_tokens: 6,
            total_tokens: 10,
          },
        }, {
          headers: {
            "x-request-id": "req_group_avatar_image",
          },
        }));
      const request = readMurphDynamicToolRequest(groupToolCall({
        action: "set_chat_avatar",
        alt: "Our generated avatar",
        avatarSource: "generate",
        prompt: "A clean square badge for our group",
      }));
      if (!request || request.kind !== "group") {
        throw new Error("Expected group request.");
      }

      const nextUsageOrdinal = vi.fn(() => 7);
      const result = await executeMurphDynamicToolRequest({
        env: {
          OPENAI_API_KEY: "openai-test-key",
        },
        fetchImpl,
        hostedGeneratedImageUploader: { uploadGeneratedImage },
        hostedToolContext: createGroupHostedToolContext({ groupRequest }),
        nextUsageOrdinal,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(nextUsageOrdinal).toHaveBeenCalledOnce();
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(result.rpcResult.success).toBe(true);
      const payload = readGroupToolPayload(result);
      expect(payload).toMatchObject({
        action: "set_chat_avatar",
        generatedImage: {
          savedCaptureId: expect.stringMatching(/^evt_[A-Za-z0-9_-]+$/u),
          savedImageRef: expect.stringMatching(/^raw\/captures\/.+\.webp$/u),
        },
        result: { status: "requested" },
      });
      const savedImageRef = generatedImageRefFromPayload(payload);
      await expect(readFile(join(vaultRoot, savedImageRef)))
        .resolves.toEqual(Buffer.from(webpBytes));
      expect(groupRequest).toHaveBeenNthCalledWith(1, {
        action: "preflight_set_chat_avatar",
      });
      expect(groupRequest).toHaveBeenNthCalledWith(2, {
        action: "set_chat_avatar",
        groupChatIconUrl: "https://imagedelivery.net/account/generated-avatar/public",
      });
      expect(uploadGeneratedImage).toHaveBeenCalledWith(
        expect.objectContaining({
          alt: "Our generated avatar",
          contentType: "image/webp",
          metadata: expect.objectContaining({
            model: "gpt-image-2",
            promptHash: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/u),
            schema: "murph.generated-image.v1",
          }),
          source: "gpt-image-2",
        }),
      );
      expect(result.usageDraft).toMatchObject({
        provider: "openai-images",
        providerRequestOrdinal: 7,
        providerRequestOutcome: "succeeded",
        usage: {
          inputTokens: 4,
          outputTokens: 6,
          providerRequestId: "req_group_avatar_image",
          totalTokens: 10,
        },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("reuses a saved generated group avatar across RPC request id retries", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-group-avatar-retry-"));
    try {
      await initializeVault({ vaultRoot });

      const groupRequest = vi.fn<GroupToolRequest>(async (request) =>
        request.action === "preflight_set_chat_avatar"
          ? {
              action: "preflight_set_chat_avatar",
              result: { status: "ok" },
            }
          : {
              action: "set_chat_avatar",
              result: { status: "requested" },
            });
      const uploadGeneratedImage = vi.fn()
        .mockRejectedValueOnce(new Error("upload failed"))
        .mockImplementationOnce(async (
          input: AssistantHostedGeneratedImageUploadInput,
        ) => ({
          alt: input.alt,
          kind: "image" as const,
          source: input.source,
          url: "https://imagedelivery.net/account/generated-avatar-retry/public",
        }));
      const fetchImpl = vi.fn(async () =>
        jsonResponse({
          data: [{ b64_json: Buffer.from(webpBytes).toString("base64") }],
          usage: {
            input_tokens: 4,
            output_tokens: 6,
            total_tokens: 10,
          },
        }));
      const args = {
        action: "set_chat_avatar",
        alt: "Our retried generated avatar",
        avatarSource: "generate",
        prompt: "A clean square retry badge for our group",
      };
      const firstRequest = readMurphDynamicToolRequest(groupToolCall(args, {
        callId: "call_stable_group_avatar",
        id: 200,
      }));
      const secondRequest = readMurphDynamicToolRequest(groupToolCall(args, {
        callId: "call_stable_group_avatar",
        id: 201,
      }));
      if (
        !firstRequest ||
        !secondRequest ||
        firstRequest.kind !== "group" ||
        secondRequest.kind !== "group"
      ) {
        throw new Error("Expected group requests.");
      }
      expect(firstRequest).toMatchObject({
        kind: "group",
        toolCallId: "call_stable_group_avatar",
      });

      let usageOrdinal = 7;
      const first = await executeMurphDynamicToolRequest({
        env: {
          OPENAI_API_KEY: "openai-test-key",
        },
        fetchImpl,
        hostedGeneratedImageUploader: { uploadGeneratedImage },
        hostedToolContext: createGroupHostedToolContext({ groupRequest }),
        nextUsageOrdinal: () => usageOrdinal++,
        progressDelivery: null,
        request: firstRequest,
        vaultRoot,
      });

      expect(first.rpcResult).toEqual({
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: "image generated but upload failed",
          },
        ],
      });
      expect(fetchImpl).toHaveBeenCalledOnce();

      const second = await executeMurphDynamicToolRequest({
        env: {
          OPENAI_API_KEY: "openai-test-key",
        },
        fetchImpl,
        hostedGeneratedImageUploader: { uploadGeneratedImage },
        hostedToolContext: createGroupHostedToolContext({ groupRequest }),
        nextUsageOrdinal: () => usageOrdinal++,
        progressDelivery: null,
        request: secondRequest,
        vaultRoot,
      });

      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(uploadGeneratedImage).toHaveBeenCalledTimes(2);
      expect(second.rpcResult.success).toBe(true);
      expect(readGroupToolPayload(second)).toMatchObject({
        action: "set_chat_avatar",
        generatedImage: {
          savedCaptureId: expect.stringMatching(/^evt_[A-Za-z0-9_-]+$/u),
          savedImageRef: expect.stringMatching(/^raw\/captures\/.+\.webp$/u),
        },
        result: { status: "requested" },
      });
      expect(groupRequest).toHaveBeenNthCalledWith(1, {
        action: "preflight_set_chat_avatar",
      });
      expect(groupRequest).toHaveBeenNthCalledWith(2, {
        action: "preflight_set_chat_avatar",
      });
      expect(groupRequest).toHaveBeenNthCalledWith(3, {
        action: "set_chat_avatar",
        groupChatIconUrl: "https://imagedelivery.net/account/generated-avatar-retry/public",
      });
      expect(second).not.toHaveProperty("usageDraft");
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not upload a user-sent avatar image when group avatar preflight fails", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-group-avatar-"));
    try {
      await mkdir(join(vaultRoot, "raw", "inbox"), { recursive: true });
      await writeFile(
        join(vaultRoot, "raw", "inbox", "avatar.png"),
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
          "base64",
        ),
      );

      const groupRequest = vi.fn<GroupToolRequest>(async () => ({
        action: "preflight_set_chat_avatar",
        result: {
          status: "unavailable",
          unavailableReason: "linq_thread_unavailable",
        },
      }));
      const uploadGeneratedImage = vi.fn(async (
        input: AssistantHostedGeneratedImageUploadInput,
      ) => ({
        alt: input.alt,
        kind: "image" as const,
        source: input.source,
        url: "https://imagedelivery.net/account/avatar/public",
      }));
      const request = readMurphDynamicToolRequest(groupToolCall({
        action: "set_chat_avatar",
        avatarSource: "image_ref",
        imageRef: "raw/inbox/avatar.png",
      }));
      if (!request || request.kind !== "group") {
        throw new Error("Expected group request.");
      }

      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedGeneratedImageUploader: { uploadGeneratedImage },
        hostedToolContext: createGroupHostedToolContext({ groupRequest }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(result.rpcResult.success).toBe(true);
      expect(readGroupToolPayload(result)).toEqual({
        action: "set_chat_avatar",
        result: {
          status: "unavailable",
          unavailableReason: "linq_thread_unavailable",
        },
      });
      expect(groupRequest).toHaveBeenCalledOnce();
      expect(groupRequest).toHaveBeenCalledWith({ action: "preflight_set_chat_avatar" });
      expect(uploadGeneratedImage).not.toHaveBeenCalled();
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("reports structured avatar unavailability when preflight is rejected by the host", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-group-avatar-"));
    try {
      await mkdir(join(vaultRoot, "raw", "inbox"), { recursive: true });
      await writeFile(
        join(vaultRoot, "raw", "inbox", "avatar.png"),
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
          "base64",
        ),
      );

      const groupRequest = vi.fn<GroupToolRequest>(async () => {
        throw new Error("unsupported group tool action");
      });
      const uploadGeneratedImage = vi.fn(async (
        input: AssistantHostedGeneratedImageUploadInput,
      ) => ({
        alt: input.alt,
        kind: "image" as const,
        source: input.source,
        url: "https://imagedelivery.net/account/avatar/public",
      }));
      const request = readMurphDynamicToolRequest(groupToolCall({
        action: "set_chat_avatar",
        avatarSource: "image_ref",
        imageRef: "raw/inbox/avatar.png",
      }));
      if (!request || request.kind !== "group") {
        throw new Error("Expected group request.");
      }

      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedGeneratedImageUploader: { uploadGeneratedImage },
        hostedToolContext: createGroupHostedToolContext({ groupRequest }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(result.rpcResult.success).toBe(true);
      expect(readGroupToolPayload(result)).toEqual({
        action: "set_chat_avatar",
        result: {
          status: "unavailable",
          unavailableReason: "group_avatar_preflight_unavailable",
        },
      });
      expect(groupRequest).toHaveBeenCalledOnce();
      expect(groupRequest).toHaveBeenCalledWith({ action: "preflight_set_chat_avatar" });
      expect(uploadGeneratedImage).not.toHaveBeenCalled();
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });
});

describe("murph.newsletter dynamic tool", () => {
  it("advertises the supported actions", () => {
    expect(MURPH_NEWSLETTER_TOOL.inputSchema.properties.action.enum).toEqual([
      "prepare",
      "send",
    ]);
    expect(MURPH_NEWSLETTER_TOOL.inputSchema.properties).not.toHaveProperty("groupId");
    expect(MURPH_NEWSLETTER_TOOL.inputSchema.required).toEqual(["action"]);
  });

  it("keeps the automation name in scheduled email subjects", () => {
    expect(MURPH_NEWSLETTER_TOOL.description).toContain(
      "current scheduled automation instructions",
    );
    expect(MURPH_NEWSLETTER_TOOL.description).toContain(
      "Start the subject",
    );
    expect(MURPH_NEWSLETTER_TOOL.description).toContain(
      "never a generic label",
    );
    expect(MURPH_NEWSLETTER_TOOL.description).toContain(
      "current-week shared facts",
    );
    expect(MURPH_NEWSLETTER_TOOL.description).toContain(
      "exact live email and health-share grants",
    );
    expect(MURPH_NEWSLETTER_TOOL.description).toContain(
      "compose only from its members",
    );
  });

  it("derives the group from runtime authority and rejects model-supplied targets", () => {
    expect(readMurphDynamicToolRequest(newsletterToolCall({
      action: "prepare",
    }))).toEqual({
      kind: "newsletter",
      request: {
        action: "prepare",
      },
    });

    expect(readMurphDynamicToolRequest(newsletterToolCall({
      action: "send",
      html: "<p>Weekly</p>",
      subject: "Weekly note",
      text: "Weekly",
    }))).toEqual({
      kind: "newsletter",
      request: {
        action: "send",
        html: "<p>Weekly</p>",
        subject: "Weekly note",
        text: "Weekly",
      },
    });

    expect(readMurphDynamicToolRequest(newsletterToolCall({
      action: "send",
      html: "<p>Weekly</p>",
      subject: "Weekly note",
      to: ["one@example.test"],
    }))?.kind).toBe("invalid-newsletter-arguments");

    expect(readMurphDynamicToolRequest(newsletterToolCall({
      action: "prepare",
      groupId: "group_1",
    }))?.kind).toBe("invalid-newsletter-arguments");
  });

  it("prepares recipient eligibility and an empty member set without shared scopes", async () => {
    vi.useFakeTimers();
    try {
      const hostedToolContext = createNewsletterHostedToolContext();
      const request = readMurphDynamicToolRequest(newsletterToolCall({
        action: "prepare",
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
        vaultRoot: null,
      });
      vi.setSystemTime(new Date("2026-07-20T12:00:00.000Z"));
      const second = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot: null,
      });

      expect(readNewsletterToolPayload(first)).toEqual({
        action: "prepare",
        result: {
          missingEmailParticipants: [],
          members: [],
          participants: [
            {
              hasEmail: true,
              memberId: "member_a",
            },
          ],
          referenceAt: "2026-07-06T03:30:00.000Z",
          status: "ok",
        },
      });
      expect(readNewsletterToolPayload(second)).toEqual(readNewsletterToolPayload(first));
    } finally {
      vi.useRealTimers();
    }
  });

  it("records no recipients and closes send authority after an all-missing-email prepare", async () => {
    const closeNewsletterCapability = vi.fn();
    const recordNewsletterSendResult = vi.fn();
    const newsletterRequest = vi.fn<NewsletterToolRequest>(async (request) => ({
      action: "prepare",
      result: {
        authorizationProof: NEWSLETTER_AUTHORIZATION_PROOF,
        groupId: "group_1",
        missingEmailParticipants: [
          {
            authorizedShares: [],
            hasEmail: false,
            memberId: "member_a",
          },
        ],
        participants: [
          {
            authorizedShares: [],
            hasEmail: false,
            memberId: "member_a",
          },
        ],
        status: "ok",
      },
    }));
    const request = readMurphDynamicToolRequest(newsletterToolCall({
      action: "prepare",
    }));
    if (!request || request.kind !== "newsletter") {
      throw new Error("Expected newsletter request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createNewsletterHostedToolContext({
        closeNewsletterCapability,
        newsletterRequest,
        recordNewsletterSendResult,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(readNewsletterToolPayload(result)).toEqual({
      action: "prepare",
      result: {
        members: [],
        missingEmailParticipants: [
          { hasEmail: false, memberId: "member_a" },
        ],
        participants: [
          { hasEmail: false, memberId: "member_a" },
        ],
        referenceAt: "2026-07-06T03:30:00.000Z",
        status: "ok",
      },
    });
    expect(closeNewsletterCapability).toHaveBeenCalledTimes(1);
    expect(recordNewsletterSendResult).toHaveBeenCalledWith({
      action: "send",
      result: {
        participantCount: 0,
        skippedNoEmailMemberIds: ["member_a"],
        status: "no_recipients",
      },
    });
    expect(newsletterRequest).toHaveBeenCalledTimes(1);
  });

  it("returns an empty member set when no shared scopes are authorized", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-newsletter-stats-missing-"));
    try {
      const hostedToolContext = createNewsletterHostedToolContext();
      const request = readMurphDynamicToolRequest(newsletterToolCall({
        action: "prepare",
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
      expect(readNewsletterToolPayload(result)).toEqual({
        action: "prepare",
        result: {
          missingEmailParticipants: [],
          members: [],
          participants: [
            {
              hasEmail: true,
              memberId: "member_a",
            },
          ],
          referenceAt: "2026-07-06T03:30:00.000Z",
          status: "ok",
        },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("summarizes only live Web-owned records for email-authorized participants and scopes", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-newsletter-eligible-"));
    try {
      await initializeVault({ timezone: "UTC", vaultRoot });
      const sequence: string[] = [];
      const newsletterRequest = vi.fn<NewsletterToolRequest>(async () => {
        sequence.push("newsletter.authority");
        return {
          action: "prepare",
          result: {
            authorizationProof: NEWSLETTER_AUTHORIZATION_PROOF,
            groupId: "group_1",
            missingEmailParticipants: [{
              authorizedShares: [],
              hasEmail: false,
              memberId: "member_opted_out",
            }],
            participants: [
              {
                authorizedShares: [{
                  projectionScopeKey: "steps-days.v0",
                  shareId: "share-member-a",
                }],
                hasEmail: true,
                memberId: "member_a",
              },
              {
                authorizedShares: [],
                hasEmail: false,
                memberId: "member_opted_out",
              },
              {
                authorizedShares: [{
                  projectionScopeKey: "steps-days.v0",
                  shareId: "share-current-replacement",
                }],
                hasEmail: true,
                memberId: "member_stale_grant",
              },
            ],
            status: "ok",
          },
        };
      });
      const groupSharedReader: AssistantHostedGroupSharedReader = {
        request: vi.fn<AssistantHostedGroupSharedReader["request"]>(async ({
          projectionScopes,
        }) => {
          sequence.push("shared.read");
          expect(projectionScopes).toEqual([
            { projectionKind: "steps-days.v0" },
          ]);
          return {
            members: [
              {
                currentTurnHandles: [],
                displayName: "Ada",
                memberId: "member_a",
                participantId: "participant_a",
                projections: [{
                  dataStatus: "available",
                  grantStatus: "granted",
                  projectionScope: { projectionKind: "steps-days.v0" },
                  projectionScopeKey: "steps-days.v0",
                  records: [{
                    data: {
                      date: "2026-07-06",
                      metricKey: "steps",
                      unit: "count",
                      value: 7_000,
                    },
                    occurredAt: "2026-07-06T00:00:00.000Z",
                    recordKey: "2026-07-06",
                  }],
                }],
              },
              {
                currentTurnHandles: [],
                displayName: "Opted out",
                memberId: "member_opted_out",
                participantId: "participant_opted_out",
                projections: [{
                  dataStatus: "available",
                  grantStatus: "granted",
                  projectionScope: { projectionKind: "steps-days.v0" },
                  projectionScopeKey: "steps-days.v0",
                  records: [{
                    data: {
                      date: "2026-07-06",
                      metricKey: "steps",
                      unit: "count",
                      value: 20_000,
                    },
                    occurredAt: "2026-07-06T00:00:00.000Z",
                    recordKey: "2026-07-06",
                  }],
                }],
              },
              {
                currentTurnHandles: [],
                displayName: "No current data",
                memberId: "member_stale_grant",
                participantId: "participant_stale_grant",
                projections: [{
                  dataStatus: "missing",
                  grantStatus: "granted",
                  projectionScope: { projectionKind: "steps-days.v0" },
                  projectionScopeKey: "steps-days.v0",
                  records: [],
                }],
              },
            ],
            requestedProjectionScopeKeys: ["steps-days.v0"],
            status: "ok",
          };
        }),
      };
      const request = readMurphDynamicToolRequest(newsletterToolCall({
        action: "prepare",
      }));
      if (!request || request.kind !== "newsletter") {
        throw new Error("Expected newsletter request.");
      }

      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext: createNewsletterHostedToolContext({
          groupSharedReader,
          newsletterRequest,
        }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(sequence).toEqual(["newsletter.authority", "shared.read"]);
      expect(readNewsletterToolPayload(result)).toEqual({
        action: "prepare",
        result: {
          members: [{
            displayName: "Ada",
            memberId: "member_a",
            weeklyStats: [{
              currentWeekAvg: 7_000,
              stream: "steps",
              unit: "count",
            }],
          }],
          missingEmailParticipants: [
            { hasEmail: false, memberId: "member_opted_out" },
          ],
          participants: [
            { hasEmail: true, memberId: "member_a" },
            { hasEmail: false, memberId: "member_opted_out" },
            { hasEmail: true, memberId: "member_stale_grant" },
          ],
          referenceAt: "2026-07-06T03:30:00.000Z",
          status: "ok",
        },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it.each([
    {
      finalParticipants: [
        { authorizedShares: [], hasEmail: true, memberId: "member_a" },
      ],
      revokeKind: "health share",
    },
    {
      finalParticipants: [],
      revokeKind: "email grant",
    },
    {
      finalParticipants: [],
      revokeKind: "member access",
    },
    {
      finalParticipants: [
        {
          authorizedShares: [{
            projectionScopeKey: "steps-days.v0",
            shareId: "share-member-a",
          }],
          hasEmail: false,
          memberId: "member_a",
        },
      ],
      revokeKind: "verified email",
    },
  ])("does not read shared data after final $revokeKind authority removes eligibility", async ({
    finalParticipants,
  }) => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-newsletter-revoked-"));
    try {
      await initializeVault({ timezone: "UTC", vaultRoot });
      const groupSharedRequest = vi.fn<
        AssistantHostedGroupSharedReader["request"]
      >(async () => {
        throw new Error("Ineligible participants must not trigger a shared read.");
      });
      const newsletterRequest = vi.fn<NewsletterToolRequest>(async () => ({
        action: "prepare",
        result: {
          authorizationProof: NEWSLETTER_AUTHORIZATION_PROOF,
          groupId: "group_1",
          missingEmailParticipants: [],
          participants: finalParticipants,
          status: "ok",
        },
      }));
      const request = readMurphDynamicToolRequest(newsletterToolCall({
        action: "prepare",
      }));
      if (!request || request.kind !== "newsletter") {
        throw new Error("Expected newsletter request.");
      }

      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext: createNewsletterHostedToolContext({
          groupSharedReader: { request: groupSharedRequest },
          newsletterRequest,
        }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(readNewsletterToolPayload(result)).toMatchObject({
        action: "prepare",
        result: {
          members: [],
          participants: finalParticipants.map(({ hasEmail, memberId }) => ({
            hasEmail,
            memberId,
          })),
          status: "ok",
        },
      });
      expect(groupSharedRequest).not.toHaveBeenCalled();
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("fails prepare closed when the lazy shared read is unavailable without gating a later send", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-newsletter-read-unavailable-"));
    try {
      await initializeVault({ timezone: "UTC", vaultRoot });
      const newsletterRequest = vi.fn<NewsletterToolRequest>(async (request) =>
        request.action === "prepare"
          ? {
              action: "prepare" as const,
              result: {
                authorizationProof: NEWSLETTER_AUTHORIZATION_PROOF,
                groupId: "group_1",
                missingEmailParticipants: [],
                participants: [{
                  authorizedShares: [{
                    projectionScopeKey: "steps-days.v0",
                    shareId: "share-member-a",
                  }],
                  hasEmail: true,
                  memberId: "member_a",
                }],
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
      const groupSharedRequest = vi.fn(async () => ({
        status: "unavailable" as const,
        unavailableReason: "control_plane_unavailable",
      }));
      const hostedToolContext = createNewsletterHostedToolContext({
        groupSharedReader: { request: groupSharedRequest },
        newsletterRequest,
      });
      const prepareRequest = readMurphDynamicToolRequest(newsletterToolCall({
        action: "prepare",
      }));
      const sendRequest = readMurphDynamicToolRequest(newsletterToolCall({
        action: "send",
        html: "<p>Weekly</p>",
        subject: "Weekly note",
        text: "Weekly",
      }));
      if (
        !prepareRequest
        || prepareRequest.kind !== "newsletter"
        || !sendRequest
        || sendRequest.kind !== "newsletter"
      ) {
        throw new Error("Expected newsletter requests.");
      }

      const prepareResult = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request: prepareRequest,
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

      expect(readNewsletterToolPayload(prepareResult)).toEqual({
        action: "prepare",
        result: {
          status: "unavailable",
          unavailableReason: "shared_projection_unavailable",
        },
      });
      expect(readNewsletterToolPayload(sendResult)).toEqual({
        action: "send",
        result: {
          participantCount: 1,
          skippedNoEmailMemberIds: [],
          status: "sent",
        },
      });
      expect(groupSharedRequest).toHaveBeenCalledTimes(1);
      expect(newsletterRequest).toHaveBeenCalledTimes(2);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("batches exact authorized scopes into at most three lazy reads after newsletter authority", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-newsletter-batches-"));
    try {
      await initializeVault({ timezone: "UTC", vaultRoot });
      const projectionScopes = [
        { projectionKind: "steps-days.v0" },
        { projectionKind: "hrv-days.v0" },
        { projectionKind: "activity-days.v0" },
        { projectionKind: "workout-days.v0" },
        { projectionKind: "resting-heart-rate-days.v0" },
      ] as const;
      const sequence: string[] = [];
      const newsletterRequest = vi.fn<NewsletterToolRequest>(async () => {
        sequence.push("newsletter.authority");
        return {
          action: "prepare",
          result: {
            authorizationProof: NEWSLETTER_AUTHORIZATION_PROOF,
            groupId: "group_1",
            missingEmailParticipants: [],
            participants: [{
              authorizedShares: projectionScopes.map((projectionScope) => ({
                projectionScopeKey: projectionScope.projectionKind,
                shareId: `share-${projectionScope.projectionKind}`,
              })),
              hasEmail: true,
              memberId: "member_a",
            }],
            status: "ok",
          },
        };
      });
      const groupSharedRequest = vi.fn<AssistantHostedGroupSharedReader["request"]>(
        async ({ projectionScopes: batch }) => {
          sequence.push("shared.read");
          return {
            members: [],
            requestedProjectionScopeKeys: batch.map(
              (projectionScope) => projectionScope.projectionKind,
            ),
            status: "none",
          };
        },
      );
      const request = readMurphDynamicToolRequest(newsletterToolCall({
        action: "prepare",
      }));
      if (!request || request.kind !== "newsletter") {
        throw new Error("Expected newsletter request.");
      }

      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext: createNewsletterHostedToolContext({
          groupSharedReader: { request: groupSharedRequest },
          newsletterRequest,
        }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(readNewsletterToolPayload(result)).toMatchObject({
        action: "prepare",
        result: { members: [], status: "ok" },
      });
      expect(sequence[0]).toBe("newsletter.authority");
      expect(groupSharedRequest.mock.calls.map(([call]) => call.projectionScopes.length))
        .toEqual([3, 2]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("records a rejected newsletter request as an unavailable send result", async () => {
    const closeNewsletterCapability = vi.fn();
    const recordNewsletterSendResult = vi.fn();
    const request = readMurphDynamicToolRequest(newsletterToolCall({
      action: "prepare",
    }));
    if (!request || request.kind !== "newsletter") {
      throw new Error("Expected newsletter request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createNewsletterHostedToolContext({
        closeNewsletterCapability,
        newsletterRequest: async () => {
          throw new Error("Web callback rejected the request.");
        },
        recordNewsletterSendResult,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult).toEqual({
      contentItems: [
        { type: "inputText", text: "newsletter tool request failed" },
      ],
      success: false,
    });
    expect(closeNewsletterCapability).toHaveBeenCalledTimes(1);
    expect(recordNewsletterSendResult).toHaveBeenCalledWith({
      action: "send",
      result: {
        status: "unavailable",
        unavailableReason: "newsletter_tool_failed",
      },
    });
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
              action: "prepare",
              result: {
                authorizationProof: NEWSLETTER_AUTHORIZATION_PROOF,
                groupId: "group_1",
                missingEmailParticipants: [],
                participants: [
                  {
                    authorizedShares: [],
                    hasEmail: true,
                    memberId: "member_a",
                  },
                ],
                status: "ok",
              },
            },
      recordNewsletterSendResult,
    });
    const request = readMurphDynamicToolRequest(newsletterToolCall({
      action: "send",
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
  closeNewsletterCapability?: () => void;
  groupSharedReader?: AssistantHostedGroupSharedReader;
  newsletterRequest?: NewsletterToolRequest;
  recordNewsletterSendResult?: (result: unknown) => void;
} = {}): AssistantHostedToolContext {
  const context = {
    connectedApps: null,
    computerToolsAvailable: false,
    ...(input.closeNewsletterCapability
      ? { closeNewsletterCapability: input.closeNewsletterCapability }
      : {}),
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentUserActionScope: () => null,
    currentScheduledAutomationAuthority: () => ({
      automationId: "automation_newsletter",
      occurrenceAt: "2026-07-06T03:30:00.000Z",
    }),
    familyPlanTool: null,
    groupSharedReader: input.groupSharedReader ?? null,
    groupTool: null,
    newsletterTool: {
      request: input.newsletterRequest ?? (async (request) =>
        request.action === "prepare"
          ? {
              action: "prepare",
              result: {
                authorizationProof: NEWSLETTER_AUTHORIZATION_PROOF,
                groupId: "group_1",
                missingEmailParticipants: [],
                participants: [
                  {
                    authorizedShares: [],
                    hasEmail: true,
                    memberId: "member_a",
                  },
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

function createGroupHostedToolContext(input: {
  currentInvocationScope?: AssistantHostedToolContext["currentInvocationScope"];
  currentUserActionScope?: AssistantHostedToolContext["currentUserActionScope"];
  groupPermissionOfferRequest?: GroupPermissionOfferRequest;
  groupSharedReadRequest?: GroupSharedReadRequest;
  groupRequest?: GroupToolRequest;
  groupToolAvailable?: boolean;
} = {}): AssistantHostedToolContext {
  const currentUserActionScope = input.currentUserActionScope ?? (() => null);
  const context = {
    connectedApps: null,
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentInvocationScope: input.currentInvocationScope ?? (() => {
      const scope = currentUserActionScope();
      const assistantInputId = scope?.acceptedInputIds.at(-1) ?? null;
      return scope && assistantInputId
        ? {
            conversationScope: scope.conversationScope,
            origin: {
              assistantInputId,
              kind: "accepted_input" as const,
              sessionId: scope.originSessionId,
            },
          }
        : null;
    }),
    currentUserActionScope,
    currentScheduledAutomationAuthority: () => null,
    familyPlanTool: null,
    groupPermissionOfferTool: input.groupPermissionOfferRequest
      ? { request: input.groupPermissionOfferRequest }
      : null,
    groupSharedReader: input.groupSharedReadRequest
      ? { request: input.groupSharedReadRequest }
      : null,
    groupTool: input.groupToolAvailable === false
      ? null
      : {
          request: input.groupRequest ?? (async () => ({
            action: "read_current" as const,
            result: { group: null, status: "none" as const },
          })),
        },
    newsletterTool: null,
    phoneCalls: null,
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

function readGroupToolPayload(
  result: Awaited<ReturnType<typeof executeMurphDynamicToolRequest>>,
): unknown {
  const item = result.rpcResult.contentItems[0];
  if (!item || item.type !== "inputText") {
    throw new Error("Expected text tool payload.");
  }
  return JSON.parse(item.text);
}

function generatedImageRefFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !("generatedImage" in payload)) {
    throw new Error("Expected generated image payload.");
  }
  const generatedImage = payload.generatedImage;
  if (
    !generatedImage ||
    typeof generatedImage !== "object" ||
    !("savedImageRef" in generatedImage) ||
    typeof generatedImage.savedImageRef !== "string"
  ) {
    throw new Error("Expected generated image ref.");
  }
  return generatedImage.savedImageRef;
}

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    status: init.status ?? 200,
  });
}
