import { describe, expect, it } from "vitest";

import {
  resolveHostedLocalTemporalWorkerPackageDir,
} from "../../src/dev-hosted-local/temporal.ts";

describe("hosted-local Temporal worker package directory", () => {
  it("requires an explicit external worker package", () => {
    expect(resolveHostedLocalTemporalWorkerPackageDir({})).toBeNull();
    expect(resolveHostedLocalTemporalWorkerPackageDir({
      MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR: "   ",
    })).toBeNull();
  });

  it("accepts one trimmed external package directory", () => {
    expect(resolveHostedLocalTemporalWorkerPackageDir({
      MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR:
        "  ../murph-cloud/packages/hosted-orchestrator-temporal  ",
    })).toBe("../murph-cloud/packages/hosted-orchestrator-temporal");
  });
});
