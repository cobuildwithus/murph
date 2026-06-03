import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { verifyWorkspaceImportPolicy } = require("./import-policy-rules.mjs");
const { repoRoot } = require("./scanner.mjs");

describe("workspace import policy rules", () => {
  it("rejects empty imports from workspace packages", () => {
    const filePath = path.join(repoRoot, "packages/hosted-execution/src/parsers.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: `
import {
} from "@murphai/device-syncd/hosted-runtime";
      `,
      sourceMember: "packages/hosted-execution",
      specifier: "@murphai/device-syncd/hosted-runtime",
    });

    expect(failure).toContain("uses empty import");
    expect(failure).toContain('"@murphai/device-syncd/hosted-runtime"');
  });

  it("rejects comment-interleaved empty imports from workspace packages", () => {
    const filePath = path.join(repoRoot, "packages/hosted-execution/src/parsers.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: `
import /* keep */ {
  /* keep */
} /* keep */ from "@murphai/device-syncd/hosted-runtime";
      `,
      sourceMember: "packages/hosted-execution",
      specifier: "@murphai/device-syncd/hosted-runtime",
    });

    expect(failure).toContain("uses empty import");
    expect(failure).toContain('"@murphai/device-syncd/hosted-runtime"');
  });

  it("rejects assistant-runtime imports from generic inbox connector normalizers", () => {
    const filePath = path.join(
      repoRoot,
      "packages/assistant-runtime/src/hosted-runtime/events/conversation.ts",
    );
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import { normalizeHostedTelegramMessage } from "@murphai/inboxd/connectors/telegram/normalize";',
      sourceMember: "packages/assistant-runtime",
      specifier: "@murphai/inboxd/connectors/telegram/normalize",
    });

    expect(failure).toContain("@murphai/inboxd/connectors/hosted-conversation");
    expect(failure).toContain("generic provider connector internals");
  });

  it("allows empty imports from non-workspace packages", () => {
    const filePath = path.join(repoRoot, "packages/hosted-execution/src/parsers.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import {} from "dotenv/config";',
      sourceMember: "packages/hosted-execution",
      specifier: "dotenv/config",
    });

    expect(failure).toBeNull();
  });

  it("allows normal workspace imports with explicit bindings", () => {
    const filePath = path.join(repoRoot, "packages/hosted-execution/src/parsers.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import { parseHostedExecutionBundleRef } from "@murphai/runtime-state";',
      sourceMember: "packages/hosted-execution",
      specifier: "@murphai/runtime-state",
    });

    expect(failure).toBeNull();
  });

  it("rejects Cloudflare source imports of hosted invocation internals from assistant-runtime root", () => {
    const filePath = path.join(repoRoot, "apps/cloudflare/src/hosted-workspace-invocation.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import { runHostedWorkspaceRuntimeJobInProcess } from "@murphai/assistant-runtime";',
      sourceMember: "apps/cloudflare",
      specifier: "@murphai/assistant-runtime",
    });

    expect(failure).toContain("@murphai/assistant-runtime/hosted-invocation");
  });

  it("rejects Cloudflare source imports of bridge construction from the hosted invocation facade", () => {
    const filePath = path.join(repoRoot, "apps/cloudflare/src/hosted-workspace-invocation.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import { createHostedWorkspaceRuntimeBridgeJobOptions } from "@murphai/assistant-runtime/hosted-invocation";',
      sourceMember: "apps/cloudflare",
      specifier: "@murphai/assistant-runtime/hosted-invocation",
    });

    expect(failure).toContain("runHostedWorkspaceInvocation");
  });

  it("rejects Cloudflare source imports of checkpoint lease types from the hosted invocation facade", () => {
    const filePath = path.join(repoRoot, "apps/cloudflare/src/runtime-platform/authority-headers.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import type { HostedRuntimeBridgeCheckpointLease } from "@murphai/assistant-runtime/hosted-invocation";',
      sourceMember: "apps/cloudflare",
      specifier: "@murphai/assistant-runtime/hosted-invocation",
    });

    expect(failure).toContain("focused capability subpaths");
  });

  it("rejects Cloudflare source imports from the hosted invocation testkit", () => {
    const filePath = path.join(repoRoot, "apps/cloudflare/src/hosted-workspace-invocation.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import { createHostedWorkspaceRuntimeBridgeJobOptions } from "@murphai/assistant-runtime/hosted-invocation-testkit";',
      sourceMember: "apps/cloudflare",
      specifier: "@murphai/assistant-runtime/hosted-invocation-testkit",
    });

    expect(failure).toContain("testkit is for focused tests only");
  });

  it("rejects non-test imports from the hosted invocation testkit outside Cloudflare", () => {
    const filePath = path.join(repoRoot, "apps/web/app/hosted-workspace-invocation.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import { createHostedWorkspaceRuntimeBridgeJobOptions } from "@murphai/assistant-runtime/hosted-invocation-testkit";',
      sourceMember: "apps/web",
      specifier: "@murphai/assistant-runtime/hosted-invocation-testkit",
    });

    expect(failure).toContain("testkit is for focused tests only");
  });

  it("allows test imports from the hosted invocation testkit", () => {
    const filePath = path.join(repoRoot, "apps/cloudflare/test/runtime-bridge-workspace.test.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import { createHostedWorkspaceRuntimeBridgeJobOptions } from "@murphai/assistant-runtime/hosted-invocation-testkit";',
      sourceMember: "apps/cloudflare",
      specifier: "@murphai/assistant-runtime/hosted-invocation-testkit",
    });

    expect(failure).toBeNull();
  });

  it("rejects Cloudflare source re-exports of hosted invocation internals from assistant-runtime root", () => {
    const filePath = path.join(repoRoot, "apps/cloudflare/src/hosted-workspace-invocation.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'export { runHostedWorkspaceRuntimeJobInProcess } from "@murphai/assistant-runtime";',
      sourceMember: "apps/cloudflare",
      specifier: "@murphai/assistant-runtime",
    });

    expect(failure).toContain("@murphai/assistant-runtime/hosted-invocation");
  });

  it("rejects Cloudflare source re-exports of bridge construction from the hosted invocation facade", () => {
    const filePath = path.join(repoRoot, "apps/cloudflare/src/hosted-workspace-invocation.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'export { createHostedWorkspaceRuntimeBridgeJobOptions } from "@murphai/assistant-runtime/hosted-invocation";',
      sourceMember: "apps/cloudflare",
      specifier: "@murphai/assistant-runtime/hosted-invocation",
    });

    expect(failure).toContain("runHostedWorkspaceInvocation");
  });

  it("rejects Cloudflare source imports of old app-local runtime bridge files", () => {
    const filePath = path.join(repoRoot, "apps/cloudflare/src/hosted-workspace-invocation.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import { createHostedWorkspaceRuntimeBridgeJobOptions } from "./runtime-bridge-workspace.ts";',
      sourceMember: "apps/cloudflare",
      specifier: "./runtime-bridge-workspace.ts",
    });

    expect(failure).toContain("hosted workspace bridge ownership lives");
  });

  it("rejects Cloudflare source imports of package-owned snapshot planning helpers", () => {
    const filePath = path.join(repoRoot, "apps/cloudflare/src/workspace-snapshot-archive-builder.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import { collectHostedWorkspaceSnapshotArchivePlan } from "@murphai/runtime-state/node";',
      sourceMember: "apps/cloudflare",
      specifier: "@murphai/runtime-state/node",
    });

    expect(failure).toContain("snapshot planning and diagnostics belong");
  });

  it("rejects assistant-runtime source imports of app-local Cloudflare runtime surfaces", () => {
    const filePath = path.join(
      repoRoot,
      "packages/assistant-runtime/src/hosted-runtime/snapshot-bridge.ts",
    );
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import { readHostedExecutionWorkerEnvironment } from "./hosted-execution-worker-env.ts";',
      sourceMember: "packages/assistant-runtime",
      specifier: "./hosted-execution-worker-env.ts",
    });

    expect(failure).toContain("explicit hosted invocation capabilities");
  });

  it("allows Cloudflare to import hosted Codex process hooks from the assistant-engine owner", () => {
    const filePath = path.join(repoRoot, "apps/cloudflare/src/container-entrypoint.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: `
import path from "node:path";
import {
  snapshotExpectedHostedCodexRootProcess,
  stopHostedWarmCodexAppServer,
} from "@murphai/assistant-engine/hosted-codex-lifecycle";
      `,
      sourceMember: "apps/cloudflare",
      specifier: "@murphai/assistant-engine/hosted-codex-lifecycle",
    });

    expect(failure).toBeNull();
  });

  it.each([
    [
      "extra named imports",
      `
import {
  snapshotExpectedHostedCodexRootProcess,
  stopHostedWarmCodexAppServer,
  debugHostedCodexLifecycle,
} from "@murphai/assistant-engine/hosted-codex-lifecycle";
      `,
    ],
    [
      "default imports",
      'import hostedCodexLifecycle from "@murphai/assistant-engine/hosted-codex-lifecycle";',
    ],
    [
      "namespace imports",
      'import * as hostedCodexLifecycle from "@murphai/assistant-engine/hosted-codex-lifecycle";',
    ],
    [
      "dynamic imports",
      'const hostedCodexLifecycle = await import("@murphai/assistant-engine/hosted-codex-lifecycle");',
    ],
    [
      "mixed allowed imports and re-exports",
      `
import {
  snapshotExpectedHostedCodexRootProcess,
  stopHostedWarmCodexAppServer,
} from "@murphai/assistant-engine/hosted-codex-lifecycle";
export { debugHostedCodexLifecycle } from "@murphai/assistant-engine/hosted-codex-lifecycle";
      `,
    ],
  ])("rejects Cloudflare %s from hosted Codex lifecycle", (_label, source) => {
    const filePath = path.join(repoRoot, "apps/cloudflare/src/container-entrypoint.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source,
      sourceMember: "apps/cloudflare",
      specifier: "@murphai/assistant-engine/hosted-codex-lifecycle",
    });

    expect(failure).toContain("apps/cloudflare must depend on @murphai/assistant-runtime");
  });

  it("rejects Cloudflare hosted Codex process hook imports outside the container entrypoint", () => {
    const filePath = path.join(repoRoot, "apps/cloudflare/src/runner-container.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: `
import {
  snapshotExpectedHostedCodexRootProcess,
  stopHostedWarmCodexAppServer,
} from "@murphai/assistant-engine/hosted-codex-lifecycle";
      `,
      sourceMember: "apps/cloudflare",
      specifier: "@murphai/assistant-engine/hosted-codex-lifecycle",
    });

    expect(failure).toContain("apps/cloudflare must depend on @murphai/assistant-runtime");
  });

  it.each([
    [
      "hosted-runtime-contracts.ts",
      "aliased lifecycle re-exports",
      'export { snapshotExpectedHostedCodexRootProcess as snapshotHostedCodexRoot } from "@murphai/assistant-engine/hosted-codex-lifecycle";',
    ],
    [
      "hosted-runtime-contracts.ts",
      "type-only lifecycle re-exports",
      'export type { HostedExpectedCodexRootProcess } from "@murphai/assistant-engine/hosted-codex-lifecycle";',
    ],
    [
      "hosted-runtime-worker-contracts.ts",
      "aliased lifecycle re-exports",
      'export { stopHostedWarmCodexAppServer as stopWarmCodex } from "@murphai/assistant-engine/hosted-codex-lifecycle";',
    ],
    [
      "hosted-runtime-worker-contracts.ts",
      "type-only lifecycle re-exports",
      'export type { HostedExpectedCodexRootProcess } from "@murphai/assistant-engine/hosted-codex-lifecycle";',
    ],
  ])("rejects assistant-runtime %s %s", (contractFileName, _label, source) => {
    const filePath = path.join(
      repoRoot,
      "packages/assistant-runtime/src",
      contractFileName,
    );
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source,
      sourceMember: "packages/assistant-runtime",
      specifier: "@murphai/assistant-engine/hosted-codex-lifecycle",
    });

    expect(failure).toContain("contract entrypoints must not route");
  });

  it("rejects assistant-runtime source imports of hosted Codex lifecycle ownership", () => {
    const filePath = path.join(repoRoot, "packages/assistant-runtime/src/hosted-runtime.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'export { stopHostedWarmCodexAppServer } from "@murphai/assistant-engine/hosted-codex-lifecycle";',
      sourceMember: "packages/assistant-runtime",
      specifier: "@murphai/assistant-engine/hosted-codex-lifecycle",
    });

    expect(failure).toContain("assistant-runtime must not route");
  });

  it("rejects unrelated direct Cloudflare imports from assistant-engine", () => {
    const filePath = path.join(repoRoot, "apps/cloudflare/src/container-entrypoint.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import { executeCodexAppServerTurn } from "@murphai/assistant-engine/assistant-codex";',
      sourceMember: "apps/cloudflare",
      specifier: "@murphai/assistant-engine/assistant-codex",
    });

    expect(failure).toContain("apps/cloudflare must depend on @murphai/assistant-runtime");
  });
});
