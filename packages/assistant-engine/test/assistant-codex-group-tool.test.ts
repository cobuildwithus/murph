import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initializeVault } from "@murphai/core";
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
} from "../src/assistant/execution-context.ts";
import {
  executeMurphDynamicToolRequest,
  MURPH_GROUP_TOOL,
  MURPH_NEWSLETTER_TOOL,
  readMurphDynamicToolRequest,
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

const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46,
  0x00, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
]);

describe("murph.group dynamic tool", () => {
  it("advertises the supported actions", () => {
    expect(MURPH_GROUP_TOOL.inputSchema.properties.action.enum).toEqual([
      "read_current",
      "list_memberships",
      "update_display_name",
      "create_join_link",
      "post_join_offer",
      "read_chat_participants",
      "set_chat_avatar",
      "share_contact_card",
      "revoke_own_email_share",
    ]);
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
    expect(MURPH_GROUP_TOOL.inputSchema.properties.messageTemplate.description)
      .toContain("{{join_url}}");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.messageTemplate.description)
      .toContain("{{share_scope}}");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.messageTemplate.description)
      .toContain("Include {{join_url}} exactly once");
    expect(MURPH_GROUP_TOOL.inputSchema.properties.messageTemplate.description)
      .toContain('Lead with the exact words "Like this message"');
    expect(MURPH_GROUP_TOOL.inputSchema.properties.messageTemplate.description)
      .not.toContain("Lead with reacting to this message");
    expect(MURPH_GROUP_TOOL.description).toContain('action="list_memberships"');
    expect(MURPH_GROUP_TOOL.description).toContain("permission only");
    expect(MURPH_GROUP_TOOL.description)
      .toContain('In a connected group-chat turn, if read_current returns status="none"');
    expect(MURPH_GROUP_TOOL.description)
      .toContain("no hosted group record exists yet");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("continue with create_join_link or post_join_offer");
    expect(MURPH_GROUP_TOOL.description)
      .toContain("instead of claiming that an external workspace-linking step is required");
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
      displayName: "Sunday Sleep Crew",
      messageTemplate:
        "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }))).toEqual({
      kind: "group",
      request: {
        action: "post_join_offer",
        joinOffer: {
          displayName: "Sunday Sleep Crew",
          messageTemplate:
            "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
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
      messageTemplate:
        "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
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
        memberships: [{
          displayName: "Fun-loving runners",
          grantedVaultShareProjectionScopes: [{ projectionKind: "profile-name.v0" as const }],
          kind: "friends",
          memberCount: 7,
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
      messageTemplate:
        "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }));

    expect(request).toEqual({
      kind: "group",
      request: {
        action: "post_join_offer",
        joinOffer: {
          messageTemplate:
            "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
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
      messageTemplate:
        "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
      intro: "Like this to join.",
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      displayName: "   ",
      messageTemplate:
        "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      displayName: "a".repeat(121),
      messageTemplate:
        "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      messageTemplate:
        "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
      projectionScopes: [{ projectionKind: "all-health-data" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      messageTemplate: "React here to join. Details: {{join_url}}.",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      messageTemplate:
        "React to this message to join. This shares {{share_scope}} with the group.",
      projectionScopes: [
        { projectionKind: "group-email.v0" },
        { projectionKind: "sleep-times.v0" },
        { projectionKind: "activity-days.v0" },
        { projectionKind: "workout-days.v0" },
        { projectionKind: "resting-heart-rate-days.v0" },
        { projectionKind: "hrv-days.v0" },
      ],
    }))?.kind).toBe("invalid-group-arguments");

    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "post_join_offer",
      messageTemplate:
        "React to join. This shares {{share_scope}}. Details: {{join_url}} and {{join_url}}.",
      projectionScopes: [{ projectionKind: "sleep-times.v0" }],
    }))?.kind).toBe("invalid-group-arguments");
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

  it("parses read and send requests without accepting model-supplied addresses", () => {
    expect(readMurphDynamicToolRequest(newsletterToolCall({
      action: "prepare",
      groupId: "group_1",
    }))).toEqual({
      kind: "newsletter",
      request: {
        action: "prepare",
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

  it("prepares recipient eligibility and an empty member set without a local projection", async () => {
    vi.useFakeTimers();
    try {
      const hostedToolContext = createNewsletterHostedToolContext();
      const request = readMurphDynamicToolRequest(newsletterToolCall({
        action: "prepare",
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
          groupId: "group_1",
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
        groupId: request.groupId,
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
      groupId: "group_1",
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
        groupId: "group_1",
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

  it("returns an empty member set when the shared projection store is empty", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-newsletter-stats-missing-"));
    try {
      const hostedToolContext = createNewsletterHostedToolContext();
      const request = readMurphDynamicToolRequest(newsletterToolCall({
        action: "prepare",
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
      expect(readNewsletterToolPayload(result)).toEqual({
        action: "prepare",
        result: {
          groupId: "group_1",
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

  it("returns shared facts only for exact current member, scope, and share grants", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-newsletter-eligible-"));
    try {
      await initializeVault({ timezone: "UTC", vaultRoot });
      await mkdir(join(vaultRoot, "derived", "vault-share"), { recursive: true });
      await writeFile(
        join(vaultRoot, "derived", "vault-share", "projections.json"),
        JSON.stringify({
          projections: {
            "steps-days.v0": {
              grantors: {
                member_a: sharedDailyMetricGrantor({
                  memberId: "member_a",
                  staleRecordShareId: "share-member_a-revoked",
                  staleRecordValue: 50_000,
                  value: 7_000,
                }),
                member_opted_out: sharedDailyMetricGrantor({
                  memberId: "member_opted_out",
                  value: 20_000,
                }),
                member_stale_grant: sharedDailyMetricGrantor({
                  memberId: "member_stale_grant",
                  value: 30_000,
                }),
              },
            },
            "resting-heart-rate-days.v0": {
              grantors: {
                member_a: sharedDailyMetricGrantor({
                  memberId: "member_a",
                  metricKey: "resting-heart-rate",
                  projectionKind: "resting-heart-rate-days.v0",
                  shareId: "share-member_a",
                  unit: "bpm",
                  value: 45,
                }),
              },
            },
          },
          schema: "murph.shared-vault-projections.v1",
          updatedAt: "2026-07-06T12:00:00.000Z",
        }),
        "utf8",
      );
      const newsletterRequest = vi.fn<NewsletterToolRequest>(async () => ({
        action: "prepare",
        result: {
          authorizationProof: NEWSLETTER_AUTHORIZATION_PROOF,
          groupId: "group_1",
          missingEmailParticipants: [
            {
              authorizedShares: [],
              hasEmail: false,
              memberId: "member_opted_out",
            },
          ],
          participants: [
            {
              authorizedShares: [
                {
                  projectionScopeKey: "steps-days.v0",
                  shareId: "share-member_a",
                },
              ],
              hasEmail: true,
              memberId: "member_a",
            },
            {
              authorizedShares: [],
              hasEmail: false,
              memberId: "member_opted_out",
            },
            {
              authorizedShares: [
                {
                  projectionScopeKey: "steps-days.v0",
                  shareId: "share-current-replacement",
                },
              ],
              hasEmail: true,
              memberId: "member_stale_grant",
            },
          ],
          status: "ok",
        },
      }));
      const request = readMurphDynamicToolRequest(newsletterToolCall({
        action: "prepare",
        groupId: "group_1",
      }));
      if (!request || request.kind !== "newsletter") {
        throw new Error("Expected newsletter request.");
      }

      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext: createNewsletterHostedToolContext({ newsletterRequest }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(readNewsletterToolPayload(result)).toEqual({
        action: "prepare",
        result: {
          groupId: "group_1",
          members: [
            {
              displayName: null,
              memberId: "member_a",
              weeklyStats: [
                {
                  currentWeekAvg: 7_000,
                  stream: "steps",
                  unit: "count",
                },
              ],
            },
          ],
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
      expect(newsletterRequest).toHaveBeenCalledWith({
        action: "prepare",
        groupId: "group_1",
        includeAuthorizationProof: true,
        includeAuthorizationSnapshot: true,
        scheduledAutomationAuthority: {
          automationId: "automation_newsletter",
          occurrenceAt: "2026-07-06T03:30:00.000Z",
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
      visibleParticipants: [{ hasEmail: true, memberId: "member_a" }],
    },
    {
      finalParticipants: [],
      revokeKind: "email grant",
      visibleParticipants: [],
    },
    {
      finalParticipants: [],
      revokeKind: "member access",
      visibleParticipants: [],
    },
    {
      finalParticipants: [
        {
          authorizedShares: [
            {
              projectionScopeKey: "steps-days.v0",
              shareId: "share-member_a",
            },
          ],
          hasEmail: false,
          memberId: "member_a",
        },
      ],
      revokeKind: "verified email",
      visibleParticipants: [{ hasEmail: false, memberId: "member_a" }],
    },
  ])("loads stale projection data before the final $revokeKind authority result", async ({
    finalParticipants,
    visibleParticipants,
  }) => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-newsletter-revoke-race-"));
    const projectionPath = join(vaultRoot, "derived", "vault-share", "projections.json");
    try {
      await initializeVault({ timezone: "UTC", vaultRoot });
      await mkdir(join(vaultRoot, "derived", "vault-share"), { recursive: true });
      await writeFile(projectionPath, JSON.stringify({
        projections: {
          "steps-days.v0": {
            grantors: {
              member_a: sharedDailyMetricGrantor({
                memberId: "member_a",
                shareId: "share-member_a",
                value: 7_000,
              }),
            },
          },
        },
        schema: "murph.shared-vault-projections.v1",
        updatedAt: "2026-07-06T12:00:00.000Z",
      }), "utf8");
      const newsletterRequest = vi.fn<NewsletterToolRequest>(async () => {
        // Canonical revocation wins before model handoff even though asynchronous
        // projection cleanup has not repaired the already-loaded local source.
        await writeFile(projectionPath, "{ stale projection cleanup pending", "utf8");
        return {
          action: "prepare",
          result: {
            authorizationProof: NEWSLETTER_AUTHORIZATION_PROOF,
            groupId: "group_1",
            missingEmailParticipants: [],
            participants: finalParticipants,
            status: "ok",
          },
        };
      });
      const request = readMurphDynamicToolRequest(newsletterToolCall({
        action: "prepare",
        groupId: "group_1",
      }));
      if (!request || request.kind !== "newsletter") {
        throw new Error("Expected newsletter request.");
      }

      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext: createNewsletterHostedToolContext({ newsletterRequest }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request,
        vaultRoot,
      });

      expect(result.rpcResult.success).toBe(true);
      expect(readNewsletterToolPayload(result)).toEqual({
        action: "prepare",
        result: {
          groupId: "group_1",
          members: [],
          missingEmailParticipants: [],
          participants: visibleParticipants,
          referenceAt: "2026-07-06T03:30:00.000Z",
          status: "ok",
        },
      });
      expect(newsletterRequest).toHaveBeenCalledTimes(1);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("blocks prepare and send when shared projections are corrupt", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "assistant-codex-newsletter-stats-corrupt-"));
    try {
      await mkdir(join(vaultRoot, "derived", "vault-share"), { recursive: true });
      await writeFile(
        join(vaultRoot, "derived", "vault-share", "projections.json"),
        "{ not valid json",
        "utf8",
      );
      const newsletterRequest = vi.fn<NewsletterToolRequest>(async (request) =>
        request.action === "prepare"
          ? {
              action: "prepare" as const,
              result: {
                authorizationProof: NEWSLETTER_AUTHORIZATION_PROOF,
                groupId: request.groupId,
                missingEmailParticipants: [],
                participants: [
                  {
                    authorizedShares: [],
                    hasEmail: true,
                    memberId: "member_a",
                  },
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
        action: "prepare",
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
        action: "prepare",
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
      expect(newsletterRequest).not.toHaveBeenCalled();
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
              action: "prepare",
              result: {
                authorizationProof: NEWSLETTER_AUTHORIZATION_PROOF,
                groupId: request.groupId,
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
  closeNewsletterCapability?: () => void;
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
    currentPhoneCallToolRequestKeyScope: () => null,
    currentScheduledAutomationAuthority: () => ({
      automationId: "automation_newsletter",
      occurrenceAt: "2026-07-06T03:30:00.000Z",
    }),
    familyPlanTool: null,
    groupTool: null,
    newsletterTool: {
      request: input.newsletterRequest ?? (async (request) =>
        request.action === "prepare"
          ? {
              action: "prepare",
              result: {
                authorizationProof: NEWSLETTER_AUTHORIZATION_PROOF,
                groupId: request.groupId,
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

function sharedDailyMetricGrantor(input: {
  memberId: string;
  metricKey?: string;
  projectionKind?: string;
  shareId?: string;
  staleRecordShareId?: string;
  staleRecordValue?: number;
  unit?: string;
  value: number;
}) {
  const projectionKind = input.projectionKind ?? "steps-days.v0";
  const shareId = input.shareId ?? `share-${input.memberId}`;
  return {
    grantorMemberId: input.memberId,
    projectionKind,
    records: [
      ...(
        input.staleRecordShareId !== undefined
        && input.staleRecordValue !== undefined
          ? [{
              receivedEventId: `event-stale-${input.memberId}`,
              record: {
                data: {
                  date: "2026-07-06",
                  metricKey: input.metricKey ?? "steps",
                  unit: input.unit ?? "count",
                  value: input.staleRecordValue,
                },
                occurredAt: "2026-07-06T00:00:00.000Z",
                recordKey: "2026-07-06",
              },
              schema: "murph.vault-share.delivery.v1",
              shareId: input.staleRecordShareId,
            }]
          : []
      ),
      {
        receivedEventId: `event-${input.memberId}`,
        record: {
          data: {
            date: "2026-07-06",
            metricKey: input.metricKey ?? "steps",
            unit: input.unit ?? "count",
            value: input.value,
          },
          occurredAt: "2026-07-06T00:00:00.000Z",
          recordKey: "2026-07-06",
        },
        schema: "murph.vault-share.delivery.v1",
        shareId,
      },
    ],
    shareId,
    updatedAt: "2026-07-06T12:00:00.000Z",
  };
}

function createGroupHostedToolContext(input: {
  groupRequest?: GroupToolRequest;
} = {}): AssistantHostedToolContext {
  const context = {
    connectedApps: null,
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentPhoneCallToolRequestKeyScope: () => null,
    currentScheduledAutomationAuthority: () => null,
    familyPlanTool: null,
    groupTool: {
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
