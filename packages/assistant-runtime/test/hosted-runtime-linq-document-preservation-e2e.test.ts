import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { initializeVault } from "@murphai/core";
import {
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";
import { createIntegratedInboxServices } from "@murphai/inbox-services";
import { openInboxRuntime } from "@murphai/inboxd";
import { createParserRegistry } from "@murphai/parsers";
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
import {
  ensureHostedInboxSidecarReady,
} from "../src/hosted-runtime/context.ts";

describe("hosted Linq document preservation", () => {
  it("bootstraps the hosted inbox sidecar before document preservation", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-linq-document-"));
    const vaultRoot = path.join(workspaceRoot, "vault");
    const pdfBytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const importDocument = vi.fn(async (input: { filePath: string }) => {
      await access(input.filePath);
      return {
        documentId: "doc_preserved_pdf",
        event: {
          id: "event_preserved_pdf",
        },
      };
    });

    await initializeVault({ vaultRoot, createdAt: "2026-04-29T00:00:00.000Z" });

    mocks.createHostedLinqAttachmentDownloadDriver.mockReturnValue({
      downloadPart: vi.fn(async (part: { url?: string | null }) => {
        assert.equal(part.url, "https://cdn.example.test/attachments/lab-results.pdf");
        return pdfBytes;
      }),
      downloadUrl: vi.fn(async (url: string) => {
        assert.equal(url, "https://cdn.example.test/attachments/lab-results.pdf");
        return pdfBytes;
      }),
    });
    mocks.createConfiguredParserRegistry.mockResolvedValue({
      ffmpeg: undefined,
      registry: createParserRegistry([]),
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
          eventId: "evt_linq_pdf_media",
          linqMessage: {
            chatId: "chat_linq_pdf",
            from: "+15551234567",
            isFromMe: false,
            messageId: "msg_linq_pdf_media",
            parts: [
              {
                attachmentId: "att_pdf_media",
                fileName: "lab-results.pdf",
                mimeType: "application/pdf",
                size: pdfBytes.byteLength,
                type: "media",
                url: "https://cdn.example.test/attachments/lab-results.pdf",
              },
            ],
            service: "iMessage",
          },
          occurredAt: "2026-04-29T17:47:55.000Z",
          phoneLookupKey: "15551234567",
          userId: "member_linq_pdf",
        }),
      });

      assert.deepEqual(importResult.metrics, {
        nextWakeAt: null,
        parserProcessed: 0,
      });

      const runtime = await openInboxRuntime({ vaultRoot });
      let captureId: string;
      try {
        const captures = runtime.listCaptures({
          limit: 10,
          source: "linq",
        });
        assert.equal(captures.length, 1);
        const capture = captures[0];
        assert.ok(capture);
        captureId = capture.captureId;
        assert.equal(capture.attachments.length, 1);
        assert.equal(capture.attachments[0]?.kind, "document");
        assert.equal(capture.attachments[0]?.mime, "application/pdf");
        assert.equal(capture.attachments[0]?.parseState ?? null, null);
        assert.equal(runtime.listAttachmentParseJobs({ captureId }).length, 0);
      } finally {
        runtime.close();
      }

      const services = createIntegratedInboxServices({
        loadImportersModule: async () => ({
          createImporters: () => ({
            importDocument,
          }),
        }),
      });

      await expect(
        services.preserveDocumentAttachments({
          captureId,
          requestId: "req_preserve_without_init",
          vault: vaultRoot,
        }),
      ).rejects.toMatchObject({
        code: "INBOX_NOT_INITIALIZED",
      });
      expect(importDocument).not.toHaveBeenCalled();

      await ensureHostedInboxSidecarReady({
        bestEffort: false,
        rebuild: true,
        requestId: "req_init_inbox_runtime",
        vaultRoot,
      });

      await expect(
        services.show({
          captureId,
          requestId: "req_show_after_hosted_sidecar_bootstrap",
          vault: vaultRoot,
        }),
      ).resolves.toMatchObject({
        capture: {
          captureId,
        },
      });

      await expect(
        services.preserveDocumentAttachments({
          captureId,
          requestId: "req_preserve_after_hosted_sidecar_bootstrap",
          vault: vaultRoot,
        }),
      ).resolves.toMatchObject({
        captureId,
        createdCount: 1,
        preservedCount: 1,
      });
      expect(importDocument).toHaveBeenCalledTimes(1);

      await ensureHostedInboxSidecarReady({
        bestEffort: false,
        rebuild: false,
        requestId: "req_idempotent_inbox_runtime",
        vaultRoot,
      });
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
