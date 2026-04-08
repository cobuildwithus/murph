import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, defineProject } from "vitest/config";

import {
  resolveMurphAppVitestMaxWorkers,
  resolveMurphVitestConcurrency,
} from "../../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveHostedWebWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution";
import { resolveVitestBucketFiles } from "../../config/vitest-test-buckets.js";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");
const hostedWebVitestConcurrency = resolveMurphVitestConcurrency();
const hostedWebVitestMaxWorkers = resolveMurphAppVitestMaxWorkers();
const hostedWebAliases = [
  {
    find: "@",
    replacement: path.resolve(repoRoot, "apps/web"),
  },
  ...createVitestWorkspaceRuntimeAliases(resolveHostedWebWorkspaceSourceEntries(appDir)),
];

function hostedWebPattern(pattern: string): string {
  return path.join(appDir, "test", pattern);
}

function createHostedWebProject(name: string, fileNames: readonly string[]) {
  return defineProject({
    resolve: {
      alias: hostedWebAliases,
    },
    test: {
      ...murphVitestNoTimeouts,
      name,
      environment: "node",
      ...hostedWebVitestConcurrency,
      include: fileNames.map(hostedWebPattern),
      setupFiles: [
        path.join(appDir, "test", "setup-env.ts"),
      ],
    },
  });
}

const hostedWebVitestProjectSpecs = resolveVitestBucketFiles(
  path.join(appDir, "test"),
  [
    {
      name: "hosted-web-onboarding-integrations",
      patterns: [
        "connect-start-route.test.ts",
        "hosted-onboarding-invite-send-code.test.ts",
        "hosted-onboarding-linq-*.test.ts",
        "hosted-onboarding-privy*.test.ts",
        "hosted-onboarding-revnet*.test.ts",
        "hosted-onboarding-telegram-dispatch.test.ts",
        "hosted-phone-auth.test.ts",
        "invite-status-client.test.ts",
      ],
    },
    {
      name: "hosted-web-onboarding-core",
      patterns: ["hosted-onboarding-*.test.ts"],
    },
    {
      name: "hosted-web-execution",
      patterns: [
        "agent-*.test.ts",
        "hosted-execution-*.test.ts",
        "hosted-member-email-runtime-boundary.test.ts",
        "hosted-share-*.test.ts",
        "internal.test.ts",
        "linq-control-plane.test.ts",
        "linq-webhook-route.test.ts",
        "share-link-client.test.ts",
      ],
    },
    {
      name: "hosted-web-sync-settings",
      patterns: [
        "auth.test.ts",
        "device-sync-*.test.ts",
        "hosted-billing-settings.test.tsx",
        "hosted-device-sync-*.test.ts",
        "join-*.test.ts",
        "local-heartbeat-route.test.ts",
        "settings-*.test.ts",
      ],
    },
    {
      includeRemaining: true,
      name: "hosted-web-store-config",
      patterns: [
        "contact-privacy-*.test.ts",
        "crypto.test.ts",
        "dev-local.test.ts",
        "env.test.ts",
        "hosted-contact-privacy.test.ts",
        "http.test.ts",
        "install-script.test.ts",
        "layout.test.ts",
        "next-config.test.ts",
        "page.test.ts",
        "prisma-store-*.test.ts",
        "public-url.test.ts",
        "route-loading.test.tsx",
        "vercel-config.test.ts",
      ],
    },
  ],
  {
    label: "apps/web/test",
  },
);

export const hostedWebVitestProjects = hostedWebVitestProjectSpecs.map(
  ({ fileNames, name }) => createHostedWebProject(name, fileNames),
);

export default defineConfig({
  test: {
    ...murphVitestNoTimeouts,
    maxWorkers: hostedWebVitestMaxWorkers,
    projects: hostedWebVitestProjects,
  },
});
