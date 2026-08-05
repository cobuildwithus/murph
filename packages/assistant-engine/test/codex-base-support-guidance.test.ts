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
      "In a verified private direct conversation",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "show the exact de-identified product-only summary",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "it may be included in an internal support escalation linked to their Murph account",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "A generic request does not approve unseen linkage or summary; wait for affirmative approval.",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "If no safe summary exists, or outside private direct chat, give the address and do not call.",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "the product issue was saved for triage and an account-linked escalation was recorded",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Never claim the issue was emailed or seen",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).not.toContain(
      "a de-identified report is queued",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Never promise a ticket, response, fix, follow-up, or timing",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "never retry or evade daily limits",
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
