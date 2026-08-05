import { describe, expect, it } from "vitest";

import {
  MURPH_CODEX_BASE_INSTRUCTIONS,
} from "../src/assistant/codex-base-instructions.js";

describe("Murph Codex base support guidance", () => {
  it("keeps product failures background-first and support contact opt-in", () => {
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "support@withmurph.ai",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "murph.submit_product_feedback",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "do not volunteer contact details",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "de-identified summary not beginning `Support escalation:`",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "briefly say you flagged it for the product team",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "This exception is not silent",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Give support@withmurph.ai only when the user explicitly asks for it.",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Only after a verified-private user asks for Murph human support",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "without giving the address",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Never promise a ticket, response, fix, follow-up, or timing",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "never retry",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).not.toContain(
      "For Murph product problems, give support@withmurph.ai directly",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).not.toContain(
      "give the address and move account-linked escalation",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).not.toContain(
      "say a de-identified report is queued and give the address",
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
