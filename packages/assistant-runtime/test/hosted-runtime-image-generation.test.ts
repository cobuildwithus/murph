import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  readAssistantInputEvent,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";
import { initializeVault } from "@murphai/core";
import { afterEach, describe, test, vi } from "vitest";

import {
  createHostedImageGenerationController,
} from "../src/hosted-runtime/image-generation.ts";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ));
});

describe("hosted image generation", () => {
  test("stages a completed image once on the original trusted route", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-image-completion-"));
    tempRoots.push(vaultRoot);
    await initializeVault({
      createdAt: "2026-07-26T12:00:00.000Z",
      vaultRoot,
    });
    const origin = await upsertAssistantInputEvent({
      event: {
        content: {
          text: "Please draw a sunrise.",
          transcriptText: "Please draw a sunrise.",
          userMessageContent: [{
            text: "Please draw a sunrise.",
            type: "text",
          }],
        },
        conversation: {
          accountId: "account_1",
          actorId: "actor_1",
          actorIsSelf: false,
          source: "linq",
          threadId: "thread_1",
          threadIsDirect: true,
        },
        occurredAt: "2026-07-26T12:00:00.000Z",
        receivedAt: "2026-07-26T12:00:00.000Z",
        replyTarget: {
          channel: "linq",
          messageId: "message_1",
          threadId: "thread_1",
        },
        sourceMetadata: {
          kind: "linq",
          partCount: 1,
          reactionEligible: true,
          replyToMessageId: null,
          service: "iMessage",
        },
        sourceRef: {
          dedupeKey: "origin_dedupe",
          eventId: "origin_event",
          itemId: "origin_item",
          kind: "hosted-mailbox",
          lane: "conversation",
          laneSeq: "1",
          payloadSchema: "murph.hosted-mailbox-payload.v1",
          payloadSource: "inline",
          source: "hosted-mailbox",
          wakeSchema: "murph.hosted-execution-wake.v1",
        },
      },
      vault: vaultRoot,
    });
    let releaseImage = (): void => undefined;
    const heldImage = new Promise<void>((resolve) => {
      releaseImage = resolve;
    });
    let notifyReady = (): void => undefined;
    const ready = new Promise<void>((resolve) => {
      notifyReady = resolve;
    });
    const onStarted = vi.fn();
    const controller = createHostedImageGenerationController({
      notifyReady,
      onStarted,
      vaultRoot,
    });

    assert.equal(controller.launcher.launch({
      operationId: "image_operation_1",
      originAssistantInputId: origin.inputId,
      async run() {
        await heldImage;
        return {
          media: [{
            alt: "A calm sunrise",
            kind: "image",
            source: "gpt-image-1",
            url: "https://imagedelivery.net/account/sunrise/public",
          }],
          success: true,
        };
      },
    }), "started");
    assert.equal(controller.hasWork(), true);
    assert.equal(controller.hasCompleted(), false);
    assert.equal(onStarted.mock.calls.length, 1);

    releaseImage();
    await ready;
    assert.equal(controller.hasCompleted(), true);
    const batch = await controller.drain();
    assert.equal(batch?.assistantInputIds.length, 1);
    assert.equal(controller.hasCompleted(), false);

    const completion = await readAssistantInputEvent({
      inputId: batch!.assistantInputIds[0]!,
      vault: vaultRoot,
    });
    assert.ok(completion);
    assert.deepEqual(completion.conversation, {
      ...origin.conversation,
      actorId: null,
    });
    assert.deepEqual(completion.replyTarget, origin.replyTarget);
    assert.equal(completion.sourceRef.kind, "hosted-mailbox");
    assert.equal(
      completion.sourceRef.kind === "hosted-mailbox"
        ? completion.sourceRef.lane
        : null,
      "system",
    );
    assert.match(
      completion.content.text ?? "",
      /https:\/\/imagedelivery\.net\/account\/sunrise\/public/u,
    );
    assert.equal(await controller.drain(), null);
    await controller.close();
  });
});
