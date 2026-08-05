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
      "don't volunteer contact details",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "de-identified non-`Support escalation:` summary",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Keep ordinary feedback silent",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Give support@withmurph.ai only when asked.",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Explicit verified-private human support",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      'kind: "frustration"`, summary `Support escalation`, no changelog IDs',
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "supportArea/supportProblem; tool builds the safe issue",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Don't show or seek approval",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "issue saved for triage and account-linked escalation recorded",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Never claim email delivery/receipt",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "promise a ticket/response/fix/follow-up/timing",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "or retry",
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
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).not.toContain(
      "disclose potential account linkage",
    );
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).not.toContain(
      "say it was flagged",
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
