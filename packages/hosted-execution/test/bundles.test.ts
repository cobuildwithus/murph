import { describe, expect, it } from "vitest";

import {
  HOSTED_EXECUTION_BUNDLE_SLOTS,
  createEmptyHostedExecutionBundleRefs,
  mapHostedExecutionBundleSlots,
  mapHostedExecutionBundleSlotsAsync,
  parseHostedExecutionBundlePayloads,
  parseHostedExecutionBundleRefsRecord,
  resolveHostedExecutionBundleKind,
} from "../src/index.ts";

describe("hosted execution bundle helpers", () => {
  it("keeps slot ownership in one canonical place", () => {
    expect(HOSTED_EXECUTION_BUNDLE_SLOTS).toEqual(["agentState", "vault"]);
    expect(HOSTED_EXECUTION_BUNDLE_SLOTS.map((slot) => resolveHostedExecutionBundleKind(slot))).toEqual([
      "agent-state",
      "vault",
    ]);
  });

  it("parses bundle payloads and refs through the shared slot map", () => {
    expect(parseHostedExecutionBundlePayloads({
      agentState: "agent-bytes",
      vault: null,
    })).toEqual({
      agentState: "agent-bytes",
      vault: null,
    });

    expect(parseHostedExecutionBundleRefsRecord({
      agentState: {
        hash: "abc",
        key: "bundles/agent-state/abc",
        size: 12,
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      vault: null,
    })).toEqual({
      agentState: {
        hash: "abc",
        key: "bundles/agent-state/abc",
        size: 12,
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      vault: null,
    });
  });

  it("preserves empty bundle payload strings for the shared wire contract", () => {
    expect(parseHostedExecutionBundlePayloads({
      agentState: "",
      vault: null,
    })).toEqual({
      agentState: "",
      vault: null,
    });
  });

  it("supports shared sync and async slot mapping", async () => {
    expect(createEmptyHostedExecutionBundleRefs()).toEqual({
      agentState: null,
      vault: null,
    });

    expect(mapHostedExecutionBundleSlots((slot) => slot.toUpperCase())).toEqual({
      agentState: "AGENTSTATE",
      vault: "VAULT",
    });

    expect(await mapHostedExecutionBundleSlotsAsync(async (slot) => `${slot}:mapped`)).toEqual({
      agentState: "agentState:mapped",
      vault: "vault:mapped",
    });
  });
});
