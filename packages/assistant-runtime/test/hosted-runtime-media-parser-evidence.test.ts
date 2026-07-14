import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  updateAssistantInputAttachmentEvidence,
  upsertAssistantInputEvent,
  type AssistantInputAttachmentEvidence,
  type AssistantInputContent,
  type UpsertAssistantInputEventInput,
} from "@murphai/assistant-engine";
import {
  saveAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-state";

import {
  classifyHostedAssistantInputMediaSemanticState,
} from "../src/hosted-runtime/media-parser-evidence.ts";
import {
  compactHostedPendingAssistantInputIds,
  enqueueHostedPendingAssistantInputId,
  ensureHostedPendingAssistantInputIndex,
  readHostedPendingAssistantInputIds,
} from "../src/hosted-runtime/pending-input-index.ts";
import {
  selectHostedAssistantInputIds,
} from "../src/hosted-runtime/turn-input.ts";

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

describe("classifyHostedAssistantInputMediaSemanticState", () => {
  it("keeps media-only input pending until terminal parser evidence exists", () => {
    expect(classifyHostedAssistantInputMediaSemanticState({
      attachmentEvidence: createAttachmentEvidence("not_attempted"),
      content: createInputContent({ media: true, userText: null }),
    })).toBe("pending");
  });

  it("classifies terminal media-parser failure as failed", () => {
    expect(classifyHostedAssistantInputMediaSemanticState({
      attachmentEvidence: createAttachmentEvidence("failed"),
      content: createInputContent({ media: true, userText: null }),
    })).toBe("failed");
  });

  it("requires a non-empty terminal transcript before media-only input is ready", () => {
    expect(classifyHostedAssistantInputMediaSemanticState({
      attachmentEvidence: createAttachmentEvidence("succeeded", "spoken request"),
      content: createInputContent({ media: true, userText: null }),
    })).toBe("ready");
    expect(classifyHostedAssistantInputMediaSemanticState({
      attachmentEvidence: createAttachmentEvidence("succeeded", "   "),
      content: createInputContent({ media: true, userText: null }),
    })).toBe("failed");
  });

  it("keeps text plus media reply-ready without waiting for parser enrichment", () => {
    expect(classifyHostedAssistantInputMediaSemanticState({
      attachmentEvidence: createAttachmentEvidence("not_attempted"),
      content: createInputContent({
        media: true,
        userText: "Please use this voice note as extra context.",
      }),
    })).toBe("not_required");
  });

  it("does not treat legacy generated attachment summaries as user-authored text", () => {
    expect(classifyHostedAssistantInputMediaSemanticState({
      attachmentEvidence: createAttachmentEvidence("not_attempted"),
      content: createInputContent({
        media: true,
        userText: "Received a Linq message with 1 attachment.",
      }),
    })).toBe("pending");
  });
});

describe("media-aware hosted input selection", () => {
  it("excludes pending and terminally failed media-only inputs", async () => {
    const vaultRoot = await createTempVault();
    const pending = await createStoredInput({
      evidence: "not_attempted",
      laneSeq: "10",
      media: true,
      suffix: "pending_media_only",
      userText: null,
      vaultRoot,
    });
    const failed = await createStoredInput({
      evidence: "failed",
      laneSeq: "20",
      media: true,
      suffix: "failed_media_only",
      userText: null,
      vaultRoot,
    });

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [pending.inputId, failed.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([]);
  });

  it("selects media-only input after a terminal non-empty transcript", async () => {
    const vaultRoot = await createTempVault();
    const ready = await createStoredInput({
      evidence: "succeeded",
      laneSeq: "10",
      media: true,
      suffix: "ready_media_only",
      transcript: "Please summarize my voice note.",
      userText: null,
      vaultRoot,
    });

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [ready.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([ready.inputId]);
  });

  it("selects text plus media immediately while parser evidence is pending", async () => {
    const vaultRoot = await createTempVault();
    const textAndMedia = await createStoredInput({
      evidence: "not_attempted",
      laneSeq: "10",
      media: true,
      suffix: "text_and_media",
      userText: "This message is enough to answer now.",
      vaultRoot,
    });

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [textAndMedia.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([textAndMedia.inputId]);
  });

  it("does not let older pending media block later ready fresh input", async () => {
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    const olderPending = await createStoredInput({
      evidence: "not_attempted",
      laneSeq: "10",
      media: true,
      suffix: "older_pending_media",
      userText: null,
      vaultRoot,
    });
    const laterFresh = await createStoredInput({
      evidence: "not_attempted",
      laneSeq: "20",
      media: false,
      suffix: "later_ready_fresh",
      userText: "Answer this newer message now.",
      vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: olderPending.inputId,
      vaultRoot,
    });

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [olderPending.inputId, laterFresh.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([laterFresh.inputId]);
    expect(selection.pendingInputIds).toEqual([olderPending.inputId]);
  });

  it("compacts terminally failed media-only input out of the pending index", async () => {
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    const failed = await createStoredInput({
      evidence: "failed",
      laneSeq: "10",
      media: true,
      suffix: "failed_pending_media",
      userText: null,
      vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: failed.inputId,
      vaultRoot,
    });

    await expect(compactHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toEqual([]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toEqual([]);
  });
});

type StoredEvidenceState = "failed" | "not_attempted" | "succeeded";

async function createStoredInput(input: {
  evidence: StoredEvidenceState;
  laneSeq: string;
  media: boolean;
  suffix: string;
  transcript?: string;
  userText: string | null;
  vaultRoot: string;
}) {
  const event = await upsertAssistantInputEvent({
    event: createStoredInputEvent(input),
    vault: input.vaultRoot,
  });
  if (input.evidence !== "not_attempted") {
    await updateAssistantInputAttachmentEvidence({
      attachmentEvidence: createAttachmentEvidence(
        input.evidence,
        input.transcript,
      ),
      inputId: event.inputId,
      vault: input.vaultRoot,
    });
  }
  return event;
}

function createStoredInputEvent(input: {
  laneSeq: string;
  media: boolean;
  suffix: string;
  userText: string | null;
}): UpsertAssistantInputEventInput {
  return {
    content: createInputContent({
      media: input.media,
      userText: input.userText,
    }),
    conversation: {
      accountId: "acct_media_gate",
      actorId: "actor_media_gate",
      actorIsSelf: false,
      source: "linq",
      threadId: "thread_media_gate",
      threadIsDirect: true,
    },
    occurredAt: `2026-07-14T00:00:${input.laneSeq.padStart(2, "0")}.000Z`,
    receivedAt: `2026-07-14T00:01:${input.laneSeq.padStart(2, "0")}.000Z`,
    replyTarget: {
      channel: "linq",
      messageId: `msg_${input.suffix}`,
      threadId: "thread_media_gate",
    },
    sourceMetadata: {
      externalThreadRouteAuthorityPresent: false,
      kind: "linq",
      partCount: input.media ? 1 : 0,
      previousHomeThreadId: null,
      reactionEligible: false,
      replyToMessageId: null,
      service: "imessage",
    },
    sourceRef: {
      dedupeKey: `dedupe_${input.suffix}`,
      eventId: `evt_${input.suffix}`,
      itemId: `item_${input.suffix}`,
      kind: "hosted-mailbox",
      lane: "conversation",
      laneSeq: input.laneSeq,
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      payloadSource: "inline",
      source: "hosted-mailbox",
      wakeSchema: "murph.hosted-execution-wake.v1",
    },
  };
}

function createInputContent(input: {
  media: boolean;
  userText: string | null;
}): AssistantInputContent {
  return {
    attachmentDescriptors: input.media
      ? [{
          attachmentId: "audio_attachment_1",
          contentType: "audio/mp4",
          fileName: "message.m4a",
          kind: "audio",
          sizeBytes: 512,
        }]
      : [],
    text: input.userText,
    transcriptText: input.userText,
    userMessageContent: input.userText === null
      ? null
      : [{
          text: input.userText,
          type: "text",
        }],
  };
}

function createAttachmentEvidence(
  state: StoredEvidenceState,
  transcript = "",
): AssistantInputAttachmentEvidence {
  if (state === "not_attempted") {
    return {
      attachments: [],
      optionalInboxCaptureId: null,
      reasonCode: null,
      source: null,
      status: "not_attempted",
      updatedAt: null,
    };
  }
  if (state === "failed") {
    return {
      attachments: [],
      optionalInboxCaptureId: "cap_failed_media_parser",
      reasonCode: "media_parser_failed",
      source: "hosted-inbox-projection",
      status: "failed",
      updatedAt: "2026-07-14T00:02:00.000Z",
    };
  }
  return {
    attachments: [{
      byteSize: 512,
      derived: null,
      descriptorAttachmentId: "audio_attachment_1",
      fileName: "message.m4a",
      inlineFragments: [{
        kind: "attachment_transcript",
        label: "Transcript",
        text: transcript,
        truncated: false,
      }],
      kind: "audio",
      mime: "audio/mp4",
      ordinal: 1,
      parseState: "succeeded",
      raw: null,
      sourceAttachmentId: "source_audio_attachment_1",
    }],
    optionalInboxCaptureId: "cap_succeeded_media_parser",
    reasonCode: null,
    source: "hosted-inbox-projection",
    status: "available",
    updatedAt: "2026-07-14T00:02:00.000Z",
  };
}

async function createTempVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-media-parser-gate-"));
  tempRoots.push(root);
  return path.join(root, "vault");
}

async function enableLinqAutoReply(vaultRoot: string): Promise<void> {
  await saveAssistantAutomationState(vaultRoot, {
    autoReply: [{
      channel: "linq",
      eligibleAfter: null,
      enabledAt: "2026-07-14T00:00:00.000Z",
    }],
    updatedAt: "2026-07-14T00:00:00.000Z",
    version: 1,
  });
  await ensureHostedPendingAssistantInputIndex({ vaultRoot });
}
