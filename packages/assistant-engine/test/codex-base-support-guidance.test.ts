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
      "Only in a verified private direct conversation",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "In groups or unverified audiences, give the address and move account-linked escalation to private Murph.",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Never promise a ticket, response, fix, follow-up, or timing",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "never retry or evade the daily limit",
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
