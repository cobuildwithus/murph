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
});
