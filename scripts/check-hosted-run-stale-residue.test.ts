import { describe, expect, it, vi } from "vitest";

import {
  findHostedRunStaleResidueMatches,
  shouldScanHostedRunProductionFile,
} from "./check-hosted-run-stale-residue.ts";

describe("check-hosted-run-stale-residue", () => {
  it("does not scan the repo when imported as a helper module", async () => {
    vi.doMock("node:fs/promises", async () => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      return {
        ...actual,
        async readdir() {
          throw new Error("import should not scan");
        },
      };
    });

    try {
      const moduleUrl = new URL(
        `./check-hosted-run-stale-residue.ts?import-test=${Date.now()}`,
        import.meta.url,
      ).href;
      await expect(
        import(/* @vite-ignore */ moduleUrl),
      ).resolves.toHaveProperty("findHostedRunStaleResidueMatches");
    } finally {
      vi.doUnmock("node:fs/promises");
    }
  });

  it("scans production app and package source files only", () => {
    expect(shouldScanHostedRunProductionFile("apps/web/app/api/internal/hosted-run/route.ts")).toBe(
      true,
    );
    expect(shouldScanHostedRunProductionFile("packages/hosted-execution/src/contracts.ts")).toBe(
      true,
    );
    expect(shouldScanHostedRunProductionFile("apps/web/prisma/schema.prisma")).toBe(true);
    expect(
      shouldScanHostedRunProductionFile("apps/web/prisma/migrations/2026040600_init/migration.sql"),
    ).toBe(false);
    expect(shouldScanHostedRunProductionFile("apps/web/test/hosted-wake-routes.test.ts")).toBe(
      false,
    );
    expect(
      shouldScanHostedRunProductionFile(
        "packages/assistant-runtime/test/hosted-runtime-events.test.ts",
      ),
    ).toBe(false);
  });

  it("flags deleted hosted-run production paths", () => {
    expect(
      findHostedRunStaleResidueMatches("apps/web/src/lib/hosted-run/store.ts", "export {};"),
    ).toEqual([
      {
        kind: "path",
        filePath: "apps/web/src/lib/hosted-run/store.ts",
        matched: "apps/web/src/lib/hosted-run/",
      },
    ]);
  });

  it("flags blocked stale hosted-run tokens with line numbers", () => {
    expect(
      findHostedRunStaleResidueMatches(
        "apps/cloudflare/src/user-runner.ts",
        [
          "const lease = request.runDrain;",
          "const token = runToken;",
          "const hint = targetCommittedSeqHint;",
        ].join("\n"),
      ),
    ).toEqual([
      {
        kind: "content",
        filePath: "apps/cloudflare/src/user-runner.ts",
        matched: "runDrain",
        line: 1,
      },
      {
        kind: "content",
        filePath: "apps/cloudflare/src/user-runner.ts",
        matched: "runToken",
        line: 2,
      },
      {
        kind: "content",
        filePath: "apps/cloudflare/src/user-runner.ts",
        matched: "targetCommittedSeqHint",
        line: 3,
      },
    ]);
  });

  it("allows hosted-runner production names, parser legacy rejection tables, and tests", () => {
    expect(
      findHostedRunStaleResidueMatches(
        "apps/web/src/lib/hosted-runner/control.ts",
        "type HostedRunnerNudgeResult = { nudged: boolean };",
      ),
    ).toEqual([]);
    expect(
      findHostedRunStaleResidueMatches(
        "packages/hosted-execution/src/parsers/runtime-control.ts",
        `const removedFields = ["committedSeq", "runDrain", "runToken", "finalizeRequired", "targetCommittedSeqHint"];`,
      ),
    ).toEqual([]);
    expect(shouldScanHostedRunProductionFile("apps/cloudflare/test/workers/test-hosted-wake-control.ts")).toBe(
      false,
    );
  });

  it("flags stale targetCommittedSeqHint residue in assistant-runtime production code", () => {
    expect(
      findHostedRunStaleResidueMatches(
        "packages/assistant-runtime/src/hosted-runtime/execution.ts",
        "const targetCommittedSeqHint = input.cursor.committedSeq;",
      ),
    ).toEqual([
      {
        kind: "content",
        filePath: "packages/assistant-runtime/src/hosted-runtime/execution.ts",
        matched: "committedSeq",
        line: 1,
      },
      {
        kind: "content",
        filePath: "packages/assistant-runtime/src/hosted-runtime/execution.ts",
        matched: "targetCommittedSeqHint",
        line: 1,
      },
    ]);
  });

  it("flags old hosted run and ingress schema names in the active schema", () => {
    expect(
      findHostedRunStaleResidueMatches(
        "apps/web/prisma/schema.prisma",
        [
          "model HostedRunLog {",
          "model HostedIngressEvent {",
          "@@map(\"hosted_ingress_payload\")",
        ].join("\n"),
      ),
    ).toEqual([
      {
        kind: "content",
        filePath: "apps/web/prisma/schema.prisma",
        matched: "HostedIngressEvent",
        line: 2,
      },
      {
        kind: "content",
        filePath: "apps/web/prisma/schema.prisma",
        matched: "HostedRunLog",
        line: 1,
      },
      {
        kind: "content",
        filePath: "apps/web/prisma/schema.prisma",
        matched: "hosted_ingress_payload",
        line: 3,
      },
    ]);
  });
});
