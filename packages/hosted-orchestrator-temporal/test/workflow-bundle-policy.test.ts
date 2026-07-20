import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  assertHostedTemporalWorkflowBundle,
  HOSTED_TEMPORAL_WORKFLOW_BUNDLE_MAX_BYTES,
} from "../src/workflow-bundle-policy.js";

describe("hosted Temporal workflow bundle policy", () => {
  it("accepts a small bundle with a dependency-light source graph", () => {
    const code = buildBundle([
      "/workspace/packages/hosted-execution/src/runtime-control.ts",
      "/workspace/packages/hosted-execution/src/vault-share-limits.ts",
      "/workspace/packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts",
    ]);

    expect(assertHostedTemporalWorkflowBundle(code)).toEqual({
      byteLength: Buffer.byteLength(code, "utf8"),
      sourceCount: 3,
    });
  });

  it.each([
    [
      "@murphai/contracts",
      "/workspace/packages/contracts/src/index.ts",
    ],
    [
      "hosted-execution vault-share",
      "/workspace/packages/hosted-execution/src/vault-share.ts",
    ],
  ])("rejects the forbidden %s source closure", (label, source) => {
    expect(() => assertHostedTemporalWorkflowBundle(buildBundle([source])))
      .toThrow(label);
  });

  it("rejects a bundle above the production byte ceiling", () => {
    const oversized = `${"x".repeat(HOSTED_TEMPORAL_WORKFLOW_BUNDLE_MAX_BYTES)}é`;

    expect(() => assertHostedTemporalWorkflowBundle(oversized))
      .toThrow(/production limit/u);
  });

  it("fails closed when dependency-policy evidence is unavailable", () => {
    expect(() => assertHostedTemporalWorkflowBundle("module.exports = {};"))
      .toThrow(/missing its inline source map/u);
  });

  it.each([
    [
      "empty inline source map",
      "module.exports = {};\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,",
      /empty inline source map/u,
    ],
    [
      "invalid inline source map",
      buildBundleFromEncodedSourceMap(
        Buffer.from("not-json", "utf8").toString("base64"),
      ),
      /invalid inline source map/u,
    ],
    [
      "missing sources list",
      buildBundleFromSourceMap({ version: 3 }),
      /has no sources list/u,
    ],
    [
      "invalid source entry",
      buildBundleFromSourceMap({ sources: [1] }),
      /invalid source entry/u,
    ],
  ])("rejects %s evidence", (_label, code, expected) => {
    expect(() => assertHostedTemporalWorkflowBundle(code)).toThrow(expected);
  });
});

function buildBundle(sources: readonly string[]): string {
  return buildBundleFromSourceMap({ sources });
}

function buildBundleFromSourceMap(sourceMap: unknown): string {
  return buildBundleFromEncodedSourceMap(
    Buffer.from(JSON.stringify(sourceMap), "utf8").toString("base64"),
  );
}

function buildBundleFromEncodedSourceMap(encodedSourceMap: string): string {
  return [
    "module.exports = {};",
    `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${encodedSourceMap}`,
  ].join("\n");
}
