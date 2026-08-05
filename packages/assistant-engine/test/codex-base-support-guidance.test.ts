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
      "In verified private direct chat",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "show the exact de-identified product-only summary",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "it may enter an internal escalation linked to their Murph account",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Generic escalation approves neither; wait for affirmative approval.",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "If no safe summary or chat not private, give the address only; do not call.",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "issue saved for triage and account-linked escalation recorded",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Never claim email delivery/receipt",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).not.toContain(
      "a de-identified report is queued",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Never promise a ticket, response, fix, follow-up, or timing",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "never retry or evade limits",
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
