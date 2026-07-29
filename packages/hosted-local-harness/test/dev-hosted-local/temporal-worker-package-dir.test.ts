import { describe, expect, it } from "vitest";

import {
  resolveHostedLocalTemporalWorkerPackageDir,
} from "../../src/dev-hosted-local/temporal.ts";

describe("hosted-local Temporal worker package directory", () => {
  it("keeps the in-repo worker as the default", () => {
    expect(resolveHostedLocalTemporalWorkerPackageDir({})).toBe(
      "packages/hosted-orchestrator-temporal",
    );
    expect(resolveHostedLocalTemporalWorkerPackageDir({
      MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR: "   ",
    })).toBe("packages/hosted-orchestrator-temporal");
  });

  it("accepts one trimmed external package directory", () => {
    expect(resolveHostedLocalTemporalWorkerPackageDir({
      MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR:
        "  ../murph-hosted/packages/hosted-orchestrator-temporal  ",
    })).toBe("../murph-hosted/packages/hosted-orchestrator-temporal");
  });
});
