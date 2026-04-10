import { readFile } from "node:fs/promises";

import * as runtimeState from "@murphai/runtime-state";
import * as runtimeStateNode from "@murphai/runtime-state/node";

import { describe, expect, it } from "vitest";

describe("@murphai/runtime-state package boundary", () => {
  it("keeps node-only helpers off the root surface", async () => {
    const rootBarrel = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(runtimeState.generateUlid).toBeTypeOf("function");
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
});
