import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createAssistantTurnReceipt,
  finalizeAssistantTurnReceipt,
  readAssistantTurnReceipt,
} from "../src/assistant/turns.ts";

describe("assistant turn receipt redaction", () => {
  it("stores redacted prompt and response previews instead of raw turn text", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "murph-turn-receipt-"));

    try {
      const prompt = "Sensitive health note about sleep, HRV, and supplements.";
      const response = "Private assistant reply with specific user context.";
      const created = await createAssistantTurnReceipt({
        deliveryRequested: false,
        prompt,
        provider: "codex-cli",
        providerModel: "gpt-5.4",
        sessionId: "session_123",
        vault,
      });

      expect(created.promptPreview).toMatch(/^\[redacted \d+ chars sha256:[0-9a-f]{12}\]$/);
      expect(created.promptPreview).not.toContain(prompt);

      const finalized = await finalizeAssistantTurnReceipt({
        response,
        status: "completed",
        turnId: created.turnId,
        vault,
      });

      expect(finalized?.responsePreview).toMatch(/^\[redacted \d+ chars sha256:[0-9a-f]{12}\]$/);
      expect(finalized?.responsePreview).not.toContain(response);

      const reread = await readAssistantTurnReceipt(vault, created.turnId);
      expect(reread?.promptPreview).toBe(created.promptPreview);
      expect(reread?.responsePreview).toBe(finalized?.responsePreview ?? null);
    } finally {
      await rm(vault, { force: true, recursive: true });
    }
  });

  it("redacts portable receipt errors and timeline metadata before persistence", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "murph-turn-receipt-sensitive-"));

    try {
      const created = await createAssistantTurnReceipt({
        deliveryRequested: true,
        metadata: {
          accessToken: "receipt-access-token",
          targetUrl: "https://example.com/send?api_key=secret-token-value",
        },
        prompt: "hello",
        provider: "codex-cli",
        providerModel: "gpt-5.4",
        sessionId: "session_123",
        vault,
      });

      const finalized = await finalizeAssistantTurnReceipt({
        error: {
          code: "ASSISTANT_DELIVERY_FAILED",
          message:
            "Authorization: Bearer secret-token-value failed at https://example.com/send?api_key=secret-token-value under /tmp/murph-secret",
        },
        metadata: {
          "Authorization: Bearer secret-token-value": "metadata-key-secret",
          targetPath: "/tmp/murph-secret",
        },
        status: "failed",
        turnId: created.turnId,
        vault,
      });
      const persisted = await readAssistantTurnReceipt(vault, created.turnId);
      const serialized = JSON.stringify(persisted);

      expect(finalized?.lastError?.message).toContain("[REDACTED]");
      expect(persisted?.lastError?.message).toContain("[url]");
      expect(persisted?.lastError?.message).toContain("[path]");
      expect(persisted?.timeline[0]?.metadata.accessToken).toBe("[REDACTED]");
      expect(persisted?.timeline.at(-1)?.metadata.targetPath).toBe("[path]");
      expect(
        Object.keys(persisted?.timeline.at(-1)?.metadata ?? {}).join(" "),
      ).not.toContain("secret-token-value");
      expect(serialized).not.toContain("secret-token-value");
      expect(serialized).not.toContain("metadata-key-secret");
      expect(serialized).not.toContain("api_key=");
      expect(serialized).not.toContain("/tmp/murph-secret");
    } finally {
      await rm(vault, { force: true, recursive: true });
    }
  });
});
