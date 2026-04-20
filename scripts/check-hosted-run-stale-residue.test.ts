import { describe, expect, it } from "vitest";

import {
  findHostedRunStaleResidueMatches,
  shouldScanHostedRunProductionFile,
} from "./check-hosted-run-stale-residue.ts";

describe("check-hosted-run-stale-residue", () => {
  it("scans production app and package source files only", () => {
    expect(shouldScanHostedRunProductionFile("apps/web/app/api/internal/hosted-run/route.ts")).toBe(
      true,
    );
    expect(shouldScanHostedRunProductionFile("packages/hosted-execution/src/contracts.ts")).toBe(
      true,
    );
    expect(shouldScanHostedRunProductionFile("apps/web/test/hosted-wake-routes.test.ts")).toBe(
      false,
    );
    expect(
      shouldScanHostedRunProductionFile(
        "packages/assistant-runtime/test/hosted-runtime-events.test.ts",
      ),
    ).toBe(false);
  });

  it("flags deleted hosted-wake production paths", () => {
    expect(
      findHostedRunStaleResidueMatches("apps/web/src/lib/hosted-wake/store.ts", "export {};"),
    ).toEqual([
      {
        kind: "path",
        filePath: "apps/web/src/lib/hosted-wake/store.ts",
        matched: "apps/web/src/lib/hosted-wake",
      },
    ]);
  });

  it("flags blocked stale hosted-wake tokens with line numbers", () => {
    expect(
      findHostedRunStaleResidueMatches(
        "apps/cloudflare/src/user-runner.ts",
        [
          "const terminalState = null;",
          "const assistantNextWakeAt = nextRuntimeWakeAt;",
          "const hints = wakeMaterializationHints;",
        ].join("\n"),
      ),
    ).toEqual([
      {
        kind: "content",
        filePath: "apps/cloudflare/src/user-runner.ts",
        matched: "assistantNextWakeAt",
        line: 2,
      },
      {
        kind: "content",
        filePath: "apps/cloudflare/src/user-runner.ts",
        matched: "wakeMaterializationHints",
        line: 3,
      },
    ]);
  });

  it("allows run-centric production names and grandfathered test paths", () => {
    expect(
      findHostedRunStaleResidueMatches(
        "apps/web/src/lib/hosted-run/store.ts",
        "const nextRuntimeWakeAt = input.run.nextRuntimeWakeAt ?? null;",
      ),
    ).toEqual([]);
    expect(shouldScanHostedRunProductionFile("apps/cloudflare/test/workers/test-hosted-wake-control.ts")).toBe(
      false,
    );
  });

  it("flags stale assistantNextWakeAt residue in assistant-runtime production code", () => {
    expect(
      findHostedRunStaleResidueMatches(
        "packages/assistant-runtime/src/hosted-runtime/execution.ts",
        "const assistantNextWakeAt = nextRuntimeWakeAt;",
      ),
    ).toEqual([
      {
        kind: "content",
        filePath: "packages/assistant-runtime/src/hosted-runtime/execution.ts",
        matched: "assistantNextWakeAt",
        line: 1,
      },
    ]);
  });
});
