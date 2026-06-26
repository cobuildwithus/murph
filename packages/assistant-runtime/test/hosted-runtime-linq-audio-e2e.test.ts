import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { initializeVault } from "@murphai/core";
import {
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";
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

async function writeExecutableNodeScript(filePath: string, body: string): Promise<void> {
  await writeFile(filePath, `#!/usr/bin/env node\n${body}\n`, "utf8");
  await chmod(filePath, 0o755);
}
