#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const BUILD_ARTIFACTS = {
  "packages/contracts": "tsconfig.build.tsbuildinfo",
  "packages/hosted-execution": ".tsbuildinfo",
  "packages/cloudflare-hosted-control": ".tsbuildinfo",
  "packages/messaging-ingress": ".tsbuildinfo",
  "packages/runtime-state": ".tsbuildinfo",
  "packages/operator-config": ".tsbuildinfo",
  "packages/assistant-engine": ".tsbuildinfo",
  "packages/assistant-cli": ".tsbuildinfo",
  "packages/setup-cli": ".tsbuildinfo",
  "packages/gateway-core": ".tsbuildinfo",
  "packages/gateway-local": ".tsbuildinfo",
  "packages/core": "tsconfig.build.tsbuildinfo",
  "packages/importers": ".tsbuildinfo",
  "packages/device-syncd": ".tsbuildinfo",
  "packages/query": ".tsbuildinfo",
  "packages/inboxd": ".tsbuildinfo",
  "packages/parsers": ".tsbuildinfo",
  "packages/inbox-services": ".tsbuildinfo",
  "packages/vault-usecases": ".tsbuildinfo",
  "packages/cli": ".tsbuildinfo",
  "packages/openclaw-plugin": ".tsbuildinfo",
  "packages/assistant-runtime": ".tsbuildinfo",
  "packages/assistantd": ".tsbuildinfo",
};

const CLEAN_GROUPS = {
  workspace: [
    "packages/contracts",
    "packages/hosted-execution",
    "packages/cloudflare-hosted-control",
    "packages/messaging-ingress",
    "packages/runtime-state",
    "packages/operator-config",
    "packages/assistant-engine",
    "packages/assistant-cli",
    "packages/setup-cli",
    "packages/gateway-core",
    "packages/gateway-local",
    "packages/core",
    "packages/importers",
    "packages/device-syncd",
    "packages/query",
    "packages/inboxd",
    "packages/parsers",
    "packages/inbox-services",
    "packages/vault-usecases",
    "packages/cli",
    "packages/openclaw-plugin",
    "packages/assistant-runtime",
    "packages/assistantd",
  ],
  "test-runtime": [
    "packages/contracts",
    "packages/hosted-execution",
    "packages/cloudflare-hosted-control",
    "packages/messaging-ingress",
    "packages/runtime-state",
    "packages/operator-config",
    "packages/assistant-engine",
    "packages/assistant-cli",
    "packages/setup-cli",
    "packages/gateway-core",
    "packages/gateway-local",
    "packages/core",
    "packages/importers",
    "packages/device-syncd",
    "packages/query",
    "packages/inboxd",
    "packages/parsers",
    "packages/inbox-services",
    "packages/vault-usecases",
    "packages/cli",
    "packages/assistantd",
  ],
};

const args = process.argv.slice(2);
const printOnly = args.includes("--print");
const groupName = args.find((argument) => !argument.startsWith("-"));

if (!groupName || !(groupName in CLEAN_GROUPS)) {
  console.error(
    "Usage: node scripts/clean-build-artifacts.mjs <workspace|test-runtime> [--print]",
  );
  process.exitCode = 1;
} else {
  const paths = CLEAN_GROUPS[groupName].flatMap((packageDir) => [
    `${packageDir}/dist`,
    `${packageDir}/${BUILD_ARTIFACTS[packageDir]}`,
  ]);

  if (printOnly) {
    for (const targetPath of paths) {
      console.log(targetPath);
    }
  } else {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const rmPathsScript = path.join(scriptDir, "rm-paths.mjs");
    const result = spawnSync(process.execPath, [rmPathsScript, ...paths], {
      stdio: "inherit",
    });

    if (result.error) {
      throw result.error;
    }

    process.exitCode = result.status ?? 1;
  }
}
