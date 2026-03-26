import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  restoreHostedBundleRoots,
  restoreHostedExecutionContext,
  resolveAssistantStatePaths,
  sha256HostedBundleHex,
  snapshotHostedBundleRoots,
  snapshotHostedExecutionContext,
} from "../src/index.ts";

test("hosted bundle helpers round-trip multi-root archives and base64 helpers", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "healthybob-hosted-bundle-"));

  try {
    const alphaRoot = path.join(workspaceRoot, "alpha");
    const betaRoot = path.join(workspaceRoot, "beta");
    await mkdir(path.join(alphaRoot, "nested"), { recursive: true });
    await mkdir(betaRoot, { recursive: true });
    await writeFile(path.join(alphaRoot, "nested", "state.json"), "{\"ok\":true}\n");
    await writeFile(path.join(betaRoot, "keep.txt"), "hello\n");
    await writeFile(path.join(betaRoot, "skip.txt"), "skip\n");

    const bundle = await snapshotHostedBundleRoots({
      kind: "agent-state",
      roots: [
        {
          root: alphaRoot,
          rootKey: "alpha",
        },
        {
          root: betaRoot,
          rootKey: "beta",
          shouldIncludeRelativePath(relativePath) {
            return relativePath !== "skip.txt";
          },
        },
      ],
    });

    assert.ok(bundle);
    assert.deepEqual(
      Buffer.from(decodeHostedBundleBase64(encodeHostedBundleBase64(bundle)) ?? []),
      Buffer.from(bundle),
    );
    assert.match(sha256HostedBundleHex(bundle), /^[a-f0-9]{64}$/u);

    const restoreRoot = path.join(workspaceRoot, "restore");
    await restoreHostedBundleRoots({
      bytes: bundle,
      expectedKind: "agent-state",
      roots: {
        alpha: path.join(restoreRoot, "alpha"),
        beta: path.join(restoreRoot, "beta"),
      },
    });

    assert.equal(
      await readFile(path.join(restoreRoot, "alpha", "nested", "state.json"), "utf8"),
      "{\"ok\":true}\n",
    );
    assert.equal(await readFile(path.join(restoreRoot, "beta", "keep.txt"), "utf8"), "hello\n");
    await assert.rejects(readFile(path.join(restoreRoot, "beta", "skip.txt"), "utf8"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted execution bundles keep vault runtime and operator config inside agent-state", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "healthybob-hosted-context-"));
  const restoreRoot = await mkdtemp(path.join(tmpdir(), "healthybob-hosted-context-restore-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    await mkdir(path.join(vaultRoot, ".runtime"), { recursive: true });
    await mkdir(path.join(vaultRoot, "exports", "packs"), { recursive: true });
    await mkdir(assistantStateRoot, { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".healthybob"), { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "device-sync.db"), "runtime-state\n");
    await writeFile(path.join(vaultRoot, ".env.local"), "secret=true\n");
    await writeFile(path.join(vaultRoot, "exports", "packs", "bundle.zip"), "skip-me\n");
    await writeFile(path.join(assistantStateRoot, "automation.json"), "{\"autoReplyChannels\":[\"linq\"]}\n");
    await writeFile(path.join(operatorHomeRoot, ".healthybob", "config.json"), "{\"schema\":\"cfg\"}\n");

    const bundles = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });

    assert.ok(bundles.agentStateBundle);

    const restored = await restoreHostedExecutionContext({
      agentStateBundle: bundles.agentStateBundle,
      vaultBundle: bundles.vaultBundle,
      workspaceRoot: restoreRoot,
    });

    assert.equal(
      await readFile(path.join(restored.vaultRoot, "vault.json"), "utf8"),
      "{\"schema\":\"vault\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "device-sync.db"), "utf8"),
      "runtime-state\n",
    );
    assert.equal(
      await readFile(path.join(restored.assistantStateRoot, "automation.json"), "utf8"),
      "{\"autoReplyChannels\":[\"linq\"]}\n",
    );
    assert.equal(
      await readFile(path.join(restored.operatorHomeRoot, ".healthybob", "config.json"), "utf8"),
      "{\"schema\":\"cfg\"}\n",
    );
    await assert.rejects(readFile(path.join(restored.vaultRoot, ".env.local"), "utf8"));
    await assert.rejects(readFile(path.join(restored.vaultRoot, "exports", "packs", "bundle.zip"), "utf8"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(restoreRoot, { force: true, recursive: true });
  }
});
