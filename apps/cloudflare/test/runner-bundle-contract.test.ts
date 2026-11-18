import { describe, expect, it } from "vitest";

import {
  hostedRunnerBuildPackageNames,
  resolveHostedRunnerBuildPackageNames,
  resolveHostedRunnerWorkspacePackageNames,
} from "../scripts/runner-bundle-contract.js";
import { diffReach, readWorkspace } from "../../../scripts/ci-diff-reach.mjs";

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
    expect(reducedBuildPackageNames).not.toContain("@murphai/assistant-cli");
    expect(reducedBuildPackageNames).not.toContain("@murphai/setup-cli");
  });

  it("is reached by a pull request that changes any package it ships", () => {
    const workspace = readWorkspace();
    const shipped = resolveHostedRunnerWorkspacePackageNames();
    expect(shipped).toContain("@murphai/murph");
    for (const name of shipped) {
      const dir = workspace.byName.get(name);
      expect(dir, name).toBeDefined();
      expect(diffReach([`${dir}/src/index.ts`], workspace).changed, name)
        .toContain("apps/cloudflare");
    }
  });
});
