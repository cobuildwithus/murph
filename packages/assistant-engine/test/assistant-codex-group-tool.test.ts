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
  AssistantHostedGroupSharedReader,
  AssistantHostedPrivateImageUrlPublisher,
} from "../src/assistant/execution-context.ts";
import {
  ASSISTANT_HOSTED_GROUP_SHARED_READ_MAX_RESULT_CODE_UNITS,
} from "../src/assistant/group-shared-read-limits.ts";
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
const SIGNED_PRIVATE_IMAGE_URL =
  `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}?exp=2000000000`;

describe("murph.group dynamic tool", () => {
  it("advertises the supported actions", () => {
    expect(MURPH_GROUP_TOOL.deferLoading).toBe(true);
    expect(MURPH_DYNAMIC_TOOLS).not.toContain(MURPH_GROUP_SHARED_READ_TOOL);
    expect(MURPH_DYNAMIC_TOOLS)
      .not.toContain(MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL);
    expect(MURPH_GROUP_TOOL.inputSchema.properties.action.enum).toEqual([
      "ask",
      "ask_current_sender",
      "ask_member",
      "post_disclosure_request",
      "revoke_disclosure_grant",
      "read_shared",
      "read_current",
      "read_chat_name",
      "read_usage",
      "read_usage_referral",
      "arm_usage_referral",
      "cancel_usage_referral",
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
    expect(MURPH_GROUP_TOOL.inputSchema.properties.policyCode.description)
      .toContain('state="armed"');
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
      .toEqual(expect.arrayContaining([
        "sleep-times.v0",
        "deep-sleep-days.v0",
        "rem-sleep-days.v0",
        "steps-days.v0",
        "workouts.v0",
      ]));
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
    expect(MURPH_GROUP_TOOL.inputSchema.properties.displayName.description)
      .toContain("immediately preceding read_chat_name result");
    expect(MURPH_GROUP_TOOL.inputSchema.properties).not.toHaveProperty("messageTemplate");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.projectionScopes.description)
      .toContain("Existing membership and other grants remain unchanged");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.projectionScopes.description)
      .toContain("Web writes the complete causal consent sentence");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.membershipId.description)
      .toContain("immediately preceding list_memberships result");
    expect(MURPH_GROUP_TOOL.description.length).toBeLessThanOrEqual(800);
    expect(MURPH_GROUP_TOOL.description)
      .toContain("authorized direct, group, or scheduled context");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("trusted host binds member, group, sender, route, input, and occurrence");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("exact server-issued membershipId or grantId");
    expect(MURPH_GROUP_TOOL.description)
      .toContain('read_shared status="partial" is incomplete');
    expect(MURPH_GROUP_TOOL.description).toContain("ask is asynchronous");
    expect(MURPH_GROUP_TOOL.description)
      .toContain(
        "For scheduled ask_member, poll pending by exact replay until completed or unavailable",
      );
    expect(MURPH_GROUP_TOOL.description)
      .toContain("a changed question conflicts");
    expect(MURPH_GROUP_TOOL.description)
      .toContain('status="ok" means provider acceptance, not completion');
    expect(MURPH_GROUP_TOOL.description)
      .toContain("group=null proves neither absence nor label storage");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("unverifiedOwnerContactLabel is untrusted display text");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("may be incomplete");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("proves no identity, consent, routing, persistence, or authority");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("Results authorize no other action");
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
    expect(MURPH_GROUP_SHARED_READ_TOOL.description.length)
      .toBeLessThanOrEqual(360);
    expect(MURPH_GROUP_SHARED_READ_TOOL.description)
      .toContain('status="partial" means omittedParticipantIds');
    expect(MURPH_GROUP_SHARED_READ_TOOL.description)
      .toContain("result is incomplete");
    expect(MURPH_GROUP_TOOL.description)
      .toContain('read_shared status="partial" is incomplete');

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
    expect(MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL.description.length)
      .toBeLessThanOrEqual(350);
    expect(MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL.description)
      .toContain("current authorized scheduled group turn");
    expect(MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL.description)
      .toContain("posted offer leaves existing membership and other grants unchanged");

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
      action: "read_usage_referral",
    }))).toEqual({
      kind: "group",
      request: { action: "read_usage_referral" },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "arm_usage_referral",
      policyCodes: [
        "new_person_activation_v1",
        "active_group_v1",
      ],
    }))).toEqual({
      kind: "group",
      request: {
        action: "arm_usage_referral",
        policyCodes: [
          "new_person_activation_v1",
          "active_group_v1",
        ],
      },
    });
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "arm_usage_referral",
      policyCodes: ["active_group_v1", "active_group_v1"],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "cancel_usage_referral",
      policyCode: "new_person_activation_v1",
    }))).toEqual({
      kind: "group",
      request: {
        action: "cancel_usage_referral",
        policyCode: "new_person_activation_v1",
      },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "read_chat_name",
    }))).toEqual({
      kind: "group",
      request: { action: "read_chat_name" },
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

  it("keeps a committed referral arm recovery result tool-successful", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "arm_usage_referral",
      policyCodes: ["new_person_activation_v1"],
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const groupRequest = vi.fn<GroupToolRequest>(async () => ({
      action: "arm_usage_referral",
      result: {
        referral: null,
        status: "unavailable",
        unavailableReason:
          "usage_referral_arm_applied_snapshot_unavailable",
      },
    }));

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

    expect(result.rpcResult.success).toBe(true);
    expect(readGroupToolPayload(result)).toEqual({
      action: "arm_usage_referral",
      result: {
        referral: null,
        status: "unavailable",
        unavailableReason:
          "usage_referral_arm_applied_snapshot_unavailable",
      },
    });
    expect(groupRequest).toHaveBeenCalledWith({
      action: "arm_usage_referral",
      policyCodes: ["new_person_activation_v1"],
    });
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

  it("renames owner contact hints so the model sees their unverified authority", async () => {
    const groupRequest = vi.fn<GroupToolRequest>(async () => ({
      action: "read_chat_participants",
      result: {
        participants: [
          {
            handle: "+15551110003",
            hasOwnMurph: true,
            ownerAdvisoryName: "Alex R.",
          },
        ],
        status: "ok",
      },
    }));
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_chat_participants",
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
      action: "read_chat_participants",
      result: {
        participants: [{
          handle: "+15551110003",
          hasOwnMurph: true,
          unverifiedOwnerContactLabel: "Alex R.",
        }],
        status: "ok",
      },
    });
    expect(JSON.stringify(readGroupToolPayload(result))).not.toContain(
      "ownerAdvisoryName",
    );
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

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "read_shared",
      projectionScopes: [
        { projectionKind: "deep-sleep-days.v0" },
        { projectionKind: "rem-sleep-days.v0" },
        { projectionKind: "workouts.v0" },
      ],
    }))).toEqual({
      kind: "group",
      request: {
        action: "read_shared",
        projectionScopes: [
          { projectionKind: "deep-sleep-days.v0" },
          { projectionKind: "rem-sleep-days.v0" },
          { projectionKind: "workouts.v0" },
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

  it("normalizes a mixed shared read without exposing global member ids", async () => {
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
            {
              dataStatus: "available" as const,
              grantStatus: "granted" as const,
              projectionScope: { projectionKind: "workouts.v0" as const },
              projectionScopeKey: "workouts.v0",
              records: [{
                data: {
                  calendarClosedThroughDate: "2026-07-18",
                  date: "2026-07-18",
                  timeSemantics: "canonical-event-zone-or-vault-zone.v0" as const,
                  workouts: [{
                    kind: "running",
                    minutes: 45,
                    startLocalMs: 23_400_000,
                  }],
                },
                occurredAt: "2026-07-18T00:00:00.000Z",
                recordKey: "2026-07-18",
              }],
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
            {
              dataStatus: "missing" as const,
              grantStatus: "not_granted" as const,
              projectionScope: { projectionKind: "workouts.v0" as const },
              projectionScopeKey: "workouts.v0",
              records: [],
            },
          ],
        },
      ],
      requestedProjectionScopeKeys: [
        "steps-days.v0",
        "device-sync-status.v0",
        "workouts.v0",
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
        { projectionKind: "workouts.v0" },
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
        { projectionKind: "workouts.v0" },
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
    expect(toolText.text.length)
      .toBeLessThanOrEqual(
        ASSISTANT_HOSTED_GROUP_SHARED_READ_MAX_RESULT_CODE_UNITS,
      );
    const payload = readGroupToolPayload(result);
    expect(payload).toMatchObject({
      action: "read_shared",
      result: {
        members: [
          {
            currentTurnHandles: ["+15551110001"],
            displayName: "Alex",
            participantId: "participant_a",
            // Keyed by scope, and the granted/data pair collapses to the one
            // status the model actually acts on.
            projections: {
              "steps-days.v0": {
                records: [{
                  data: {
                    date: "2026-07-18",
                    metricKey: "steps",
                    unit: "count",
                    value: 8_001,
                  },
                  occurredAt: "2026-07-18T00:00:00.000Z",
                  recordKey: "2026-07-18",
                }],
                status: "available",
              },
              "device-sync-status.v0": { status: "not_granted" },
              "workouts.v0": {
                calendarClosedThroughDate: "2026-07-18",
                days: {
                  "2026-07-18": [{
                    kindIndex: 0,
                    minutes: 45,
                    startLocalMs: 23_400_000,
                  }],
                },
                kinds: ["running"],
                status: "available",
                timeSemantics: "canonical-event-zone-or-vault-zone.v0",
              },
            },
          },
          {
            currentTurnHandles: ["member-b@example.test"],
            displayName: "Alex",
            participantId: "participant_b",
            projections: {
              "steps-days.v0": { status: "missing" },
              "device-sync-status.v0": { status: "available" },
              "workouts.v0": { status: "not_granted" },
            },
          },
        ],
        status: "ok",
      },
    });
  });

  it("passes bounded workout arrays through the model-facing boundary", async () => {
    const groupSharedReadRequest = vi.fn(async () => ({
      members: [{
        currentTurnHandles: [],
        displayName: null,
        memberId: "member_internal_timing",
        participantId: "participant_timing",
        projections: [{
          dataStatus: "available" as const,
          grantStatus: "granted" as const,
          projectionScope: {
            projectionKind: "workouts.v0" as const,
          },
          projectionScopeKey: "workouts.v0",
          records: [{
            data: {
              calendarClosedThroughDate: "2026-07-17",
              date: "2026-07-18",
              timeSemantics: "canonical-event-zone-or-vault-zone.v0" as const,
              workouts: [{
                kind: "running",
                minutes: 45,
                startLocalMs: 64_800_001,
              }],
            },
            occurredAt: "2026-07-18T00:00:00.000Z",
            recordKey: "2026-07-18",
          }],
        }],
      }],
      requestedProjectionScopeKeys: ["workouts.v0"],
      status: "ok" as const,
    }));
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "workouts.v0" }],
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

    const payload = readGroupToolPayload(result);
    expect(JSON.stringify(payload)).not.toContain("member_internal_timing");
    expect(payload).toMatchObject({
      action: "read_shared",
      result: {
        members: [{
          participantId: "participant_timing",
          // Projections are keyed by scope, so each one no longer restates it.
          projections: {
            "workouts.v0": {
              calendarClosedThroughDate: "2026-07-17",
              // Days are keyed by their ISO date, and the one required semantics
              // literal is stated once for the projection, not per record.
              days: {
                "2026-07-18": [{
                  kindIndex: 0,
                  minutes: 45,
                  startLocalMs: 64_800_001,
                }],
              },
              kinds: ["running"],
              status: "available",
              timeSemantics: "canonical-event-zone-or-vault-zone.v0",
            },
          },
        }],
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /absoluteTimestamp|heartRate|location|provider|route|timeZone/u,
    );

    // One read returns members x scopes x days, so the shared budget must not be
    // spent restating each day's own date or a projection-level constant.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("2026-07-18T00:00:00.000Z");
    expect(serialized).not.toContain('"recordKey"');
    expect(serialized).not.toContain('"records"');
    expect(serialized.match(/2026-07-18/gu)).toHaveLength(1);
    expect(serialized.match(/canonical-event-zone-or-vault-zone\.v0/gu))
      .toHaveLength(1);
  });

  it("keeps every workouts day value an array and hoists its completion watermark", async () => {
    const groupSharedReadRequest = vi.fn(async () => ({
      members: [{
        currentTurnHandles: [],
        displayName: null,
        memberId: "member_internal_provisional",
        participantId: "participant_provisional",
        projections: [{
          dataStatus: "available" as const,
          grantStatus: "granted" as const,
          projectionScope: { projectionKind: "workouts.v0" as const },
          projectionScopeKey: "workouts.v0",
          records: [
            {
              data: {
                calendarClosedThroughDate: "2026-07-24",
                date: "2026-07-24",
                timeSemantics: "canonical-event-zone-or-vault-zone.v0" as const,
                workouts: [],
              },
              occurredAt: "2026-07-24T00:00:00.000Z",
              recordKey: "2026-07-24",
            },
            {
              data: {
                calendarClosedThroughDate: "2026-07-24",
                date: "2026-07-25",
                timeSemantics: "canonical-event-zone-or-vault-zone.v0" as const,
                workouts: [{ kind: "running", minutes: 30, startLocalMs: 68_400_000 }],
              },
              occurredAt: "2026-07-25T00:00:00.000Z",
              recordKey: "2026-07-25",
            },
          ],
        }],
      }],
      requestedProjectionScopeKeys: ["workouts.v0"],
      status: "ok" as const,
    }));
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "workouts.v0" }],
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

    const projection = readFirstProjection(readGroupToolPayload(result));
    // A settled empty day and an open day must have the SAME value shape, or the
    // referee's days[date].some(...) breaks on exactly the pending case.
    const days = projection.days;
    expect(Object.values(days ?? {}).every(Array.isArray)).toBe(true);
    expect(days).toEqual({
      "2026-07-24": [],
      "2026-07-25": [{ kindIndex: 0, minutes: 30, startLocalMs: 68_400_000 }],
    });
    expect(projection.kinds).toEqual(["running"]);
    expect(projection.calendarClosedThroughDate).toBe("2026-07-24");
  });

  it("preserves non-workout records while normalizing their projection envelope", async () => {
    const groupSharedReadRequest = vi.fn(async () => ({
      members: [{
        currentTurnHandles: [],
        displayName: null,
        memberId: "member_internal_mixed",
        participantId: "participant_mixed",
        projections: [{
          dataStatus: "available" as const,
          grantStatus: "granted" as const,
          projectionScope: {
            projectionKind: "activity-days.v0" as const,
          },
          projectionScopeKey: "activity-days.v0",
          records: [
            {
              data: {
                date: "2026-07-18",
                metricKey: "activity-minutes",
                metricSemantics: "broad-movement" as const,
                unit: "minutes",
                value: 30,
              },
              occurredAt: "2026-07-18T00:00:00.000Z",
              recordKey: "2026-07-18",
            },
            {
              data: {
                date: "2026-07-17",
                metricKey: "activity-minutes",
                unit: "minutes",
                value: 45,
              },
              occurredAt: "2026-07-17T00:00:00.000Z",
              recordKey: "2026-07-17",
            },
          ],
        }],
      }],
      requestedProjectionScopeKeys: ["activity-days.v0"],
      status: "ok" as const,
    }));
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "activity-days.v0" }],
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

    const payload = readGroupToolPayload(result);
    const projection = readFirstProjection(payload);
    // The model envelope is deliberately keyed and three-state, while the
    // non-workout record array remains byte-identical to the Web response.
    expect(projection).toEqual({
      status: "available",
      records: [
        {
          data: {
            date: "2026-07-18",
            metricKey: "activity-minutes",
            metricSemantics: "broad-movement",
            unit: "minutes",
            value: 30,
          },
          occurredAt: "2026-07-18T00:00:00.000Z",
          recordKey: "2026-07-18",
        },
        {
          data: {
            date: "2026-07-17",
            metricKey: "activity-minutes",
            unit: "minutes",
            value: 45,
          },
          occurredAt: "2026-07-17T00:00:00.000Z",
          recordKey: "2026-07-17",
        },
      ],
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

  it("names omitted members instead of failing an oversized shared read", async () => {
    const dates = [
      "2026-07-24",
      "2026-07-23",
      "2026-07-22",
      "2026-07-21",
      "2026-07-20",
      "2026-07-19",
      "2026-07-18",
    ];
    const workoutKinds = Array.from({ length: 13 }, (_unused, index) =>
      `activity-${String(index).padStart(2, "0")}-${"x".repeat(65)}`
    );
    // This uses the production roster, day, workout-count, and activity-kind
    // bounds. A dense but valid roster must not cost everyone their standings,
    // while capacity-omitted members must remain explicitly current.
    const groupSharedReadRequest = vi.fn<GroupSharedReadRequest>(async () => ({
      members: Array.from({ length: 32 }, (_unused, index) => ({
        currentTurnHandles: [],
        displayName: `Member ${index}`,
        memberId: `member_oversized_${index}`,
        participantId: `participant_oversized_${index}`,
        projections: [{
          dataStatus: "available" as const,
          grantStatus: "granted" as const,
          projectionScope: { projectionKind: "workouts.v0" as const },
          projectionScopeKey: "workouts.v0",
          records: dates.map((date) => ({
            data: {
              calendarClosedThroughDate: "2026-07-24",
              date,
              timeSemantics:
                "canonical-event-zone-or-vault-zone.v0" as const,
              workouts: workoutKinds.map((kind, workoutIndex) => ({
                kind,
                minutes: 1_440 - workoutIndex,
                startLocalMs: 86_399_999 - workoutIndex,
              })),
            },
            occurredAt: `${date}T00:00:00.000Z`,
            recordKey: date,
          })),
        }],
      })),
      requestedProjectionScopeKeys: ["workouts.v0"],
      status: "ok",
    }));
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "workouts.v0" }],
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

    const payload = JSON.parse(JSON.stringify(readGroupToolPayload(result)));
    expect(payload.result.status).toBe("partial");
    // Whole members only: whoever remains is complete.
    expect(payload.result.members.length).toBeGreaterThan(0);
    expect(payload.result.members.length).toBeLessThan(32);
    for (const member of payload.result.members) {
      expect(Object.keys(member.projections)).toEqual(["workouts.v0"]);
      expect(member.projections["workouts.v0"].days)
        .toHaveProperty("2026-07-24");
    }
    expect(payload.result.omittedParticipantIds.length)
      .toBe(32 - payload.result.members.length);
    for (const omitted of payload.result.omittedParticipantIds) {
      expect(omitted).toMatch(/^participant_oversized_\d+$/u);
    }
    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(64_000);
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
          sponsorshipUrl: "https://www.withmurph.ai/groups/fund/funding_locator",
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

  it("executes a rename that renamed the chat without a hosted group record", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "update_display_name",
      displayName: "Weekly Health Crew",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }

    const response = {
      action: "update_display_name" as const,
      result: { group: null, status: "ok" as const },
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
    expect(MURPH_GROUP_TOOL.description)
      .toContain('status="ok" means provider acceptance, not completion');
    expect(MURPH_GROUP_TOOL.description)
      .toContain("group=null proves neither absence nor label storage");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.displayName.description)
      .toContain("then tries to store the same hosted group label");
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
      const privateImageUrlPublish = vi.fn<
        AssistantHostedPrivateImageUrlPublisher["publishPrivateImageUrl"]
      >(async () => ({
        expiresAt: "2033-05-18T03:33:20.000Z",
        url: SIGNED_PRIVATE_IMAGE_URL,
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
        hostedToolContext: createGroupHostedToolContext({
          groupRequest,
          privateImageUrlPublish,
        }),
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
      expect(JSON.stringify(readGroupToolPayload(result))).not.toContain(
        "murph-hosted.cobuildwithus.workers.dev",
      );
      expect(result.responseMediaPatch).toBeUndefined();
      expect(privateImageUrlPublish).toHaveBeenCalledOnce();
      expect(privateImageUrlPublish.mock.calls[0]?.[0]).toEqual({
        bytes: expect.any(Uint8Array),
        contentType: "image/png",
      });
      expect(groupRequest).toHaveBeenNthCalledWith(
        2,
        { action: "set_chat_avatar", groupChatIconUrl: SIGNED_PRIVATE_IMAGE_URL },
      );
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
      const privateImageUrlPublish = vi.fn<
        AssistantHostedPrivateImageUrlPublisher["publishPrivateImageUrl"]
      >(async () => ({
        expiresAt: "2033-05-18T03:33:20.000Z",
        url: SIGNED_PRIVATE_IMAGE_URL,
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
        hostedToolContext: createGroupHostedToolContext({
          groupRequest,
          privateImageUrlPublish,
        }),
        nextUsageOrdinal,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(nextUsageOrdinal).toHaveBeenCalledOnce();
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(result.rpcResult.success).toBe(true);
      expect(readGroupToolPayload(result)).toMatchObject({
        action: "set_chat_avatar",
        generatedImage: {
          savedCaptureId: expect.any(String),
          savedImageRef: expect.stringMatching(/^raw\/captures\//u),
        },
        result: { status: "requested" },
      });
      expect(JSON.stringify(readGroupToolPayload(result))).not.toContain(
        "murph-hosted.cobuildwithus.workers.dev",
      );
      expect(privateImageUrlPublish.mock.calls[0]?.[0]).toEqual({
        bytes: expect.any(Uint8Array),
        contentType: "image/webp",
      });
      expect(groupRequest).toHaveBeenNthCalledWith(
        2,
        { action: "set_chat_avatar", groupChatIconUrl: SIGNED_PRIVATE_IMAGE_URL },
      );
      expect(result.usageDraft).toMatchObject({ providerRequestOrdinal: 7 });
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
      const fetchImpl = vi.fn(async () =>
        jsonResponse({
          data: [{ b64_json: Buffer.from(webpBytes).toString("base64") }],
          usage: {
            input_tokens: 4,
            output_tokens: 6,
            total_tokens: 10,
          },
        }));
      const privateImageUrlPublish = vi.fn<
        AssistantHostedPrivateImageUrlPublisher["publishPrivateImageUrl"]
      >(async () => ({
        expiresAt: "2033-05-18T03:33:20.000Z",
        url: SIGNED_PRIVATE_IMAGE_URL,
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
        hostedToolContext: createGroupHostedToolContext({
          groupRequest,
          privateImageUrlPublish,
        }),
        nextUsageOrdinal: () => usageOrdinal++,
        progressDelivery: null,
        request: firstRequest,
        vaultRoot,
      });

      expect(first.rpcResult.success).toBe(true);
      expect(readGroupToolPayload(first)).toMatchObject({
        action: "set_chat_avatar",
        generatedImage: {
          savedImageRef: expect.stringMatching(/^raw\/captures\//u),
        },
        result: { status: "requested" },
      });
      expect(fetchImpl).toHaveBeenCalledOnce();

      const second = await executeMurphDynamicToolRequest({
        env: {
          OPENAI_API_KEY: "openai-test-key",
        },
        fetchImpl,
        hostedToolContext: createGroupHostedToolContext({
          groupRequest,
          privateImageUrlPublish,
        }),
        nextUsageOrdinal: () => usageOrdinal++,
        progressDelivery: null,
        request: secondRequest,
        vaultRoot,
      });

      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(second.rpcResult.success).toBe(true);
      expect(readGroupToolPayload(second)).toMatchObject({
        action: "set_chat_avatar",
        generatedImage: {
          savedImageRef: expect.stringMatching(/^raw\/captures\//u),
        },
        result: { status: "requested" },
      });
      expect(groupRequest).toHaveBeenCalledTimes(4);
      expect(privateImageUrlPublish).toHaveBeenCalledTimes(2);
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
          occurrenceAt: "2026-07-07T03:30:00.000Z",
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
              observedDayCount: 1,
              observedDates: ["2026-07-06"],
              stream: "steps",
              throughDate: "2026-07-06",
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
          referenceAt: "2026-07-07T03:30:00.000Z",
          status: "ok",
        },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("excludes challenge-only nutrient grants from newsletter shared reads", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-newsletter-nutrient-"));
    try {
      await initializeVault({ timezone: "UTC", vaultRoot });
      const newsletterRequest = vi.fn<NewsletterToolRequest>(async () => ({
        action: "prepare",
        result: {
          authorizationProof: NEWSLETTER_AUTHORIZATION_PROOF,
          groupId: "group_1",
          missingEmailParticipants: [],
          participants: [
            {
              authorizedShares: [
                { projectionScopeKey: "steps-days.v0", shareId: "share-steps" },
                { projectionScopeKey: "calories-days.v0", shareId: "share-cal" },
                { projectionScopeKey: "carbs-days.v0", shareId: "share-carb" },
                { projectionScopeKey: "fat-days.v0", shareId: "share-fat" },
                { projectionScopeKey: "fiber-days.v0", shareId: "share-fiber" },
              ],
              hasEmail: true,
              memberId: "member_a",
            },
          ],
          status: "ok",
        },
      }));
      const groupSharedReader: AssistantHostedGroupSharedReader = {
        request: vi.fn<AssistantHostedGroupSharedReader["request"]>(async ({
          projectionScopes,
        }) => {
          // The member granted four nutrient scopes for a challenge, but the
          // newsletter is only configured for steps; the reader must never be
          // asked for the challenge-only nutrient scopes.
          expect(projectionScopes).toEqual([{ projectionKind: "steps-days.v0" }]);
          return {
            members: [{
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
                  data: { date: "2026-07-06", metricKey: "steps", unit: "count", value: 7_000 },
                  occurredAt: "2026-07-06T00:00:00.000Z",
                  recordKey: "2026-07-06",
                }],
              }],
            }],
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
          occurrenceAt: "2026-07-07T03:30:00.000Z",
        }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(groupSharedReader.request).toHaveBeenCalledTimes(1);
      const payload = readNewsletterToolPayload(result);
      expect(payload).toMatchObject({
        action: "prepare",
        result: {
          members: [{ memberId: "member_a", weeklyStats: [{ stream: "steps" }] }],
        },
      });
      const serialized = JSON.stringify(payload);
      for (const nutrientKey of ["dietary-calories", "carbs-grams", "fat-grams", "fiber-grams"]) {
        expect(serialized).not.toContain(nutrientKey);
      }
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
  occurrenceAt?: string;
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
      occurrenceAt: input.occurrenceAt ?? "2026-07-06T03:30:00.000Z",
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
  privateImageUrlPublish?: AssistantHostedPrivateImageUrlPublisher[
    "publishPrivateImageUrl"
  ];
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
    privateImageUrlPublisher: input.privateImageUrlPublish
      ? { publishPrivateImageUrl: input.privateImageUrlPublish }
      : null,
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

interface ReadSharedProjectionShape {
  calendarClosedThroughDate?: string;
  days?: Record<string, unknown>;
  status?: string;
  kinds?: string[];
  records?: { data: Record<string, unknown> }[];
  timeSemantics?: string;
}

function readFirstProjection(payload: unknown): ReadSharedProjectionShape {
  const projections = JSON.parse(JSON.stringify(payload))
    ?.result?.members?.[0]?.projections;
  const projection = projections === undefined
    ? undefined
    : Object.values(projections)[0];
  if (!projection) {
    throw new Error("Expected a read_shared payload with one projection.");
  }
  return projection;
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
