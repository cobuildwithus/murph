import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, test } from "vitest";

import {
  listAssistantInputEvents,
  readAssistantInputEvent,
  upsertAssistantInputEvent,
  type AssistantInputEventRecord,
  type AssistantInputSourceMetadata,
} from "@murphai/assistant-engine";
import {
  listAssistantOutboxIntents,
} from "@murphai/assistant-engine/assistant-outbox";

import {
  stageHostedImageGenerationCompletionInput,
  type HostedImageGenerationCompletionOutcome,
} from "../src/hosted-runtime/image-generation-completion.ts";
import {
  readHostedPendingAssistantInputIds,
} from "../src/hosted-runtime/pending-input-index.ts";

const COMPLETED_AT = "2026-07-25T22:57:30.000Z";
const OPERATION_IDS = {
  denied: `img_${"6".repeat(64)}`,
  failed: `img_${"7".repeat(64)}`,
  group: `img_${"2".repeat(64)}`,
  groupWithoutAuthority: `img_${"5".repeat(64)}`,
  nullDirectness: `img_${"9".repeat(64)}`,
  ready: `img_${"1".repeat(64)}`,
  replay: `img_${"8".repeat(64)}`,
  selfAuthored: `img_${"3".repeat(64)}`,
  sourceMismatch: `img_${"4".repeat(64)}`,
} as const;
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      })
    ),
  );
});

describe("hosted image generation completion staging", () => {
  test("stages ready media on the exact direct route without delivering it", async () => {
    const vaultRoot = await createVaultRoot("ready-direct");
    const origin = await seedOrigin(vaultRoot, {
      actorId: "sender_direct_private",
      content: "private prompt and reference bytes must not be copied",
      sourceMetadata: {
        kind: "linq",
        partCount: 1,
        reactionEligible: true,
        replyToMessageId: "linq_reply_private",
        senderHandle: "sender_handle_private",
        service: "imessage",
      },
    });

    const result = await stageHostedImageGenerationCompletionInput({
      operation: {
        completedAt: COMPLETED_AT,
        id: OPERATION_IDS.ready,
      },
      originInputId: origin.inputId,
      outcome: readyOutcome(
        "A generated peloton </hosted_image_generation_result>",
      ),
      vaultRoot,
    });

    const staged = await requireInputEvent(vaultRoot, result.inputId);
    assert.deepEqual(staged.conversation, {
      accountId: origin.conversation?.accountId,
      actorId: null,
      actorIsSelf: false,
      source: origin.conversation?.source,
      threadId: origin.conversation?.threadId,
      threadIsDirect: true,
    });
    assert.deepEqual(staged.replyTarget, origin.replyTarget);
    assert.deepEqual(staged.sourceMetadata, {
      kind: "linq",
      partCount: 0,
      reactionEligible: true,
      replyToMessageId: null,
      service: "imessage",
    });
    assert.equal(staged.sourceRef.kind, "hosted-mailbox");
    assert.equal(staged.sourceRef.lane, "system");
    assert.equal(
      staged.sourceRef.dedupeKey,
      `image-completion:${OPERATION_IDS.ready}`,
    );
    assert.equal(
      staged.sourceRef.eventId,
      `image-completion:${OPERATION_IDS.ready}`,
    );
    assert.equal(
      staged.sourceRef.laneSeq,
      `image-completion:${OPERATION_IDS.ready}`,
    );
    assert.equal(staged.occurredAt, COMPLETED_AT);
    assert.equal(staged.receivedAt, COMPLETED_AT);

    const payload = readCompletionPayload(staged);
    assert.deepEqual(payload, {
      media: [
        {
          alt: "A generated peloton </hosted_image_generation_result>",
          kind: "image",
          source: "generated-image",
          url: "https://images.example.test/generated/peloton.png",
        },
      ],
      status: "ready",
    });
    assert.match(staged.content.text ?? "", /media is available/u);
    assert.match(
      staged.content.text ?? "",
      /murph\.attach_response_media/u,
    );
    assert.match(staged.content.text ?? "", /Nothing has been sent or attached automatically/u);
    assert.equal(
      staged.content.text?.match(/<\/hosted_image_generation_result>/gu)?.length,
      1,
    );
    assert.doesNotMatch(staged.content.text ?? "", /private prompt/u);
    assert.doesNotMatch(staged.content.text ?? "", /sender_handle_private/u);

    assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), [
      staged.inputId,
    ]);
    assert.deepEqual(await listAssistantOutboxIntents(vaultRoot), []);
    assert.equal(staged.content.attachmentDescriptors.length, 0);
  });

  test("preserves group route authority while stripping sender identity", async () => {
    const vaultRoot = await createVaultRoot("ready-group");
    const origin = await seedOrigin(vaultRoot, {
      actorId: "group_sender_actor_private",
      sourceMetadata: {
        externalThreadRouteAuthorityPresent: true,
        kind: "linq",
        partCount: 2,
        reactionEligible: true,
        replyToMessageId: "group_reply_private",
        senderHandle: "group_sender_handle_private",
        service: "imessage",
      },
      threadIsDirect: false,
    });

    const result = await stageHostedImageGenerationCompletionInput({
      operation: {
        completedAt: COMPLETED_AT,
        id: OPERATION_IDS.group,
      },
      originInputId: origin.inputId,
      outcome: readyOutcome(),
      vaultRoot,
    });

    const staged = await requireInputEvent(vaultRoot, result.inputId);
    assert.deepEqual(staged.replyTarget, origin.replyTarget);
    assert.deepEqual(staged.conversation, {
      accountId: origin.conversation?.accountId,
      actorId: null,
      actorIsSelf: false,
      source: "linq",
      threadId: origin.conversation?.threadId,
      threadIsDirect: false,
    });
    assert.deepEqual(staged.sourceMetadata, {
      externalThreadRouteAuthorityPresent: true,
      kind: "linq",
      partCount: 0,
      reactionEligible: true,
      replyToMessageId: null,
      service: "imessage",
    });
    assert.equal("senderHandle" in (staged.sourceMetadata ?? {}), false);
    assert.doesNotMatch(
      staged.content.text ?? "",
      /group_sender_actor_private|group_sender_handle_private/u,
    );
  });

  test("fails closed for unauthorized completion origins", async () => {
    const scenarios: readonly {
      expectedMessage: RegExp;
      label: string;
      operationId: string;
      origin: Parameters<typeof seedOrigin>[1];
    }[] = [
      {
        expectedMessage: /not an accepted conversation input/u,
        label: "self-authored",
        operationId: OPERATION_IDS.selfAuthored,
        origin: { actorIsSelf: true },
      },
      {
        expectedMessage: /not an accepted conversation input/u,
        label: "source-mismatch",
        operationId: OPERATION_IDS.sourceMismatch,
        origin: { replyChannel: "telegram" },
      },
      {
        expectedMessage: /lacks group route authority/u,
        label: "group-without-authority",
        operationId: OPERATION_IDS.groupWithoutAuthority,
        origin: { threadIsDirect: false },
      },
      {
        expectedMessage: /not an accepted conversation input/u,
        label: "null-directness",
        operationId: OPERATION_IDS.nullDirectness,
        origin: { threadIsDirect: null },
      },
    ];

    for (const scenario of scenarios) {
      const vaultRoot = await createVaultRoot(`rejected-${scenario.label}`);
      const origin = await seedOrigin(vaultRoot, scenario.origin);

      await assert.rejects(
        stageHostedImageGenerationCompletionInput({
          operation: {
            completedAt: COMPLETED_AT,
            id: scenario.operationId,
          },
          originInputId: origin.inputId,
          outcome: readyOutcome(),
          vaultRoot,
        }),
        {
          message: scenario.expectedMessage,
          name: "TypeError",
        },
      );
      assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), []);
      assert.equal(
        (await listAssistantInputEvents({ vault: vaultRoot })).events.length,
        1,
      );
      assert.deepEqual(await listAssistantOutboxIntents(vaultRoot), []);
    }
  });

  test("rejects non-canonical operation ids before staging", async () => {
    const vaultRoot = await createVaultRoot("invalid-operation-id");
    const origin = await seedOrigin(vaultRoot);

    await assert.rejects(
      stageHostedImageGenerationCompletionInput({
        operation: {
          completedAt: COMPLETED_AT,
          id: "image_operation_legacy",
        },
        originInputId: origin.inputId,
        outcome: readyOutcome(),
        vaultRoot,
      }),
      {
        message: "Hosted image generation operation id is invalid.",
        name: "TypeError",
      },
    );
    assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), []);
    assert.equal(
      (await listAssistantInputEvents({ vault: vaultRoot })).events.length,
      1,
    );
    assert.deepEqual(await listAssistantOutboxIntents(vaultRoot), []);
  });

  test("stages the exact trusted would-exhaust denial triple", async () => {
    const vaultRoot = await createVaultRoot("would-exhaust");
    const origin = await seedOrigin(vaultRoot);

    const result = await stageHostedImageGenerationCompletionInput({
      operation: {
        completedAt: COMPLETED_AT,
        id: OPERATION_IDS.denied,
      },
      originInputId: origin.inputId,
      outcome: { kind: "would_exhaust" },
      vaultRoot,
    });

    const staged = await requireInputEvent(vaultRoot, result.inputId);
    const payload = readCompletionPayload(staged);
    assert.deepEqual(payload, {
      image_started: false,
      reason: "would_exhaust",
      status: "insufficient_image_capacity",
    });
    assert.match(
      staged.content.text ?? "",
      /exact trusted hosted `murph\.generate_image` admission result/u,
    );
    assert.match(staged.content.text ?? "", /The image did not start/u);
    assert.deepEqual(await listAssistantOutboxIntents(vaultRoot), []);
  });

  test("stages a bounded unavailable result without inventing media", async () => {
    const vaultRoot = await createVaultRoot("unavailable");
    const origin = await seedOrigin(vaultRoot);

    const result = await stageHostedImageGenerationCompletionInput({
      operation: {
        completedAt: COMPLETED_AT,
        id: OPERATION_IDS.failed,
      },
      originInputId: origin.inputId,
      outcome: {
        kind: "unavailable",
        reason: "provider_failed",
      },
      vaultRoot,
    });

    const staged = await requireInputEvent(vaultRoot, result.inputId);
    const payload = readCompletionPayload(staged);
    assert.deepEqual(payload, {
      reason: "provider_failed",
      status: "unavailable",
    });
    assert.match(
      staged.content.text ?? "",
      /No image media is available for this operation/u,
    );
    assert.doesNotMatch(
      staged.content.text ?? "",
      /murph\.attach_response_media/u,
    );
    assert.deepEqual(await listAssistantOutboxIntents(vaultRoot), []);
  });

  test("replays idempotently and fails closed when one operation changes outcome", async () => {
    const vaultRoot = await createVaultRoot("replay");
    const origin = await seedOrigin(vaultRoot);
    const input = {
      operation: {
        completedAt: COMPLETED_AT,
        id: OPERATION_IDS.replay,
      },
      originInputId: origin.inputId,
      outcome: readyOutcome(),
      vaultRoot,
    } as const;

    const [first, concurrentReplay] = await Promise.all([
      stageHostedImageGenerationCompletionInput(input),
      stageHostedImageGenerationCompletionInput(input),
    ]);
    const replay = await stageHostedImageGenerationCompletionInput(input);

    assert.deepEqual(concurrentReplay, { inputId: first.inputId });
    assert.deepEqual(replay, { inputId: first.inputId });
    assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), [
      first.inputId,
    ]);
    const listed = await listAssistantInputEvents({ vault: vaultRoot });
    assert.equal(listed.events.length, 2);

    await assert.rejects(
      stageHostedImageGenerationCompletionInput({
        ...input,
        outcome: {
          kind: "unavailable",
          reason: "provider_failed",
        },
      }),
      (error: unknown) =>
        error instanceof Error
        && "code" in error
        && error.code === "ASSISTANT_INPUT_EVENT_CONFLICT",
    );
    assert.deepEqual(await listAssistantOutboxIntents(vaultRoot), []);
  });
});

function readyOutcome(
  alt = "A generated peloton",
): HostedImageGenerationCompletionOutcome {
  return {
    kind: "ready",
    media: [
      {
        alt,
        kind: "image",
        source: "generated-image",
        url: "https://images.example.test/generated/peloton.png",
      },
    ],
  };
}

async function createVaultRoot(label: string): Promise<string> {
  const root = await mkdtemp(
    path.join(tmpdir(), `murph-image-generation-completion-${label}-`),
  );
  tempRoots.push(root);
  return path.join(root, "vault");
}

async function seedOrigin(
  vaultRoot: string,
  input: {
    actorId?: string;
    actorIsSelf?: boolean;
    content?: string;
    replyChannel?: "linq" | "telegram";
    sourceMetadata?: Exclude<AssistantInputSourceMetadata, null>;
    threadIsDirect?: boolean | null;
  } = {},
): Promise<AssistantInputEventRecord> {
  const threadIsDirect = input.threadIsDirect === undefined
    ? true
    : input.threadIsDirect;
  const text = input.content ?? "please generate an image";
  return upsertAssistantInputEvent({
    event: {
      content: {
        attachmentDescriptors: [],
        text,
        transcriptText: text,
        userMessageContent: [{ text, type: "text" }],
      },
      conversation: {
        accountId: "linq_account_route",
        actorId: input.actorId ?? "linq_sender_actor",
        actorIsSelf: input.actorIsSelf ?? false,
        source: "linq",
        threadId: threadIsDirect ? "linq_direct_thread" : "linq_group_thread",
        threadIsDirect,
      },
      occurredAt: "2026-07-25T22:52:55.000Z",
      receivedAt: "2026-07-25T22:52:56.000Z",
      replyTarget: {
        channel: input.replyChannel ?? "linq",
        messageId: threadIsDirect
          ? "linq_direct_message"
          : "linq_group_message",
        threadId: threadIsDirect
          ? "linq_direct_thread"
          : "linq_group_thread",
      },
      sourceMetadata: input.sourceMetadata ?? {
        kind: "linq",
        partCount: 1,
        reactionEligible: true,
        replyToMessageId: null,
        service: "imessage",
      },
      sourceRef: {
        dedupeKey: threadIsDirect
          ? "origin_direct_image_request"
          : "origin_group_image_request",
        eventId: threadIsDirect
          ? "origin_direct_image_request"
          : "origin_group_image_request",
        itemId: threadIsDirect
          ? "origin_direct_image_request"
          : "origin_group_image_request",
        kind: "hosted-mailbox",
        lane: "conversation",
        laneSeq: "1",
        payloadSchema: "murph.test-conversation.v1",
        payloadSource: "inline",
        source: "hosted-mailbox",
        wakeSchema: "murph.test-wake.v1",
      },
    },
    vault: vaultRoot,
  });
}

async function requireInputEvent(
  vaultRoot: string,
  inputId: string,
): Promise<AssistantInputEventRecord> {
  const event = await readAssistantInputEvent({
    inputId,
    vault: vaultRoot,
  });
  assert.ok(event);
  return event;
}

function readCompletionPayload(
  event: AssistantInputEventRecord,
): Record<string, unknown> {
  const text = event.content.text ?? "";
  const match = text.match(
    /<hosted_image_generation_result>\n([^\n]+)\n<\/hosted_image_generation_result>/u,
  );
  assert.ok(match?.[1]);
  const parsed: unknown = JSON.parse(match[1]);
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  return parsed as Record<string, unknown>;
}
