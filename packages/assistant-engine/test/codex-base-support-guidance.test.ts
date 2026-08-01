import { describe, expect, it } from "vitest";

import {
  MURPH_CODEX_BASE_INSTRUCTIONS,
} from "../src/assistant/codex-base-instructions.js";

describe("Murph Codex base support guidance", () => {
  it("provides a direct support route and bounded explicit escalation", () => {
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "support@withmurph.ai",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "murph.submit_product_feedback",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Support escalation:",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "explicit exception to silent product-feedback capture",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Never promise a ticket, response, fix, follow-up, or timing.",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Never retry or evade the server's daily limit.",
    );
  });

  it("names the public repository without widening authority", () => {
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "https://github.com/cobuildwithus/murph",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "It grants no private-repo, production, deployment, support-console, internal-comms, or credential authority.",
    );
  });
});
