import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { expect, test } from "vitest";

import {
  sameHostedBundlePayloadRef,
  sameHostedExecutionBundleRef,
  type HostedExecutionBundleRef,
} from "../src/index.ts";
import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  hasHostedBundleArtifactPath,
  HOSTED_BUNDLE_SCHEMA,
  listHostedBundleArtifacts,
  materializeHostedExecutionArtifacts,
  readHostedBundleTextFile,
  restoreHostedBundleRoots,
  restoreHostedExecutionContext,
  resolveAssistantStatePaths,
  sha256HostedBundleHex,
  snapshotHostedBundleRoots,
  snapshotHostedExecutionContext,
  writeHostedBundleTextFile,
} from "../src/node/index.ts";

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

test("hosted execution snapshots collapse into one workspace bundle and externalize raw artifacts", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-context-"));
  const restoreRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-context-restore-"));
  const artifacts = new Map<string, Uint8Array>();

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const rawAttachmentPath = path.join(
      vaultRoot,
      "raw",
      "inbox",
      "2026-03-28",
      "capture_123",
      "attachments",
      "report.pdf",
    );
    await mkdir(path.join(vaultRoot, ".runtime", "device-syncd"), { recursive: true });
    await mkdir(path.dirname(rawAttachmentPath), { recursive: true });
    await mkdir(path.join(vaultRoot, "exports", "packs"), { recursive: true });
    await mkdir(assistantStateRoot, { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".murph", "hosted"), { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "device-syncd.sqlite"), "sqlite-control-state\n");
    await writeFile(path.join(vaultRoot, ".runtime", "device-syncd", "launcher.json"), "{\"pid\":1234}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "device-syncd", "control-token"), "control-token\n");
    await writeFile(path.join(vaultRoot, ".runtime", "device-syncd", "stdout.log"), "skip-log\n");
    await writeFile(path.join(vaultRoot, ".env.local"), "secret=true\n");
    await writeFile(path.join(vaultRoot, "exports", "packs", "bundle.zip"), "skip-me\n");
    await writeFile(path.join(vaultRoot, "raw", "notes.json"), "{\"keep\":true}\n");
    await writeFile(rawAttachmentPath, Buffer.from("pdf-binary-artifact\n", "utf8"));
    await writeFile(path.join(assistantStateRoot, "automation.json"), "{\"autoReplyChannels\":[\"linq\"]}\n");
    await writeFile(path.join(operatorHomeRoot, ".murph", "config.json"), "{\"schema\":\"cfg\"}\n");
    await writeFile(
      path.join(operatorHomeRoot, ".murph", "hosted", "user-env.json"),
      "{\"schema\":\"murph.hosted-user-env.v1\",\"env\":{\"OPENAI_API_KEY\":\"sk-user\"}}\n",
    );

    const bundles = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      operatorHomeRoot,
      vaultRoot,
    });

    assert.equal(bundles.agentStateBundle, null);
    assert.equal(
      readHostedBundleTextFile({
        bytes: bundles.vaultBundle,
        expectedKind: "vault",
        path: "vault.json",
        root: "vault",
      }),
      "{\"schema\":\"vault\"}\n",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: bundles.vaultBundle,
        expectedKind: "vault",
        path: ".runtime/device-syncd.sqlite",
        root: "vault",
      }),
      null,
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: bundles.vaultBundle,
        expectedKind: "vault",
        path: ".runtime/device-syncd/launcher.json",
        root: "vault",
      }),
      null,
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: bundles.vaultBundle,
        expectedKind: "vault",
        path: ".runtime/device-syncd/control-token",
        root: "vault",
      }),
      null,
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: bundles.vaultBundle,
        expectedKind: "vault",
        path: "automation.json",
        root: "assistant-state",
      }),
      "{\"autoReplyChannels\":[\"linq\"]}\n",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: bundles.vaultBundle,
        expectedKind: "vault",
        path: ".murph/config.json",
        root: "operator-home",
      }),
      "{\"schema\":\"cfg\"}\n",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: bundles.vaultBundle,
        expectedKind: "vault",
        path: ".murph/hosted/user-env.json",
        root: "operator-home",
      }),
      null,
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: bundles.vaultBundle,
        expectedKind: "vault",
        path: "raw/inbox/2026-03-28/capture_123/attachments/report.pdf",
        root: "vault",
      }),
      null,
    );

    const artifactRefs = listHostedBundleArtifacts({
      bytes: bundles.vaultBundle,
      expectedKind: "vault",
    });
    assert.deepEqual(
      artifactRefs.map((artifact) => artifact.path),
      ["raw/inbox/2026-03-28/capture_123/attachments/report.pdf"],
    );
    assert.equal(artifacts.has(artifactRefs[0]!.ref.sha256), true);

    const restored = await restoreHostedExecutionContext({
      artifactResolver: async ({ ref }) => {
        const bytes = artifacts.get(ref.sha256);
        if (!bytes) {
          throw new Error(`Missing artifact ${ref.sha256}.`);
        }

        return bytes;
      },
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
    assert.deepEqual(
      await readFile(
        path.join(restored.vaultRoot, "raw", "inbox", "2026-03-28", "capture_123", "attachments", "report.pdf"),
      ),
      Buffer.from("pdf-binary-artifact\n", "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".murph", "hosted", "user-env.json"), "utf8"),
    );
    await assert.rejects(readFile(path.join(restored.vaultRoot, ".runtime", "device-syncd.sqlite"), "utf8"));
    await assert.rejects(readFile(path.join(restored.vaultRoot, ".runtime", "device-syncd", "launcher.json"), "utf8"));
    await assert.rejects(readFile(path.join(restored.vaultRoot, ".runtime", "device-syncd", "control-token"), "utf8"));
    await assert.rejects(readFile(path.join(restored.vaultRoot, ".runtime", "device-syncd", "stdout.log"), "utf8"));
    await assert.rejects(readFile(path.join(restored.vaultRoot, ".env.local"), "utf8"));
    await assert.rejects(readFile(path.join(restored.vaultRoot, "exports", "packs", "bundle.zip"), "utf8"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(restoreRoot, { force: true, recursive: true });
  }
});

test("hosted execution can defer artifact materialization until a targeted restore request", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-context-lazy-"));
  const restoreRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-context-lazy-restore-"));
  const artifacts = new Map<string, Uint8Array>();
  const resolvedHashes: string[] = [];

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const rawAttachmentPath = path.join(vaultRoot, "raw", "inbox", "example", "scan.pdf");

    await mkdir(path.dirname(rawAttachmentPath), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".murph"), { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
    await writeFile(rawAttachmentPath, Buffer.from("pdf-binary-artifact\n", "utf8"));
    await writeFile(path.join(operatorHomeRoot, ".murph", "config.json"), "{\"schema\":\"cfg\"}\n");

    const snapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      operatorHomeRoot,
      vaultRoot,
    });

    assert.equal(
      hasHostedBundleArtifactPath({
        bytes: snapshot.vaultBundle,
        expectedKind: "vault",
        path: "raw/inbox/example/scan.pdf",
        root: "vault",
      }),
      true,
    );

    const restored = await restoreHostedExecutionContext({
      artifactResolver: async ({ ref }) => {
        resolvedHashes.push(ref.sha256);
        const bytes = artifacts.get(ref.sha256);
        if (!bytes) {
          throw new Error(`Missing artifact ${ref.sha256}.`);
        }

        return bytes;
      },
      shouldRestoreArtifact: () => false,
      vaultBundle: snapshot.vaultBundle,
      workspaceRoot: restoreRoot,
    });

    await assert.rejects(
      readFile(path.join(restored.vaultRoot, "raw", "inbox", "example", "scan.pdf")),
    );
    assert.deepEqual(resolvedHashes, []);

    await materializeHostedExecutionArtifacts({
      artifactResolver: async ({ ref }) => {
        resolvedHashes.push(ref.sha256);
        const bytes = artifacts.get(ref.sha256);
        if (!bytes) {
          throw new Error(`Missing artifact ${ref.sha256}.`);
        }

        return bytes;
      },
      shouldRestoreArtifact: ({ path: artifactPath, root }) => (
        root === "vault" && artifactPath === "raw/inbox/example/scan.pdf"
      ),
      vaultBundle: snapshot.vaultBundle,
      workspaceRoot: restoreRoot,
    });

    await expect(
      readFile(path.join(restored.vaultRoot, "raw", "inbox", "example", "scan.pdf")),
    ).resolves.toEqual(Buffer.from("pdf-binary-artifact\n", "utf8"));
    assert.equal(resolvedHashes.length, 1);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(restoreRoot, { force: true, recursive: true });
  }
});

test("hosted execution snapshots externalize large non-text raw files but keep large UTF-8 text inline", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-raw-heuristics-"));
  const restoreRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-raw-heuristics-restore-"));
  const artifacts = new Map<string, Uint8Array>();

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const binaryRawPath = path.join(vaultRoot, "raw", "captures", "payload");
    const textRawPath = path.join(vaultRoot, "raw", "captures", "notes.txt");
    const binaryBytes = Uint8Array.from({ length: 256 * 1024 + 16 }, (_, index) => index % 251);
    binaryBytes[0] = 0;
    binaryBytes[17] = 255;
    const textBytes = Buffer.from("notes-line\n".repeat(30_000), "utf8");

    await mkdir(path.dirname(binaryRawPath), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".murph"), { recursive: true });
    await writeFile(binaryRawPath, binaryBytes);
    await writeFile(textRawPath, textBytes);
    await writeFile(path.join(operatorHomeRoot, ".murph", "config.json"), "{\"schema\":\"cfg\"}\n");

    const snapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      operatorHomeRoot,
      vaultRoot,
    });

    const artifactRefs = listHostedBundleArtifacts({
      bytes: snapshot.vaultBundle,
      expectedKind: "vault",
    });
    assert.deepEqual(
      artifactRefs.map((artifact) => artifact.path),
      ["raw/captures/payload"],
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.vaultBundle,
        expectedKind: "vault",
        path: "raw/captures/payload",
        root: "vault",
      }),
      null,
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.vaultBundle,
        expectedKind: "vault",
        path: "raw/captures/notes.txt",
        root: "vault",
      }),
      textBytes.toString("utf8"),
    );

    const restored = await restoreHostedExecutionContext({
      artifactResolver: async ({ ref }) => {
        const bytes = artifacts.get(ref.sha256);
        if (!bytes) {
          throw new Error(`Missing artifact ${ref.sha256}.`);
        }

        return bytes;
      },
      vaultBundle: snapshot.vaultBundle,
      workspaceRoot: restoreRoot,
    });

    await expect(readFile(path.join(restored.vaultRoot, "raw", "captures", "payload"))).resolves.toEqual(
      Buffer.from(binaryBytes),
    );
    await expect(readFile(path.join(restored.vaultRoot, "raw", "captures", "notes.txt"))).resolves.toEqual(
      textBytes,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(restoreRoot, { force: true, recursive: true });
  }
});

test("hosted execution restore rejects externalized artifacts whose bytes do not match the snapshot ref", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-artifact-integrity-"));
  const restoreRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-artifact-integrity-restore-"));
  const artifacts = new Map<string, Uint8Array>();

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const rawAttachmentPath = path.join(vaultRoot, "raw", "captures", "report.pdf");

    await mkdir(path.dirname(rawAttachmentPath), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".murph"), { recursive: true });
    await writeFile(rawAttachmentPath, Buffer.from("pdf-binary-artifact\n", "utf8"));
    await writeFile(path.join(operatorHomeRoot, ".murph", "config.json"), "{\"schema\":\"cfg\"}\n");

    const snapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      operatorHomeRoot,
      vaultRoot,
    });

    await expect(restoreHostedExecutionContext({
      artifactResolver: async ({ ref }) => {
        const bytes = artifacts.get(ref.sha256);
        if (!bytes) {
          throw new Error(`Missing artifact ${ref.sha256}.`);
        }

        return Buffer.from("corrupt-artifact\n", "utf8");
      },
      vaultBundle: snapshot.vaultBundle,
      workspaceRoot: restoreRoot,
    })).rejects.toThrow("Hosted bundle artifact vault:raw/captures/report.pdf");
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

function buildBundleRef(overrides: Partial<HostedExecutionBundleRef> = {}): HostedExecutionBundleRef {
  return {
    hash: "sha256:abc",
    key: "transient/bundles/vault/sha256-abc.bin",
    size: 12,
    updatedAt: "2026-03-31T00:00:00.000Z",
    ...overrides,
  };
}

test("sameHostedExecutionBundleRef ignores updatedAt when content identity matches", () => {
  expect(
    sameHostedExecutionBundleRef(
      buildBundleRef({ updatedAt: "2026-03-31T00:00:00.000Z" }),
      buildBundleRef({ updatedAt: "2026-03-31T00:05:00.000Z" }),
    ),
  ).toBe(true);
});

test("sameHostedExecutionBundleRef returns false when bundle identity changes", () => {
  expect(
    sameHostedExecutionBundleRef(
      buildBundleRef(),
      buildBundleRef({ hash: "sha256:def", key: "transient/bundles/vault/sha256-def.bin" }),
    ),
  ).toBe(false);
  expect(sameHostedExecutionBundleRef(buildBundleRef(), null)).toBe(false);
  expect(sameHostedExecutionBundleRef(null, null)).toBe(true);
});

test("sameHostedBundlePayloadRef ignores updatedAt metadata and compares payload identity only", () => {
  expect(
    sameHostedBundlePayloadRef(
      buildBundleRef({ updatedAt: "2026-03-31T00:00:00.000Z" }),
      buildBundleRef({ updatedAt: "2026-04-01T00:00:00.000Z" }),
    ),
  ).toBe(true);
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
