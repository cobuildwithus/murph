import assert from "node:assert/strict";

import {
  createAssistantOutboxIntent,
  listAssistantCronJobs,
  listAssistantOutboxIntents,
  saveAssistantOutboxIntent,
  type AssistantExecutionContext,
} from "@murphai/assistant-engine";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import type {
  HostedMailboxItem,
} from "@murphai/hosted-execution/runtime-control";
import {
  serializeHostedEmailThreadTarget,
} from "@murphai/runtime-state";
import { describe, expect, it, vi } from "vitest";

import {
  collectHostedAssistantDeliverySideEffects,
} from "../src/hosted-runtime/callbacks.ts";
import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime/platform.ts";
import {
  enqueueHostedSystemMailboxItem,
  prepareHostedSystemMailboxItemForCheckpoint,
  recordHostedSystemMailboxItemAfterCheckpoint,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

const RETRIED_AT_MS = Date.now();
const ACTIVATED_AT = new Date(RETRIED_AT_MS - 10 * 60_000).toISOString();
const REPLIED_AT = new Date(RETRIED_AT_MS - 5 * 60_000).toISOString();
const RETRIED_AT = new Date(RETRIED_AT_MS).toISOString();

describe("hosted system mailbox signup welcome recovery", () => {
  it("suppresses a retained email welcome after direct-email first contact and keeps the onboarding follow-up", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-hosted-system-mailbox-signup-welcome-recovery-",
    );
    const memberId = "member_signup_welcome_recovery";
    const eventId = `member.activated:${memberId}`;
    const memberEmail = "member@example.test";
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId,
      memberChannels: {
        email: true,
        linq: false,
        telegram: false,
      },
      memberId,
      onboardingFollowupEnrollment: true,
      occurredAt: ACTIVATED_AT,
      signupWelcome: {
        route: {
          actorId: null,
          channel: "email",
          delivery: {
            kind: "explicit",
            target: memberEmail,
          },
          identityId: "assistant@example.test",
          threadId: null,
          threadIsDirect: true,
        },
        text: "Welcome to Murph.",
      },
    });
    const sendEmail = vi.fn(async () => {
      throw new Error("A stale signup welcome must not reach email dispatch.");
    });
    const runtime = createRuntime(sendEmail);
    const executionContext: AssistantExecutionContext = {
      hosted: {
        memberId,
        userEnvKeys: [],
      },
    };

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedActivationItem({ eventId, memberId }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const earlierReplyTarget = serializeHostedEmailThreadTarget({
        cc: [],
        lastMessageId: "<message_earlier@example.test>",
        references: [],
        subject: "Earlier conversation",
        to: [memberEmail],
      });
      const earlierReply = await createAssistantOutboxIntent({
        bindingDelivery: {
          kind: "thread",
          target: earlierReplyTarget,
        },
        channel: "email",
        createdAt: REPLIED_AT,
        explicitTarget: earlierReplyTarget,
        identityId: "assistant@example.test",
        message: "Earlier direct-email reply.",
        replyToMessageId: "<message_earlier@example.test>",
        sessionId: "session_earlier_direct_email_reply",
        threadId: "hid_direct_email_thread",
        threadIsDirect: true,
        turnId: "turn_earlier_direct_email_reply",
        turnTrigger: "automation-auto-reply",
        vault: workspace.vaultRoot,
      });
      await saveAssistantOutboxIntent(workspace.vaultRoot, {
        ...earlierReply,
        attemptCount: 1,
        delivery: {
          channel: "email",
          idempotencyKey: earlierReply.deliveryIdempotencyKey,
          messageLength: earlierReply.message.length,
          providerMessageId: "provider_earlier_direct_email_reply",
          providerThreadId: "provider_direct_email_thread",
          sentAt: REPLIED_AT,
          target: earlierReplyTarget,
          targetKind: "thread",
        },
        lastAttemptAt: REPLIED_AT,
        nextAttemptAt: null,
        sentAt: REPLIED_AT,
        status: "sent",
        updatedAt: REPLIED_AT,
      });

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext,
        now: () => RETRIED_AT,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.ok(prepared);
      assert.equal(prepared.status, "processed");

      await expect(collectHostedAssistantDeliverySideEffects({
        includeBackgroundDueIntents: true,
        preferredIntentIds: [],
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual([]);

      const intents = await listAssistantOutboxIntents(workspace.vaultRoot);
      expect(intents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          intentId: earlierReply.intentId,
          status: "sent",
        }),
        expect.objectContaining({
          deliveryIdempotencyKey: `signup-welcome:${memberId}`,
          lastError: expect.objectContaining({
            code: "ASSISTANT_STALE_SIGNUP_WELCOME_SUPPRESSED",
          }),
          status: "abandoned",
        }),
      ]));
      const onboardingFollowupJobs = await listAssistantCronJobs(
        workspace.vaultRoot,
      );
      expect(onboardingFollowupJobs).toEqual([
        expect.objectContaining({
          enabled: true,
          name: "Finite Murph onboarding follow-up",
        }),
      ]);
      expect(sendEmail).not.toHaveBeenCalled();

      await recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      });
      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending)
        .toEqual([]);
      expect(await listAssistantCronJobs(workspace.vaultRoot)).toEqual([
        expect.objectContaining({
          enabled: true,
          jobId: onboardingFollowupJobs[0]?.jobId,
          name: "Finite Murph onboarding follow-up",
        }),
      ]);
    } finally {
      await workspace.cleanup();
    }
  });
});

function createRuntime(
  sendEmail: NonNullable<HostedRuntimePlatform["effectsPort"]["sendEmail"]>,
): Parameters<typeof prepareHostedSystemMailboxItemForCheckpoint>[0]["runtime"] {
  return {
    commitTimeoutMs: null,
    forwardedEnv: {},
    platform: {
      artifactStore: {
        async get() {
          return null;
        },
        async put() {},
      },
      effectsPort: {
        async readRawEmailMessage() {
          return null;
        },
        sendEmail,
      },
    },
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  };
}

function createResolvedActivationItem(input: {
  eventId: string;
  memberId: string;
}): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: ACTIVATED_AT,
    dedupeKey: input.eventId,
    expiresAt: null,
    id: "mailbox_item_signup_welcome_recovery",
    kind: "member.activated",
    lane: "system",
    laneSeq: "1",
    occurredAt: ACTIVATED_AT,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: ACTIVATED_AT,
    userId: input.memberId,
  };

  return {
    item,
    payload: {
      payloadCiphertext: "ciphertext",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      requestId: null,
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "apply-member-activation",
      advanceProgress: true,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route",
    },
  };
}
