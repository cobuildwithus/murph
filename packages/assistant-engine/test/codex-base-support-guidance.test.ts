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
      "exception to the ordinary rule that product-feedback capture stays silent",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Never promise a ticket number, a human response, a fix, automatic follow-up, or response timing.",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "The server owns the daily alert limit; never retry the tool",
    );
  });

  it("names the public repository without widening authority", () => {
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "https://github.com/cobuildwithus/murph",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Public repository access does not imply access to private repositories, production systems, deployment authority, support consoles, internal communications, or credentials.",
    );
  });
});
