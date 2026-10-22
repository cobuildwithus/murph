import { describe, expect, it } from "vitest";

import {
  hostedRunnerBuildPackageNames,
  resolveHostedRunnerBuildPackageNames,
  resolveHostedRunnerWorkspacePackageNames,
} from "../scripts/runner-bundle-contract.js";

describe("runner bundle package closure", () => {
  it("keeps the built CLI as an assembly-only input for the reduced runtime closure", () => {
    const reducedWorkspacePackageNames = resolveHostedRunnerWorkspacePackageNames({
      includeBundleOnlyDependencies: false,
    });
    const reducedBuildPackageNames = resolveHostedRunnerBuildPackageNames({
      includeBundleOnlyDependencies: false,
    });

    expect(reducedWorkspacePackageNames).not.toContain("@murphai/murph");
    expect(reducedBuildPackageNames).toEqual(hostedRunnerBuildPackageNames);
    expect(reducedBuildPackageNames).toContain("@murphai/murph");
    expect(reducedBuildPackageNames).toContain("@murphai/assistant-cli");
    expect(reducedBuildPackageNames).toContain("@murphai/setup-cli");
  });
});
