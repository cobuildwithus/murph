import { describe, expect, it } from "vitest";

import {
  buildTemporalCompatibilityProducerFixtures,
} from "./temporal-compatibility-producer-fixtures.ts";

describe("Temporal compatibility producer fixtures", () => {
  it("executes the production wire projection across populated and nullable branches", () => {
    const fixtures = buildTemporalCompatibilityProducerFixtures();

    expect(fixtures).toHaveLength(3);
    expect(fixtures[0]).toEqual({
      blocked: null,
      mailboxLag: [],
      workspace: null,
    });
    expect(fixtures[1]).toMatchObject({
      blocked: {
        reason: "hosted_runtime_not_configured",
        retryAt: "2026-01-01T00:02:00.000Z",
      },
      mailboxLag: [{
        maxUpdatedAt: "2026-01-01T00:00:00.000Z",
      }],
      workspace: {
        hostedMailboxSystemHandledThroughSeq: "1",
        systemMailboxFrontier: "model_free",
      },
    });
    expect(fixtures[2]).toEqual({
      blocked: {
        reason: "ai_usage_gate_unavailable",
        retryAt: null,
      },
      mailboxLag: [{
        importedSeq: "0",
        lag: "0",
        lane: "system",
        maxSeq: "0",
      }],
      workspace: {
        inboxMediaRetentionWakeAt: null,
        nextWakeAt: null,
        nextWakeReason: null,
        version: null,
      },
    });
    expect(fixtures).not.toContainEqual(expect.objectContaining({
      environmentInterviewPending: expect.anything(),
    }));
  });
});
