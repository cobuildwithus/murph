import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  addCaptureWithLookup,
  CAPTURE_LOOKUP_INDEX_PATH,
  findCaptureByLookup,
  initializeVault,
  runGeneratedImageCaptureRetention,
} from "@murphai/core";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_CODE_POINTS,
} from "@murphai/hosted-execution/pending-group-setup";
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
  normalizeAssistantExecutionContext,
} from "../src/assistant/execution-context.ts";
import {
  ASSISTANT_HOSTED_GROUP_SHARED_READ_MAX_RESULT_CODE_UNITS,
} from "../src/assistant/group-shared-read-limits.ts";
import {
  createAssistantOutboxIntent,
  listAssistantOutboxIntents,
  saveAssistantOutboxIntent,
} from "../src/assistant/outbox.ts";
import {
  buildAssistantGeneratedImageDeliveryTranscriptMarkerText,
  resolveAssistantGeneratedImageDelivery,
} from "../src/assistant/response-media.ts";
import {
  appendAssistantTranscriptEntries,
  listAssistantTranscriptEntries,
} from "../src/assistant/store.ts";
import type {
  AssistantAcceptedMessageTargetAuthorizer,
} from "../src/assistant/message-target-selection.ts";
import {
  executeMurphDynamicToolRequest,
  GROUP_ACCESS_FRESH_NATIVE_RESPONSE_HANDLING,
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
    id: options.id ?? "request-test",
    method: "item/tool/call",
    params: {
      arguments: argumentsValue,
      callId: options.callId ?? "call-test",
      namespace: "murph",
      threadId: "thread-test",
      tool: MURPH_GROUP_TOOL.name,
      turnId: "turn-test",
    },
  };
}

function newsletterToolCall(argumentsValue: unknown): Record<string, unknown> {
  return {
    id: "request-newsletter-test",
    method: "item/tool/call",
    params: {
      arguments: argumentsValue,
      callId: "call-newsletter-test",
      namespace: "murph",
      threadId: "thread-test",
      tool: MURPH_NEWSLETTER_TOOL.name,
      turnId: "turn-test",
    },
  };
}

type NewsletterToolRequest = NonNullable<AssistantHostedToolContext["newsletterTool"]>["request"];
const NEWSLETTER_AUTHORIZATION_PROOF = "a".repeat(64);
type GroupToolRequest = NonNullable<AssistantHostedToolContext["groupTool"]>["request"];
type GroupToolResponse = Awaited<ReturnType<GroupToolRequest>>;
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
  `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.png?exp=2000000000`;
const SIGNED_PRIVATE_JPEG_URL =
  SIGNED_PRIVATE_IMAGE_URL.replace("group-avatar.png", "group-avatar.jpg");

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
      "prepare_next_group",
      "read_next_group",
      "cancel_next_group",
      "read_chat_name",
      "read_usage",
      "read_usage_referral",
      "arm_usage_referral",
      "cancel_usage_referral",
      "create_signup_referral_link",
      "list_memberships",
      "leave_membership",
      "update_display_name",
      "offer_access",
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
    expect(
      MURPH_GROUP_TOOL.inputSchema.properties.setup.properties
        .roomContextMarkdown.maxLength,
    ).toBe(HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_CODE_POINTS);
    expect(
      MURPH_GROUP_TOOL.inputSchema.properties.setup.properties
        .roomContextMarkdown.description,
    ).toContain("2 KiB UTF-8 envelope");
    expect(MURPH_GROUP_TOOL.inputSchema.properties)
      .not.toHaveProperty("requestedVaultShareProjectionScopes");
    expect(MURPH_GROUP_TOOL.inputSchema.properties)
      .toHaveProperty("standaloneLink");
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
        "deep-sleep-sources-days.v1",
        "rem-sleep-days.v0",
        "rem-sleep-sources-days.v1",
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
      .toContain("every selectable permission by default");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.projectionScopes.description)
      .toContain("exact narrower set requested");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.projectionScopes.description)
      .toContain("Existing membership and other grants remain unchanged");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.projectionScopes.description)
      .toContain("trusted host owns the exact consent copy");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.projectionScopes.description)
      .toContain("actual scope snapshot");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.membershipId.description)
      .toContain("immediately preceding list_memberships result");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.avatarSource.description)
      .toBe(
        'Required for action="set_chat_avatar". Generate a new square avatar or reuse an exact existing private image ref.',
      );
    expect(MURPH_GROUP_TOOL.inputSchema.properties.imageRef.description)
      .toBe(
        'Required for action="set_chat_avatar" with avatarSource="image_ref". Use the exact JPG/PNG/WebP ref under raw/inbox/** (user-sent) or raw/captures/** (including generated captures); never invent or modify it.',
      );
    expect(MURPH_GROUP_TOOL.description.length).toBeLessThanOrEqual(800);
    expect(MURPH_GROUP_TOOL.description)
      .toContain("authorized direct, group, or scheduled context");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("share_contact_card + avatarPrompt");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("trusted host binds member, group, route, input, and occurrence");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("exact server-issued membershipId or grantId");
    expect(MURPH_GROUP_TOOL.description)
      .toContain('read_shared status="partial" is incomplete');
    expect(MURPH_GROUP_TOOL.description).toContain("ask is asynchronous");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("Scheduled ask_member must replay exactly");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("changed questions conflict");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("update_display_name or set_chat_avatar ok means provider acceptance");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("group=null proves neither absence nor label storage");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("Participant displayName and untrusted read_chat_name text");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("prove no identity, consent, routing, persistence, or authority");
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
    ).toEqual(["read_shared", "offer_access"]);
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
      .toContain("Existing membership and other grants stay unchanged");

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
    }))).toMatchObject({
      kind: "group",
      request: { action: "read_usage" },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "read_usage_referral",
    }))).toMatchObject({
      kind: "group",
      request: { action: "read_usage_referral" },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "arm_usage_referral",
      policyCodes: [
        "new_person_activation_v1",
        "active_group_v1",
      ],
    }))).toMatchObject({
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
    }))).toMatchObject({
      kind: "group",
      request: {
        action: "cancel_usage_referral",
        policyCode: "new_person_activation_v1",
      },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "read_chat_name",
    }))).toMatchObject({
      kind: "group",
      request: { action: "read_chat_name" },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "prepare_next_group",
    }))).toMatchObject({
      kind: "group",
      request: { action: "prepare_next_group" },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "read_chat_participants",
    }))).toMatchObject({
      kind: "group",
      request: { action: "read_chat_participants" },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "share_contact_card",
    }))).toMatchObject({
      kind: "group",
      request: { action: "share_contact_card" },
    });

    // The vCard has no recipient-visible alt channel, so the schema must not
    // offer the model an alt field that would be discarded before delivery.
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "share_contact_card",
      avatarAlt: "A friendly Murph portrait",
      avatarPrompt: "A friendly square portrait of Murph",
    }))?.kind).toBe("invalid-group-arguments");

    // Photo quality is not a member-visible choice, so the schema must not
    // offer the model a hidden latency/cost/fidelity control.
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "share_contact_card",
      avatarPrompt: "A friendly square portrait of Murph",
      avatarQuality: "high",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "share_contact_card",
      avatarPrompt: "A friendly square portrait of Murph",
    }))).toMatchObject({
      kind: "group",
      request: {
        action: "share_contact_card",
        avatar: {
          source: "generate",
          args: {
            alt: null,
            outputFormat: "jpeg",
            prompt: "A friendly square portrait of Murph",
            quality: "medium",
            referenceImageRefs: [],
            size: "1024x1024",
          },
        },
      },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      displayName: "Sunday Sleep Crew",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }))).toMatchObject({
      kind: "group",
      request: {
        action: "offer_access",
        displayName: "Sunday Sleep Crew",
        projectionScopes: [{ projectionKind: "sleep-times.v0" }],
      },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "revoke_own_email_share",
      message_ref: FRESH_ASSISTANT_INPUT_ID,
    }))).toMatchObject({
      kind: "group",
      request: {
        action: "revoke_own_email_share",
        messageRef: FRESH_ASSISTANT_INPUT_ID,
      },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "share_contact_card",
      linqThread: { chatId: "chat_hijack" },
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      messageTemplate: "Model-authored consent copy must not cross the boundary.",
      linqThread: { chatId: "chat_hijack" },
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "read_chat_participants",
      chatId: "chat_hijack",
    }))?.kind).toBe("invalid-group-arguments");

    for (const invalid of [
      { action: "revoke_own_email_share" },
      {
        action: "revoke_own_email_share",
        message_ref: FRESH_ASSISTANT_INPUT_ID,
        memberId: "model-supplied",
      },
      {
        action: "revoke_own_email_share",
        message_ref: FRESH_ASSISTANT_INPUT_ID,
        participant: { senderHandle: "+15551110003", source: "linq" },
      },
      {
        action: "revoke_own_email_share",
        message_ref: FRESH_ASSISTANT_INPUT_ID,
        selfOptOut: { senderHandle: "member@example.test", source: "email" },
      },
      { action: "revoke_own_email_share", message_ref: "provider-message-id" },
    ]) {
      expect(readMurphDynamicToolRequest(groupToolCall(invalid))?.kind)
        .toBe("invalid-group-arguments");
    }
  });

  it("uses one message_ref model contract for exact-message group actions", () => {
    expect(MURPH_GROUP_TOOL.inputSchema.properties)
      .not.toHaveProperty("messageRef");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.message_ref)
      .toMatchObject({ pattern: "^ain_[0-9a-f]{32}$" });

    for (const action of [
      "ask_current_sender",
      "create_signup_referral_link",
      "revoke_own_email_share",
    ] as const) {
      expect(readMurphDynamicToolRequest(groupToolCall({
        action,
        message_ref: FRESH_ASSISTANT_INPUT_ID,
      }))).toMatchObject({
        kind: "group",
        request: {
          action,
          messageRef: FRESH_ASSISTANT_INPUT_ID,
        },
      });
      expect(readMurphDynamicToolRequest(groupToolCall({
        action,
        messageRef: FRESH_ASSISTANT_INPUT_ID,
      }))).toMatchObject({ kind: "invalid-group-arguments" });
      expect(readMurphDynamicToolRequest(groupToolCall({
        action,
        memberId: "model-supplied",
        message_ref: FRESH_ASSISTANT_INPUT_ID,
      }))).toMatchObject({ kind: "invalid-group-arguments" });
    }
  });

  it("creates a direct signup link only from fresh user input and returns the exact server result", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "create_signup_referral_link",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected signup referral request.");
    }
    const response = {
      action: "create_signup_referral_link" as const,
      result: {
        expiresAt: "2026-08-06T12:00:00.000Z",
        signupUrl: "https://www.withmurph.ai/join/server-issued",
        status: "ok" as const,
      },
    };
    const groupRequest = vi.fn<GroupToolRequest>(async () => response);
    const currentUserActionScope = () => ({
      acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
      conversationId: "conversation_private",
      conversationScope: "direct" as const,
      inboundMailboxItemIds: ["mailbox_private"],
      originSessionId: "session_private",
      recipientKey: "recipient_private",
    });

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

    expect(result.rpcResult.success).toBe(true);
    expect(groupRequest).toHaveBeenCalledWith({
      action: "create_signup_referral_link",
    });
    expect(readGroupToolPayload(result)).toEqual(response);

    const rejectedRequest = vi.fn<GroupToolRequest>();
    const rejected = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentUserActionScope: () => null,
        groupRequest: rejectedRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(rejected.rpcResult.success).toBe(false);
    expect(rejectedRequest).not.toHaveBeenCalled();

    const unverifiedRequest = vi.fn<GroupToolRequest>();
    const unverified = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentUserActionScope: () => ({
          acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
          conversationId: "conversation_external",
          conversationScope: "unverified-external",
          inboundMailboxItemIds: ["mailbox_external"],
          originSessionId: "session_external",
          recipientKey: "recipient_external",
        }),
        groupRequest: unverifiedRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(unverified.rpcResult.success).toBe(false);
    expect(unverifiedRequest).not.toHaveBeenCalled();
  });

  it("binds a group signup link to the request-bearing accepted message", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "create_signup_referral_link",
      message_ref: FRESH_ASSISTANT_INPUT_ID,
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected signup referral request.");
    }
    const participant = {
      assistantInputId: FRESH_ASSISTANT_INPUT_ID,
      senderHandle: "+15551110003",
      source: "linq" as const,
    };
    const authorizeAcceptedMessageTarget: AssistantAcceptedMessageTargetAuthorizer =
      vi.fn(async ({ messageRef }) =>
        messageRef === FRESH_ASSISTANT_INPUT_ID
          ? { participant, targetInputId: FRESH_ASSISTANT_INPUT_ID }
          : null);
    const response = {
      action: "create_signup_referral_link" as const,
      result: {
        expiresAt: "2026-08-06T12:00:00.000Z",
        signupUrl: "https://www.withmurph.ai/join/group-server-issued",
        status: "ok" as const,
      },
    };
    const groupRequest = vi.fn<GroupToolRequest>(async () => response);

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentUserActionScope: () => ({
          acceptedInputIds: [EARLIER_ASSISTANT_INPUT_ID, FRESH_ASSISTANT_INPUT_ID],
          conversationId: "conversation_group",
          conversationScope: "group",
          inboundMailboxItemIds: ["mailbox_one", "mailbox_two"],
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

    expect(result.rpcResult.success).toBe(true);
    expect(authorizeAcceptedMessageTarget).toHaveBeenCalledWith({
      action: "participant-effect",
      deliveryContextOrdinal: 0,
      messageRef: FRESH_ASSISTANT_INPUT_ID,
    });
    expect(groupRequest).toHaveBeenCalledWith({
      action: "create_signup_referral_link",
      participant,
    });
    expect(readGroupToolPayload(result)).toEqual(response);
  });

  it.each([
    ["no message ref", undefined],
    ["a ref outside the accepted input set", EARLIER_ASSISTANT_INPUT_ID],
  ])("rejects a group signup link with %s", async (_case, messageRef) => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "create_signup_referral_link",
      ...(messageRef ? { message_ref: messageRef } : {}),
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected signup referral request.");
    }
    const authorizeAcceptedMessageTarget = vi.fn();
    const groupRequest = vi.fn<GroupToolRequest>();

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentUserActionScope: () => ({
          acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
          conversationId: "conversation_group",
          conversationScope: "group",
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

    expect(result.rpcResult.success).toBe(false);
    expect(authorizeAcceptedMessageTarget).not.toHaveBeenCalled();
    expect(groupRequest).not.toHaveBeenCalled();
  });

  it("binds a group referral read to the request-bearing accepted message", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_usage_referral",
      message_ref: FRESH_ASSISTANT_INPUT_ID,
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const participant = {
      assistantInputId: FRESH_ASSISTANT_INPUT_ID,
      senderHandle: "+15551110003",
      source: "linq" as const,
    };
    const authorizeAcceptedMessageTarget: AssistantAcceptedMessageTargetAuthorizer =
      vi.fn(async ({ messageRef }) =>
        messageRef === FRESH_ASSISTANT_INPUT_ID
          ? { participant, targetInputId: FRESH_ASSISTANT_INPUT_ID }
          : null);
    const groupRequest = vi.fn<GroupToolRequest>(async () => ({
      action: "read_usage_referral",
      result: {
        referral: null,
        status: "unavailable",
        unavailableReason: "synthetic",
      },
    }));

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentUserActionScope: () => ({
          acceptedInputIds: [EARLIER_ASSISTANT_INPUT_ID, FRESH_ASSISTANT_INPUT_ID],
          conversationId: "conversation_group",
          conversationScope: "group",
          inboundMailboxItemIds: ["mailbox_one", "mailbox_two"],
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

    expect(result.rpcResult.success).toBe(true);
    expect(authorizeAcceptedMessageTarget).toHaveBeenCalledWith({
      action: "participant-effect",
      deliveryContextOrdinal: 0,
      messageRef: FRESH_ASSISTANT_INPUT_ID,
    });
    expect(groupRequest).toHaveBeenCalledWith({
      action: "read_usage_referral",
      participant,
    });
  });

  it("selects the request-bearing message_ref from two accepted group senders", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "revoke_own_email_share",
      message_ref: FRESH_ASSISTANT_INPUT_ID,
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const earlierParticipant = {
      assistantInputId: EARLIER_ASSISTANT_INPUT_ID,
      senderHandle: "+15551110002",
      source: "linq" as const,
    };
    const participant = {
      assistantInputId: FRESH_ASSISTANT_INPUT_ID,
      senderHandle: "+15551110003",
      source: "linq" as const,
    };
    const authorizeAcceptedMessageTarget: AssistantAcceptedMessageTargetAuthorizer =
      vi.fn(async ({ messageRef }) => {
        if (messageRef === EARLIER_ASSISTANT_INPUT_ID) {
          return {
            participant: earlierParticipant,
            targetInputId: EARLIER_ASSISTANT_INPUT_ID,
          };
        }
        if (messageRef === FRESH_ASSISTANT_INPUT_ID) {
          return {
            participant,
            targetInputId: FRESH_ASSISTANT_INPUT_ID,
          };
        }
        return null;
      });
    const groupRequest = vi.fn<GroupToolRequest>(async () => ({
      action: "revoke_own_email_share",
      result: { revokedCount: 1, status: "revoked" },
    }));

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentUserActionScope: () => ({
          acceptedInputIds: [EARLIER_ASSISTANT_INPUT_ID, FRESH_ASSISTANT_INPUT_ID],
          conversationId: "conversation_group",
          conversationScope: "group",
          inboundMailboxItemIds: ["mailbox_one", "mailbox_two"],
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

    expect(result.rpcResult.success).toBe(true);
    expect(authorizeAcceptedMessageTarget).toHaveBeenCalledWith({
      action: "participant-effect",
      deliveryContextOrdinal: 0,
      messageRef: FRESH_ASSISTANT_INPUT_ID,
    });
    expect(groupRequest).toHaveBeenCalledWith({
      action: "revoke_own_email_share",
      participant,
    });
  });

  it.each([
    ["missing authorizer", null],
    ["invented ref", async () => null],
    [
      "cross-message participant",
      async () => ({
        participant: {
          assistantInputId: EARLIER_ASSISTANT_INPUT_ID,
          senderHandle: "+15551110002",
          source: "linq" as const,
        },
        targetInputId: FRESH_ASSISTANT_INPUT_ID,
      }),
    ],
  ])("fails closed for email-share revocation with %s", async (
    _case,
    authorizeAcceptedMessageTarget,
  ) => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "revoke_own_email_share",
      message_ref: FRESH_ASSISTANT_INPUT_ID,
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const groupRequest = vi.fn<GroupToolRequest>();

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentUserActionScope: () => ({
          acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
          conversationId: "conversation_group",
          conversationScope: "group",
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

    expect(result.rpcResult.success).toBe(false);
    expect(groupRequest).not.toHaveBeenCalled();
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

  it("allows next-group preparation only from fresh private text input", async () => {
    const setup = {
      roomContextMarkdown: "Keep this room low-key.",
      style: {
        personality: { humor: 2 },
        tone: "casual",
      },
    } as const;
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "prepare_next_group",
      setup,
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const groupRequest = vi.fn<GroupToolRequest>(async () => ({
      action: "prepare_next_group",
      result: {
        expiresAt: "2026-07-29T18:30:00.000Z",
        setup: {},
        status: "prepared",
      },
    }));
    const freshDirectScope = () => ({
      acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
      conversationId: "conversation_private",
      conversationScope: "direct" as const,
      inboundMailboxItemIds: ["mailbox_private"],
      originSessionId: "session_private",
      recipientKey: "recipient_private",
    });
    const run = async (input: {
      conversationScope?: "direct" | "group";
      returnContactKind?: "email" | "text";
    }) => executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentHostedDeliveryContext: () => ({
          conversationId: "conversation_private",
          recipientKey: "recipient_private",
          returnContactKind: input.returnContactKind ?? "text",
        }),
        currentUserActionScope: input.conversationScope === "group"
          ? () => ({ ...freshDirectScope(), conversationScope: "group" })
          : freshDirectScope,
        groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect((await run({})).rpcResult.success).toBe(true);
    expect(groupRequest).toHaveBeenCalledExactlyOnceWith({
      action: "prepare_next_group",
      setup,
    });
    expect((await run({ conversationScope: "group" })).rpcResult.success)
      .toBe(false);
    expect((await run({ returnContactKind: "email" })).rpcResult.success)
      .toBe(false);
    expect(groupRequest).toHaveBeenCalledTimes(1);
  });

  it("parses set_chat_avatar arguments without accepting model-supplied URLs or targets", () => {
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "set_chat_avatar",
      avatarSource: "generate",
      prompt: "A clean square badge for our running group",
      referenceImageRefs: ["raw/inbox/reference.png"],
    }))).toMatchObject({
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
    }))).toMatchObject({
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

  it("passes the bounded included-usage progress field through to the model", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_usage",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const response = {
      action: "read_usage" as const,
      result: {
        status: "ok" as const,
        usage: {
          fundingNeeded: false,
          fundingUrl: null,
          includedUsageUsedPercent: 64,
        },
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
    expect(groupRequest).toHaveBeenCalledWith({ action: "read_usage" });
    expect(readGroupToolPayload(result)).toEqual(response);
  });

  it("parses read_current arguments", () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_current",
    }));

    expect(request).toMatchObject({
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

  it("projects advisory names as display names without changing alternatives", async () => {
    const groupRequest = vi.fn<GroupToolRequest>(async () => ({
      action: "read_chat_participants",
      result: {
        participants: [
          {
            handle: "+15551110003",
            hasOwnMurph: true,
            ownerAdvisoryName: "Alex R.",
          },
          {
            handle: "+15551110004",
            hasOwnMurph: false,
            ownerAdvisoryName: "Jordan P. / Riley P.",
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
          displayName: "Alex R.",
        }, {
          handle: "+15551110004",
          hasOwnMurph: false,
          displayName: "Jordan P. / Riley P.",
        }],
        status: "ok",
      },
    });
    expect(JSON.stringify(readGroupToolPayload(result))).not.toContain(
      "ownerAdvisoryName",
    );
    expect(JSON.stringify(readGroupToolPayload(result))).not.toContain(
      "unverifiedOwnerContactLabel",
    );
  });

  it("parses a bounded exact shared-data read without model-supplied authority", () => {
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "read_shared",
      projectionScopes: [
        { projectionKind: "steps-days.v0" },
        { projectionKind: "device-sync-status.v0" },
      ],
    }))).toMatchObject({
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
    }))).toMatchObject({
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
              grantedAt: "2026-07-31T12:30:00.000Z",
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
              grantedAt: null,
              grantStatus: "not_granted" as const,
              projectionScope: { projectionKind: "device-sync-status.v0" as const },
              projectionScopeKey: "device-sync-status.v0",
              records: [],
            },
            {
              dataStatus: "available" as const,
              grantedAt: "2026-07-31T12:31:00.000Z",
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
              grantedAt: "2026-07-31T12:32:00.000Z",
              grantStatus: "granted" as const,
              projectionScope: { projectionKind: "steps-days.v0" as const },
              projectionScopeKey: "steps-days.v0",
              records: [],
            },
            {
              dataStatus: "available" as const,
              grantedAt: "2026-07-31T12:33:00.000Z",
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
              grantedAt: null,
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
                grantedAt: "2026-07-31T12:30:00.000Z",
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
                grantedAt: "2026-07-31T12:31:00.000Z",
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
              "steps-days.v0": {
                grantedAt: "2026-07-31T12:32:00.000Z",
                status: "missing",
              },
              "device-sync-status.v0": {
                grantedAt: "2026-07-31T12:33:00.000Z",
                status: "available",
              },
              "workouts.v0": { status: "not_granted" },
            },
          },
        ],
        status: "ok",
      },
    });
  });

  it("passes source-aware sleep values and freshness through the model boundary", async () => {
    const groupSharedReadRequest = vi.fn(async () => ({
      members: [{
        currentTurnHandles: [],
        displayName: null,
        memberId: "member_internal_sleep_sources",
        participantId: "participant_sleep_sources",
        projections: [{
          dataStatus: "available" as const,
          grantStatus: "granted" as const,
          projectionScope: {
            projectionKind: "deep-sleep-sources-days.v1" as const,
          },
          projectionScopeKey: "deep-sleep-sources-days.v1",
          records: [{
            data: {
              date: "2026-07-18",
              metricKey: "deep-sleep-minutes",
              projectedAt: "2026-07-18T12:00:00.000Z",
              sources: [
                {
                  label: "Fitbit",
                  recordedAt: "2026-07-18T06:58:00.000Z",
                  source: "fitbit",
                  unit: "minutes",
                  value: 64,
                },
                {
                  label: "Garmin",
                  recordedAt: "2026-07-18T07:01:00.000Z",
                  selected: true as const,
                  source: "garmin",
                  unit: "minutes",
                  value: 88,
                },
                {
                  label: "Oura",
                  recordedAt: null,
                  source: "oura",
                  unit: "minutes",
                  value: 112,
                },
              ],
              sourcesDisagree: true,
              unit: "minutes",
              value: 88,
            },
            occurredAt: "2026-07-18T00:00:00.000Z",
            recordKey: "2026-07-18",
          }],
        }],
      }],
      requestedProjectionScopeKeys: ["deep-sleep-sources-days.v1"],
      status: "ok" as const,
    }));
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "deep-sleep-sources-days.v1" }],
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
    expect(payload).toMatchObject({
      action: "read_shared",
      result: {
        members: [{
          participantId: "participant_sleep_sources",
          projections: {
            "deep-sleep-sources-days.v1": {
              records: [{
                data: {
                  projectedAt: "2026-07-18T12:00:00.000Z",
                  sources: [
                    { source: "fitbit", value: 64 },
                    { selected: true, source: "garmin", value: 88 },
                    { source: "oura", value: 112 },
                  ],
                  sourcesDisagree: true,
                  value: 88,
                },
              }],
              status: "available",
            },
          },
        }],
        status: "ok",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("member_internal_sleep_sources");
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

  it("strips group metadata from access results and member ids from summaries", async () => {
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
      {
        args: { action: "offer_access", standaloneLink: true },
        exposesGroupSummary: false,
      },
      {
        args: { action: "update_display_name", displayName: "Challenge group" },
        exposesGroupSummary: true,
      },
      {
        args: {
          action: "offer_access",
          projectionScopes: [{ projectionKind: "steps-days.v0" }],
        },
        exposesGroupSummary: false,
      },
    ];

    for (const modelRequest of modelRequests) {
      const request = readMurphDynamicToolRequest(groupToolCall(modelRequest.args));
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
      if (modelRequest.exposesGroupSummary) {
        expect(resultText.text).toContain("group_challenge");
      } else {
        expect(resultText.text).not.toContain("group_challenge");
      }
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
    }))).toMatchObject({
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
    {
      errorFields: {
        code: "HOSTED_GROUP_TOOL_RESPONSE_SCHEMA_INVALID",
        name: "HostedGroupToolResponseSchemaError",
      },
      expectedIssue: {
        component: "assistant.group-tool",
        details: {
          action: "read_usage",
          failureCategory: "response_schema_invalid",
        },
        errorCode: "HOSTED_GROUP_TOOL_RESPONSE_SCHEMA_INVALID",
        issueKind: "schema_rejection",
        operation: "read_usage",
        phase: "tool_result_parse",
        severity: "warning",
        summary: "Hosted group tool request failed.",
      },
    },
    {
      errorFields: {
        code: "PRIVATE_WEB_ERROR",
        retryable: true,
        statusCode: 503,
      },
      expectedIssue: {
        component: "assistant.group-tool",
        details: {
          action: "read_usage",
          failureCategory: "http_5xx",
          retryable: true,
          statusClass: "5xx",
        },
        errorCode: "HOSTED_GROUP_TOOL_HTTP_5XX",
        issueKind: "tool_error",
        operation: "read_usage",
        phase: "tool_call",
        severity: "warning",
        summary: "Hosted group tool request failed.",
      },
    },
    {
      errorFields: {
        code: "PRIVATE_RATE_LIMIT_DETAIL",
        retryable: false,
        status: 429,
      },
      expectedIssue: {
        component: "assistant.group-tool",
        details: {
          action: "read_usage",
          failureCategory: "http_4xx",
          retryable: false,
          statusClass: "4xx",
        },
        errorCode: "HOSTED_GROUP_TOOL_HTTP_4XX",
        issueKind: "tool_error",
        operation: "read_usage",
        phase: "tool_call",
        severity: "warning",
        summary: "Hosted group tool request failed.",
      },
    },
    {
      errorFields: {
        code: "PRIVATE_TIMEOUT_DETAIL",
        hostedRuntimeFetchCauseKind: "timeout",
      },
      expectedIssue: {
        component: "assistant.group-tool",
        details: {
          action: "read_usage",
          failureCategory: "timeout",
        },
        errorCode: "HOSTED_GROUP_TOOL_TIMEOUT",
        issueKind: "timeout",
        operation: "read_usage",
        phase: "tool_call",
        severity: "warning",
        summary: "Hosted group tool request failed.",
      },
    },
    {
      errorFields: {
        code: "PRIVATE_NETWORK_DETAIL",
        hostedRuntimeFetchCauseKind: "network",
      },
      expectedIssue: {
        component: "assistant.group-tool",
        details: {
          action: "read_usage",
          failureCategory: "transport",
        },
        errorCode: "HOSTED_GROUP_TOOL_TRANSPORT_FAILED",
        issueKind: "tool_error",
        operation: "read_usage",
        phase: "tool_call",
        severity: "warning",
        summary: "Hosted group tool request failed.",
      },
    },
    {
      errorFields: {
        hostedRuntimeFetchCallerSignalAborted: true,
        hostedRuntimeFetchCauseKind: "abort",
      },
      expectedIssue: {
        component: "assistant.group-tool",
        details: {
          action: "read_usage",
          failureCategory: "transport",
        },
        errorCode: "HOSTED_GROUP_TOOL_TRANSPORT_FAILED",
        issueKind: "tool_error",
        operation: "read_usage",
        phase: "tool_call",
        severity: "warning",
        summary: "Hosted group tool request failed.",
      },
    },
    {
      errorFields: {
        name: "AbortError",
      },
      expectedIssue: {
        component: "assistant.group-tool",
        details: {
          action: "read_usage",
          failureCategory: "transport",
        },
        errorCode: "HOSTED_GROUP_TOOL_TRANSPORT_FAILED",
        issueKind: "tool_error",
        operation: "read_usage",
        phase: "tool_call",
        severity: "warning",
        summary: "Hosted group tool request failed.",
      },
    },
    {
      errorFields: {
        code: "PRIVATE_UNKNOWN_DETAIL",
      },
      expectedIssue: {
        component: "assistant.group-tool",
        details: {
          action: "read_usage",
          failureCategory: "unknown",
        },
        errorCode: "HOSTED_GROUP_TOOL_FAILED",
        issueKind: "tool_error",
        operation: "read_usage",
        phase: "tool_call",
        severity: "warning",
        summary: "Hosted group tool request failed.",
      },
    },
  ])("records bounded group-tool failure metadata %#", async ({
    errorFields,
    expectedIssue,
  }) => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_usage",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const privateDetail = "private upstream group-tool response";
    const groupRequest = vi.fn<GroupToolRequest>(async () => {
      throw Object.assign(new Error(privateDetail), errorFields);
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({ groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult).toEqual({
      contentItems: [{ type: "inputText", text: "group tool request failed" }],
      success: false,
    });
    expect(result.runtimeIssueInputs).toEqual([expectedIssue]);
    expect(JSON.stringify(result)).not.toContain(privateDetail);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });

  it("does not report caller-owned group-tool cancellation as a runtime failure", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_usage",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const abortController = new AbortController();
    const privateDetail = "private caller cancellation reason";
    const groupRequest = vi.fn<GroupToolRequest>(async () => {
      abortController.abort(new DOMException(privateDetail, "AbortError"));
      throw abortController.signal.reason;
    });

    const result = await executeMurphDynamicToolRequest({
      abortSignal: abortController.signal,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({ groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.runtimeIssueInputs).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(privateDetail);
  });

  it("records a raw group-tool body deadline as a bounded timeout", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "read_usage",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const privateDetail = "private response body timeout reason";
    const groupRequest = vi.fn<GroupToolRequest>(async () => {
      throw new DOMException(privateDetail, "TimeoutError");
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({ groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult).toEqual({
      contentItems: [{ type: "inputText", text: "group tool request failed" }],
      success: false,
    });
    expect(result.runtimeIssueInputs).toEqual([{
      component: "assistant.group-tool",
      details: {
        action: "read_usage",
        failureCategory: "timeout",
      },
      errorCode: "HOSTED_GROUP_TOOL_TIMEOUT",
      issueKind: "timeout",
      operation: "read_usage",
      phase: "tool_call",
      severity: "warning",
      summary: "Hosted group tool request failed.",
    }]);
    expect(JSON.stringify(result)).not.toContain(privateDetail);
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

  it("keeps scheduled access offers on the existing bounded port", async () => {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }
    const groupRequest = vi.fn<GroupToolRequest>();
    const groupPermissionOfferRequest = vi.fn<GroupPermissionOfferRequest>(
      async () => ({
        action: "create_join_link",
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
    expect(readGroupToolPayload(result)).toEqual({
      action: "offer_access",
      result: {
        status: "unavailable",
        unavailableReason: "permission_offer_unavailable",
      },
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

    expect(request).toMatchObject({
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
      .toContain("update_display_name or set_chat_avatar ok means provider acceptance");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("group=null proves neither absence nor label storage");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.displayName.description)
      .toContain('Required for action="update_display_name"');
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

  it("parses one provider-neutral access offer", () => {
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      displayName: "Sunday sleep crew",
      projectionScopes: [
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
    }))).toMatchObject({
      kind: "group",
      request: {
        action: "offer_access",
        displayName: "Sunday sleep crew",
        projectionScopes: [
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
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
    }))).toMatchObject({
      kind: "group",
      request: { action: "offer_access" },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      standaloneLink: true,
    }))).toMatchObject({
      kind: "group",
      request: { action: "offer_access", standaloneLink: true },
    });

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "create_join_link",
    }))?.kind).toBe("invalid-group-arguments");
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
    }))?.kind).toBe("invalid-group-arguments");
  });

  it("rejects unsupported group kinds and projection kinds", () => {
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      kind: "everyone",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      projectionScopes: [{ projectionKind: "all-health-data" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      projectionScopes: [{ projectionKind: "activity-minutes-days.v1" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      projectionScopes: [{ projectionKind: "activity-distance-days.v1" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      projectionScopes: [{
        projectionKind: "activity-session-count-days.v1",
        selector: { activityKind: "running+walking" },
      }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      projectionScopes: [{
        projectionKind: "activity-distance-days.v1",
        selector: { activityKind: "sleep" },
      }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      projectionScopes: [{
        projectionKind: "activity-session-count-days.v1",
        selector: { activityKind: "sleep" },
      }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      intro: "Like this to join.",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      displayName: "   ",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      displayName: "a".repeat(121),
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      projectionScopes: [{ projectionKind: "all-health-data" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      messageTemplate: "Model-authored offer copy.",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      projectionScopes: [
        { projectionKind: "sleep-times.v0" },
        { projectionKind: "sleep-times.v0" },
      ],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      standaloneLink: "yes",
    }))?.kind).toBe("invalid-group-arguments");
  });

  it("maps provider-neutral access offers to native consent or an exact link", async () => {
    const group = {
      displayName: "Private group label",
      id: "private-group-id",
      kind: "friends" as const,
      memberCount: 0,
      members: [],
      requestedVaultShareProjectionKinds: ["steps-days.v0" as const],
      requestedVaultShareProjectionScopes: [
        { projectionKind: "steps-days.v0" as const },
      ],
      status: "active" as const,
    };
    const groupRequest = vi.fn<GroupToolRequest>(async (request) =>
      request.action === "create_join_link"
        ? {
            action: request.action,
            result: {
              group,
              joinUrl: "https://example.test/groups/join/exact",
              offeredAt: "2026-07-31T12:00:00.000Z",
              status: "ok",
            },
          }
        : request.action === "post_join_offer"
          ? {
              action: request.action,
              result: {
                group,
                joinUrl: "https://example.test/groups/join/native-hidden",
                offeredAt: "2026-07-31T12:01:00.000Z",
                offerState: "posted",
                status: "sent",
              },
            }
          : (() => {
              throw new Error(`Unexpected group action ${request.action}.`);
            })()
    );

    const standalone = readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      displayName: "Sunday sleep crew",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
      standaloneLink: true,
    }));
    const native = readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    }));
    if (
      !standalone
      || standalone.kind !== "group"
      || !native
      || native.kind !== "group"
    ) {
      throw new Error("Expected access-offer requests.");
    }

    const standaloneResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({ groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: standalone,
      vaultRoot: null,
    });
    const nativeResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({ groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: native,
      vaultRoot: null,
    });

    expect(groupRequest).toHaveBeenNthCalledWith(1, {
      action: "create_join_link",
      joinLink: {
        displayName: "Sunday sleep crew",
        requestedVaultShareProjectionScopes: [
          { projectionKind: "steps-days.v0" },
        ],
      },
    });
    expect(groupRequest).toHaveBeenNthCalledWith(2, {
      action: "post_join_offer",
      joinOffer: {
        messageTemplate: HOSTED_RUNTIME_GROUP_JOIN_OFFER_LEGACY_MESSAGE_TEMPLATE,
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      },
    });
    expect(readGroupToolPayload(standaloneResult)).toEqual({
      action: "offer_access",
      result: {
        joinUrl: "https://example.test/groups/join/exact",
        presentation: "link",
        recencyEvidence: "unavailable",
        status: "ok",
      },
    });
    expect(readGroupToolPayload(nativeResult)).toEqual({
      action: "offer_access",
      result: {
        offeredAt: "2026-07-31T12:01:00.000Z",
        presentation: "native",
        recencyEvidence: "eligible",
        responseHandling: GROUP_ACCESS_FRESH_NATIVE_RESPONSE_HANDLING,
        status: "ok",
      },
    });
    expect(JSON.stringify(readGroupToolPayload(standaloneResult))).not.toContain(
      "private-group-id",
    );
    expect(JSON.stringify(readGroupToolPayload(nativeResult))).not.toContain(
      "native-hidden",
    );
    expect(standaloneResult.finalActionPatch).toBeUndefined();
    expect(nativeResult.finalActionPatch).toBeUndefined();
  });

  it("shows a fresh exact link for a reused native offer and fails closed without recency evidence", async () => {
    const group = {
      displayName: null,
      id: "private-group-id",
      kind: "friends" as const,
      memberCount: 0,
      members: [],
      requestedVaultShareProjectionKinds: ["steps-days.v0" as const],
      requestedVaultShareProjectionScopes: [
        { projectionKind: "steps-days.v0" as const },
      ],
      status: "active" as const,
    };
    const responses: GroupToolResponse[] = [
      {
        action: "post_join_offer",
        result: {
          group,
          joinUrl: "https://example.test/groups/join/reused",
          offeredAt: "2026-07-31T12:02:00.000Z",
          offerState: "existing",
          status: "sent",
        },
      },
      {
        action: "post_join_offer",
        result: {
          group,
          joinUrl: "https://example.test/groups/join/legacy-hidden",
          status: "sent",
        },
      },
      {
        action: "post_join_offer",
        result: {
          group,
          joinUrl: "https://example.test/groups/join/replayed-native",
          offerState: "posted",
          status: "sent",
        },
      },
    ];
    const groupRequest = vi.fn<GroupToolRequest>(async () => {
      const response = responses.shift();
      if (!response) throw new Error("Missing test response.");
      return response;
    });
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected access-offer request.");
    }

    const reusedResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({ groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });
    const legacyResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({ groupRequest }),
      nextUsageOrdinal: () => 2,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });
    const replayedProviderResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createGroupHostedToolContext({ groupRequest }),
      nextUsageOrdinal: () => 3,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(readGroupToolPayload(reusedResult)).toEqual({
      action: "offer_access",
      result: {
        joinUrl: "https://example.test/groups/join/reused",
        presentation: "link",
        recencyEvidence: "unavailable",
        status: "ok",
      },
    });
    expect(readGroupToolPayload(legacyResult)).toEqual({
      action: "offer_access",
      result: {
        presentation: "native",
        recencyEvidence: "unavailable",
        status: "ok",
      },
    });
    expect(readGroupToolPayload(replayedProviderResult)).toEqual({
      action: "offer_access",
      result: {
        presentation: "native",
        recencyEvidence: "unavailable",
        status: "ok",
      },
    });
    expect(reusedResult.finalActionPatch).toBeUndefined();
    expect(legacyResult.finalActionPatch).toBeUndefined();
    expect(replayedProviderResult.finalActionPatch).toBeUndefined();
  });

  it("normalizes a host-substituted access link after requesting the native path", async () => {
    const groupRequest = vi.fn<GroupToolRequest>(async (request) => {
      expect(request).toEqual({
        action: "post_join_offer",
        joinOffer: {
          messageTemplate: HOSTED_RUNTIME_GROUP_JOIN_OFFER_LEGACY_MESSAGE_TEMPLATE,
          projectionScopes: [{ projectionKind: "steps-days.v0" }],
        },
      });
      return {
        action: "create_join_link",
        result: {
          group: {
            displayName: null,
            id: "private-group-id",
            kind: "friends",
            memberCount: 0,
            members: [],
            requestedVaultShareProjectionKinds: ["steps-days.v0"],
            requestedVaultShareProjectionScopes: [
              { projectionKind: "steps-days.v0" },
            ],
            status: "active",
          },
          joinUrl: "https://example.test/groups/join/host-selected",
          offeredAt: "2026-07-31T12:03:00.000Z",
          status: "ok",
        },
      };
    });
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected access-offer request.");
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

    expect(groupRequest).toHaveBeenCalledOnce();
    expect(readGroupToolPayload(result)).toEqual({
      action: "offer_access",
      result: {
        joinUrl: "https://example.test/groups/join/host-selected",
        presentation: "link",
        recencyEvidence: "unavailable",
        status: "ok",
      },
    });
    expect(JSON.stringify(readGroupToolPayload(result))).not.toContain(
      "private-group-id",
    );
  });

  it("forwards only the runtime-owned legacy offer template", async () => {
    const modelAuthoredCopy = "Model-authored consent copy must never be forwarded.";
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
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
      action: "offer_access",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }

    const result = await executeMurphDynamicToolRequest({
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
    expect(readGroupToolPayload(result)).toEqual({
      action: "offer_access",
      result: {
        status: "unavailable",
        unavailableReason: "test_unavailable",
      },
    });
  });

  it("routes the narrow scheduled offer without exposing group metadata", async () => {
    const groupPermissionOfferRequest = vi.fn<GroupPermissionOfferRequest>(
      async () => ({
        action: "create_join_link",
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
          joinUrl: "https://example.test/join/offer",
          offeredAt: "2026-07-31T12:04:00.000Z",
          status: "ok",
        },
      }),
    );
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
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
      action: "offer_access",
      result: {
        joinUrl: "https://example.test/join/offer",
        presentation: "link",
        recencyEvidence: "unavailable",
        status: "ok",
      },
    });
    expect(JSON.stringify(readGroupToolPayload(result))).not.toContain("private");
  });

  it("rejects non-canonical scheduled offer evidence", async () => {
    const groupPermissionOfferRequest = vi.fn<GroupPermissionOfferRequest>(
      async () => ({
        action: "create_join_link",
        result: {
          group: {
            displayName: null,
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
          joinUrl: "https://example.test/join/offer",
          offeredAt: "2026-07-31T12:04:00Z",
          status: "ok",
        },
      }),
    );
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "offer_access",
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

    expect(result.rpcResult).toEqual({
      success: false,
      contentItems: [{
        type: "inputText",
        text: "group tool request failed",
      }],
    });
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

  it("generates and sends a personalized Murph contact card from fresh direct input", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-contact-card-"));
    try {
      await initializeVault({ vaultRoot });
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
      const groupRequest = vi.fn<GroupToolRequest>(async (hostRequest) => {
        if (hostRequest.action !== "share_contact_card") {
          throw new Error(`Unexpected group request: ${hostRequest.action}`);
        }
        return {
          action: "share_contact_card",
          result: { status: "sent" },
        };
      });
      const fetchImpl = vi.fn(async () =>
        jsonResponse({
          data: [{ b64_json: Buffer.from(jpegBytes).toString("base64") }],
          usage: {
            input_tokens: 4,
            output_tokens: 6,
            total_tokens: 10,
          },
        }, {
          headers: {
            "x-request-id": "req_contact_card_image",
          },
        }));
      const privateImageUrlPublish = vi.fn<
        AssistantHostedPrivateImageUrlPublisher["publishPrivateImageUrl"]
      >(async () => ({
        expiresAt: "2033-05-18T03:33:20.000Z",
        url: SIGNED_PRIVATE_JPEG_URL,
      }));
      const request = readMurphDynamicToolRequest(groupToolCall({
        action: "share_contact_card",
        avatarPrompt: "A friendly square portrait of Murph",
      }));
      if (!request || request.kind !== "group") {
        throw new Error("Expected group request.");
      }

      const nextUsageOrdinal = vi.fn(() => 9);
      const result = await executeMurphDynamicToolRequest({
        env: { OPENAI_API_KEY: "openai-test-key" },
        fetchImpl,
        hostedToolContext: createGroupHostedToolContext({
          currentUserActionScope: () => ({
            acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
            conversationId: "conversation_contact_card",
            conversationScope: "direct",
            inboundMailboxItemIds: ["mailbox_contact_card"],
            originSessionId: "session_contact_card",
            recipientKey: "recipient_contact_card",
          }),
          groupRequest,
          privateImageUrlPublish,
        }),
        nextUsageOrdinal,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(result.rpcResult.success).toBe(true);
      expect(readGroupToolPayload(result)).toMatchObject({
        action: "share_contact_card",
        generatedImage: {
          savedCaptureId: expect.any(String),
          savedImageRef: expect.stringMatching(/^raw\/captures\//u),
        },
        result: { status: "sent" },
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(nextUsageOrdinal).toHaveBeenCalledOnce();
      expect(privateImageUrlPublish).toHaveBeenCalledWith({
        bytes: expect.any(Uint8Array),
        contentType: "image/jpeg",
      });
      expect(groupRequest).toHaveBeenCalledExactlyOnceWith({
        action: "share_contact_card",
        contactCardImageUrl: SIGNED_PRIVATE_JPEG_URL,
        // Host-owned accepted-input identity, never the tool call id.
        contactCardShareKey: FRESH_ASSISTANT_INPUT_ID,
      });
      expect(result.usageDraft).toMatchObject({ providerRequestOrdinal: 9 });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("returns an unconfirmed contact-card send to the model instead of a failed tool call", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-contact-card-unconfirmed-"));
    try {
      await initializeVault({ vaultRoot });
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
      const groupRequest = vi.fn<GroupToolRequest>(async (hostRequest) => {
        if (hostRequest.action !== "share_contact_card") {
          throw new Error(`Unexpected group request: ${hostRequest.action}`);
        }
        return {
          action: "share_contact_card",
          result: { status: "unconfirmed" },
        };
      });
      const fetchImpl = vi.fn(async () =>
        jsonResponse({
          data: [{ b64_json: Buffer.from(jpegBytes).toString("base64") }],
          usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 },
        }));
      const request = readMurphDynamicToolRequest(groupToolCall({
        action: "share_contact_card",
        avatarPrompt: "A friendly square portrait of Murph",
      }));
      if (!request || request.kind !== "group") {
        throw new Error("Expected group request.");
      }

      const result = await executeMurphDynamicToolRequest({
        env: { OPENAI_API_KEY: "openai-test-key" },
        fetchImpl,
        hostedToolContext: createGroupHostedToolContext({
          currentUserActionScope: () => ({
            acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
            conversationId: "conversation_contact_card_unconfirmed",
            conversationScope: "direct",
            inboundMailboxItemIds: ["mailbox_contact_card_unconfirmed"],
            originSessionId: "session_contact_card_unconfirmed",
            recipientKey: "recipient_contact_card_unconfirmed",
          }),
          groupRequest,
          privateImageUrlPublish: vi.fn<
            AssistantHostedPrivateImageUrlPublisher["publishPrivateImageUrl"]
          >(async () => ({
            expiresAt: "2033-05-18T03:33:20.000Z",
            url: SIGNED_PRIVATE_JPEG_URL,
          })),
        }),
        nextUsageOrdinal: () => 9,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      // The card may be in the conversation. The model must be able to say so,
      // which it cannot do from a failed tool call carrying no status.
      expect(result.rpcResult.success).toBe(true);
      expect(readGroupToolPayload(result)).toMatchObject({
        action: "share_contact_card",
        result: { status: "unconfirmed" },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("keeps contact-card and group-avatar generated captures in separate retry scopes", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-avatar-scope-"));
    try {
      await initializeVault({ vaultRoot });
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
      const groupRequest = vi.fn<GroupToolRequest>(async (request) => {
        if (request.action === "share_contact_card") {
          return {
            action: "share_contact_card",
            result: { status: "sent" },
          };
        }
        if (request.action === "preflight_set_chat_avatar") {
          return {
            action: "preflight_set_chat_avatar",
            result: { status: "ok" },
          };
        }
        if (request.action === "set_chat_avatar") {
          return {
            action: "set_chat_avatar",
            result: { status: "requested" },
          };
        }
        throw new Error(`Unexpected group request: ${request.action}`);
      });
      let generationOrdinal = 0;
      const fetchImpl = vi.fn(async (
        _input: string | URL | Request,
        _init?: RequestInit,
      ) => {
        generationOrdinal += 1;
        const bytes = generationOrdinal === 1 ? jpegBytes : webpBytes;
        return jsonResponse({
          data: [{ b64_json: Buffer.from(bytes).toString("base64") }],
          usage: {
            input_tokens: 4,
            output_tokens: 6,
            total_tokens: 10,
          },
        });
      });
      const privateImageUrlPublish = vi.fn<
        AssistantHostedPrivateImageUrlPublisher["publishPrivateImageUrl"]
      >(async ({ contentType }) => ({
        expiresAt: "2033-05-18T03:33:20.000Z",
        url: contentType === "image/jpeg"
          ? SIGNED_PRIVATE_JPEG_URL
          : SIGNED_PRIVATE_IMAGE_URL,
      }));
      const callId = "call_shared_generated_avatar_scope";
      const contactRequest = readMurphDynamicToolRequest(groupToolCall({
        action: "share_contact_card",
        avatarPrompt: "A friendly square portrait of Murph",
      }, { callId, id: 210 }));
      const groupAvatarRequest = readMurphDynamicToolRequest(groupToolCall({
        action: "set_chat_avatar",
        avatarSource: "generate",
        prompt: "A clean square badge for our group",
      }, { callId, id: 211 }));
      if (
        !contactRequest
        || !groupAvatarRequest
        || contactRequest.kind !== "group"
        || groupAvatarRequest.kind !== "group"
      ) {
        throw new Error("Expected generated avatar requests.");
      }
      const hostedToolContext = createGroupHostedToolContext({
        currentUserActionScope: () => ({
          acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
          conversationId: "conversation_avatar_scope",
          conversationScope: "direct",
          inboundMailboxItemIds: ["mailbox_avatar_scope"],
          originSessionId: "session_avatar_scope",
          recipientKey: "recipient_avatar_scope",
        }),
        groupRequest,
        privateImageUrlPublish,
      });
      let usageOrdinal = 1;

      const contactResult = await executeMurphDynamicToolRequest({
        env: { OPENAI_API_KEY: "openai-test-key" },
        fetchImpl,
        hostedToolContext,
        nextUsageOrdinal: () => usageOrdinal++,
        progressDelivery: null,
        request: contactRequest,
        vaultRoot,
      });
      const groupAvatarResult = await executeMurphDynamicToolRequest({
        env: { OPENAI_API_KEY: "openai-test-key" },
        fetchImpl,
        hostedToolContext,
        nextUsageOrdinal: () => usageOrdinal++,
        progressDelivery: null,
        request: groupAvatarRequest,
        vaultRoot,
      });

      expect(contactResult.rpcResult.success).toBe(true);
      expect(groupAvatarResult.rpcResult.success).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const contactCardRequestBody = JSON.parse(String(
        fetchImpl.mock.calls[0]?.[1]?.body,
      ));
      const groupAvatarRequestBody = JSON.parse(String(
        fetchImpl.mock.calls[1]?.[1]?.body,
      ));
      expect(contactCardRequestBody).toMatchObject({
        output_compression: 40,
        output_format: "jpeg",
      });
      expect(groupAvatarRequestBody).not.toHaveProperty("output_compression");
      expect(privateImageUrlPublish).toHaveBeenNthCalledWith(1, {
        bytes: expect.any(Uint8Array),
        contentType: "image/jpeg",
      });
      expect(privateImageUrlPublish).toHaveBeenNthCalledWith(2, {
        bytes: expect.any(Uint8Array),
        contentType: "image/webp",
      });
      expect(groupRequest).toHaveBeenCalledTimes(3);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("rejects generated contact cards outside fresh direct input", async () => {
    const groupRequest = vi.fn<GroupToolRequest>();
    const fetchImpl = vi.fn();
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "share_contact_card",
      avatarPrompt: "A friendly square portrait of Murph",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: { OPENAI_API_KEY: "openai-test-key" },
      fetchImpl: fetchImpl as typeof fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentUserActionScope: () => ({
          acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
          conversationId: "conversation_group",
          conversationScope: "group",
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

    expect(result.rpcResult).toEqual({
      contentItems: [{
        text: "personalized contact cards require a fresh user request in a personal direct conversation",
        type: "inputText",
      }],
      success: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(groupRequest).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "SMS",
      status: {
        status: "unavailable" as const,
        unavailableReason: "sms_attachments_unsupported",
      },
    },
    {
      label: "a missing or ambiguous direct route",
      status: {
        status: "unavailable" as const,
        unavailableReason: "direct_attachment_route_unavailable",
      },
    },
  ])(
    "refuses generated contact cards on $label before any generation work",
    async ({ status }) => {
      const groupRequest = vi.fn<GroupToolRequest>();
      const fetchImpl = vi.fn();
      const privateImageUrlPublish = vi.fn();
      const persistGeneratedImageCapture = vi.fn();
      const request = readMurphDynamicToolRequest(groupToolCall({
        action: "share_contact_card",
        avatarPrompt: "A friendly square portrait of Murph",
      }));
      if (!request || request.kind !== "group") {
        throw new Error("Expected group request.");
      }

      const result = await executeMurphDynamicToolRequest({
        env: { OPENAI_API_KEY: "openai-test-key" },
        fetchImpl: fetchImpl as typeof fetch,
        hostedToolContext: createGroupHostedToolContext({
          currentUserActionScope: () => ({
            acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
            conversationId: "conversation_direct",
            conversationScope: "direct",
            inboundMailboxItemIds: ["mailbox_direct"],
            originSessionId: "session_direct",
            recipientKey: "recipient_direct",
          }),
          directAttachmentRouteStatus: () => status,
          groupRequest,
          persistGeneratedImageCapture,
          privateImageUrlPublish,
        }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot: null,
      });

      expect(readGroupToolPayload(result)).toEqual({
        action: "share_contact_card",
        result: status,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(persistGeneratedImageCapture).not.toHaveBeenCalled();
      expect(privateImageUrlPublish).not.toHaveBeenCalled();
      expect(groupRequest).not.toHaveBeenCalled();
    },
  );

  it("keeps the route probe across execution-context normalization", async () => {
    const groupRequest = vi.fn<GroupToolRequest>();
    const fetchImpl = vi.fn();
    const privateImageUrlPublish = vi.fn();
    const persistGeneratedImageCapture = vi.fn();
    const status = {
      status: "unavailable" as const,
      unavailableReason: "sms_attachments_unsupported",
    };
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "share_contact_card",
      avatarPrompt: "A friendly square portrait of Murph",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }

    // The engine rebuilds the hosted group tool before any tool runs. A probe
    // that does not survive that rebuild reads as admission downstream, so the
    // tool the executor sees must come through the real normalization.
    const normalized = normalizeAssistantExecutionContext({
      hosted: {
        groupTool: {
          directAttachmentRouteStatus: () => status,
          request: groupRequest,
        },
        memberId: "member_direct",
        userEnvKeys: [],
      },
    } as never);
    const normalizedGroupTool = normalized.hosted?.groupTool;
    expect(normalizedGroupTool?.directAttachmentRouteStatus).toEqual(
      expect.any(Function),
    );
    expect(normalizedGroupTool?.directAttachmentRouteStatus?.()).toEqual(status);

    const result = await executeMurphDynamicToolRequest({
      env: { OPENAI_API_KEY: "openai-test-key" },
      fetchImpl: fetchImpl as typeof fetch,
      hostedToolContext: {
        ...createGroupHostedToolContext({
          currentUserActionScope: () => ({
            acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
            conversationId: "conversation_direct",
            conversationScope: "direct",
            inboundMailboxItemIds: ["mailbox_direct"],
            originSessionId: "session_direct",
            recipientKey: "recipient_direct",
          }),
          groupRequest,
          persistGeneratedImageCapture,
          privateImageUrlPublish,
        }),
        groupTool: normalizedGroupTool ?? null,
      },
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(readGroupToolPayload(result)).toEqual({
      action: "share_contact_card",
      result: status,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(persistGeneratedImageCapture).not.toHaveBeenCalled();
    expect(privateImageUrlPublish).not.toHaveBeenCalled();
    expect(groupRequest).not.toHaveBeenCalled();
  });

  it("rejects generated contact cards without fresh accepted direct input", async () => {
    const groupRequest = vi.fn<GroupToolRequest>();
    const fetchImpl = vi.fn();
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "share_contact_card",
      avatarPrompt: "A friendly square portrait of Murph",
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected group request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: { OPENAI_API_KEY: "openai-test-key" },
      fetchImpl: fetchImpl as typeof fetch,
      hostedToolContext: createGroupHostedToolContext({
        currentUserActionScope: () => ({
          acceptedInputIds: [],
          conversationId: "conversation_direct",
          conversationScope: "direct",
          inboundMailboxItemIds: [],
          originSessionId: "session_direct",
          recipientKey: "recipient_direct",
        }),
        groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      vaultRoot: null,
    });

    expect(result.rpcResult).toEqual({
      contentItems: [{
        text: "personalized contact cards require a fresh user request in a personal direct conversation",
        type: "inputText",
      }],
      success: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(groupRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["user-sent", "raw/inbox/avatar.png"],
    [
      "Murph-generated canonical capture",
      "raw/captures/2026/08/generated-avatar/avatar.png",
    ],
  ] as const)("uploads a %s image ref before setting the group avatar", async (
    _source,
    imageRef,
  ) => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-group-avatar-"));
    try {
      await mkdir(dirname(join(vaultRoot, imageRef)), { recursive: true });
      await writeFile(
        join(vaultRoot, imageRef),
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
        imageRef,
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
      expect(groupRequest).toHaveBeenNthCalledWith(
        1,
        { action: "preflight_set_chat_avatar" },
      );
      expect(privateImageUrlPublish).toHaveBeenCalledOnce();
      expect(privateImageUrlPublish.mock.calls[0]?.[0]).toEqual({
        bytes: expect.any(Uint8Array),
        contentType: "image/png",
      });
      expect(groupRequest).toHaveBeenNthCalledWith(
        2,
        { action: "set_chat_avatar", groupChatIconUrl: SIGNED_PRIVATE_IMAGE_URL },
      );
      expect(groupRequest.mock.invocationCallOrder[0])
        .toBeLessThan(privateImageUrlPublish.mock.invocationCallOrder[0]!);
      expect(privateImageUrlPublish.mock.invocationCallOrder[0])
        .toBeLessThan(groupRequest.mock.invocationCallOrder[1]!);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("keeps an undelivered generated completion image out of a later avatar update", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-group-avatar-pending-"));
    const imageRef = "raw/captures/2026/08/pending-avatar/avatar.png";
    const sessionId = "session_pending_generated_avatar";
    const completionTurnId = "turn_pending_generated_avatar_completion";
    const deliveryTurnId = "turn_pending_generated_avatar_delivery";
    const media = {
      alt: "Pending generated avatar",
      contentType: "image/png",
      filename: "avatar.png",
      kind: "vault_image",
      ref: imageRef,
      sha256: "a".repeat(64),
      sizeBytes: 68,
      source: "gpt-image-2",
    } as const;
    try {
      await mkdir(dirname(join(vaultRoot, imageRef)), { recursive: true });
      await writeFile(
        join(vaultRoot, imageRef),
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      const transcriptEntries = await appendAssistantTranscriptEntries(
        vaultRoot,
        sessionId,
        [{
          kind: "status",
          text: buildAssistantGeneratedImageDeliveryTranscriptMarkerText({
            contentType: media.contentType,
            deliveryContextOrdinal: 0,
            ref: media.ref,
            sha256: media.sha256,
            sizeBytes: media.sizeBytes,
            turnId: completionTurnId,
          }),
        }],
      );
      const intent = await createAssistantOutboxIntent({
        channel: "linq",
        explicitTarget: "thread-pending-avatar",
        media: [media],
        message: "Pending generated avatar",
        sessionId,
        threadId: "thread-pending-avatar",
        threadIsDirect: false,
        turnId: deliveryTurnId,
        vault: vaultRoot,
      });

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
        imageRef,
      }));
      if (!request || request.kind !== "group") {
        throw new Error("Expected group request.");
      }

      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext: createGroupHostedToolContext({
          currentUserActionScope: () => ({
            acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
            conversationId: "conversation_pending_avatar",
            conversationScope: "group",
            inboundMailboxItemIds: ["mailbox_pending_avatar"],
            originSessionId: sessionId,
            recipientKey: "recipient_pending_avatar",
          }),
          groupRequest,
          privateImageUrlPublish,
          verifyGeneratedImageDelivery: async (requestedRef) =>
            resolveAssistantGeneratedImageDelivery({
              imageRef: requestedRef,
              intents: await listAssistantOutboxIntents(vaultRoot),
              sessionId,
              transcriptEntries: await listAssistantTranscriptEntries(
                vaultRoot,
                sessionId,
              ),
            }),
        }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(result.rpcResult).toEqual({
        contentItems: [{
          text: "generated image must be visible before it can become the group avatar",
          type: "inputText",
        }],
        success: false,
      });
      expect(groupRequest).toHaveBeenCalledOnce();
      expect(groupRequest).toHaveBeenCalledWith({
        action: "preflight_set_chat_avatar",
      });
      expect(privateImageUrlPublish).not.toHaveBeenCalled();

      const sentAt = "2026-08-10T12:00:00.000Z";
      const delivered = {
        channel: "linq",
        idempotencyKey: "pending-avatar-delivery",
        messageLength: intent.message.length,
        providerMessageEffects: [{
          carriesIntentMedia: true as const,
          message: intent.message,
          providerMessageId: "linq-message-pending-avatar",
        }],
        providerMessageId: "linq-message-pending-avatar",
        providerMessageIds: ["linq-message-pending-avatar"],
        providerThreadId: "thread-pending-avatar",
        sentAt,
        target: "thread-pending-avatar",
        targetKind: "thread" as const,
      };
      expect(resolveAssistantGeneratedImageDelivery({
        generatedImageOriginKnown: true,
        imageRef,
        intents: [intent],
        sessionId,
        transcriptEntries: [],
      })).toBe(false);
      expect(resolveAssistantGeneratedImageDelivery({
        imageRef,
        intents: [intent],
        sessionId,
        transcriptEntries: [],
      })).toBe(true);
      expect(resolveAssistantGeneratedImageDelivery({
        imageRef,
        intents: [{
          ...intent,
          delivery: {
            ...delivered,
            providerMessageEffects: delivered.providerMessageEffects.map(
              ({ carriesIntentMedia: _ignored, ...effect }) => effect,
            ),
          },
          status: "retryable",
        }],
        sessionId,
        transcriptEntries,
      })).toBe(false);
      expect(resolveAssistantGeneratedImageDelivery({
        generatedImageOriginKnown: true,
        imageRef,
        intents: [{
          ...intent,
          delivery: delivered,
          status: "retryable",
        }],
        sessionId,
        transcriptEntries: [],
      })).toBe(true);
      expect(resolveAssistantGeneratedImageDelivery({
        imageRef,
        intents: [{
          ...intent,
          delivery: delivered,
          status: "sending",
        }],
        sessionId: "session_pending_generated_avatar_other",
        transcriptEntries,
      })).toBe(false);
      expect(resolveAssistantGeneratedImageDelivery({
        imageRef,
        intents: [{ ...intent, delivery: delivered, status: "sending" }],
        sessionId,
        transcriptEntries,
      })).toBe(true);
      expect(resolveAssistantGeneratedImageDelivery({
        imageRef,
        intents: [{
          ...intent,
          delivery: delivered,
          media: [{
            ...media,
            sha256: "b".repeat(64),
          }],
          status: "sending",
        }],
        sessionId,
        transcriptEntries,
      })).toBe(false);
      expect(resolveAssistantGeneratedImageDelivery({
        imageRef,
        intents: [{ ...intent, delivery: delivered, status: "failed" }],
        sessionId,
        transcriptEntries,
      })).toBe(true);
      expect(resolveAssistantGeneratedImageDelivery({
        imageRef,
        intents: [{
          ...intent,
          delivery: delivered,
          deliveryConfirmationPending: true,
          status: "retryable",
        }],
        sessionId,
        transcriptEntries,
      })).toBe(false);
      expect(resolveAssistantGeneratedImageDelivery({
        imageRef,
        intents: [{ ...intent, delivery: delivered, status: "abandoned" }],
        sessionId,
        transcriptEntries,
      })).toBe(false);
      expect(resolveAssistantGeneratedImageDelivery({
        imageRef,
        intents: [{
          ...intent,
          delivery: {
            ...delivered,
            providerMessageEffects: [
              ...delivered.providerMessageEffects,
              ...delivered.providerMessageEffects,
            ],
          },
          status: "failed",
        }],
        sessionId,
        transcriptEntries,
      })).toBe(false);
      expect(resolveAssistantGeneratedImageDelivery({
        imageRef,
        intents: [{ ...intent, status: "failed" }],
        sessionId,
        transcriptEntries,
      })).toBe(false);
      await saveAssistantOutboxIntent(vaultRoot, {
        ...intent,
        delivery: delivered,
        sentAt,
        status: "sent",
        updatedAt: sentAt,
      });
      const deliveredResult = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext: createGroupHostedToolContext({
          currentUserActionScope: () => ({
            acceptedInputIds: [FRESH_ASSISTANT_INPUT_ID],
            conversationId: "conversation_pending_avatar",
            conversationScope: "group",
            inboundMailboxItemIds: ["mailbox_pending_avatar"],
            originSessionId: sessionId,
            recipientKey: "recipient_pending_avatar",
          }),
          groupRequest,
          privateImageUrlPublish,
          verifyGeneratedImageDelivery: async (requestedRef) =>
            resolveAssistantGeneratedImageDelivery({
              imageRef: requestedRef,
              intents: await listAssistantOutboxIntents(vaultRoot),
              sessionId,
              transcriptEntries: await listAssistantTranscriptEntries(
                vaultRoot,
                sessionId,
              ),
            }),
        }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(deliveredResult.rpcResult.success).toBe(true);
      expect(groupRequest).toHaveBeenCalledTimes(3);
      expect(privateImageUrlPublish).toHaveBeenCalledOnce();
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("requires visible generated references before generating a group avatar", async () => {
    const vaultRoot = await mkdtemp(join(
      tmpdir(),
      "assistant-codex-group-avatar-generated-reference-",
    ));
    const generatedRef = "raw/captures/2026/08/generated-reference/avatar.png";
    const ordinaryRef = "raw/captures/2026/08/ordinary-reference/avatar.png";
    const sessionId = "session_generated_avatar_reference";
    const completionTurnId = "turn_generated_avatar_reference_completion";
    const deliveryTurnId = "turn_generated_avatar_reference_delivery";
    const media = {
      alt: "Generated avatar reference",
      contentType: "image/png",
      filename: "avatar.png",
      kind: "vault_image",
      ref: generatedRef,
      sha256: "c".repeat(64),
      sizeBytes: 68,
      source: "gpt-image-2",
    } as const;
    try {
      await initializeVault({ vaultRoot });
      const imageBytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64",
      );
      for (const imageRef of [generatedRef, ordinaryRef]) {
        await mkdir(dirname(join(vaultRoot, imageRef)), { recursive: true });
        await writeFile(join(vaultRoot, imageRef), imageBytes);
      }
      await appendAssistantTranscriptEntries(vaultRoot, sessionId, [{
        kind: "status",
        text: buildAssistantGeneratedImageDeliveryTranscriptMarkerText({
          contentType: media.contentType,
          deliveryContextOrdinal: 0,
          ref: media.ref,
          sha256: media.sha256,
          sizeBytes: media.sizeBytes,
          turnId: completionTurnId,
        }),
      }]);
      const intent = await createAssistantOutboxIntent({
        channel: "linq",
        explicitTarget: "thread-generated-avatar-reference",
        media: [media],
        message: "Generated avatar reference",
        sessionId,
        threadId: "thread-generated-avatar-reference",
        threadIsDirect: false,
        turnId: deliveryTurnId,
        vault: vaultRoot,
      });
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
      let requestOrdinal = 0;
      const run = async (referenceImageRefs: string[]) => {
        const currentRequestOrdinal = requestOrdinal++;
        const request = readMurphDynamicToolRequest(groupToolCall({
          action: "set_chat_avatar",
          alt: "Our generated avatar",
          avatarSource: "generate",
          prompt: "A clean square badge based on these references",
          referenceImageRefs,
        }, {
          callId: `call_generated_avatar_reference_${currentRequestOrdinal}`,
          id: 300 + currentRequestOrdinal,
        }));
        if (!request || request.kind !== "group") {
          throw new Error("Expected group request.");
        }
        return await executeMurphDynamicToolRequest({
          env: { OPENAI_API_KEY: "openai-test-key" },
          fetchImpl,
          hostedToolContext: createGroupHostedToolContext({
            groupRequest,
            privateImageUrlPublish,
            verifyGeneratedImageDelivery: async (requestedRef) =>
              resolveAssistantGeneratedImageDelivery({
                imageRef: requestedRef,
                intents: await listAssistantOutboxIntents(vaultRoot),
                sessionId,
                transcriptEntries: await listAssistantTranscriptEntries(
                  vaultRoot,
                  sessionId,
                ),
              }),
          }),
          nextUsageOrdinal: () => 1,
          progressDelivery: null,
          request,
          vaultRoot,
        });
      };

      const hiddenResult = await run([generatedRef]);
      expect(hiddenResult.rpcResult).toEqual({
        contentItems: [{
          text: "generated image must be visible before it can become the group avatar",
          type: "inputText",
        }],
        success: false,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(privateImageUrlPublish).not.toHaveBeenCalled();
      expect(groupRequest).toHaveBeenCalledExactlyOnceWith({
        action: "preflight_set_chat_avatar",
      });

      const mixedResult = await run([ordinaryRef, generatedRef]);
      expect(mixedResult.rpcResult.success).toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(privateImageUrlPublish).not.toHaveBeenCalled();
      expect(groupRequest).toHaveBeenCalledTimes(2);

      const sentAt = "2026-08-10T12:00:00.000Z";
      await saveAssistantOutboxIntent(vaultRoot, {
        ...intent,
        delivery: {
          channel: "linq",
          idempotencyKey: "generated-avatar-reference-delivery",
          messageLength: intent.message.length,
          providerMessageEffects: [{
            carriesIntentMedia: true,
            message: intent.message,
            providerMessageId: "linq-message-generated-avatar-reference",
          }],
          providerMessageId: "linq-message-generated-avatar-reference",
          providerMessageIds: ["linq-message-generated-avatar-reference"],
          providerThreadId: "thread-generated-avatar-reference",
          sentAt,
          target: "thread-generated-avatar-reference",
          targetKind: "thread",
        },
        sentAt,
        status: "sent",
        updatedAt: sentAt,
      });

      const deliveredResult = await run([generatedRef]);
      expect(deliveredResult.rpcResult.success).toBe(true);
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(privateImageUrlPublish).toHaveBeenCalledOnce();
      expect(groupRequest).toHaveBeenCalledTimes(4);

      const ordinaryResult = await run([ordinaryRef]);
      expect(ordinaryResult.rpcResult.success).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(privateImageUrlPublish).toHaveBeenCalledTimes(2);
      expect(groupRequest).toHaveBeenCalledTimes(6);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("shows bounded provider diagnostics for a rejected group avatar update", async () => {
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
              result: {
                providerErrorCode: 5006,
                providerErrorMessage: "The avatar image type was not accepted.",
                status: "unavailable",
                unavailableReason: "provider_unavailable",
              },
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
        hostedToolContext: createGroupHostedToolContext({
          groupRequest,
          privateImageUrlPublish: async () => ({
            expiresAt: "2033-05-18T03:33:20.000Z",
            url: SIGNED_PRIVATE_IMAGE_URL,
          }),
        }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(result.rpcResult.success).toBe(true);
      expect(readGroupToolPayload(result)).toEqual({
        action: "set_chat_avatar",
        result: {
          providerErrorCode: 5006,
          providerErrorMessage: "The avatar image type was not accepted.",
          status: "unavailable",
          unavailableReason: "provider_unavailable",
        },
      });
      expect(JSON.stringify(readGroupToolPayload(result))).not.toContain(
        "murph-hosted.cobuildwithus.workers.dev",
      );
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("saves generated group avatars to the vault before setting the group avatar", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-group-avatar-generated-"));
    try {
      await initializeVault({ vaultRoot });
      const existingImagePath = join(vaultRoot, "existing-generated.webp");
      await writeFile(existingImagePath, webpBytes);
      const oldRecordedAt = new Date(
        Date.now() - 16 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const addExistingGeneratedCapture = async (lookupKey: string) =>
        await addCaptureWithLookup({
          attachments: [{
            role: "media_1",
            sourcePath: existingImagePath,
          }],
          draft: {
            note: "Assistant-generated image saved for later visual reuse.",
            occurredAt: oldRecordedAt,
            recordedAt: oldRecordedAt,
            source: "derived",
            tags: ["assistant-generated-image", "generated-image"],
            title: "Generated image",
          },
          lookupAttachmentRole: "media_1",
          lookupKey,
          rawImport: {
            importKind: "capture",
            importedAt: oldRecordedAt,
            provenance: {
              family: "capture",
              generatedImage: { schema: "murph.generated-image.v1" },
              mediaCount: 1,
            },
            source: "murph.generate_image",
          },
          vaultRoot,
        });
      const retiredExisting = await addExistingGeneratedCapture(
        "generated:legacy-retired",
      );
      const liveExisting = await addExistingGeneratedCapture(
        "generated:legacy-live",
      );
      await expect(runGeneratedImageCaptureRetention({
        now: new Date(),
        protectedCaptureIds: [liveExisting.event.id],
        vaultRoot,
      })).resolves.toMatchObject({ retiredCaptureCount: 1 });
      const lookupPath = join(vaultRoot, CAPTURE_LOOKUP_INDEX_PATH);
      const lazyLookupBytes = await readFile(lookupPath);
      await rm(lookupPath);
      let lookupMaterialized = false;
      const materializeWorkspaceArtifacts = vi.fn(async (
        relativePaths: readonly string[],
      ) => {
        if (
          relativePaths.includes(CAPTURE_LOOKUP_INDEX_PATH)
          && !lookupMaterialized
        ) {
          await mkdir(join(vaultRoot, "derived", "captures"), {
            recursive: true,
          });
          await writeFile(lookupPath, lazyLookupBytes);
          lookupMaterialized = true;
        }
        return {
          materializedArtifactPaths: new Set(relativePaths),
          missingArtifactPaths: new Set<string>(),
        };
      });

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
      let retentionWakeAt: string | null = null;
      const result = await executeMurphDynamicToolRequest({
        env: {
          OPENAI_API_KEY: "openai-test-key",
        },
        fetchImpl,
        hostedToolContext: createGroupHostedToolContext({
          groupRequest,
          persistGeneratedImageCapture: async (write, metadata) => {
            retentionWakeAt = metadata.retentionWakeAt;
            return await write();
          },
          privateImageUrlPublish,
        }),
        nextUsageOrdinal,
        materializeWorkspaceArtifacts,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(nextUsageOrdinal).toHaveBeenCalledOnce();
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(retentionWakeAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
      expect(materializeWorkspaceArtifacts.mock.calls[0]?.[0]).toEqual([
        CAPTURE_LOOKUP_INDEX_PATH,
      ]);
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

      const savedImageRef = generatedImageRefFromPayload(
        readGroupToolPayload(result),
      );
      const restoredLookup = JSON.parse(
        await readFile(lookupPath, "utf8"),
      ) as { entries: Record<string, { retiredAt?: string }> };
      expect(Object.keys(restoredLookup.entries)).toHaveLength(3);
      expect(Object.values(restoredLookup.entries).filter(
        (entry) => entry.retiredAt !== undefined,
      )).toHaveLength(1);
      await expect(findCaptureByLookup({
        lookupKey: "generated:legacy-retired",
        vaultRoot,
      })).resolves.toMatchObject({
        eventId: retiredExisting.event.id,
        status: "deleted",
      });
      await expect(findCaptureByLookup({
        lookupKey: "generated:legacy-live",
        vaultRoot,
      })).resolves.toMatchObject({
        eventId: liveExisting.event.id,
        status: "live",
      });
      await expect(runGeneratedImageCaptureRetention({
        now: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        vaultRoot,
      })).resolves.toMatchObject({
        blockedCaptureCount: 0,
        retiredCaptureCount: 2,
      });
      await expect(readFile(join(vaultRoot, savedImageRef), "utf8"))
        .resolves.toContain("generated_image_retention");
      expect(groupRequest).toHaveBeenCalledTimes(2);
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
      "shared facts from the seven completed local days",
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
                authorizedShares: [
                  {
                    projectionScopeKey: "steps-days.v0",
                    shareId: "share-member-a-steps",
                  },
                  {
                    projectionScopeKey: "workouts.v0",
                    shareId: "share-member-a-workouts",
                  },
                ],
                hasEmail: true,
                memberId: "member_a",
              },
              {
                authorizedShares: [{
                  projectionScopeKey: "workouts.v0",
                  shareId: "share-opted-out-workouts",
                }],
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
            { projectionKind: "workouts.v0" },
            { projectionKind: "steps-days.v0" },
          ]);
          return {
            members: [
              {
                currentTurnHandles: [],
                displayName: "Ada",
                memberId: "member_a",
                participantId: "participant_a",
                projections: [
                  {
                    dataStatus: "available",
                    grantStatus: "granted",
                    projectionScope: { projectionKind: "steps-days.v0" },
                    projectionScopeKey: "steps-days.v0",
                    records: [
                      "2026-06-30",
                      "2026-07-01",
                      "2026-07-02",
                      "2026-07-03",
                      "2026-07-04",
                      "2026-07-05",
                      "2026-07-06",
                      "2026-07-07",
                    ].map((date, index) => ({
                      data: {
                        date,
                        metricKey: "steps",
                        unit: "count",
                        value: (index + 1) * 1_000,
                      },
                      occurredAt: `${date}T00:00:00.000Z`,
                      recordKey: date,
                    })),
                  },
                  {
                    dataStatus: "available",
                    grantStatus: "granted",
                    projectionScope: { projectionKind: "workouts.v0" },
                    projectionScopeKey: "workouts.v0",
                    records: [
                      newsletterWorkoutsRecord("2026-07-04", [
                        { kind: "running", minutes: 20, startLocalMs: 1_000 },
                        { kind: "running", minutes: 40, startLocalMs: 2_000 },
                        { kind: "strength", minutes: 45, startLocalMs: 3_000 },
                      ]),
                      newsletterWorkoutsRecord("2026-07-06", [
                        { kind: "running", minutes: 30, startLocalMs: 4_000 },
                      ]),
                      newsletterWorkoutsRecord("2026-07-07", [
                        { kind: "running", minutes: 300, startLocalMs: 5_000 },
                      ]),
                    ],
                  },
                ],
              },
              {
                currentTurnHandles: [],
                displayName: "Opted out",
                memberId: "member_opted_out",
                participantId: "participant_opted_out",
                projections: [{
                  dataStatus: "available",
                  grantStatus: "granted",
                  projectionScope: { projectionKind: "workouts.v0" },
                  projectionScopeKey: "workouts.v0",
                  records: [newsletterWorkoutsRecord("2026-07-06", [{
                    kind: "running",
                    minutes: 500,
                    startLocalMs: 6_000,
                  }])],
                }],
              },
              {
                currentTurnHandles: [],
                displayName: "No current data",
                memberId: "member_stale_grant",
                participantId: "participant_stale_grant",
                projections: [
                  {
                    dataStatus: "missing",
                    grantStatus: "granted",
                    projectionScope: { projectionKind: "steps-days.v0" },
                    projectionScopeKey: "steps-days.v0",
                    records: [],
                  },
                  {
                    dataStatus: "available",
                    grantStatus: "granted",
                    projectionScope: { projectionKind: "workouts.v0" },
                    projectionScopeKey: "workouts.v0",
                    records: [newsletterWorkoutsRecord("2026-07-06", [{
                      kind: "running",
                      minutes: 600,
                      startLocalMs: 7_000,
                    }])],
                  },
                ],
              },
            ],
            requestedProjectionScopeKeys: ["steps-days.v0", "workouts.v0"],
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
            weeklyStats: [
              {
                completedDaysAvg: 4_000,
                observedDayCount: 7,
                observedDates: [
                  "2026-06-30",
                  "2026-07-01",
                  "2026-07-02",
                  "2026-07-03",
                  "2026-07-04",
                  "2026-07-05",
                  "2026-07-06",
                ],
                stream: "steps",
                throughDate: "2026-07-06",
                unit: "count",
              },
              {
                completedDaysAvg: 1.5,
                observedDayCount: 2,
                observedDates: ["2026-07-04", "2026-07-06"],
                stream: "workout-kind-running-count",
                throughDate: "2026-07-06",
                unit: "count",
              },
              {
                completedDaysAvg: 45,
                observedDayCount: 2,
                observedDates: ["2026-07-04", "2026-07-06"],
                stream: "workout-kind-running-minutes",
                throughDate: "2026-07-06",
                unit: "minutes",
              },
              {
                completedDaysAvg: 1,
                observedDayCount: 1,
                observedDates: ["2026-07-04"],
                stream: "workout-kind-strength-count",
                throughDate: "2026-07-04",
                unit: "count",
              },
              {
                completedDaysAvg: 45,
                observedDayCount: 1,
                observedDates: ["2026-07-04"],
                stream: "workout-kind-strength-minutes",
                throughDate: "2026-07-04",
                unit: "minutes",
              },
            ],
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
      const serialized = JSON.stringify(readNewsletterToolPayload(result));
      expect(serialized).not.toContain("startLocalMs");
      expect(serialized).not.toContain("calendarClosedThroughDate");
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
  currentHostedDeliveryContext?:
    AssistantHostedToolContext["currentHostedDeliveryContext"];
  currentInvocationScope?: AssistantHostedToolContext["currentInvocationScope"];
  currentUserActionScope?: AssistantHostedToolContext["currentUserActionScope"];
  directAttachmentRouteStatus?: NonNullable<
    AssistantHostedToolContext["groupTool"]
  >["directAttachmentRouteStatus"];
  groupPermissionOfferRequest?: GroupPermissionOfferRequest;
  groupSharedReadRequest?: GroupSharedReadRequest;
  groupRequest?: GroupToolRequest;
  groupToolAvailable?: boolean;
  privateImageUrlPublish?: AssistantHostedPrivateImageUrlPublisher[
    "publishPrivateImageUrl"
  ];
  persistGeneratedImageCapture?: NonNullable<
    AssistantHostedToolContext["persistGeneratedImageCapture"]
  >;
  verifyGeneratedImageDelivery?: NonNullable<
    AssistantHostedToolContext["verifyGeneratedImageDelivery"]
  >;
} = {}): AssistantHostedToolContext {
  const currentUserActionScope = input.currentUserActionScope ?? (() => null);
  const context = {
    connectedApps: null,
    computerToolsAvailable: false,
    currentHostedDeliveryContext:
      input.currentHostedDeliveryContext ?? (() => null),
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
          ...(input.directAttachmentRouteStatus
            ? { directAttachmentRouteStatus: input.directAttachmentRouteStatus }
            : {}),
        },
    newsletterTool: null,
    phoneCalls: null,
    persistGeneratedImageCapture:
      input.persistGeneratedImageCapture ?? (async (write) => await write()),
    privateImageUrlPublisher: input.privateImageUrlPublish
      ? { publishPrivateImageUrl: input.privateImageUrlPublish }
      : null,
    verifyGeneratedImageDelivery: input.verifyGeneratedImageDelivery,
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

function newsletterWorkoutsRecord(
  date: string,
  workouts: Array<{
    kind: string;
    minutes: number;
    startLocalMs: number;
  }>,
) {
  return {
    data: {
      calendarClosedThroughDate: "2026-07-06",
      date,
      timeSemantics: "canonical-event-zone-or-vault-zone.v0" as const,
      workouts,
    },
    occurredAt: `${date}T00:00:00.000Z`,
    recordKey: date,
  };
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
