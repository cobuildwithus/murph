import type { Profiler } from "node:inspector";
import { describe, expect, it } from "vitest";

import { buildHostedExecutionStructuredLogRecord } from "@murphai/hosted-execution";
import { summarizeHostedContainerCpuProfile } from "../src/container-cpu-profile.ts";

function node(id: number, name: string, url = "", children: number[] = []): Profiler.ProfileNode {
  return {
    id, children,
    callFrame: { functionName: name, url, scriptId: url ? "1" : "0", lineNumber: 9, columnNumber: 2 },
  };
}
function profile(nodes: Profiler.ProfileNode[], samples: number[]): Profiler.Profile {
  return { nodes, samples, startTime: 0, endTime: 1_000_000 };
}

describe("container CPU profile summaries", () => {
  it("keeps self versus inclusive attribution and GC separate from idle", () => {
    const summary = summarizeHostedContainerCpuProfile(profile([
      node(1, "(root)", "", [2, 4, 5]),
      node(2, "rebuildQuery", "file:///app/dist-bundled/query.js", [3]),
      node(3, "execute", "node:sqlite"),
      node(4, "(idle)"), node(5, "(garbage collector)"),
    ], [3, 3, 2, 4, 5]));
    expect(summary).toMatchObject({ activeSamples: 4, idleSamples: 1, gcSamples: 1 });
    expect(summary.topSelfFrames).toContainEqual({ frame: "node:sqlite:10:3 execute", samples: 2 });
    expect(summary.topInclusiveFrames).toContainEqual({ frame: "dist-bundled/query.js:10:3 rebuildQuery", samples: 3 });
    const record = buildHostedExecutionStructuredLogRecord({
      component: "container", phase: "wake.running", userId: null, message: "CPU profile", details: summary,
    });
    expect(record.details?.topInclusiveFrames).toEqual(summary.topInclusiveFrames);
  });

  it("drops private paths and names, traversal, URL suffixes and unknown eval sources", () => {
    const urls = [
      "/workspace/member/private.js", "file:///private/home/example.js", "",
      "/app/dist/../../private.js", "https://example.invalid/private.js",
      "file:///app/dist/file.js?private=value", "file:///app/dist/file.js#private",
      "/app/member/private.js", "/app/node_modules/pkg/file.js/extra",
    ];
    const summary = summarizeHostedContainerCpuProfile(profile(
      urls.map((url, index) => node(index + 1, "privateSymbol", url)),
      urls.map((_, index) => index + 1),
    ));
    expect(summary.topSelfFrames).toEqual([{ frame: "(redacted)", samples: urls.length }]);
    expect(JSON.stringify(summary)).not.toMatch(/private|workspace|home|example/u);
  });

  it("bounds output, sample processing, recursion and untrusted function labels", () => {
    const nodes = Array.from({ length: 100 }, (_, index) => node(
      index + 1, index === 0 ? "payload: secret value" : `operation${index}`,
      "/app/node_modules/@murphai/query/dist/index.js", [((index + 1) % 100) + 1],
    ));
    const summary = summarizeHostedContainerCpuProfile(profile(nodes, Array.from({ length: 60_005 }, (_, i) => i % 100 + 1)));
    expect(summary.samples).toBe(60_000);
    expect(summary.samplesTruncated).toBe(5);
    expect(summary.truncatedStacks).toBe(60_000);
    expect(summary.topSelfFrames).toHaveLength(6);
    expect(summary.topInclusiveFrames).toHaveLength(6);
    expect(JSON.stringify(summary)).not.toContain("secret");
    expect(JSON.stringify(summary).length).toBeLessThan(5_000);
  });

  it("bounds node processing and counts recursive frames once per sample", () => {
    const nodes = [node(1, "same", "/app/dist/query.js", [2]), node(2, "same", "/app/dist/query.js")];
    expect(summarizeHostedContainerCpuProfile(profile(nodes, [2])).topInclusiveFrames[0]?.samples).toBe(1);
    const oversized = Array.from({ length: 50_001 }, (_, index) => node(index + 1, "(idle)"));
    expect(summarizeHostedContainerCpuProfile(profile(oversized, [])).nodesTruncated).toBe(1);
  });
});
