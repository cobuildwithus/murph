import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { test } from "vitest";

import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  HOSTED_BUNDLE_SCHEMA,
  readHostedBundleTextFile,
  restoreHostedBundleRoots,
  restoreHostedExecutionContext,
  resolveAssistantStatePaths,
  sha256HostedBundleHex,
  snapshotHostedBundleRoots,
  snapshotHostedExecutionContext,
  writeHostedBundleTextFile,
} from "../src/index.ts";

test("hosted bundle helpers round-trip multi-root archives and base64 helpers", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-bundle-"));

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

test("hosted execution bundles keep only assistant state and operator config inside agent-state", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-context-"));
  const restoreRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-context-restore-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    await mkdir(path.join(vaultRoot, ".runtime", "device-syncd"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "inboxd"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "parsers"), { recursive: true });
    await mkdir(path.join(vaultRoot, "exports", "packs"), { recursive: true });
    await mkdir(assistantStateRoot, { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".murph", "hosted"), { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
    for (const artifact of LOCAL_RUNTIME_ARTIFACTS) {
      await writeFile(path.join(vaultRoot, ".runtime", artifact.relativePath), artifact.contents);
    }
    await writeFile(path.join(vaultRoot, ".env.local"), "secret=true\n");
    await writeFile(path.join(vaultRoot, "exports", "packs", "bundle.zip"), "skip-me\n");
    await writeFile(path.join(assistantStateRoot, "automation.json"), "{\"autoReplyChannels\":[\"linq\"]}\n");
    await writeFile(path.join(operatorHomeRoot, ".murph", "config.json"), "{\"schema\":\"cfg\"}\n");
    await writeFile(
      path.join(operatorHomeRoot, ".murph", "hosted", "user-env.json"),
      "{\"schema\":\"murph.hosted-user-env.v1\",\"updatedAt\":\"2026-03-26T12:00:00.000Z\",\"env\":{\"OPENAI_API_KEY\":\"sk-user\"}}\n",
    );

    const bundles = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });

    assert.ok(bundles.agentStateBundle);
    assert.equal(
      readHostedBundleTextFile({
        bytes: bundles.agentStateBundle,
        expectedKind: "agent-state",
        path: "automation.json",
        root: "assistant-state",
      }),
      "{\"autoReplyChannels\":[\"linq\"]}\n",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: bundles.agentStateBundle,
        expectedKind: "agent-state",
        path: ".murph/config.json",
        root: "operator-home",
      }),
      "{\"schema\":\"cfg\"}\n",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: bundles.agentStateBundle,
        expectedKind: "agent-state",
        path: ".murph/hosted/user-env.json",
        root: "operator-home",
      }),
      null,
    );
    for (const artifact of LOCAL_RUNTIME_ARTIFACTS) {
      assert.equal(
        readHostedBundleTextFile({
          bytes: bundles.agentStateBundle,
          expectedKind: "agent-state",
          path: artifact.relativePath,
          root: LEGACY_AGENT_STATE_VAULT_RUNTIME_ROOT,
        }),
        null,
      );
    }

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
      await readFile(path.join(restored.assistantStateRoot, "automation.json"), "utf8"),
      "{\"autoReplyChannels\":[\"linq\"]}\n",
    );
    assert.equal(
      await readFile(path.join(restored.operatorHomeRoot, ".murph", "config.json"), "utf8"),
      "{\"schema\":\"cfg\"}\n",
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".murph", "hosted", "user-env.json"), "utf8"),
    );
    for (const artifact of LOCAL_RUNTIME_ARTIFACTS) {
      await assert.rejects(
        readFile(path.join(restored.vaultRoot, ".runtime", artifact.relativePath), "utf8"),
      );
    }
    await assert.rejects(readFile(path.join(restored.vaultRoot, ".env.local"), "utf8"));
    await assert.rejects(readFile(path.join(restored.vaultRoot, "exports", "packs", "bundle.zip"), "utf8"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(restoreRoot, { force: true, recursive: true });
  }
});

test("hosted execution restore ignores legacy vault runtime roots in agent-state bundles", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-context-legacy-"));
  const restoreRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-context-legacy-restore-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    await mkdir(vaultRoot, { recursive: true });
    await mkdir(assistantStateRoot, { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".murph", "hosted"), { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
    await writeFile(path.join(assistantStateRoot, "automation.json"), "{\"autoReplyChannels\":[\"linq\"]}\n");
    await writeFile(path.join(operatorHomeRoot, ".murph", "config.json"), "{\"schema\":\"cfg\"}\n");
    await writeFile(
      path.join(operatorHomeRoot, ".murph", "hosted", "user-env.json"),
      "{\"schema\":\"murph.hosted-user-env.v1\",\"updatedAt\":\"2026-03-26T12:00:00.000Z\",\"env\":{\"OPENAI_API_KEY\":\"sk-user\"}}\n",
    );

    const bundles = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });
    assert.ok(bundles.agentStateBundle);

    let legacyAgentStateBundle = bundles.agentStateBundle;
    for (const artifact of LOCAL_RUNTIME_ARTIFACTS) {
      legacyAgentStateBundle = writeHostedBundleTextFile({
        bytes: legacyAgentStateBundle,
        kind: "agent-state",
        path: artifact.relativePath,
        root: LEGACY_AGENT_STATE_VAULT_RUNTIME_ROOT,
        text: artifact.contents,
      });
    }

    const restored = await restoreHostedExecutionContext({
      agentStateBundle: legacyAgentStateBundle,
      vaultBundle: bundles.vaultBundle,
      workspaceRoot: restoreRoot,
    });

    assert.equal(
      await readFile(path.join(restored.assistantStateRoot, "automation.json"), "utf8"),
      "{\"autoReplyChannels\":[\"linq\"]}\n",
    );
    assert.equal(
      await readFile(path.join(restored.operatorHomeRoot, ".murph", "config.json"), "utf8"),
      "{\"schema\":\"cfg\"}\n",
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".murph", "hosted", "user-env.json"), "utf8"),
    );
    for (const artifact of LOCAL_RUNTIME_ARTIFACTS) {
      await assert.rejects(
        readFile(path.join(restored.vaultRoot, ".runtime", artifact.relativePath), "utf8"),
      );
    }
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(restoreRoot, { force: true, recursive: true });
  }
});

test("hosted bundle text helpers patch and remove individual files deterministically", async () => {
  let bundle = writeHostedBundleTextFile({
    bytes: null,
    kind: "agent-state",
    path: ".murph/hosted/user-env.json",
    root: "operator-home",
    text: "{\"ok\":true}\n",
  });

  assert.equal(
    readHostedBundleTextFile({
      bytes: bundle,
      expectedKind: "agent-state",
      path: ".murph/hosted/user-env.json",
      root: "operator-home",
    }),
    "{\"ok\":true}\n",
  );

  bundle = writeHostedBundleTextFile({
    bytes: bundle,
    kind: "agent-state",
    path: ".murph/hosted/user-env.json",
    root: "operator-home",
    text: "{\"ok\":false}\n",
  });

  assert.equal(
    readHostedBundleTextFile({
      bytes: bundle,
      expectedKind: "agent-state",
      path: ".murph/hosted/user-env.json",
      root: "operator-home",
    }),
    "{\"ok\":false}\n",
  );

  bundle = writeHostedBundleTextFile({
    bytes: bundle,
    kind: "agent-state",
    path: ".murph/hosted/user-env.json",
    root: "operator-home",
    text: null,
  });

  assert.equal(
    readHostedBundleTextFile({
      bytes: bundle,
      expectedKind: "agent-state",
      path: ".murph/hosted/user-env.json",
      root: "operator-home",
    }),
    null,
  );
});

test("hosted bundle restore rejects backslash and drive-style traversal archive paths", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-bundle-paths-"));

  try {
    const restoreRoot = path.join(workspaceRoot, "restore");
    const outsidePath = path.join(workspaceRoot, "outside.txt");
    const maliciousPaths = [
      "..\\..\\outside.txt",
      "..\\nested/../../outside.txt",
      "C:\\windows\\system32\\drivers\\etc\\hosts",
    ];

    for (const archivePath of maliciousPaths) {
      await assert.rejects(
        restoreHostedBundleRoots({
          bytes: createHostedBundleArchiveBytes(archivePath),
          expectedKind: "agent-state",
          roots: {
            alpha: restoreRoot,
          },
        }),
        /Hosted bundle path is invalid/u,
      );
    }

    await assert.rejects(readFile(outsidePath, "utf8"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

function createHostedBundleArchiveBytes(archivePath: string): Uint8Array {
  return Uint8Array.from(
    gzipSync(
      Buffer.from(
        JSON.stringify({
          files: [
            {
              contentsBase64: Buffer.from("blocked\n", "utf8").toString("base64"),
              path: archivePath,
              root: "alpha",
            },
          ],
          kind: "agent-state",
          schema: HOSTED_BUNDLE_SCHEMA,
        }),
        "utf8",
      ),
    ),
  );
}

const LEGACY_AGENT_STATE_VAULT_RUNTIME_ROOT = "vault-runtime";
const LOCAL_RUNTIME_ARTIFACTS = [
  {
    contents: "control-token\n",
    relativePath: "device-syncd/control-token",
  },
  {
    contents: "device-sync-db\n",
    relativePath: "device-syncd.sqlite",
  },
  {
    contents: "device-sync-stdout\n",
    relativePath: "device-syncd/stdout.log",
  },
  {
    contents: "device-sync-stderr\n",
    relativePath: "device-syncd/stderr.log",
  },
  {
    contents: "search-db\n",
    relativePath: "search.sqlite",
  },
  {
    contents: "inbox-db\n",
    relativePath: "inboxd.sqlite",
  },
  {
    contents: "{\"cursor\":\"123\"}\n",
    relativePath: "inboxd/state.json",
  },
  {
    contents: "{\"version\":1}\n",
    relativePath: "parsers/toolchain.json",
  },
] as const;
