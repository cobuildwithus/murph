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

function createHostedWebProject(name: string, patterns: readonly string[]) {
  return defineProject({
    resolve: {
      alias: hostedWebAliases,
    },
    test: {
      ...murphVitestNoTimeouts,
      name,
      environment: "node",
      ...hostedWebVitestConcurrency,
      include: patterns.map(hostedWebPattern),
    },
  });
}

export const hostedWebVitestProjects = [
  createHostedWebProject("hosted-web-onboarding-core", [
    "hosted-onboarding-billing-service.test.ts",
    "hosted-onboarding-env.test.ts",
    "hosted-onboarding-landing.test.ts",
    "hosted-onboarding-member-service.test.ts",
    "hosted-onboarding-routes.test.ts",
    "hosted-onboarding-session.test.ts",
    "hosted-onboarding-shared.test.ts",
    "hosted-onboarding-stripe-event-reconciliation.test.ts",
    "hosted-onboarding-webhook-idempotency.test.ts",
    "hosted-onboarding-webhook-receipt-transitions.test.ts",
  ]),
  createHostedWebProject("hosted-web-onboarding-integrations", [
    "connect-start-route.test.ts",
    "hosted-phone-auth.test.ts",
    "hosted-onboarding-linq-*.test.ts",
    "hosted-onboarding-privy*.test.ts",
    "hosted-onboarding-revnet*.test.ts",
    "hosted-onboarding-telegram-dispatch.test.ts",
  ]),
  createHostedWebProject("hosted-web-execution", [
    "agent-*.test.ts",
    "hosted-execution-*.test.ts",
    "hosted-share-*.test.ts",
    "linq-control-plane.test.ts",
    "linq-webhook-route.test.ts",
  ]),
  createHostedWebProject("hosted-web-sync-settings", [
    "auth.test.ts",
    "device-sync-*.test.ts",
    "hosted-device-sync-internal-routes.test.ts",
    "join-*.test.ts",
    "local-heartbeat-route.test.ts",
    "settings-*.test.ts",
  ]),
  createHostedWebProject("hosted-web-store-config", [
    "crypto.test.ts",
    "env.test.ts",
    "layout.test.ts",
    "next-config.test.ts",
    "page.test.ts",
    "prisma-store-*.test.ts",
    "public-url.test.ts",
    "vercel-config.test.ts",
  ]),
];

export default defineConfig({
  test: {
    ...murphVitestNoTimeouts,
    maxWorkers: hostedWebVitestMaxWorkers,
    projects: hostedWebVitestProjects,
  },
});
