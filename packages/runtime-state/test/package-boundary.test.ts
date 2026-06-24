import { readFile } from "node:fs/promises";

import * as runtimeState from "@murphai/runtime-state";
import * as assistantIds from "@murphai/runtime-state/assistant-ids";
import * as hostedCodexSubscriptionAuth from "@murphai/runtime-state/hosted-codex-subscription-auth";
import * as runtimeStateNode from "@murphai/runtime-state/node";
import * as runtimeStateNodeAssistantRuntimeIssues from "@murphai/runtime-state/node/assistant-runtime-issues";
import * as runtimeStateNodeAssistantStateFs from "@murphai/runtime-state/node/assistant-state-fs";
import * as runtimeStateNodeHostedBundleCodec from "@murphai/runtime-state/node/hosted-bundle-codec";
import * as runtimeStateNodeLoopbackAuth from "@murphai/runtime-state/node/loopback-control-plane-auth";
import * as runtimeStateNodeRuntimePaths from "@murphai/runtime-state/node/runtime-paths";
import * as runtimeStateNodeSqliteWarningFilter from "@murphai/runtime-state/node/sqlite-warning-filter";
import * as runtimeStateNodeUlid from "@murphai/runtime-state/node/ulid";

import { describe, expect, it } from "vitest";

describe("@murphai/runtime-state package boundary", () => {
  it("keeps node-only helpers off the root surface", async () => {
    const rootBarrel = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(runtimeState.generateUlid).toBeTypeOf("function");
    expect("normalizeAssistantOpaqueId" in runtimeState).toBe(false);
    expect("isValidAssistantOpaqueId" in runtimeState).toBe(false);
    expect("openSqliteRuntimeDatabase" in runtimeState).toBe(false);
    expect("resolveRuntimePaths" in runtimeState).toBe(false);
    expect("snapshotHostedExecutionContext" in runtimeState).toBe(false);
    expect("decodeHostedBundleBase64" in runtimeState).toBe(false);
    expect("buildProcessCommand" in runtimeState).toBe(false);
    expect("fingerprintHost" in runtimeState).toBe(false);
    expect("isProcessRunning" in runtimeState).toBe(false);
    expect(rootBarrel).not.toContain('./hosted-bundle.ts');
  });

  it("exposes node-only helpers through the node subpath", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      exports?: Record<string, { default?: string; types?: string }>;
    };

    expect(runtimeStateNode.generateUlid).toBeTypeOf("function");
    expect(runtimeStateNode.ensureAssistantStateDir).toBeTypeOf("function");
    expect(runtimeStateNode.installSqliteExperimentalWarningFilter).toBeTypeOf("function");
    expect(runtimeStateNode.isSqliteExperimentalWarning).toBeTypeOf("function");
    expect(runtimeStateNode.openSqliteRuntimeDatabase).toBeTypeOf("function");
    expect(runtimeStateNode.resolveRuntimePaths).toBeTypeOf("function");
    expect(runtimeStateNode.snapshotHostedExecutionContext).toBeTypeOf("function");
    expect(runtimeStateNode.decodeHostedBundleBase64).toBeTypeOf("function");
    expect(runtimeStateNode.buildProcessCommand).toBeTypeOf("function");
    expect(runtimeStateNode.fingerprintHost).toBeTypeOf("function");
    expect(runtimeStateNode.isProcessRunning).toBeTypeOf("function");
    expect(packageJson.exports?.["./node"]).toEqual({
      default: "./dist/node/index.js",
      types: "./dist/node/index.d.ts",
    });
  });

  it("exposes assistant opaque id helpers through the dedicated assistant-ids subpath", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      exports?: Record<string, { default?: string; types?: string }>;
    };

    expect(assistantIds.normalizeAssistantOpaqueId).toBeTypeOf("function");
    expect(assistantIds.isValidAssistantOpaqueId).toBeTypeOf("function");
    expect(packageJson.exports?.["./assistant-ids"]).toEqual({
      default: "./dist/assistant-ids.js",
      types: "./dist/assistant-ids.d.ts",
    });
  });

  it("exposes hosted Codex subscription auth through a dedicated subpath", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      exports?: Record<string, { default?: string; types?: string }>;
    };

    expect(hostedCodexSubscriptionAuth.parseHostedLocalCodexSubscriptionHostAuth)
      .toBeTypeOf("function");
    expect(hostedCodexSubscriptionAuth.buildHostedLocalCodexSubscriptionSeedAuth)
      .toBeTypeOf("function");
    expect(packageJson.exports?.["./hosted-codex-subscription-auth"]).toEqual({
      default: "./dist/hosted-codex-subscription-auth.js",
      types: "./dist/hosted-codex-subscription-auth.d.ts",
    });
  });

  it("exposes narrow node subpaths for hosted-safe helpers", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      exports?: Record<string, { default?: string; types?: string }>;
    };

    expect(runtimeStateNodeAssistantRuntimeIssues.parseAssistantRuntimeIssueRecord).toBeTypeOf("function");
    expect(runtimeStateNodeAssistantStateFs.ensureAssistantStateDir).toBeTypeOf("function");
    expect(runtimeStateNodeAssistantStateFs.writeAssistantStateJson).toBeTypeOf("function");
    expect(runtimeStateNodeAssistantStateFs.appendAssistantStateJsonLine).toBeTypeOf("function");
    expect(runtimeStateNodeHostedBundleCodec.decodeHostedBundleBase64).toBeTypeOf("function");
    expect(runtimeStateNodeHostedBundleCodec.encodeHostedBundleBase64).toBeTypeOf("function");
    expect(runtimeStateNodeHostedBundleCodec.sameHostedBundlePayloadRef).toBeTypeOf("function");
    expect(runtimeStateNodeLoopbackAuth.hasMatchingLoopbackControlBearerToken).toBeTypeOf("function");
    expect(runtimeStateNodeRuntimePaths.DEVICE_SYNC_DB_RELATIVE_PATH).toBeTypeOf("string");
    expect(runtimeStateNodeSqliteWarningFilter.installSqliteExperimentalWarningFilter).toBeTypeOf("function");
    expect(runtimeStateNodeUlid.generateUlid).toBeTypeOf("function");
    expect(packageJson.exports?.["./node/assistant-runtime-issues"]).toEqual({
      default: "./dist/node/assistant-runtime-issues.js",
      types: "./dist/node/assistant-runtime-issues.d.ts",
    });
    expect(packageJson.exports?.["./node/assistant-state-fs"]).toEqual({
      default: "./dist/node/assistant-state-fs.js",
      types: "./dist/node/assistant-state-fs.d.ts",
    });
    expect(packageJson.exports?.["./node/hosted-bundle-codec"]).toEqual({
      default: "./dist/node/hosted-bundle-codec.js",
      types: "./dist/node/hosted-bundle-codec.d.ts",
    });
    expect(packageJson.exports?.["./node/loopback-control-plane-auth"]).toEqual({
      default: "./dist/node/loopback-control-plane-auth.js",
      types: "./dist/node/loopback-control-plane-auth.d.ts",
    });
    expect(packageJson.exports?.["./node/runtime-paths"]).toEqual({
      default: "./dist/node/runtime-paths.js",
      types: "./dist/node/runtime-paths.d.ts",
    });
    expect(packageJson.exports?.["./node/sqlite-warning-filter"]).toEqual({
      default: "./dist/node/sqlite-warning-filter.js",
      types: "./dist/node/sqlite-warning-filter.d.ts",
    });
    expect(packageJson.exports?.["./node/ulid"]).toEqual({
      default: "./dist/node/ulid.js",
      types: "./dist/node/ulid.d.ts",
    });
  });

  it("keeps node helper source imports compatible with hosted source resolution", async () => {
    const nodeBarrel = await readFile(
      new URL("../src/node/index.ts", import.meta.url),
      "utf8",
    );
    const loopbackAuthSource = await readFile(
      new URL("../src/node/loopback-control-plane-auth.ts", import.meta.url),
      "utf8",
    );

    expect(nodeBarrel).toContain('from "./loopback-control-plane-auth.ts"');
    expect(nodeBarrel).not.toContain('from "./loopback-control-plane-auth.js"');
    expect(loopbackAuthSource).toContain('from "../loopback-control-plane.ts"');
    expect(loopbackAuthSource).not.toContain('from "../loopback-control-plane.js"');
  });
});
