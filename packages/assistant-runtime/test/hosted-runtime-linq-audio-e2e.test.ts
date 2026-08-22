import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { initializeVault } from "@murphai/core";
import {
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";
import type {
  HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  type HostedMailboxFetchRequest,
  type HostedMailboxItem,
  type HostedMailboxPayloadFetchRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  createParserRegistry,
  type ParserProvider,
} from "@murphai/parsers";
import {
  openInboxRuntime,
} from "@murphai/inboxd";
import { describe, expect, it, vi } from "vitest";

import {
  createHostedRuntimeEffectsPortStub,
} from "./hosted-runtime-test-helpers.ts";
import {
  createHostedConversationMailboxImportItem,
} from "../src/hosted-runtime/mailbox-conversation-import.ts";
import {
  fetchAndProcessHostedMailboxPrefix,
} from "../src/hosted-runtime/mailbox-import.ts";
import {
  createEmptyHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import type {
  NormalizedHostedAssistantRuntimeConfig,
} from "../src/hosted-runtime/models.ts";

const mocks = vi.hoisted(() => ({
  createConfiguredParserRegistry: vi.fn(),
  createHostedLinqAttachmentDownloadDriver: vi.fn(),
  markLinqChatRead: vi.fn(),
}));

vi.mock("@murphai/parsers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/parsers")>();

  return {
    ...actual,
    createConfiguredParserRegistry: mocks.createConfiguredParserRegistry,
  };
});

vi.mock("../src/hosted-runtime/events/linq.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hosted-runtime/events/linq.ts")>();

  return {
    ...actual,
    createHostedLinqAttachmentDownloadDriver: mocks.createHostedLinqAttachmentDownloadDriver,
  };
});

vi.mock("@murphai/operator-config/linq-runtime", () => ({
  markLinqChatRead: mocks.markLinqChatRead,
}));

import {
  importHostedConversationMessageWakeIntoLocalInbox,
} from "../src/hosted-runtime/events/conversation.ts";

describe("hosted Linq audio conversation ingestion", () => {
  it("commits mailbox progress when stop aborts after the parser drain", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-linq-audio-abort-"));
    const vaultRoot = path.join(workspaceRoot, "vault");
    const fakeFfmpeg = path.join(workspaceRoot, "fake-ffmpeg");
    const audioBytes = Uint8Array.from([7, 6, 5, 4, 3, 2, 1]);
    const controller = new AbortController();
    const abortReason = new DOMException("Stopped", "AbortError");
    const providerSignals: Array<AbortSignal | undefined> = [];
    const transcript = "The preempted parser drain still completed.";

    await initializeVault({ vaultRoot, createdAt: "2026-04-29T00:00:00.000Z" });
    await writeExecutableNodeScript(
      fakeFfmpeg,
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "const outputPath = process.argv.at(-1);",
        "fs.mkdirSync(path.dirname(outputPath), { recursive: true });",
        "fs.writeFileSync(outputPath, 'normalized wav bytes');",
      ].join("\n"),
    );

    const abortingAudioProvider: ParserProvider = {
      id: "fake-hosted-audio-parser-abort",
      locality: "local",
      openness: "open_source",
      priority: 500,
      runtime: "node",
      async discover() {
        return {
          available: true,
          reason: "available for hosted Linq audio abort test",
        };
      },
      supports(request) {
        return (request.preparedKind ?? request.artifact.kind) === "audio";
      },
      async run(request) {
        providerSignals.push(request.signal);
        controller.abort(abortReason);
        return {
          text: transcript,
        };
      },
    };
    const downloadDriver = {
      downloadPart: vi.fn(async (part: { url?: string | null }) => {
        assert.equal(part.url, "https://cdn.example.test/attachments/aborted-audio.m4a");
        return audioBytes;
      }),
      downloadUrl: vi.fn(async (url: string) => {
        assert.equal(url, "https://cdn.example.test/attachments/aborted-audio.m4a");
        return audioBytes;
      }),
    };

    mocks.createHostedLinqAttachmentDownloadDriver.mockReturnValue(downloadDriver);
    mocks.createConfiguredParserRegistry.mockResolvedValue({
      ffmpeg: {
        allowSystemLookup: false,
        commandCandidates: [fakeFfmpeg],
      },
      registry: createParserRegistry([abortingAudioProvider]),
    });
    mocks.markLinqChatRead.mockResolvedValue(undefined);

    try {
      const wake = buildHostedExecutionLinqConversationMessageWake({
        eventId: "evt_linq_audio_abort",
        linqMessage: {
          chatId: "chat_linq_audio_abort",
          from: "+15551234567",
          isFromMe: false,
          messageId: "msg_linq_audio_abort",
          parts: [
            {
              attachmentId: "att_audio_abort",
              fileName: "Audio Abort.m4a",
              mimeType: "audio/mp4",
              size: audioBytes.byteLength,
              type: "media",
              url: "https://cdn.example.test/attachments/aborted-audio.m4a",
            },
          ],
          service: "iMessage",
        },
        occurredAt: "2026-04-29T17:22:20.000Z",
        phoneLookupKey: "15551234567",
        userId: "member_linq_audio",
      });
      const mailboxItem = createConversationMailboxItemForWake(wake, {
        id: "mailbox_item_linq_audio_abort",
      });
      const mailboxPort = createSingleItemMailboxPort(mailboxItem);
      const importItem = createHostedConversationMailboxImportItem({
        decodePayload: createDecodedPayloadDecoder(wake),
        prepareWakeContext: async () => {},
        runtime: createRuntimeConfig(),
        stageAssistantInputEvent: async () => ({
          async recordAttachmentEvidence() {
            return true;
          },
          async recordProjection() {},
          inputId: "assistant_input_linq_audio_abort",
        }),
        vaultRoot,
      });
      let state = createEmptyHostedMailboxImportState();

      const firstImport = await fetchAndProcessHostedMailboxPrefix({
        expectedUserId: "member_linq_audio",
        importItem: (item) => importItem(item, { signal: controller.signal }),
        lanes: ["conversation"],
        limitPerLane: 10,
        mailboxPort: mailboxPort.port,
        requestId: "linq-audio-abort-first",
        state,
      });
      state = firstImport.state;

      assert.deepEqual(providerSignals, [undefined]);
      assert.equal(firstImport.importedCount, 1);
      assert.equal(firstImport.blocked.length, 0);
      assert.equal(state.watermarks.conversation, "1");
      assert.equal(mailboxPort.fetchRequests.length, 1);
      assert.equal(mailboxPort.fetchRequests[0]?.lanes[0]?.importedSeq, "0");
      await assertSingleLinqAudioCapture({
        parseState: "succeeded",
        transcript,
        vaultRoot,
      });

      const replay = await fetchAndProcessHostedMailboxPrefix({
        expectedUserId: "member_linq_audio",
        importItem,
        lanes: ["conversation"],
        limitPerLane: 10,
        mailboxPort: mailboxPort.port,
        requestId: "linq-audio-abort-replay",
        state,
      });
      state = replay.state;
      assert.equal(replay.importedCount, 0);
      assert.equal(replay.blocked.length, 0);
      assert.equal(state.watermarks.conversation, "1");
      assert.equal(mailboxPort.fetchRequests.length, 2);
      assert.equal(mailboxPort.fetchRequests[1]?.lanes[0]?.importedSeq, "1");
      await assertSingleLinqAudioCapture({
        parseState: "succeeded",
        transcript,
        vaultRoot,
      });
      assert.equal(providerSignals.length, 1);
    } finally {
      await rm(workspaceRoot, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 50,
      });
    }
  });

  it("keeps audio parser jobs pending when stop aborts before parser drain", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-linq-audio-pre-drain-abort-"));
    const vaultRoot = path.join(workspaceRoot, "vault");
    const fakeFfmpeg = path.join(workspaceRoot, "fake-ffmpeg");
    const audioBytes = Uint8Array.from([8, 7, 6, 5, 4, 3, 2]);
    const controller = new AbortController();
    const abortReason = new DOMException("Stopped before drain", "AbortError");
    const providerSignals: Array<AbortSignal | undefined> = [];
    const transcript = "Retry drained the still-pending audio job.";

    await initializeVault({ vaultRoot, createdAt: "2026-04-29T00:00:00.000Z" });
    await writeExecutableNodeScript(
      fakeFfmpeg,
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "const outputPath = process.argv.at(-1);",
        "fs.mkdirSync(path.dirname(outputPath), { recursive: true });",
        "fs.writeFileSync(outputPath, 'normalized wav bytes');",
      ].join("\n"),
    );

    const audioProvider: ParserProvider = {
      id: "fake-hosted-audio-parser-pre-drain-abort",
      locality: "local",
      openness: "open_source",
      priority: 500,
      runtime: "node",
      async discover() {
        return {
          available: true,
          reason: "available for hosted Linq audio pre-drain abort test",
        };
      },
      supports(request) {
        return (request.preparedKind ?? request.artifact.kind) === "audio";
      },
      async run(request) {
        providerSignals.push(request.signal);
        return {
          text: transcript,
        };
      },
    };
    const downloadDriver = {
      downloadPart: vi.fn(async (part: { url?: string | null }) => {
        assert.equal(part.url, "https://cdn.example.test/attachments/pre-drain-audio.m4a");
        return audioBytes;
      }),
      downloadUrl: vi.fn(async (url: string) => {
        assert.equal(url, "https://cdn.example.test/attachments/pre-drain-audio.m4a");
        return audioBytes;
      }),
    };

    mocks.createHostedLinqAttachmentDownloadDriver.mockReturnValue(downloadDriver);
    mocks.createConfiguredParserRegistry.mockImplementationOnce(async () => {
      controller.abort(abortReason);
      return {
        ffmpeg: {
          allowSystemLookup: false,
          commandCandidates: [fakeFfmpeg],
        },
        registry: createParserRegistry([audioProvider]),
      };
    });
    mocks.markLinqChatRead.mockResolvedValue(undefined);

    try {
      const wake = buildHostedExecutionLinqConversationMessageWake({
        eventId: "evt_linq_audio_pre_drain_abort",
        linqMessage: {
          chatId: "chat_linq_audio_pre_drain_abort",
          from: "+15551234567",
          isFromMe: false,
          messageId: "msg_linq_audio_pre_drain_abort",
          parts: [
            {
              attachmentId: "att_audio_pre_drain_abort",
              fileName: "Audio Pre Drain Abort.m4a",
              mimeType: "audio/mp4",
              size: audioBytes.byteLength,
              type: "media",
              url: "https://cdn.example.test/attachments/pre-drain-audio.m4a",
            },
          ],
          service: "iMessage",
        },
        occurredAt: "2026-04-29T17:22:20.000Z",
        phoneLookupKey: "15551234567",
        userId: "member_linq_audio",
      });

      await assert.rejects(
        withTestTimeout(
          importHostedConversationMessageWakeIntoLocalInbox({
            runtime: createRuntimeConfig(),
            signal: controller.signal,
            vaultRoot,
            wake,
          }),
          "pre-drain aborted parser projection did not settle",
        ),
        (error) => error === abortReason,
      );

      assert.deepEqual(providerSignals, []);
      const runtime = await openInboxRuntime({ vaultRoot });
      try {
        const captures = runtime.listCaptures({
          limit: 10,
          source: "linq",
        });
        assert.equal(captures.length, 1);
        const capture = captures[0];
        assert.ok(capture);
        const attachment = capture.attachments[0];
        assert.ok(attachment);
        assert.equal(attachment.parseState, "pending");
        assert.equal(attachment.transcriptText ?? null, null);
        assert.equal(
          runtime.listAttachmentParseJobs({
            captureId: capture.captureId,
            limit: 10,
            state: "pending",
          }).length,
          1,
        );
        assert.equal(
          runtime.listAttachmentParseJobs({
            captureId: capture.captureId,
            limit: 10,
            state: "failed",
          }).length,
          0,
        );
      } finally {
        runtime.close();
      }

      mocks.createConfiguredParserRegistry.mockResolvedValue({
        ffmpeg: {
          allowSystemLookup: false,
          commandCandidates: [fakeFfmpeg],
        },
        registry: createParserRegistry([audioProvider]),
      });
      const retryResult = await importHostedConversationMessageWakeIntoLocalInbox({
        runtime: createRuntimeConfig(),
        vaultRoot,
        wake,
      });
      assert.deepEqual(retryResult.metrics, {
        nextWakeAt: null,
        parserProcessed: 1,
      });
      await assertSingleLinqAudioCapture({
        parseState: "succeeded",
        transcript,
        vaultRoot,
      });
      assert.deepEqual(providerSignals, [undefined]);
    } finally {
      await rm(workspaceRoot, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 50,
      });
    }
  });

  it("stores and transcribes generic iMessage audio media without requiring voice_memo classification", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-linq-audio-"));
    const vaultRoot = path.join(workspaceRoot, "vault");
    const fakeFfmpeg = path.join(workspaceRoot, "fake-ffmpeg");
    const audioBytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6]);
    const parserInputs: Array<{ inputPath: string; preparedKind: string | null }> = [];

    await initializeVault({ vaultRoot, createdAt: "2026-04-29T00:00:00.000Z" });
    await writeExecutableNodeScript(
      fakeFfmpeg,
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "const outputPath = process.argv.at(-1);",
        "fs.mkdirSync(path.dirname(outputPath), { recursive: true });",
        "fs.writeFileSync(outputPath, 'normalized wav bytes');",
      ].join("\n"),
    );

    const fakeAudioProvider: ParserProvider = {
      id: "fake-hosted-audio-parser",
      locality: "local",
      openness: "open_source",
      priority: 500,
      runtime: "node",
      async discover() {
        return {
          available: true,
          reason: "available for hosted Linq audio ingestion test",
        };
      },
      supports(request) {
        return (request.preparedKind ?? request.artifact.kind) === "audio";
      },
      async run(request) {
        parserInputs.push({
          inputPath: request.inputPath,
          preparedKind: request.preparedKind ?? null,
        });
        return {
          text: "Remember to log the voice note",
        };
      },
    };
    const downloadDriver = {
      downloadPart: vi.fn(async (part: { url?: string | null }) => {
        assert.equal(part.url, "https://cdn.example.test/attachments/audio-message.m4a");
        return audioBytes;
      }),
      downloadUrl: vi.fn(async (url: string) => {
        assert.equal(url, "https://cdn.example.test/attachments/audio-message.m4a");
        return audioBytes;
      }),
    };

    mocks.createHostedLinqAttachmentDownloadDriver.mockReturnValue(downloadDriver);
    mocks.createConfiguredParserRegistry.mockResolvedValue({
      ffmpeg: {
        allowSystemLookup: false,
        commandCandidates: [fakeFfmpeg],
      },
      registry: createParserRegistry([fakeAudioProvider]),
    });
    mocks.markLinqChatRead.mockResolvedValue(undefined);

    try {
      const importResult = await importHostedConversationMessageWakeIntoLocalInbox({
        runtime: {
          forwardedEnv: {},
          userEnv: {},
          platform: {
            artifactStore: {
              async get() {
                return null;
              },
              async put() {},
            },
            deviceSyncPort: null,
            effectsPort: createHostedRuntimeEffectsPortStub(),
            usageRecordPort: null,
          },
          platformEnv: {},
        },
        vaultRoot,
        wake: buildHostedExecutionLinqConversationMessageWake({
          eventId: "evt_linq_audio_media",
          linqMessage: {
            chatId: "chat_linq_audio",
            from: "+15551234567",
            isFromMe: false,
            messageId: "msg_linq_audio_media",
            parts: [
              {
                attachmentId: "att_audio_media",
                fileName: "Audio Message.m4a",
                mimeType: "audio/mp4",
                size: audioBytes.byteLength,
                type: "media",
                url: "https://cdn.example.test/attachments/audio-message.m4a",
              },
            ],
            service: "iMessage",
          },
          occurredAt: "2026-04-29T17:22:20.000Z",
          phoneLookupKey: "15551234567",
          userId: "member_linq_audio",
        }),
      });
      assert.deepEqual(importResult.metrics, {
        nextWakeAt: null,
        parserProcessed: 1,
      });
      expect(downloadDriver.downloadPart).toHaveBeenCalledTimes(1);
      expect(downloadDriver.downloadUrl).not.toHaveBeenCalled();
      assert.equal(parserInputs.length, 1);
      assert.equal(parserInputs[0]?.preparedKind, "audio");

      const runtime = await openInboxRuntime({ vaultRoot });
      try {
        const captures = runtime.listCaptures({
          limit: 10,
          source: "linq",
        });
        assert.equal(captures.length, 1);
        const capture = captures[0];
        assert.ok(capture);
        assert.equal(capture.text, null);
        assert.equal(capture.raw.media_part_count, 1);
        assert.equal(capture.raw.voice_memo_part_count, 0);
        assert.equal(capture.attachments.length, 1);
        const attachment = capture.attachments[0];
        assert.ok(attachment);
        assert.equal(attachment.kind, "audio");
        assert.equal(attachment.mime, "audio/mp4");
        assert.equal(attachment.fileName, "Audio Message.m4a");
        assert.equal(attachment.byteSize, audioBytes.byteLength);
        assert.equal(attachment.parseState, "succeeded");
        assert.equal(attachment.transcriptText, "Remember to log the voice note");
        assert.equal(attachment.extractedText ?? null, null);
        const storedPath = attachment.storedPath;
        if (typeof storedPath !== "string") {
          assert.fail("Expected audio attachment to have a stored path.");
        }
        assert.ok(storedPath.startsWith("raw/inbox/"));
        assert.deepEqual(
          Array.from(await readFile(path.join(vaultRoot, storedPath))),
          Array.from(audioBytes),
        );

        const hits = runtime.searchCaptures({
          limit: 10,
          text: "voice note",
        });
        assert.equal(hits.length, 1);
        assert.equal(hits[0]?.captureId, capture.captureId);
        assert.match(hits[0]?.snippet ?? "", /Remember to log the voice note/u);
      } finally {
        runtime.close();
      }
    } finally {
      await rm(workspaceRoot, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 50,
      });
    }
  });
});

function createRuntimeConfig(): Pick<
  NormalizedHostedAssistantRuntimeConfig,
  | "forwardedEnv"
  | "parserToolchain"
  | "platform"
  | "platformEnv"
  | "resolvedConfig"
  | "userEnv"
> {
  return {
    forwardedEnv: {},
    parserToolchain: null,
    platform: {
      artifactStore: {
        async get() {
          return null;
        },
        async put() {},
      },
      deviceSyncPort: null,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      usageRecordPort: null,
    },
    platformEnv: {},
    resolvedConfig: {
      channelCapabilities: {
        emailSendReady: false,
        telegramBotConfigured: false,
      },
      deviceSync: null,
      managedAutoReplyChannels: [
        {
          capabilityReady: true,
          channel: "linq",
          memberChannel: "linq",
        },
      ],
    },
    userEnv: {},
  };
}

function createDecodedPayloadDecoder(wake: HostedExecutionConversationMessageWake) {
  return {
    async decode() {
      return {
        status: "decoded" as const,
        wake,
      };
    },
  };
}

function createConversationMailboxItemForWake(
  wake: HostedExecutionConversationMessageWake,
  overrides: Partial<HostedMailboxItem> = {},
): HostedMailboxItem {
  return {
    consumedAt: null,
    createdAt: wake.occurredAt,
    dedupeKey: wake.eventId,
    expiresAt: null,
    id: "mailbox_item_linq_audio",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: wake.occurredAt,
    payloadBytes: 128,
    payloadInlineCiphertext: "ciphertext_inline_synthetic",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: wake.occurredAt,
    userId: wake.userId,
    ...overrides,
  };
}

function createSingleItemMailboxPort(item: HostedMailboxItem): {
  fetchRequests: HostedMailboxFetchRequest[];
  port: {
    fetch(request: HostedMailboxFetchRequest): Promise<{
      consumedSeqByLane: [];
      fetchedAt: string;
      items: HostedMailboxItem[];
      maxSeqByLane: [{ lane: "conversation"; maxSeq: string }];
      userId: string;
    }>;
    fetchPayload(request: HostedMailboxPayloadFetchRequest): Promise<never>;
  };
} {
  const fetchRequests: HostedMailboxFetchRequest[] = [];

  return {
    fetchRequests,
    port: {
      async fetch(request) {
        fetchRequests.push(request);
        const conversationCursor = request.lanes.find((lane) => lane.lane === "conversation");
        const shouldIncludeItem = conversationCursor
          ? BigInt(item.laneSeq) > BigInt(conversationCursor.importedSeq)
          : false;
        return {
          consumedSeqByLane: [],
          fetchedAt: item.updatedAt,
          items: shouldIncludeItem ? [item] : [],
          maxSeqByLane: [
            {
              lane: "conversation",
              maxSeq: item.laneSeq,
            },
          ],
          userId: item.userId,
        };
      },
      async fetchPayload(_request) {
        assert.fail("Inline payload test should not fetch sidecar payload.");
      },
    },
  };
}

async function assertSingleLinqAudioCapture(input: {
  parseState: "pending" | "succeeded";
  transcript: string | null;
  vaultRoot: string;
}): Promise<void> {
  const runtime = await openInboxRuntime({ vaultRoot: input.vaultRoot });
  try {
    const captures = runtime.listCaptures({
      limit: 10,
      source: "linq",
    });
    assert.equal(captures.length, 1);
    const capture = captures[0];
    assert.ok(capture);
    const attachment = capture.attachments[0];
    assert.ok(attachment);
    assert.equal(attachment.parseState, input.parseState);
    assert.equal(attachment.transcriptText ?? null, input.transcript);
    assert.equal(
      runtime.listAttachmentParseJobs({
        captureId: capture.captureId,
        limit: 10,
        state: "failed",
      }).length,
      0,
    );
  } finally {
    runtime.close();
  }
}

async function writeExecutableNodeScript(filePath: string, body: string): Promise<void> {
  await writeFile(filePath, `#!/usr/bin/env node\n${body}\n`, "utf8");
  await chmod(filePath, 0o755);
}

async function withTestTimeout<T>(
  promise: Promise<T>,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), 1_000);
  });
  try {
    return await Promise.race([promise, timer]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
