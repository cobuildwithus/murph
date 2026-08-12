import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import {
  createAssistantOutboxIntent,
  deliverAssistantOutboxReaction,
  listAssistantOutboxIntents,
  readAssistantOutboxIntent,
} from "@murphai/assistant-engine/assistant-outbox";
import {
  buildHostedExecutionRuntimeTimerWake,
} from "@murphai/hosted-execution";
import {
  buildHostedAssistantDeliveryEffect,
  type HostedAssistantDeliveryMedia,
} from "@murphai/hosted-execution/side-effects";

import {
  collectHostedAssistantDeliverySideEffects,
  drainHostedPreparedAssistantDeliveries,
  prepareHostedAssistantDeliveryEffectsForDispatch,
  resolveHostedAssistantOutboxNextWakeAt,
} from "../src/hosted-runtime/callbacks.ts";
import type {
  HostedRuntimeActionApprovalPort,
} from "../src/hosted-runtime/platform.ts";
import {
  buildHostedRuntimeResolvedLinqRoute,
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(cleanupTasks.splice(0).map((cleanup) => cleanup()));
});

it("freezes an accepted reaction's exact-consume set across callback retry and replay", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-06T20:00:00.000Z"));
  const fixture = await createHostedLinqReactionFixture();
  const lateMailboxItemId = "mailbox_item_reaction_after_acceptance";
  const pendingMailboxItemIds = new Set([
    fixture.mailboxItemId,
    lateMailboxItemId,
  ]);
  const providerFetch = vi.fn<typeof fetch>(async (request) => {
    const url = String(request);
    if (!url.endsWith(`/messages/${fixture.messageId}/reactions`)) {
      throw new Error(`Unexpected Linq provider request: ${url}`);
    }
    return new Response(JSON.stringify({}), {
      headers: { "Content-Type": "application/json" },
    });
  });
  const assertRecentInboundEngagement = vi.fn(async (request) => ({
    ...(request.authorityCheckOnly === true
      ? {}
      : { providerDispatchClaimed: true }),
    resolvedRoute: buildHostedRuntimeResolvedLinqRoute(request, {
      directRecipientPhoneNumber: null,
      fromPhoneNumber: null,
    }),
  }));
  let confirmationAttempt = 0;
  const recordLinqDeliveryOutcome = vi.fn<
    NonNullable<ReturnType<typeof createHostedRuntimeEffectsPortStub>["recordLinqDeliveryOutcome"]>
  >(async (request) => {
    confirmationAttempt += 1;
    if (confirmationAttempt === 1) {
      throw new Error("Web confirmation unavailable");
    }
    for (const mailboxItemId of request.answeredMailboxItemIds ?? []) {
      pendingMailboxItemIds.delete(mailboxItemId);
    }
  });
  const effectsPort = createHostedRuntimeEffectsPortStub({
    assertLinqRecentInboundEngagement: assertRecentInboundEngagement,
    recordLinqDeliveryOutcome,
  });

  const firstOutcomes = await drainHostedPreparedAssistantDeliveries({
    assistantDeliveryEffects: [fixture.effect],
    effectsPort,
    forwardedEnv: { LINQ_API_TOKEN: "linq-token" },
    linqDeliveryContext: fixture.linqDeliveryContext,
    platformEnv: {},
    providerFetch,
    vaultRoot: fixture.vaultRoot,
    wake: fixture.wake,
  });

  expect(firstOutcomes).toEqual([
    expect.objectContaining({
      deliveryStatus: "retryable",
      effectId: fixture.intent.intentId,
      retryable: true,
    }),
  ]);
  expect(providerFetch).toHaveBeenCalledTimes(1);
  expect(assertRecentInboundEngagement).toHaveBeenCalledTimes(2);
  expect(recordLinqDeliveryOutcome).toHaveBeenCalledTimes(1);
  expect(recordLinqDeliveryOutcome).toHaveBeenCalledWith(
    expect.objectContaining({
      acceptedAt: expect.any(String),
      answeredMailboxItemIds: [fixture.mailboxItemId],
      intentId: fixture.intent.intentId,
    }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );

  const retained = await readAssistantOutboxIntent(
    fixture.vaultRoot,
    fixture.intent.intentId,
  );
  expect(retained).toMatchObject({
    answeredMailboxItemIds: [fixture.mailboxItemId],
    delivery: {
      channel: "linq",
      kind: "message-reaction",
      targetMessageId: fixture.messageId,
    },
    deliveryConfirmationPending: true,
    lastError: { code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING" },
    nextAttemptAt: expect.any(String),
    status: "retryable",
  });
  if (!retained?.nextAttemptAt) {
    throw new Error("Expected the retained reaction confirmation to schedule a retry.");
  }
  expect(await resolveHostedAssistantOutboxNextWakeAt({
    now: new Date(),
    vaultRoot: fixture.vaultRoot,
  })).toBe(retained.nextAttemptAt);

  const widenedReplay = await deliverAssistantOutboxReaction({
    actorId: fixture.intent.actorId,
    answeredMailboxItemIds: [fixture.mailboxItemId, lateMailboxItemId],
    bindingDelivery: fixture.intent.bindingDelivery,
    channel: "linq",
    dedupeToken: "reaction-confirmation",
    dispatchMode: "queue-only",
    identityId: fixture.intent.identityId,
    reaction: "heart",
    sessionId: fixture.intent.sessionId,
    targetMessageId: fixture.messageId,
    threadId: fixture.intent.threadId,
    threadIsDirect: fixture.intent.threadIsDirect,
    turnId: fixture.intent.turnId,
    vault: fixture.vaultRoot,
  });

  expect(widenedReplay.kind).toBe("failed");
  expect(widenedReplay.deliveryError).toMatchObject({
    code: "ASSISTANT_OUTBOX_ANSWERED_ITEMS_UNCOVERED",
    diagnosticContext: { retryable: true },
  });
  expect(widenedReplay.intent).toMatchObject({
    answeredMailboxItemIds: [fixture.mailboxItemId],
    deliveryConfirmationPending: true,
    status: "retryable",
  });
  await expect(readAssistantOutboxIntent(
    fixture.vaultRoot,
    fixture.intent.intentId,
  )).resolves.toMatchObject({
    answeredMailboxItemIds: [fixture.mailboxItemId],
    deliveryConfirmationPending: true,
  });
  expect(providerFetch).toHaveBeenCalledTimes(1);
  expect(assertRecentInboundEngagement).toHaveBeenCalledTimes(2);

  vi.setSystemTime(new Date(retained.nextAttemptAt));
  const retryEffects = await collectHostedAssistantDeliverySideEffects({
    includeBackgroundDueIntents: true,
    vaultRoot: fixture.vaultRoot,
  });
  expect(retryEffects.map((effect) => effect.effectId)).toEqual([
    fixture.intent.intentId,
  ]);

  const retryOutcomes = await drainHostedPreparedAssistantDeliveries({
    assistantDeliveryEffects: retryEffects,
    effectsPort,
    forwardedEnv: { LINQ_API_TOKEN: "linq-token" },
    linqDeliveryContext: fixture.linqDeliveryContext,
    platformEnv: {},
    providerFetch,
    vaultRoot: fixture.vaultRoot,
    wake: fixture.wake,
  });

  expect(retryOutcomes).toEqual([
    expect.objectContaining({
      deliveryStatus: "sent",
      effectId: fixture.intent.intentId,
      retryable: false,
    }),
  ]);
  expect(providerFetch).toHaveBeenCalledTimes(1);
  expect(assertRecentInboundEngagement).toHaveBeenCalledTimes(2);
  expect(recordLinqDeliveryOutcome).toHaveBeenCalledTimes(2);
  expect([...pendingMailboxItemIds]).toEqual([lateMailboxItemId]);
  await expect(readAssistantOutboxIntent(
    fixture.vaultRoot,
    fixture.intent.intentId,
  )).resolves.toMatchObject({
    deliveryConfirmationPending: false,
    status: "sent",
  });

  const lateIntent = await createAssistantOutboxIntent({
    actorId: fixture.intent.actorId,
    answeredMailboxItemIds: [lateMailboxItemId],
    bindingDelivery: fixture.intent.bindingDelivery,
    channel: "linq",
    dedupeToken: "reaction-after-acceptance",
    identityId: fixture.intent.identityId,
    message: "",
    operation: { kind: "message-reaction", reaction: "laugh" },
    replyToMessageId: fixture.messageId,
    sessionId: fixture.intent.sessionId,
    threadId: fixture.intent.threadId,
    threadIsDirect: fixture.intent.threadIsDirect,
    turnId: "turn_reaction_after_acceptance",
    vault: fixture.vaultRoot,
  });
  const lateEffect = buildHostedAssistantDeliveryEffect({
    dedupeKey: lateIntent.dedupeKey,
    deliveryPhase: "background_retry",
    effectId: lateIntent.intentId,
    payload: {
      actorId: lateIntent.actorId,
      answeredMailboxItemIds: lateIntent.answeredMailboxItemIds,
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: fixture.linqDeliveryContext.target,
      channel: "linq",
      deliverySourceKey: null,
      explicitTarget: null,
      idempotencyKey:
        lateIntent.deliveryIdempotencyKey
          ?? `assistant-outbox:${lateIntent.intentId}`,
      identityId: lateIntent.identityId,
      media: [],
      message: "",
      replyToMessageId: fixture.messageId,
      sessionId: lateIntent.sessionId,
      subject: null,
      threadId: lateIntent.threadId,
      threadIsDirect: true,
      transportIdempotent: lateIntent.deliveryTransportIdempotent,
      turnId: lateIntent.turnId,
    },
  });

  const lateOutcomes = await drainHostedPreparedAssistantDeliveries({
    assistantDeliveryEffects: [lateEffect],
    effectsPort,
    forwardedEnv: { LINQ_API_TOKEN: "linq-token" },
    linqDeliveryContext: fixture.linqDeliveryContext,
    platformEnv: {},
    providerFetch,
    vaultRoot: fixture.vaultRoot,
    wake: fixture.wake,
  });

  expect(lateOutcomes).toEqual([
    expect.objectContaining({
      deliveryStatus: "sent",
      effectId: lateIntent.intentId,
      retryable: false,
    }),
  ]);
  expect(providerFetch).toHaveBeenCalledTimes(2);
  expect(assertRecentInboundEngagement).toHaveBeenCalledTimes(4);
  expect(recordLinqDeliveryOutcome).toHaveBeenCalledTimes(3);
  expect([...pendingMailboxItemIds]).toEqual([]);
});

it.each([
  {
    homeRoute: null,
    key: "provider-skipped",
    label: "existing-thread private image",
    target: "linq_chat_hosted_provider_skipped",
  },
  {
    homeRoute: {
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550000",
    },
    key: "redacted-direct-provider-skipped",
    label: "redacted direct-materialization private image",
    target: "h1_222222222222222222222222",
  },
] as const)("defers a real hosted Linq $label before provider entry and later sends the same outbox intent", async ({
  homeRoute,
  key,
  target,
}) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-06T20:00:00.000Z"));
  const fixture = await createHostedLinqAttachmentFixture({
    ...(homeRoute ? { homeRoute } : {}),
    key,
    target,
  });
  const providerMessageId = `linq_${key}_sent`;
  const providerFetch = vi.fn<typeof fetch>(async (request) => {
    const url = String(request);
    if (url.endsWith("/attachments")) {
      return new Response(JSON.stringify({
        attachment_id: `attachment_${key}`,
        expires_at: "2026-08-06T21:00:00.000Z",
        http_method: "PUT",
        required_headers: {
          "content-type": "image/png",
        },
        upload_url: `https://uploads.example.test/private/${key}`,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (homeRoute && url.endsWith("/chats")) {
      return new Response(JSON.stringify({
        chat: {
          id: `materialized_${key}`,
          message: { id: providerMessageId },
        },
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!homeRoute && url.endsWith(`/chats/${fixture.target}/messages`)) {
      return new Response(JSON.stringify({
        message: { id: providerMessageId },
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected Linq provider request: ${url}`);
  });
  const publicInternetFetch = vi.fn<typeof fetch>(async () =>
    new Response(null, { status: 204 }));
  const drainInput = buildHostedLinqDrainInput({
    fixture,
    providerFetch,
    publicInternetFetch,
  });
  const reservationCalls = () => providerFetch.mock.calls.filter(([request]) =>
    String(request).endsWith("/attachments")
  );
  const messageCalls = () => providerFetch.mock.calls.filter(([request]) =>
    String(request).endsWith(
      homeRoute ? "/chats" : `/chats/${fixture.target}/messages`,
    )
  );
  expect(fixture.intent.deliveryTransportIdempotent).toBe(true);
  const firstPreparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
    assistantDeliveryEffects: [fixture.effect],
    linqDeliveryContext: fixture.linqDeliveryContext,
    now: () => "2026-08-06T20:00:00.000Z",
    vaultRoot: fixture.vaultRoot,
  });
  expect(firstPreparation.preparedDispatches).toHaveLength(1);
  const onBackgroundDeliveryYield = vi.fn();
  let yieldChecks = 0;

  const deferredOutcomes = await drainHostedPreparedAssistantDeliveries({
    ...drainInput,
    allowPreparedSending: true,
    onBackgroundDeliveryYield,
    preparedDispatches: firstPreparation.preparedDispatches,
    shouldYieldBackgroundDelivery: () => {
      yieldChecks += 1;
      return yieldChecks === 3;
    },
  });

  expect(deferredOutcomes).toEqual([]);
  expect(onBackgroundDeliveryYield).toHaveBeenCalledWith({
    yieldedEffectCount: 1,
  });
  expect(reservationCalls()).toHaveLength(0);
  expect(messageCalls()).toHaveLength(0);
  expect(publicInternetFetch).not.toHaveBeenCalled();
  await expect(readAssistantOutboxIntent(
    fixture.vaultRoot,
    fixture.intent.intentId,
  )).resolves.toMatchObject({
    intentId: fixture.intent.intentId,
    lastError: null,
    preparedDispatchToken: null,
    status: "pending",
  });
  await expect(listAssistantOutboxIntents(fixture.vaultRoot)).resolves.toEqual([
    expect.objectContaining({ intentId: fixture.intent.intentId }),
  ]);

  vi.setSystemTime(new Date("2026-08-06T20:00:31.000Z"));
  const secondPreparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
    assistantDeliveryEffects: [fixture.effect],
    linqDeliveryContext: fixture.linqDeliveryContext,
    now: () => "2026-08-06T20:00:31.000Z",
    vaultRoot: fixture.vaultRoot,
  });
  expect(secondPreparation.preparedDispatches).toHaveLength(1);
  const sentOutcomes = await drainHostedPreparedAssistantDeliveries({
    ...drainInput,
    allowPreparedSending: true,
    preparedDispatches: secondPreparation.preparedDispatches,
    shouldYieldBackgroundDelivery: () => false,
  });

  expect(sentOutcomes).toEqual([
    expect.objectContaining({
      deliveryStatus: "sent",
      effectId: fixture.intent.intentId,
      providerMessageId,
      retryable: false,
    }),
  ]);
  expect(reservationCalls()).toHaveLength(1);
  expect(messageCalls()).toHaveLength(1);
  expect(publicInternetFetch).toHaveBeenCalledTimes(1);
  await expect(listAssistantOutboxIntents(fixture.vaultRoot)).resolves.toEqual([
    expect.objectContaining({
      intentId: fixture.intent.intentId,
      status: "sent",
    }),
  ]);
});

it("terminalizes a two-image hosted Linq delivery when a later reservation yields after provider entry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-06T20:00:00.000Z"));
  const fixture = await createHostedLinqAttachmentFixture({
    imageCount: 2,
    key: "cumulative-provider-entry",
    target: "linq_chat_hosted_cumulative_provider_entry",
  });
  let reservationIndex = 0;
  const providerFetch = vi.fn<typeof fetch>(async (request) => {
    const url = String(request);
    if (url.endsWith("/attachments")) {
      reservationIndex += 1;
      return new Response(JSON.stringify({
        attachment_id: `attachment_cumulative_provider_entry_${reservationIndex}`,
        expires_at: "2026-08-06T21:00:00.000Z",
        http_method: "PUT",
        required_headers: {
          "content-type": "image/png",
        },
        upload_url:
          `https://uploads.example.test/private/cumulative-provider-entry-${reservationIndex}`,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected Linq provider request: ${url}`);
  });
  const publicInternetFetch = vi.fn<typeof fetch>(async () =>
    new Response(null, { status: 204 }));
  const drainInput = buildHostedLinqDrainInput({
    fixture,
    providerFetch,
    publicInternetFetch,
  });
  const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
    assistantDeliveryEffects: [fixture.effect],
    linqDeliveryContext: fixture.linqDeliveryContext,
    now: () => "2026-08-06T20:00:00.000Z",
    vaultRoot: fixture.vaultRoot,
  });
  expect(preparation.preparedDispatches).toHaveLength(1);
  const onBackgroundDeliveryYield = vi.fn();
  let laterReservationYieldRequested = false;

  const outcomes = await drainHostedPreparedAssistantDeliveries({
    ...drainInput,
    allowPreparedSending: true,
    onBackgroundDeliveryYield,
    preparedDispatches: preparation.preparedDispatches,
    shouldYieldBackgroundDelivery: () => {
      const reservationCallCount = providerFetch.mock.calls.filter(([request]) =>
        String(request).endsWith("/attachments")
      ).length;
      const shouldYield = !laterReservationYieldRequested
        && reservationCallCount === 1
        && publicInternetFetch.mock.calls.length === 1;
      laterReservationYieldRequested ||= shouldYield;
      return shouldYield;
    },
  });

  expect(outcomes).toEqual([
    expect.objectContaining({
      deliveryErrorCode: "ASSISTANT_DELIVERY_AMBIGUOUS",
      deliveryStatus: "failed_ambiguous",
      effectId: fixture.intent.intentId,
      retryable: false,
    }),
  ]);
  expect(laterReservationYieldRequested).toBe(true);
  expect(onBackgroundDeliveryYield).not.toHaveBeenCalled();
  expect(providerFetch.mock.calls.filter(([request]) =>
    String(request).endsWith("/attachments")
  )).toHaveLength(1);
  expect(providerFetch.mock.calls.filter(([request]) =>
    String(request).endsWith(`/chats/${fixture.target}/messages`)
  )).toHaveLength(0);
  expect(publicInternetFetch).toHaveBeenCalledTimes(1);
  await expect(readAssistantOutboxIntent(
    fixture.vaultRoot,
    fixture.intent.intentId,
  )).resolves.toMatchObject({
    intentId: fixture.intent.intentId,
    nextAttemptAt: null,
    status: "abandoned",
  });

  vi.setSystemTime(new Date("2026-08-06T20:11:00.000Z"));
  const laterOutcomes = await drainHostedPreparedAssistantDeliveries({
    ...drainInput,
    shouldYieldBackgroundDelivery: () => false,
    wake: buildHostedExecutionRuntimeTimerWake({
      eventId: "evt_hosted_cumulative_provider_entry_later",
      occurredAt: "2026-08-06T20:11:00.000Z",
      triggerKind: "runtime_timer",
      userId: "member_hosted_cumulative_provider_entry",
    }),
  });

  expect(laterOutcomes).toEqual([
    expect.objectContaining({
      deliveryErrorCode: "ASSISTANT_DELIVERY_AMBIGUOUS",
      deliveryStatus: "failed_ambiguous",
      effectId: fixture.intent.intentId,
      retryable: false,
    }),
  ]);
  expect(providerFetch.mock.calls.filter(([request]) =>
    String(request).endsWith("/attachments")
  )).toHaveLength(1);
  expect(providerFetch.mock.calls.filter(([request]) =>
    String(request).endsWith(`/chats/${fixture.target}/messages`)
  )).toHaveLength(0);
  expect(publicInternetFetch).toHaveBeenCalledTimes(1);
  await expect(listAssistantOutboxIntents(fixture.vaultRoot)).resolves.toEqual([
    expect.objectContaining({
      intentId: fixture.intent.intentId,
      status: "abandoned",
    }),
  ]);
});

it.each([
  {
    homeRoute: null,
    key: "post-upload-vault_image",
    label: "private image",
    mediaKind: "vault_image",
    target: "linq_chat_hosted_post-upload-vault_image",
  },
  {
    homeRoute: null,
    key: "post-upload-vault_file",
    label: "private file",
    mediaKind: "vault_file",
    target: "linq_chat_hosted_post-upload-vault_file",
  },
  {
    homeRoute: {
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550000",
    },
    key: "redacted-direct-post-upload",
    label: "redacted direct-materialization private image",
    mediaKind: "vault_image",
    target: "h1_111111111111111111111111",
  },
] as const)("terminalizes a hosted Linq $label delivery when foreground input arrives after upload but before the message send", async ({
  homeRoute,
  key,
  mediaKind,
  target,
}) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-06T20:00:00.000Z"));
  const fixture = await createHostedLinqAttachmentFixture({
    ...(homeRoute ? { homeRoute } : {}),
    key,
    mediaKind,
    target,
  });
  const providerFetch = vi.fn<typeof fetch>(async (request) => {
    const url = String(request);
    if (url.endsWith("/attachments")) {
      return new Response(JSON.stringify({
        attachment_id: `attachment_${key}`,
        expires_at: "2026-08-06T21:00:00.000Z",
        http_method: "PUT",
        required_headers: {
          "content-type": mediaKind === "vault_file"
            ? "application/pdf"
            : "image/png",
        },
        upload_url: `https://uploads.example.test/private/${key}`,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected Linq provider request: ${url}`);
  });
  const publicInternetFetch = vi.fn<typeof fetch>(async () =>
    new Response(null, { status: 204 }));
  const drainInput = buildHostedLinqDrainInput({
    fixture,
    providerFetch,
    publicInternetFetch,
  });
  const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
    assistantDeliveryEffects: [fixture.effect],
    linqDeliveryContext: fixture.linqDeliveryContext,
    now: () => "2026-08-06T20:00:00.000Z",
    vaultRoot: fixture.vaultRoot,
  });
  expect(preparation.preparedDispatches).toHaveLength(
    mediaKind === "vault_image" ? 1 : 0,
  );
  if (homeRoute) {
    expect(fixture.intent).toMatchObject({
      actorId: homeRoute.directRecipientPhoneNumber,
      bindingDelivery: { kind: "thread", target },
      deliverySource: {
        fromPhoneNumber: homeRoute.fromPhoneNumber,
        kind: "linq",
      },
      explicitTarget: null,
    });
  }
  const onBackgroundDeliveryYield = vi.fn();
  let postUploadYieldRequested = false;

  const outcomes = await drainHostedPreparedAssistantDeliveries({
    ...drainInput,
    allowPreparedSending: preparation.preparedDispatches.length > 0,
    onBackgroundDeliveryYield,
    preparedDispatches: preparation.preparedDispatches,
    shouldYieldBackgroundDelivery: () => {
      const reservationCallCount = providerFetch.mock.calls.filter(([request]) =>
        String(request).endsWith("/attachments")
      ).length;
      const shouldYield = !postUploadYieldRequested
        && reservationCallCount === 1
        && publicInternetFetch.mock.calls.length === 1;
      postUploadYieldRequested ||= shouldYield;
      return shouldYield;
    },
  });

  expect(outcomes).toEqual([
    expect.objectContaining({
      deliveryErrorCode: "ASSISTANT_DELIVERY_AMBIGUOUS",
      deliveryStatus: "failed_ambiguous",
      effectId: fixture.intent.intentId,
      retryable: false,
    }),
  ]);
  expect(postUploadYieldRequested).toBe(true);
  expect(onBackgroundDeliveryYield).not.toHaveBeenCalled();
  expect(providerFetch.mock.calls.filter(([request]) =>
    String(request).endsWith("/attachments")
  )).toHaveLength(1);
  expect(providerFetch.mock.calls.filter(([request]) =>
    String(request).endsWith(
      homeRoute ? "/chats" : `/chats/${fixture.target}/messages`,
    )
  )).toHaveLength(0);
  expect(publicInternetFetch).toHaveBeenCalledTimes(1);
  await expect(readAssistantOutboxIntent(
    fixture.vaultRoot,
    fixture.intent.intentId,
  )).resolves.toMatchObject({
    intentId: fixture.intent.intentId,
    lastError: { code: "ASSISTANT_DELIVERY_AMBIGUOUS" },
    nextAttemptAt: null,
    status: "abandoned",
  });

  vi.setSystemTime(new Date("2026-08-06T20:11:00.000Z"));
  const laterOutcomes = await drainHostedPreparedAssistantDeliveries({
    ...drainInput,
    shouldYieldBackgroundDelivery: () => false,
    wake: buildHostedExecutionRuntimeTimerWake({
      eventId: `evt_hosted_${key}_later`,
      occurredAt: "2026-08-06T20:11:00.000Z",
      triggerKind: "runtime_timer",
      userId: `member_${key}`,
    }),
  });

  expect(laterOutcomes).toEqual([
    expect.objectContaining({
      deliveryErrorCode: "ASSISTANT_DELIVERY_AMBIGUOUS",
      deliveryStatus: "failed_ambiguous",
      effectId: fixture.intent.intentId,
      retryable: false,
    }),
  ]);
  expect(providerFetch.mock.calls.filter(([request]) =>
    String(request).endsWith("/attachments")
  )).toHaveLength(1);
  expect(providerFetch.mock.calls.filter(([request]) =>
    String(request).endsWith(
      homeRoute ? "/chats" : `/chats/${fixture.target}/messages`,
    )
  )).toHaveLength(0);
  expect(publicInternetFetch).toHaveBeenCalledTimes(1);
  await expect(listAssistantOutboxIntents(fixture.vaultRoot)).resolves.toEqual([
    expect.objectContaining({
      intentId: fixture.intent.intentId,
      status: "abandoned",
    }),
  ]);
  if (mediaKind === "vault_file") {
    expect(fixture.actionApprovalPort?.consume).toHaveBeenCalledTimes(1);
  }
});

it.each([
  {
    key: "missing-fields",
    label: "missing required fields",
    payload: {
      attachment_id: "attachment_missing_upload_url",
      expires_at: "2026-08-06T21:00:00.000Z",
      http_method: "PUT",
      required_headers: {
        "content-type": "image/png",
      },
    },
  },
  {
    key: "unsupported-method",
    label: "an unsupported upload method",
    payload: {
      attachment_id: "attachment_unsupported_method",
      expires_at: "2026-08-06T21:00:00.000Z",
      http_method: "POST",
      required_headers: {
        "content-type": "image/png",
      },
      upload_url: "https://uploads.example.test/private/unsupported-method",
    },
  },
  {
    key: "empty-headers",
    label: "empty required headers",
    payload: {
      attachment_id: "attachment_empty_headers",
      expires_at: "2026-08-06T21:00:00.000Z",
      http_method: "PUT",
      required_headers: {},
      upload_url: "https://uploads.example.test/private/empty-headers",
    },
  },
  {
    key: "malformed-json",
    label: "malformed JSON",
    payload: null,
    responseBody: '{"attachment_id":',
  },
])("terminalizes a real hosted Linq 2xx reservation with $label", async ({
  key,
  payload,
  responseBody,
}) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-06T20:00:00.000Z"));
  const fixture = await createHostedLinqAttachmentFixture({
    key,
    target: "linq_chat_hosted_unusable_reservation",
  });
  const providerFetch = vi.fn<typeof fetch>(async (request) => {
    const url = String(request);
    if (!url.endsWith("/attachments")) {
      throw new Error(`Unexpected Linq provider request: ${url}`);
    }
    return new Response(responseBody ?? JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  });
  const publicInternetFetch = vi.fn<typeof fetch>(async () =>
    new Response(null, { status: 204 }));
  const onBackgroundDeliveryYield = vi.fn();
  const drainInput = buildHostedLinqDrainInput({
    fixture,
    providerFetch,
    publicInternetFetch,
  });

  const outcomes = await drainHostedPreparedAssistantDeliveries({
    ...drainInput,
    onBackgroundDeliveryYield,
    shouldYieldBackgroundDelivery: () => false,
  });

  expect(outcomes).toEqual([
    expect.objectContaining({
      deliveryErrorCode: "ASSISTANT_DELIVERY_AMBIGUOUS",
      deliveryStatus: "failed_ambiguous",
      effectId: fixture.intent.intentId,
      retryable: false,
    }),
  ]);
  expect(providerFetch.mock.calls.filter(([request]) =>
    String(request).endsWith("/attachments")
  )).toHaveLength(1);
  expect(providerFetch.mock.calls.filter(([request]) =>
    String(request).endsWith(`/chats/${fixture.target}/messages`)
  )).toHaveLength(0);
  expect(publicInternetFetch).not.toHaveBeenCalled();
  expect(onBackgroundDeliveryYield).not.toHaveBeenCalled();
  await expect(readAssistantOutboxIntent(
    fixture.vaultRoot,
    fixture.intent.intentId,
  )).resolves.toMatchObject({
    intentId: fixture.intent.intentId,
    lastError: { code: "ASSISTANT_DELIVERY_AMBIGUOUS" },
    nextAttemptAt: null,
    preparedDispatchToken: null,
    status: "abandoned",
  });

  vi.setSystemTime(new Date("2026-08-06T20:01:00.000Z"));
  const laterOutcomes = await drainHostedPreparedAssistantDeliveries({
    ...drainInput,
    shouldYieldBackgroundDelivery: () => false,
    wake: buildHostedExecutionRuntimeTimerWake({
      eventId: `evt_hosted_unusable_reservation_later_${key}`,
      occurredAt: "2026-08-06T20:01:00.000Z",
      triggerKind: "runtime_timer",
      userId: "member_hosted_unusable_reservation",
    }),
  });

  expect(laterOutcomes).toEqual([
    expect.objectContaining({
      deliveryErrorCode: "ASSISTANT_DELIVERY_AMBIGUOUS",
      deliveryStatus: "failed_ambiguous",
      effectId: fixture.intent.intentId,
      retryable: false,
    }),
  ]);
  expect(providerFetch.mock.calls.filter(([request]) =>
    String(request).endsWith("/attachments")
  )).toHaveLength(1);
  expect(providerFetch.mock.calls.filter(([request]) =>
    String(request).endsWith(`/chats/${fixture.target}/messages`)
  )).toHaveLength(0);
  expect(publicInternetFetch).not.toHaveBeenCalled();
  expect(onBackgroundDeliveryYield).not.toHaveBeenCalled();
  await expect(listAssistantOutboxIntents(fixture.vaultRoot)).resolves.toEqual([
    expect.objectContaining({
      intentId: fixture.intent.intentId,
      status: "abandoned",
    }),
  ]);
});

async function createHostedLinqAttachmentFixture(input: {
  homeRoute?: {
    directRecipientPhoneNumber: string;
    fromPhoneNumber: string;
  };
  imageCount?: number;
  key: string;
  mediaKind?: "vault_file" | "vault_image";
  target: string;
}) {
  const workspace = await createHostedRuntimeWorkspace(
    `hosted-runtime-linq-${input.key}-`,
  );
  cleanupTasks.push(workspace.cleanup);

  const mediaKind = input.mediaKind ?? "vault_image";
  const media: HostedAssistantDeliveryMedia[] = [];
  let actionApprovalPort: HostedRuntimeActionApprovalPort | null = null;
  if (mediaKind === "vault_file") {
    const fileBytes = new TextEncoder().encode("%PDF-1.4\nfixture\n");
    const fileRef = `documents/${input.key}.pdf`;
    const filePath = path.join(workspace.vaultRoot, fileRef);
    const approvalGeneration = "b".repeat(64);
    const approvalId = `haa_${"a".repeat(32)}`;
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, fileBytes);
    media.push({
      approvalGeneration,
      approvalId,
      contentType: "application/pdf",
      filename: `${input.key}.pdf`,
      kind: "vault_file",
      ref: fileRef,
      sha256: createHash("sha256").update(fileBytes).digest("hex"),
      sizeBytes: fileBytes.byteLength,
    });
    actionApprovalPort = {
      consume: vi.fn(async () => ({
        approvalGeneration,
        approvalId,
        status: "approved" as const,
      })),
      read: vi.fn(async () => {
        throw new Error("Vault-file approval read was not expected.");
      }),
      request: vi.fn(async () => {
        throw new Error("Vault-file approval request was not expected.");
      }),
    };
  } else {
    const imageBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
    ]);
    for (let index = 0; index < (input.imageCount ?? 1); index += 1) {
      const imageKey = input.imageCount
        ? `${input.key}-${index + 1}`
        : input.key;
      const imageRef = `raw/captures/${imageKey}.png`;
      const imagePath = path.join(workspace.vaultRoot, imageRef);
      await mkdir(path.dirname(imagePath), { recursive: true });
      await writeFile(imagePath, imageBytes);
      media.push({
        alt: "Private generated image",
        contentType: "image/png",
        filename: `${imageKey}.png`,
        kind: "vault_image",
        ref: imageRef,
        sha256: createHash("sha256").update(imageBytes).digest("hex"),
        sizeBytes: imageBytes.byteLength,
        source: "gpt-image-2",
      });
    }
  }
  const intent = await createAssistantOutboxIntent({
    actorId:
      input.homeRoute?.directRecipientPhoneNumber ?? `actor_${input.key}`,
    ...(input.homeRoute
      ? {
          bindingDelivery: { kind: "thread" as const, target: input.target },
          deliverySource: {
            fromPhoneNumber: input.homeRoute.fromPhoneNumber,
            kind: "linq" as const,
          },
          explicitTarget: null,
        }
      : { explicitTarget: input.target }),
    channel: "linq",
    dedupeToken: input.key,
    identityId: `identity_${input.key}`,
    media,
    message: "Private generated image",
    sessionId: `session_${input.key}`,
    threadId: input.target,
    threadIsDirect: true,
    turnId: `turn_${input.key}`,
    vault: workspace.vaultRoot,
  });
  const effect = buildHostedAssistantDeliveryEffect({
    dedupeKey: intent.dedupeKey,
    deliveryPhase: "background_retry",
    effectId: intent.intentId,
    payload: {
      actorId: intent.actorId,
      answeredMailboxItemIds: intent.answeredMailboxItemIds,
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: input.target,
      channel: "linq",
      deliverySourceKey: input.homeRoute
        ? `linq:${input.homeRoute.fromPhoneNumber}`
        : null,
      explicitTarget: input.homeRoute ? null : input.target,
      idempotencyKey:
        intent.deliveryIdempotencyKey ?? `assistant-outbox:${intent.intentId}`,
      identityId: intent.identityId,
      media,
      message: intent.message,
      replyToMessageId: intent.replyToMessageId,
      sessionId: intent.sessionId,
      subject: intent.subject,
      threadId: intent.threadId,
      threadIsDirect: intent.threadIsDirect,
      transportIdempotent: intent.deliveryTransportIdempotent,
      turnId: intent.turnId,
    },
  });
  const linqDeliveryContext = {
    directRecipientPhoneNumber:
      input.homeRoute?.directRecipientPhoneNumber ?? null,
    fromPhoneNumber: input.homeRoute?.fromPhoneNumber ?? null,
    replyToMessageId: null,
    routeAuthority: null,
    service: "iMessage" as const,
    target: input.target,
    threadIsDirect: true,
  };

  return {
    actionApprovalPort,
    effect,
    intent,
    linqDeliveryContext,
    target: input.target,
    vaultRoot: workspace.vaultRoot,
    wake: buildHostedExecutionRuntimeTimerWake({
      eventId: `evt_hosted_${input.key}`,
      occurredAt: "2026-08-06T20:00:00.000Z",
      triggerKind: "runtime_timer",
      userId: `member_${input.key}`,
    }),
  };
}

async function createHostedLinqReactionFixture() {
  const workspace = await createHostedRuntimeWorkspace(
    "hosted-runtime-linq-reaction-confirmation-",
  );
  cleanupTasks.push(workspace.cleanup);

  const mailboxItemId = "mailbox_item_reaction_confirmation";
  const messageId = "linq_message_reaction_confirmation";
  const target = "linq_chat_reaction_confirmation";
  const intent = await createAssistantOutboxIntent({
    actorId: "actor_reaction_confirmation",
    answeredMailboxItemIds: [mailboxItemId],
    bindingDelivery: { kind: "thread", target },
    channel: "linq",
    dedupeToken: "reaction-confirmation",
    identityId: "identity_reaction_confirmation",
    message: "",
    operation: { kind: "message-reaction", reaction: "heart" },
    replyToMessageId: messageId,
    sessionId: "session_reaction_confirmation",
    threadId: target,
    threadIsDirect: true,
    turnId: "turn_reaction_confirmation",
    vault: workspace.vaultRoot,
  });
  const effect = buildHostedAssistantDeliveryEffect({
    dedupeKey: intent.dedupeKey,
    deliveryPhase: "background_retry",
    effectId: intent.intentId,
    payload: {
      actorId: intent.actorId,
      answeredMailboxItemIds: intent.answeredMailboxItemIds,
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: target,
      channel: "linq",
      deliverySourceKey: null,
      explicitTarget: null,
      idempotencyKey:
        intent.deliveryIdempotencyKey ?? `assistant-outbox:${intent.intentId}`,
      identityId: intent.identityId,
      media: [],
      message: "",
      replyToMessageId: messageId,
      sessionId: intent.sessionId,
      subject: null,
      threadId: target,
      threadIsDirect: true,
      transportIdempotent: intent.deliveryTransportIdempotent,
      turnId: intent.turnId,
    },
  });

  return {
    effect,
    intent,
    linqDeliveryContext: {
      directRecipientPhoneNumber: null,
      fromPhoneNumber: null,
      replyToMessageId: messageId,
      routeAuthority: null,
      service: "iMessage" as const,
      target,
      threadIsDirect: true,
    },
    mailboxItemId,
    messageId,
    vaultRoot: workspace.vaultRoot,
    wake: buildHostedExecutionRuntimeTimerWake({
      eventId: "evt_hosted_reaction_confirmation",
      occurredAt: "2026-08-06T20:00:00.000Z",
      triggerKind: "runtime_timer",
      userId: "member_reaction_confirmation",
    }),
  };
}

function buildHostedLinqDrainInput(input: {
  fixture: Awaited<ReturnType<typeof createHostedLinqAttachmentFixture>>;
  providerFetch: typeof fetch;
  publicInternetFetch: typeof fetch;
}) {
  return {
    ...(input.fixture.actionApprovalPort
      ? { actionApprovalPort: input.fixture.actionApprovalPort }
      : {}),
    assistantDeliveryEffects: [input.fixture.effect],
    effectsPort: createHostedRuntimeEffectsPortStub(),
    forwardedEnv: {
      LINQ_API_TOKEN: "linq-token",
    },
    linqDeliveryContext: input.fixture.linqDeliveryContext,
    platformEnv: {},
    providerFetch: input.providerFetch,
    publicInternetFetch: input.publicInternetFetch,
    vaultRoot: input.fixture.vaultRoot,
    wake: input.fixture.wake,
  };
}
