import { describe, expect, it } from "vitest";

import {
  HOSTED_WORKSPACE_INVOCATION_DEFAULT_IDLE_CHECKPOINT_DELAY_MS,
} from "@murphai/hosted-execution/runtime-control-limits";

import {
  resolveHostedRuntimeCheckpointPublicationExpectedByMs,
  resolveHostedRuntimeIdleCheckpointDelayMs,
} from "../src/hosted-runtime/checkpoint-publication.ts";

describe("hosted runtime checkpoint publication expectation", () => {
  it("uses the default idle window and bounded publication operations", () => {
    const dirtyAtMs = Date.parse("2026-04-27T00:00:00.000Z");

    expect(HOSTED_WORKSPACE_INVOCATION_DEFAULT_IDLE_CHECKPOINT_DELAY_MS).toBe(60_000);
    expect(resolveHostedRuntimeIdleCheckpointDelayMs(null)).toBe(
      HOSTED_WORKSPACE_INVOCATION_DEFAULT_IDLE_CHECKPOINT_DELAY_MS,
    );
    expect(resolveHostedRuntimeCheckpointPublicationExpectedByMs({
      checkpointStartByMs:
        dirtyAtMs + resolveHostedRuntimeIdleCheckpointDelayMs(null),
      commitTimeoutMs: null,
    })).toBe(Date.parse("2026-04-27T00:25:00.000Z"));
  });

  it("derives the expectation from configured idle and control-plane bounds", () => {
    const dirtyAtMs = Date.parse("2026-04-27T00:00:00.000Z");

    expect(resolveHostedRuntimeCheckpointPublicationExpectedByMs({
      checkpointStartByMs:
        dirtyAtMs + resolveHostedRuntimeIdleCheckpointDelayMs(600_000),
      commitTimeoutMs: 15_000,
    })).toBe(Date.parse("2026-04-27T00:33:15.000Z"));
  });
});
