import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import {
  createAssistantOutboxIntent,
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
  drainHostedPreparedAssistantDeliveries,
  prepareHostedAssistantDeliveryEffectsForDispatch,
} from "../src/hosted-runtime/callbacks.ts";
import type {
  HostedRuntimeActionApprovalPort,
} from "../src/hosted-runtime/platform.ts";
import {
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(cleanupTasks.splice(0).map((cleanup) => cleanup()));
});

it("defers a real hosted Linq attachment before provider entry and later sends the same outbox intent", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-06T20:00:00.000Z"));
  const fixture = await createHostedLinqAttachmentFixture({
    key: "provider-skipped",
    target: "linq_chat_hosted_provider_skipped",
  });
  const providerFetch = vi.fn<typeof fetch>(async (request) => {
    const url = String(request);
    if (url.endsWith("/attachments")) {
      return new Response(JSON.stringify({
        attachment_id: "attachment_hosted_provider_skipped",
        expires_at: "2026-08-06T21:00:00.000Z",
        http_method: "PUT",
        required_headers: {
          "content-type": "image/png",
        },
        upload_url: "https://uploads.example.test/private/provider-skipped",
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith(`/chats/${fixture.target}/messages`)) {
      return new Response(JSON.stringify({
        message: { id: "linq_hosted_provider_skipped_sent" },
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
  expect(providerFetch).not.toHaveBeenCalled();
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
      providerMessageId: "linq_hosted_provider_skipped_sent",
      retryable: false,
    }),
  ]);
  expect(providerFetch).toHaveBeenCalledTimes(2);
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
    label: "private image",
    mediaKind: "vault_image",
  },
  {
    label: "private file",
    mediaKind: "vault_file",
  },
] as const)("terminalizes a hosted Linq $label delivery when foreground input arrives after upload but before the message send", async ({
  mediaKind,
}) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-06T20:00:00.000Z"));
  const key = `post-upload-${mediaKind}`;
  const fixture = await createHostedLinqAttachmentFixture({
    key,
    mediaKind,
    target: `linq_chat_hosted_${key}`,
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
    String(request).endsWith(`/chats/${fixture.target}/messages`)
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
  const drainInput = buildHostedLinqDrainInput({
    fixture,
    providerFetch,
    publicInternetFetch,
  });

  const outcomes = await drainHostedPreparedAssistantDeliveries({
    ...drainInput,
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
  expect(publicInternetFetch).not.toHaveBeenCalled();
  await expect(readAssistantOutboxIntent(
    fixture.vaultRoot,
    fixture.intent.intentId,
  )).resolves.toMatchObject({
    intentId: fixture.intent.intentId,
    nextAttemptAt: null,
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
  expect(publicInternetFetch).not.toHaveBeenCalled();
  await expect(listAssistantOutboxIntents(fixture.vaultRoot)).resolves.toEqual([
    expect.objectContaining({
      intentId: fixture.intent.intentId,
      status: "abandoned",
    }),
  ]);
});

async function createHostedLinqAttachmentFixture(input: {
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
    actorId: `actor_${input.key}`,
    channel: "linq",
    dedupeToken: input.key,
    explicitTarget: input.target,
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
      deliverySourceKey: null,
      explicitTarget: input.target,
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
    directRecipientPhoneNumber: null,
    fromPhoneNumber: null,
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
