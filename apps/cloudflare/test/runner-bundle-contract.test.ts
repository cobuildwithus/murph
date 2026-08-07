import { describe, expect, it } from "vitest";

import {
  hostedRunnerBuildPackageNames,
  hostedRunnerWorkspacePackageNames,
  publishedMurphBundledExternalPackageNames,
  publishedMurphBundledWorkspacePackageNames,
  resolveHostedRunnerBuildPackageNames,
  resolveHostedRunnerWorkspacePackageNames,
} from "../scripts/runner-bundle-contract.js";

describe("runner bundle package closure", () => {
  it("keeps the install closure limited to the runtime workspace closure plus the murph shell", () => {
    expect(hostedRunnerWorkspacePackageNames).toEqual([
      "@murphai/assistant-cli",
      "@murphai/assistant-engine",
      "@murphai/assistant-runtime",
      "@murphai/assistantd",
      "@murphai/clinical-records",
      "@murphai/cloudflare-hosted-control",
      "@murphai/contracts",
      "@murphai/core",
      "@murphai/device-syncd",
      "@murphai/exercise-library",
      "@murphai/gateway-core",
      "@murphai/health-commons",
      "@murphai/health-metrics",
      "@murphai/hosted-execution",
      "@murphai/importers",
      "@murphai/inbox-services",
      "@murphai/inboxd",
      "@murphai/messaging-ingress",
      "@murphai/murph",
      "@murphai/operator-config",
      "@murphai/parsers",
      "@murphai/query",
      "@murphai/runtime-state",
      "@murphai/setup-cli",
      "@murphai/vault-usecases",
    ]);
  });

  it("builds the extra workspace packages that murph bundles into its tarball", () => {
    expect(publishedMurphBundledExternalPackageNames).toEqual(["incur", "ink"]);
    expect(publishedMurphBundledWorkspacePackageNames).not.toContain("incur");
    expect(publishedMurphBundledWorkspacePackageNames).not.toContain("ink");
    expect(hostedRunnerBuildPackageNames).toEqual([
      "@murphai/assistant-cli",
      "@murphai/assistant-engine",
      "@murphai/assistant-runtime",
      "@murphai/assistantd",
      "@murphai/clinical-records",
      "@murphai/cloudflare-hosted-control",
      "@murphai/contracts",
      "@murphai/core",
      "@murphai/device-syncd",
      "@murphai/exercise-library",
      "@murphai/gateway-core",
      "@murphai/health-commons",
      "@murphai/health-metrics",
      "@murphai/hosted-execution",
      "@murphai/importers",
      "@murphai/inbox-services",
      "@murphai/inboxd",
      "@murphai/messaging-ingress",
      "@murphai/murph",
      "@murphai/operator-config",
      "@murphai/parsers",
      "@murphai/query",
      "@murphai/runtime-state",
      "@murphai/setup-cli",
      "@murphai/vault-usecases",
    ]);
  });

  it("can still resolve an explicit reduced bundle closure without the bundled murph shell", () => {
    expect(
      resolveHostedRunnerWorkspacePackageNames({
        includeBundleOnlyDependencies: false,
      }),
    ).toEqual([
      "@murphai/assistant-engine",
      "@murphai/assistant-runtime",
      "@murphai/clinical-records",
      "@murphai/cloudflare-hosted-control",
      "@murphai/contracts",
      "@murphai/core",
      "@murphai/device-syncd",
      "@murphai/gateway-core",
      "@murphai/health-commons",
      "@murphai/health-metrics",
      "@murphai/hosted-execution",
      "@murphai/importers",
      "@murphai/inbox-services",
      "@murphai/inboxd",
      "@murphai/messaging-ingress",
      "@murphai/operator-config",
      "@murphai/parsers",
      "@murphai/query",
      "@murphai/runtime-state",
      "@murphai/vault-usecases",
    ]);
    expect(
      resolveHostedRunnerBuildPackageNames({
        includeBundleOnlyDependencies: false,
      }),
    ).toEqual(
      resolveHostedRunnerWorkspacePackageNames({
        includeBundleOnlyDependencies: false,
      }),
    );
  });
});
