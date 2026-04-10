import { describe, expect, it } from "vitest";

import {
  hostedRunnerBuildPackageNames,
  hostedRunnerWorkspacePackageNames,
} from "../scripts/runner-bundle-contract.js";

describe("runner bundle package closure", () => {
  it("keeps the install closure limited to the runtime workspace closure plus the murph shell", () => {
    expect(hostedRunnerWorkspacePackageNames).toEqual([
      "@murphai/assistant-engine",
      "@murphai/assistant-runtime",
      "@murphai/cloudflare-hosted-control",
      "@murphai/contracts",
      "@murphai/core",
      "@murphai/device-syncd",
      "@murphai/gateway-core",
      "@murphai/gateway-local",
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
      "@murphai/vault-usecases",
    ]);
  });

  it("builds the extra workspace packages that murph bundles into its tarball", () => {
    expect(hostedRunnerBuildPackageNames).toEqual([
      "@murphai/assistant-cli",
      "@murphai/assistant-engine",
      "@murphai/assistant-runtime",
      "@murphai/assistantd",
      "@murphai/cloudflare-hosted-control",
      "@murphai/contracts",
      "@murphai/core",
      "@murphai/device-syncd",
      "@murphai/gateway-core",
      "@murphai/gateway-local",
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
});
