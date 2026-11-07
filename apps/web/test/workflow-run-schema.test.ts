import { createRequire } from "node:module";

import { WorkflowRunSchema } from "@workflow/world";
import { describe, expect, it } from "vitest";

// Resolve from the installed world, so this checks its overridden Zod rather
// than an unrelated app-level copy.
const worldRequire = createRequire(import.meta.resolve("@workflow/world"));

describe("Workflow run schema under the security Zod override", () => {
  it("uses Zod 4.6.6", () => {
    expect(worldRequire("zod/package.json").version).toBe("4.6.6");
  });

  it.each(["pending", "running"])("accepts omitted terminal fields on %s runs", (status) => {
    const run = {
      runId: "wrun_synthetic",
      workflowName: "synthetic-reconciliation",
      deploymentId: "dpl_synthetic",
      status,
      createdAt: "2026-10-30T00:00:00.000Z",
      updatedAt: "2026-10-30T00:00:00.000Z",
    };

    for (const specVersion of [2, 7]) {
      const parsed = WorkflowRunSchema.parse({ ...run, specVersion });
      expect(parsed.status).toBe(status);
      expect(parsed.output).toBeUndefined();
      expect(parsed.error).toBeUndefined();
      expect(parsed.completedAt).toBeUndefined();
    }
    expect(WorkflowRunSchema.safeParse({ ...run, completedAt: run.createdAt }).success)
      .toBe(false);
  });
});
