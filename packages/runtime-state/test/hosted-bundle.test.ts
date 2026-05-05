import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { expect, test } from "vitest";

import {
  sameHostedBundlePayloadRef,
  sameHostedExecutionBundleRef,
  type HostedExecutionBundleRef,
} from "../src/index.ts";
import * as hostedBundle from "../src/hosted-bundle.ts";
import {
  describeVaultLocalStateRelativePath,
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  hasHostedBundleArtifactPath,
  HOSTED_BUNDLE_SCHEMA,
  hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity,
  HostedAssistantRuntimeHotStateIncompleteError,
  HostedWorkspaceSnapshotContinuityIncompleteError,
  listHostedBundleArtifacts,
  clearHostedAssistantRuntimeHotState,
  materializeHostedExecutionArtifacts,
  readHostedBundleTextFile,
  restoreHostedBundleRoots,
  restoreHostedExecutionContext,
  resolveAssistantStatePaths,
  ASSISTANT_STATE_DIRECTORY_MODE,
  ASSISTANT_STATE_FILE_MODE,
  sha256HostedBundleHex,
  snapshotHostedAssistantRuntimeHotState,
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
      kind: "vault",
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
      expectedKind: "vault",
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

test("hosted bundle base64 decoding rejects malformed payloads but preserves empty bundles", () => {
  expect(encodeHostedBundleBase64(null)).toBeNull();
  expect(decodeHostedBundleBase64(null)).toBeNull();
  expect(decodeHostedBundleBase64("")).toEqual(new Uint8Array());
  expect(Buffer.from(decodeHostedBundleBase64(" Zm9v ") ?? [])).toEqual(Buffer.from("foo"));
  expect(() => decodeHostedBundleBase64("%%%")).toThrow("Hosted bundle payload must be valid base64.");
  expect(() => decodeHostedBundleBase64("Zg")).toThrow("Hosted bundle payload must be valid base64.");
});

test("hosted bundle archive helpers validate text entries, artifact entries, and invalid archives", async () => {
  const textBundle = writeHostedBundleTextFile({
    bytes: null,
    kind: "vault",
    path: "nested\\state.json",
    root: "vault",
    text: "{\"ok\":true}\n",
  });

  assert.equal(readHostedBundleTextFile({
    bytes: textBundle,
    expectedKind: "vault",
    path: "nested/state.json",
    root: "vault",
  }), "{\"ok\":true}\n");
  assert.equal(hasHostedBundleArtifactPath({
    bytes: textBundle,
    expectedKind: "vault",
    path: "nested/state.json",
    root: "vault",
  }), false);

  const artifactBundle = hostedBundle.serializeHostedBundleArchive({
    files: [
      {
        artifact: {
          byteSize: 3,
          sha256: sha256HostedBundleHex(Buffer.from("pdf")),
        },
        path: "artifacts/report.pdf",
        root: "vault",
      },
    ],
    kind: "vault",
    schema: HOSTED_BUNDLE_SCHEMA,
  });

  assert.equal(readHostedBundleTextFile({
    bytes: artifactBundle,
    expectedKind: "vault",
    path: "artifacts/report.pdf",
    root: "vault",
  }), null);
  assert.equal(hasHostedBundleArtifactPath({
    bytes: artifactBundle,
    expectedKind: "vault",
    path: "artifacts/report.pdf",
    root: "vault",
  }), true);
  assert.deepEqual(listHostedBundleArtifacts({
    bytes: artifactBundle,
    expectedKind: "vault",
  }), [{
    path: "artifacts/report.pdf",
    ref: {
      byteSize: 3,
      sha256: sha256HostedBundleHex(Buffer.from("pdf")),
    },
    root: "vault",
  }]);
  assert.equal(readHostedBundleTextFile({
    bytes: null,
    expectedKind: "vault",
    path: "missing.txt",
    root: "vault",
  }), null);
  assert.deepEqual(listHostedBundleArtifacts({
    bytes: null,
    expectedKind: "vault",
  }), []);

  const deletedBundle = writeHostedBundleTextFile({
    bytes: textBundle,
    kind: "vault",
    path: "nested/state.json",
    root: "vault",
    text: null,
  });
  assert.equal(readHostedBundleTextFile({
    bytes: deletedBundle,
    expectedKind: "vault",
    path: "nested/state.json",
    root: "vault",
  }), null);

  assert.throws(
    () => hostedBundle.assertHostedBundleArtifactIntegrity({
      bytes: Uint8Array.from(Buffer.from("bad")),
      path: "artifacts/report.pdf",
      ref: { byteSize: 4, sha256: sha256HostedBundleHex(Buffer.from("pdf")) },
      root: "vault",
    }),
    /size mismatch/u,
  );
  assert.throws(
    () => hostedBundle.assertHostedBundleArtifactIntegrity({
      bytes: Uint8Array.from(Buffer.from("pdf")),
      path: "artifacts/report.pdf",
      ref: { byteSize: 3, sha256: sha256HostedBundleHex(Buffer.from("nope")) },
      root: "vault",
    }),
    /hash mismatch/u,
  );
  assert.deepEqual(hostedBundle.toHostedBundleBytes(new Uint8Array([1, 2, 3]).buffer), new Uint8Array([1, 2, 3]));
  assert.throws(
    () => hostedBundle.parseHostedBundleArchive(Uint8Array.from(Buffer.from("not-gzip"))),
    /Hosted bundle archive is invalid\./u,
  );
  assert.throws(
    () => hostedBundle.parseHostedBundleArchive(new Uint8Array(64 * 1024 * 1024 + 1)),
    /Hosted bundle archive exceeds the .* compressed size limit/u,
  );
  assert.throws(
    () => hostedBundle.parseHostedBundleArchive(gzipSync(Buffer.from(JSON.stringify({
      files: [],
      kind: "other",
      schema: HOSTED_BUNDLE_SCHEMA,
    })))),
    /Hosted bundle archive kind is invalid\./u,
  );
  assert.throws(
    () => hostedBundle.parseHostedBundleArchive(gzipSync(Buffer.from(JSON.stringify({
      files: [{ path: "a.txt", root: " " }],
      kind: "vault",
      schema: HOSTED_BUNDLE_SCHEMA,
    })))),
    /Hosted bundle root is invalid/u,
  );
  assert.throws(
    () => hostedBundle.parseHostedBundleArchive(gzipSync(Buffer.from(JSON.stringify({
      files: [
        {
          contentsBase64: "not@@base64",
          path: "a.txt",
          root: "vault",
        },
      ],
      kind: "vault",
      schema: HOSTED_BUNDLE_SCHEMA,
    })))),
    /Hosted bundle archive contains invalid inline file contents/u,
  );
  const validArtifactHash = sha256HostedBundleHex(Buffer.from("pdf"));
  for (const byteSize of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(
      () => hostedBundle.serializeHostedBundleArchive({
        files: [
          {
            artifact: {
              byteSize,
              sha256: validArtifactHash,
            },
            path: "artifacts/report.pdf",
            root: "vault",
          },
        ],
        kind: "vault",
        schema: HOSTED_BUNDLE_SCHEMA,
      }),
      /Hosted bundle archive contains invalid artifact metadata/u,
    );
  }
  assert.throws(
    () => hostedBundle.parseHostedBundleArchive(gzipSync(Buffer.from(JSON.stringify({
      files: [
        {
          artifact: {
            byteSize: Number.MAX_SAFE_INTEGER + 1,
            sha256: validArtifactHash,
          },
          path: "artifacts/report.pdf",
          root: "vault",
        },
      ],
      kind: "vault",
      schema: HOSTED_BUNDLE_SCHEMA,
    })))),
    /Hosted bundle archive contains invalid artifact metadata/u,
  );
  assert.throws(
    () => hostedBundle.serializeHostedBundleArchive({
      files: [
        {
          artifact: {
            byteSize: 3,
            sha256: "not-a-sha",
          },
          path: "artifacts/report.pdf",
          root: "vault",
        },
      ],
      kind: "vault",
      schema: HOSTED_BUNDLE_SCHEMA,
    }),
    /Hosted bundle archive contains invalid artifact metadata/u,
  );
  assert.throws(
    () => hostedBundle.serializeHostedBundleArchive({
      files: [
        {
          artifact: {
            byteSize: 3,
            sha256: validArtifactHash.toUpperCase(),
          },
          path: "artifacts/report.pdf",
          root: "vault",
        },
      ],
      kind: "vault",
      schema: HOSTED_BUNDLE_SCHEMA,
    }),
    /Hosted bundle archive contains invalid artifact metadata/u,
  );
  assert.throws(
    () => hostedBundle.serializeHostedBundleArchive({
      files: [
        { contentsBase64: "YQ==", path: "dup.txt", root: "vault" },
        { contentsBase64: "Yg==", path: "dup.txt", root: "vault" },
      ],
      kind: "vault",
      schema: HOSTED_BUNDLE_SCHEMA,
    }),
    /duplicate file entries/u,
  );
});

test("hosted bundle archive validates large inline base64 without overflowing the stack", () => {
  const largeText = "x".repeat(4 * 1024 * 1024);
  const largeBundle = hostedBundle.serializeHostedBundleArchive({
    files: [
      {
        contentsBase64: Buffer.from(largeText, "utf8").toString("base64"),
        path: "raw/large-text.txt",
        root: "vault",
      },
    ],
    kind: "vault",
    schema: HOSTED_BUNDLE_SCHEMA,
  });

  assert.equal(readHostedBundleTextFile({
    bytes: largeBundle,
    expectedKind: "vault",
    path: "raw/large-text.txt",
    root: "vault",
  })?.length, largeText.length);

  assert.throws(
    () => hostedBundle.serializeHostedBundleArchive({
      files: [
        {
          contentsBase64: `${Buffer.from(largeText, "utf8").toString("base64").slice(0, -1)}?`,
          path: "raw/large-text.txt",
          root: "vault",
        },
      ],
      kind: "vault",
      schema: HOSTED_BUNDLE_SCHEMA,
    }),
    /Hosted bundle archive contains invalid inline file contents/u,
  );
});

test("hosted bundle node helpers cover preserved artifacts, ignored roots, and restore safety checks", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-bundle-node-"));

  try {
    const bundleRoot = path.join(workspaceRoot, "bundle");
    const restoreRoot = path.join(workspaceRoot, "restore");
    await mkdir(path.join(bundleRoot, "nested"), { recursive: true });
    await writeFile(path.join(bundleRoot, "nested", "inline.txt"), "inline\n");
    await writeFile(path.join(bundleRoot, "nested", "artifact.bin"), "artifact\n");

    const bundle = await snapshotHostedBundleRoots({
      externalizeFile: async (entry) => entry.path.endsWith(".bin")
        ? {
            byteSize: entry.bytes.byteLength,
            sha256: sha256HostedBundleHex(entry.bytes),
          }
        : null,
      kind: "vault",
      preservedArtifacts: [
        {
          path: "preserved/old.bin",
          ref: {
            byteSize: 3,
            sha256: sha256HostedBundleHex(Buffer.from("old")),
          },
          root: "vault",
        },
      ],
      roots: [
        { optional: true, root: path.join(workspaceRoot, "missing"), rootKey: "vault" },
        { root: bundleRoot, rootKey: "vault" },
      ],
    });

    assert.ok(bundle);
    assert.equal(hasHostedBundleArtifactPath({
      bytes: bundle,
      expectedKind: "vault",
      path: "nested/artifact.bin",
      root: "vault",
    }), true);
    assert.equal(hasHostedBundleArtifactPath({
      bytes: bundle,
      expectedKind: "vault",
      path: "preserved/old.bin",
      root: "vault",
    }), true);

    const materializeWorkspaceRoot = path.join(workspaceRoot, "materialized-workspace");

    await materializeHostedExecutionArtifacts({
      artifactResolver: async ({ path: artifactPath }) => {
        if (artifactPath === "nested/artifact.bin") {
          return Uint8Array.from(Buffer.from("artifact\n"));
        }

        return Uint8Array.from(Buffer.from("old"));
      },
      bundle,
      shouldRestoreArtifact: ({ path: artifactPath }) => artifactPath !== "preserved/old.bin",
      workspaceRoot: materializeWorkspaceRoot,
    });

    await assert.rejects(readFile(path.join(materializeWorkspaceRoot, "vault", "nested", "inline.txt"), "utf8"));
    assert.equal(
      await readFile(path.join(materializeWorkspaceRoot, "vault", "nested", "artifact.bin"), "utf8"),
      "artifact\n",
    );
    await assert.rejects(readFile(path.join(materializeWorkspaceRoot, "vault", "preserved", "old.bin"), "utf8"));

    await restoreHostedBundleRoots({
      bytes: hostedBundle.serializeHostedBundleArchive({
        files: [
          { contentsBase64: Buffer.from("skip\n").toString("base64"), path: "ignored.txt", root: "ignored" },
        ],
        kind: "vault",
        schema: HOSTED_BUNDLE_SCHEMA,
      }),
      expectedKind: "vault",
      ignoredRoots: ["ignored"],
      roots: {
        vault: restoreRoot,
      },
    });

    await assert.rejects(
      restoreHostedBundleRoots({
        bytes: artifactBundleBytes("artifact.bin", "vault", "artifact\n"),
        expectedKind: "vault",
        roots: { vault: restoreRoot },
      }),
      /requires an artifact resolver/u,
    );

    const symlinkRoot = path.join(workspaceRoot, "symlink-root");
    await mkdir(symlinkRoot, { recursive: true });
    await symlink(path.join(workspaceRoot, "symlink-target"), path.join(symlinkRoot, "linked"));
    await assert.rejects(
      restoreHostedBundleRoots({
        bytes: inlineBundleBytes("linked/file.txt", "vault", "data\n"),
        expectedKind: "vault",
        roots: { vault: symlinkRoot },
      }),
      /may not traverse symbolic links/u,
    );

    const blockedRoot = path.join(workspaceRoot, "blocked-root");
    await mkdir(blockedRoot, { recursive: true });
    await writeFile(path.join(blockedRoot, "parent"), "file\n");
    await assert.rejects(
      restoreHostedBundleRoots({
        bytes: inlineBundleBytes("parent/child.txt", "vault", "data\n"),
        expectedKind: "vault",
        roots: { vault: blockedRoot },
      }),
      /restore parent is not a directory/u,
    );

    assert.equal(await snapshotHostedBundleRoots({
      kind: "vault",
      roots: [{ optional: true, root: path.join(workspaceRoot, "absent"), rootKey: "vault" }],
    }), null);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted bundle restore makes assistant runtime inline files private under permissive umask", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-bundle-assistant-modes-"));
  const previousUmask = process.umask(0o000);

  try {
    const restoreRoot = path.join(workspaceRoot, "restore");
    await restoreHostedBundleRoots({
      bytes: inlineBundleBytes(
        ".runtime/operations/assistant/state/sessions/asst_123/session.json",
        "vault",
        "{\"ok\":true}\n",
      ),
      expectedKind: "vault",
      roots: {
        vault: restoreRoot,
      },
    });

    const assistantRoot = path.join(restoreRoot, ".runtime", "operations", "assistant");
    const sessionsDirectory = path.join(assistantRoot, "state", "sessions", "asst_123");
    const sessionPath = path.join(sessionsDirectory, "session.json");

    assert.equal((await lstat(assistantRoot)).mode & 0o777, ASSISTANT_STATE_DIRECTORY_MODE);
    assert.equal((await lstat(sessionsDirectory)).mode & 0o777, ASSISTANT_STATE_DIRECTORY_MODE);
    assert.equal((await lstat(sessionPath)).mode & 0o777, ASSISTANT_STATE_FILE_MODE);
    assert.equal(await readFile(sessionPath, "utf8"), "{\"ok\":true}\n");
  } finally {
    process.umask(previousUmask);
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted artifact materialization makes assistant runtime artifact files private", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-bundle-assistant-artifact-modes-"));
  const previousUmask = process.umask(0o000);

  try {
    const assistantArtifactPath = ".runtime/operations/assistant/usage/pending/usage_123.json";

    await materializeHostedExecutionArtifacts({
      artifactResolver: async () => Uint8Array.from(Buffer.from("{\"usage\":true}\n")),
      bundle: artifactBundleBytes(assistantArtifactPath, "vault", "{\"usage\":true}\n"),
      workspaceRoot,
    });

    const pendingDirectory = path.join(
      workspaceRoot,
      "vault",
      ".runtime",
      "operations",
      "assistant",
      "usage",
      "pending",
    );
    const artifactPath = path.join(pendingDirectory, "usage_123.json");

    assert.equal((await lstat(pendingDirectory)).mode & 0o777, ASSISTANT_STATE_DIRECTORY_MODE);
    assert.equal((await lstat(artifactPath)).mode & 0o777, ASSISTANT_STATE_FILE_MODE);
    assert.equal(await readFile(artifactPath, "utf8"), "{\"usage\":true}\n");
  } finally {
    process.umask(previousUmask);
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted execution snapshots do not resurrect deleted materialized preserved artifacts", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-preserved-delete-"));
  const artifacts = new Map<string, Uint8Array>();

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const rawAttachmentPath = path.join(vaultRoot, "raw", "captures", "report.pdf");

    await mkdir(path.dirname(rawAttachmentPath), { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
    await writeFile(rawAttachmentPath, Buffer.from("pdf-binary-artifact\n", "utf8"));

    const initialSnapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      materializedArtifactPaths: new Set(["raw/captures/report.pdf"]),
      vaultRoot,
    });

    await rm(rawAttachmentPath);

    const nextSnapshot = await snapshotHostedExecutionContext({
      artifactSink: async () => {},
      materializedArtifactPaths: new Set(["vault/raw/captures/report.pdf"]),
      preservedArtifacts: listHostedBundleArtifacts({
        bytes: initialSnapshot.bundle,
        expectedKind: "vault",
      }),
      vaultRoot,
    });

    assert.equal(
      hasHostedBundleArtifactPath({
        bytes: nextSnapshot.bundle,
        expectedKind: "vault",
        path: "raw/captures/report.pdf",
        root: "vault",
      }),
      false,
    );
    assert.deepEqual(
      listHostedBundleArtifacts({
        bytes: nextSnapshot.bundle,
        expectedKind: "vault",
      }),
      [],
    );
    assert.equal(artifacts.size, 1);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted execution snapshots do not misparse colon-bearing materialized artifact filenames", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-preserved-colon-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const rawAttachmentPath = path.join(vaultRoot, "raw", "captures", "report:v1.pdf");

    await mkdir(path.dirname(rawAttachmentPath), { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
    await writeFile(rawAttachmentPath, Buffer.from("pdf-binary-artifact\n", "utf8"));

    const initialSnapshot = await snapshotHostedExecutionContext({
      artifactSink: async () => {},
      materializedArtifactPaths: new Set(["vault/raw/captures/report:v1.pdf"]),
      vaultRoot,
    });

    await rm(rawAttachmentPath);

    const nextSnapshot = await snapshotHostedExecutionContext({
      artifactSink: async () => {},
      materializedArtifactPaths: new Set(["vault/raw/captures/report:v1.pdf"]),
      preservedArtifacts: listHostedBundleArtifacts({
        bytes: initialSnapshot.bundle,
        expectedKind: "vault",
      }),
      vaultRoot,
    });

    assert.equal(
      hasHostedBundleArtifactPath({
        bytes: nextSnapshot.bundle,
        expectedKind: "vault",
        path: "raw/captures/report:v1.pdf",
        root: "vault",
      }),
      false,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted execution snapshots revalidate preserved artifact refs against the workspace artifact policy", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-preserved-policy-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "home");

    await mkdir(path.join(vaultRoot, ".runtime", "operations", "device-sync"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".murph", "hosted"), { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
    await writeFile(path.join(vaultRoot, ".env.local"), "secret=true\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "device-sync", "state.sqlite"), "sqlite\n");
    await writeFile(path.join(operatorHomeRoot, ".murph", "config.json"), "{\"schema\":\"cfg\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".murph", "hosted", "user-env.json"), "{\"secret\":true}\n");

    const snapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      preservedArtifacts: [
        {
          path: ".env.local",
          ref: {
            byteSize: 6,
            sha256: sha256HostedBundleHex(Buffer.from("secret")),
          },
          root: "vault",
        },
        {
          path: ".runtime/operations/device-sync/state.sqlite",
          ref: {
            byteSize: 6,
            sha256: sha256HostedBundleHex(Buffer.from("sqlite")),
          },
          root: "vault",
        },
        {
          path: ".murph/config.json",
          ref: {
            byteSize: 6,
            sha256: sha256HostedBundleHex(Buffer.from("config")),
          },
          root: "operator-home",
        },
        {
          path: ".murph/hosted/user-env.json",
          ref: {
            byteSize: 6,
            sha256: sha256HostedBundleHex(Buffer.from("userenv")),
          },
          root: "operator-home",
        },
      ],
      vaultRoot,
    });

    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: "vault.json",
        root: "vault",
      }),
      "{\"schema\":\"vault\"}\n",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".murph/config.json",
        root: "operator-home",
      }),
      "{\"schema\":\"cfg\"}\n",
    );
    assert.deepEqual(
      listHostedBundleArtifacts({
        bytes: snapshot.bundle,
        expectedKind: "vault",
      }),
      [],
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted execution snapshots reject preserved artifacts for unknown roots", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-preserved-root-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    await mkdir(vaultRoot, { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");

    await assert.rejects(
      snapshotHostedExecutionContext({
        preservedArtifacts: [
          {
            path: "raw/captures/report.pdf",
            ref: {
              byteSize: 3,
              sha256: sha256HostedBundleHex(Buffer.from("pdf")),
            },
            root: "unknown-root",
          },
        ],
        vaultRoot,
      }),
      /preserved artifact root "unknown-root" is not configured/u,
    );
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
    const assistantRuntimeRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
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
    await mkdir(path.dirname(rawAttachmentPath), { recursive: true });
    await mkdir(path.join(vaultRoot, "exports", "packs"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".git", "objects"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "cron", "runs"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "accepted-turn-inputs"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "state", "accepted-turn-inputs"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "diagnostics"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "future-continuity"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "journals"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, ".locks"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, ".automation-run.lock.stale.test"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, ".runtime-write.lock.cleanup.test"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, ".runtime-write.lock.pending.test"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "outbox", ".quarantine"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "quarantine", "secrets"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "receipts"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "secrets", "sessions"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "sessions"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "state", "secrets"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "state", ".quarantine"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "state", ".locks"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "state", "onboarding", "first-contact"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "transcripts"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "usage", "pending"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "cache"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "logs"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "rollouts", "rollout_1"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "secrets"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "auth"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "certs"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "credentials"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "keys"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "log"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "state"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "threads", "thread_1"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "tmp"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".murph", "hosted"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "device-sync"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "inbox"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "inbox", "secrets"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "op_test", "payloads"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "parsers"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "cache"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "projections"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "tmp"), { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
    await writeFile(path.join(vaultRoot, ".git", "objects", "skip"), "git-object\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "device-sync", "state.sqlite"), "sqlite-control-state\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "device-sync", "launcher.json"), "{\"pid\":1234}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "device-sync", "stdout.log"), "skip-log\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "inbox", "config.json"), "{\"version\":1,\"connectors\":[]}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "inbox", "state.json"), "{\"running\":false}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "inbox", "promotions.json"), "{\"version\":1,\"entries\":[]}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "inbox", "secrets", "token.json"), "{\"secret\":true}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "parsers", "toolchain.json"), "{\"version\":1}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "parsers", "worker.pid"), "1234\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "op_test.json"), "{\"status\":\"committed\"}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "op_test", "payloads", "staged.md"), "staged payload\n");
    await writeFile(path.join(vaultRoot, ".runtime", "cache", "assistant-cache.json"), "{\"cache\":true}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "projections", "gateway.sqlite"), "gateway-projection\n");
    await writeFile(path.join(vaultRoot, ".runtime", "projections", "query.sqlite"), "query-projection\n");
    await writeFile(path.join(vaultRoot, ".runtime", "search.sqlite"), "legacy-search\n");
    await writeFile(path.join(vaultRoot, ".runtime", "tmp", "scratch.txt"), "scratch\n");
    await writeFile(path.join(vaultRoot, ".env.local"), "secret=true\n");
    await writeFile(path.join(vaultRoot, "exports", "packs", "bundle.zip"), "skip-me\n");
    await writeFile(path.join(vaultRoot, "raw", "notes.json"), "{\"keep\":true}\n");
    await writeFile(rawAttachmentPath, Buffer.from("pdf-binary-artifact\n", "utf8"));
    await writeFile(path.join(assistantRuntimeRoot, "automation-state.json"), "{\"autoReplyChannels\":[\"linq\"]}\n");
    await writeFile(
      path.join(assistantRuntimeRoot, "accepted-turn-inputs", "turn_accepted.json"),
      "{\"schema\":\"murph.assistant-accepted-turn-input-journal.v1\"}\n",
    );
    await writeFile(
      path.join(assistantRuntimeRoot, "state", "accepted-turn-inputs", "turn_state_accepted.json"),
      "{\"schema\":\"murph.assistant-active-turn-input-state.v1\"}\n",
    );
    await writeFile(
      path.join(assistantRuntimeRoot, "cron", "automation-runtime.json"),
      "{\"version\":1,\"automations\":[{\"automationId\":\"automation_1\"}]}\n",
    );
    await writeFile(path.join(assistantRuntimeRoot, "cron", "jobs.json"), "{\"version\":1,\"jobs\":[{\"jobId\":\"cron_1\"}]}\n");
    await writeFile(path.join(assistantRuntimeRoot, "cron", "runs", "cronrun_1.jsonl"), "{\"status\":\"ok\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "diagnostics", "events.jsonl"), "{\"kind\":\"assistant.scan\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "diagnostics", "snapshot.json"), "{\"status\":\"healthy\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "future-continuity", "next.json"), "{\"survivesWithoutDescriptor\":true}\n");
    await writeFile(
      path.join(assistantRuntimeRoot, "indexes.json"),
      "{\"version\":1,\"aliases\":{\"Rocket Man\":\"session_1\"},\"conversationKeys\":{\"channel:linq|identity:user_1|thread:chat_1\":\"session_1\"}}\n",
    );
    await writeFile(path.join(assistantRuntimeRoot, "journals", "runtime-events.jsonl"), "{\"event\":\"assistant.runtime\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, ".locks", "assistant-turn"), "locked\n");
    await writeFile(path.join(assistantRuntimeRoot, ".automation-run.lock.stale.test", "owner.json"), "{\"pid\":1234}\n");
    await writeFile(path.join(assistantRuntimeRoot, ".runtime-write.lock.cleanup.test", "owner.json"), "{\"pid\":1234}\n");
    await writeFile(path.join(assistantRuntimeRoot, ".runtime-write.lock.pending.test", "owner.json"), "{\"pid\":1234}\n");
    await writeFile(
      path.join(assistantRuntimeRoot, "hosted-provider-cleanup.json"),
      "{\"schema\":\"murph.hosted-provider-cleanup.v1\",\"linqMessageIds\":[\"linq_message_1\"],\"preparedResult\":{\"eventsHandled\":1,\"summary\":\"prepared\"}}\n",
    );
    await writeFile(
      path.join(assistantRuntimeRoot, "hosted-system-mailbox.json"),
      "{\"schema\":\"murph.hosted-system-mailbox-state.v1\",\"version\":1,\"pending\":[{\"itemId\":\"mailbox_item_1\",\"status\":\"pending\"}]}\n",
    );
    await writeFile(path.join(assistantRuntimeRoot, "outbox", "intent_1.json"), "{\"intent\":\"deliver\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "outbox", ".quarantine", "ignored.json"), "{\"ignored\":true}\n");
    await writeFile(path.join(assistantRuntimeRoot, "quarantine", "secrets", "session_1.json"), "{\"secret\":true}\n");
    await writeFile(path.join(assistantRuntimeRoot, "receipts", "turn_1.json"), "{\"receipt\":\"saved\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "runtime-budgets.json"), "{\"remainingMs\":1000}\n");
    await writeFile(path.join(assistantRuntimeRoot, "sessions", "session_1.json"), "{\"session\":\"saved\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "state", "secrets", "token.json"), "{\"secret\":true}\n");
    await writeFile(path.join(assistantRuntimeRoot, "state", ".quarantine", "payload.json"), "{\"repair\":true}\n");
    await writeFile(path.join(assistantRuntimeRoot, "state", ".locks", "owner.json"), "{\"pid\":1234}\n");
    await writeFile(
      path.join(assistantRuntimeRoot, "state", "onboarding", "conversation.json"),
      "{\"schemaVersion\":\"murph.assistant-onboarding.v1\",\"createdAt\":\"2026-04-23T00:00:00.000Z\",\"updatedAt\":\"2026-04-23T00:05:00.000Z\",\"completedAt\":\"2026-04-23T00:05:00.000Z\",\"completedReason\":\"user_answered\"}\n",
    );
    await writeFile(path.join(assistantRuntimeRoot, "state", "onboarding", "first-contact", "bootstrap.json"), "{\"state\":\"scratch\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "status.json"), "{\"status\":\"running\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "transcripts", "session_1.jsonl"), "{\"role\":\"assistant\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "usage", "pending", "usage_1.json"), "{\"usage\":true}\n");
    await writeFile(path.join(assistantRuntimeRoot, ".automation-run.lock"), "locked\n");
    await writeFile(path.join(assistantRuntimeRoot, ".runtime-write.lock"), "locked\n");
    await writeFile(path.join(assistantRuntimeRoot, "socket.sock"), "socket\n");
    await writeFile(path.join(assistantRuntimeRoot, "worker.pid"), "1234\n");
    await writeFile(path.join(assistantRuntimeRoot, ".secrets"), "{\"secret\":true}\n");
    await writeFile(path.join(assistantRuntimeRoot, "tmp"), "tmp\n");
    await writeFile(path.join(assistantRuntimeRoot, ".tmp"), "tmp\n");
    await writeFile(path.join(assistantRuntimeRoot, "secrets", "sessions", "session_1.json"), "{\"secret\":true}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "config.toml"), "model = \"gpt-test\"\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "rollout_index.jsonl"), "{\"rollout\":\"rollout_1\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "rollouts", "rollout_1", "state.json"), "{\"rollout\":\"kept\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "session_index.jsonl"), "{\"thread\":\"thread_1\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "history.jsonl"), "{\"turn\":\"kept\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "rollout.json"), "{\"thread\":\"thread_1\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "state", "lookup.json"), "{\"lookup\":\"kept\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "threads", "thread_1", "state.json"), "{\"thread\":\"kept\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", ".env"), "SHOULD_NOT_APPEAR=1\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", ".netrc"), "machine example.test login token\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "auth.json"), "{\"token\":\"secret\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "credentials.json"), "{\"token\":\"secret\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "history.jsonl"), "{\"prompt\":\"raw\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "oauth.json"), "{\"token\":\"secret\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "token.json"), "{\"token\":\"secret\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "cache", "state.json"), "{\"cache\":true}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "logs", "codex.log"), "prompt log\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "secrets", "token.json"), "{\"token\":\"secret\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "auth", "provider.json"), "{\"token\":\"secret\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "certs", "root.json"), "{\"cert\":true}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "credentials", "provider.json"), "{\"token\":\"secret\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "debug.log"), "debug\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "keys", "provider.json"), "{\"key\":\"secret\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "log", "events.json"), "{\"prompt\":\"raw\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "nested-token.json"), "{\"token\":\"secret\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "private-key.json"), "{\"key\":\"secret\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "provider_cert.json"), "{\"cert\":true}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "private.key"), "private key\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "turn.lock"), "locked\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "turn.pid"), "1234\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "turn.sock"), "socket\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "tmp", "scratch.json"), "{\"tmp\":true}\n");
    await writeFile(path.join(operatorHomeRoot, ".murph", "config.json"), "{\"schema\":\"cfg\"}\n");
    await writeFile(
      path.join(operatorHomeRoot, ".murph", "hosted", "user-env.json"),
      "{\"schema\":\"murph.hosted-user-env.v1\",\"env\":{\"OPENAI_API_KEY\":\"fixture-key\"}}\n",
    );

    const snapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      codexHomeSnapshotHashSecret: "test-diagnostic-secret",
      operatorHomeRoot,
      vaultRoot,
    });

    expect(snapshot.codexHomeSnapshotDiagnostics).toEqual({
      codexHomeIncludedRelHashes: expect.arrayContaining([
        expect.stringMatching(/^h1_[a-f0-9]{24}$/u),
      ]),
      codexHomeSnapshotCandidateCount: expect.any(Number),
      codexHomeSnapshotExcludedClassSummary: expect.arrayContaining([
        expect.stringMatching(/^(environment|root-history|sensitive-basename|unsafe-container):[0-9]+$/u),
      ]),
      codexHomeSnapshotIncludedCount: expect.any(Number),
    });
    assert.ok(snapshot.codexHomeSnapshotDiagnostics?.codexHomeSnapshotIncludedCount ?? 0 >= 7);
    assert.ok(JSON.stringify(snapshot.codexHomeSnapshotDiagnostics).includes(".codex-hosted") === false);

    assertHostedBundleTextEntries(snapshot.bundle, [
      { expected: "{\"schema\":\"vault\"}\n", path: "vault.json", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant", root: "vault" },
      {
        expected: "{\"autoReplyChannels\":[\"linq\"]}\n",
        path: ".runtime/operations/assistant/automation-state.json",
        root: "vault",
      },
      {
        expected: "{\"version\":1,\"automations\":[{\"automationId\":\"automation_1\"}]}\n",
        path: ".runtime/operations/assistant/cron/automation-runtime.json",
        root: "vault",
      },
      {
        expected: "{\"version\":1,\"jobs\":[{\"jobId\":\"cron_1\"}]}\n",
        path: ".runtime/operations/assistant/cron/jobs.json",
        root: "vault",
      },
      {
        expected: "{\"session\":\"saved\"}\n",
        path: ".runtime/operations/assistant/sessions/session_1.json",
        root: "vault",
      },
      {
        expected: "{\"role\":\"assistant\"}\n",
        path: ".runtime/operations/assistant/transcripts/session_1.jsonl",
        root: "vault",
      },
      {
        expected: "{\"intent\":\"deliver\"}\n",
        path: ".runtime/operations/assistant/outbox/intent_1.json",
        root: "vault",
      },
      {
        expected: "{\"schema\":\"murph.assistant-accepted-turn-input-journal.v1\"}\n",
        path: ".runtime/operations/assistant/accepted-turn-inputs/turn_accepted.json",
        root: "vault",
      },
      {
        expected: "{\"schema\":\"murph.assistant-active-turn-input-state.v1\"}\n",
        path: ".runtime/operations/assistant/state/accepted-turn-inputs/turn_state_accepted.json",
        root: "vault",
      },
      {
        expected: "{\"receipt\":\"saved\"}\n",
        path: ".runtime/operations/assistant/receipts/turn_1.json",
        root: "vault",
      },
      {
        expected: "{\"usage\":true}\n",
        path: ".runtime/operations/assistant/usage/pending/usage_1.json",
        root: "vault",
      },
      {
        expected:
          "{\"version\":1,\"aliases\":{\"Rocket Man\":\"session_1\"},\"conversationKeys\":{\"channel:linq|identity:user_1|thread:chat_1\":\"session_1\"}}\n",
        path: ".runtime/operations/assistant/indexes.json",
        root: "vault",
      },
      {
        expected:
          "{\"schema\":\"murph.hosted-provider-cleanup.v1\",\"linqMessageIds\":[\"linq_message_1\"],\"preparedResult\":{\"eventsHandled\":1,\"summary\":\"prepared\"}}\n",
        path: ".runtime/operations/assistant/hosted-provider-cleanup.json",
        root: "vault",
      },
      {
        expected:
          "{\"schema\":\"murph.hosted-system-mailbox-state.v1\",\"version\":1,\"pending\":[{\"itemId\":\"mailbox_item_1\",\"status\":\"pending\"}]}\n",
        path: ".runtime/operations/assistant/hosted-system-mailbox.json",
        root: "vault",
      },
      { expected: "{\"status\":\"running\"}\n", path: ".runtime/operations/assistant/status.json", root: "vault" },
      { expected: "{\"kind\":\"assistant.scan\"}\n", path: ".runtime/operations/assistant/diagnostics/events.jsonl", root: "vault" },
      { expected: "{\"status\":\"healthy\"}\n", path: ".runtime/operations/assistant/diagnostics/snapshot.json", root: "vault" },
      { expected: "{\"status\":\"ok\"}\n", path: ".runtime/operations/assistant/cron/runs/cronrun_1.jsonl", root: "vault" },
      { expected: "{\"event\":\"assistant.runtime\"}\n", path: ".runtime/operations/assistant/journals/runtime-events.jsonl", root: "vault" },
      {
        expected: "{\"survivesWithoutDescriptor\":true}\n",
        path: ".runtime/operations/assistant/future-continuity/next.json",
        root: "vault",
      },
      { expected: "{\"remainingMs\":1000}\n", path: ".runtime/operations/assistant/runtime-budgets.json", root: "vault" },
      {
        expected:
          "{\"schemaVersion\":\"murph.assistant-onboarding.v1\",\"createdAt\":\"2026-04-23T00:00:00.000Z\",\"updatedAt\":\"2026-04-23T00:05:00.000Z\",\"completedAt\":\"2026-04-23T00:05:00.000Z\",\"completedReason\":\"user_answered\"}\n",
        path: ".runtime/operations/assistant/state/onboarding/conversation.json",
        root: "vault",
      },
      {
        expected: "{\"state\":\"scratch\"}\n",
        path: ".runtime/operations/assistant/state/onboarding/first-contact/bootstrap.json",
        root: "vault",
      },
      { expected: "{\"schema\":\"cfg\"}\n", path: ".murph/config.json", root: "operator-home" },
      { expected: null, path: ".murph/hosted/user-env.json", root: "operator-home" },
      { expected: "model = \"gpt-test\"\n", path: ".codex-hosted/config.toml", root: "operator-home" },
      { expected: "{\"rollout\":\"rollout_1\"}\n", path: ".codex-hosted/rollout_index.jsonl", root: "operator-home" },
      {
        expected: "{\"rollout\":\"kept\"}\n",
        path: ".codex-hosted/rollouts/rollout_1/state.json",
        root: "operator-home",
      },
      { expected: "{\"thread\":\"thread_1\"}\n", path: ".codex-hosted/session_index.jsonl", root: "operator-home" },
      {
        expected: "{\"turn\":\"kept\"}\n",
        path: ".codex-hosted/sessions/thread_1/history.jsonl",
        root: "operator-home",
      },
      {
        expected: "{\"thread\":\"thread_1\"}\n",
        path: ".codex-hosted/sessions/thread_1/rollout.json",
        root: "operator-home",
      },
      { expected: "{\"lookup\":\"kept\"}\n", path: ".codex-hosted/state/lookup.json", root: "operator-home" },
      {
        expected: "{\"thread\":\"kept\"}\n",
        path: ".codex-hosted/threads/thread_1/state.json",
        root: "operator-home",
      },
      { expected: null, path: ".codex-hosted/.env", root: "operator-home" },
      { expected: null, path: ".codex-hosted/.netrc", root: "operator-home" },
      { expected: null, path: ".codex-hosted/auth.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/credentials.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/history.jsonl", root: "operator-home" },
      { expected: null, path: ".codex-hosted/oauth.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/token.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/cache/state.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/logs/codex.log", root: "operator-home" },
      { expected: null, path: ".codex-hosted/secrets/token.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/sessions/thread_1/auth/provider.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/sessions/thread_1/certs/root.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/sessions/thread_1/credentials/provider.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/sessions/thread_1/debug.log", root: "operator-home" },
      { expected: null, path: ".codex-hosted/sessions/thread_1/keys/provider.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/sessions/thread_1/log/events.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/sessions/thread_1/nested-token.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/sessions/thread_1/private-key.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/sessions/thread_1/provider_cert.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/sessions/thread_1/private.key", root: "operator-home" },
      { expected: null, path: ".codex-hosted/sessions/thread_1/turn.lock", root: "operator-home" },
      { expected: null, path: ".codex-hosted/sessions/thread_1/turn.pid", root: "operator-home" },
      { expected: null, path: ".codex-hosted/sessions/thread_1/turn.sock", root: "operator-home" },
      { expected: null, path: ".codex-hosted/tmp/scratch.json", root: "operator-home" },
      { expected: null, path: "raw/inbox/2026-03-28/capture_123/attachments/report.pdf", root: "vault" },
      {
        expected: "{\"version\":1,\"entries\":[]}\n",
        path: ".runtime/operations/inbox/promotions.json",
        root: "vault",
      },
      {
        expected: null,
        path: ".runtime/operations/inbox/config.json",
        root: "vault",
      },
      {
        expected: null,
        path: ".runtime/operations/inbox/state.json",
        root: "vault",
      },
      {
        expected: "{\"status\":\"committed\"}\n",
        path: ".runtime/operations/op_test.json",
        root: "vault",
      },
      {
        expected: "staged payload\n",
        path: ".runtime/operations/op_test/payloads/staged.md",
        root: "vault",
      },
      { expected: null, path: ".runtime/operations/assistant/secrets/sessions/session_1.json", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/.automation-run.lock", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/.automation-run.lock.stale.test/owner.json", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/.locks/assistant-turn", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/.runtime-write.lock", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/.runtime-write.lock.cleanup.test/owner.json", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/.runtime-write.lock.pending.test/owner.json", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/.secrets", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/tmp", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/.tmp", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/outbox/.quarantine/ignored.json", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/quarantine/secrets/session_1.json", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/state/secrets/token.json", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/state/.quarantine/payload.json", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/state/.locks/owner.json", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/socket.sock", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/worker.pid", root: "vault" },
      { expected: null, path: ".runtime/operations/inbox/secrets/token.json", root: "vault" },
      { expected: null, path: ".runtime/operations/device-sync/state.sqlite", root: "vault" },
      { expected: null, path: ".runtime/cache/assistant-cache.json", root: "vault" },
      { expected: null, path: ".runtime/projections/gateway.sqlite", root: "vault" },
      { expected: null, path: ".runtime/projections/query.sqlite", root: "vault" },
      { expected: null, path: ".runtime/search.sqlite", root: "vault" },
      { expected: null, path: ".runtime/tmp/scratch.txt", root: "vault" },
      { expected: null, path: ".runtime/operations/parsers/toolchain.json", root: "vault" },
      { expected: null, path: ".runtime/operations/parsers/worker.pid", root: "vault" },
      { expected: null, path: ".git/objects/skip", root: "vault" },
    ]);

    const artifactRefs = listHostedBundleArtifacts({
      bytes: snapshot.bundle,
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
      bundle: snapshot.bundle,
      workspaceRoot: restoreRoot,
    });

    assert.equal(
      await readFile(path.join(restored.vaultRoot, "vault.json"), "utf8"),
      "{\"schema\":\"vault\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "inbox", "promotions.json"), "utf8"),
      "{\"version\":1,\"entries\":[]}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "op_test.json"), "utf8"),
      "{\"status\":\"committed\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "op_test", "payloads", "staged.md"), "utf8"),
      "staged payload\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "automation-state.json"), "utf8"),
      "{\"autoReplyChannels\":[\"linq\"]}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "cron", "automation-runtime.json"), "utf8"),
      "{\"version\":1,\"automations\":[{\"automationId\":\"automation_1\"}]}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "cron", "jobs.json"), "utf8"),
      "{\"version\":1,\"jobs\":[{\"jobId\":\"cron_1\"}]}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "sessions", "session_1.json"), "utf8"),
      "{\"session\":\"saved\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "transcripts", "session_1.jsonl"), "utf8"),
      "{\"role\":\"assistant\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "outbox", "intent_1.json"), "utf8"),
      "{\"intent\":\"deliver\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "accepted-turn-inputs", "turn_accepted.json"), "utf8"),
      "{\"schema\":\"murph.assistant-accepted-turn-input-journal.v1\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "state", "accepted-turn-inputs", "turn_state_accepted.json"), "utf8"),
      "{\"schema\":\"murph.assistant-active-turn-input-state.v1\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "receipts", "turn_1.json"), "utf8"),
      "{\"receipt\":\"saved\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "usage", "pending", "usage_1.json"), "utf8"),
      "{\"usage\":true}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "state", "onboarding", "first-contact", "bootstrap.json"), "utf8"),
      "{\"state\":\"scratch\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "indexes.json"), "utf8"),
      "{\"version\":1,\"aliases\":{\"Rocket Man\":\"session_1\"},\"conversationKeys\":{\"channel:linq|identity:user_1|thread:chat_1\":\"session_1\"}}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "hosted-system-mailbox.json"), "utf8"),
      "{\"schema\":\"murph.hosted-system-mailbox-state.v1\",\"version\":1,\"pending\":[{\"itemId\":\"mailbox_item_1\",\"status\":\"pending\"}]}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "status.json"), "utf8"),
      "{\"status\":\"running\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "diagnostics", "events.jsonl"), "utf8"),
      "{\"kind\":\"assistant.scan\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "diagnostics", "snapshot.json"), "utf8"),
      "{\"status\":\"healthy\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "cron", "runs", "cronrun_1.jsonl"), "utf8"),
      "{\"status\":\"ok\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "future-continuity", "next.json"), "utf8"),
      "{\"survivesWithoutDescriptor\":true}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "journals", "runtime-events.jsonl"), "utf8"),
      "{\"event\":\"assistant.runtime\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "runtime-budgets.json"), "utf8"),
      "{\"remainingMs\":1000}\n",
    );
    assert.equal(
      await readFile(path.join(restored.operatorHomeRoot, ".murph", "config.json"), "utf8"),
      "{\"schema\":\"cfg\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "config.toml"), "utf8"),
      "model = \"gpt-test\"\n",
    );
    assert.equal(
      await readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "rollout_index.jsonl"), "utf8"),
      "{\"rollout\":\"rollout_1\"}\n",
    );
    assert.equal(
      await readFile(
        path.join(restored.operatorHomeRoot, ".codex-hosted", "rollouts", "rollout_1", "state.json"),
        "utf8",
      ),
      "{\"rollout\":\"kept\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "session_index.jsonl"), "utf8"),
      "{\"thread\":\"thread_1\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "history.jsonl"), "utf8"),
      "{\"turn\":\"kept\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "rollout.json"), "utf8"),
      "{\"thread\":\"thread_1\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "state", "lookup.json"), "utf8"),
      "{\"lookup\":\"kept\"}\n",
    );
    assert.equal(
      await readFile(
        path.join(restored.operatorHomeRoot, ".codex-hosted", "threads", "thread_1", "state.json"),
        "utf8",
      ),
      "{\"thread\":\"kept\"}\n",
    );
    assert.equal(
      (await lstat(path.join(restored.operatorHomeRoot, ".codex-hosted"))).mode & 0o777,
      ASSISTANT_STATE_DIRECTORY_MODE,
    );
    assert.equal(
      (await lstat(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions"))).mode & 0o777,
      ASSISTANT_STATE_DIRECTORY_MODE,
    );
    assert.equal(
      (await lstat(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1"))).mode & 0o777,
      ASSISTANT_STATE_DIRECTORY_MODE,
    );
    assert.equal(
      (await lstat(path.join(restored.operatorHomeRoot, ".codex-hosted", "config.toml"))).mode & 0o777,
      ASSISTANT_STATE_FILE_MODE,
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
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", ".env"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", ".netrc"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "auth.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "credentials.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "history.jsonl"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "oauth.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "token.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "cache", "state.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "logs", "codex.log"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "secrets", "token.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "auth", "provider.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "certs", "root.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "credentials", "provider.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "debug.log"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "keys", "provider.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "log", "events.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "nested-token.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "private-key.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "provider_cert.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "private.key"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "turn.lock"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "turn.pid"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "turn.sock"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "tmp", "scratch.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "secrets", "sessions", "session_1.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", ".automation-run.lock"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", ".automation-run.lock.stale.test", "owner.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", ".locks", "assistant-turn"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", ".runtime-write.lock"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", ".runtime-write.lock.cleanup.test", "owner.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", ".runtime-write.lock.pending.test", "owner.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "outbox", ".quarantine", "ignored.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "quarantine", "secrets", "session_1.json"), "utf8"),
    );
    await assert.rejects(readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "socket.sock"), "utf8"));
    await assert.rejects(readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "worker.pid"), "utf8"));
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "device-sync", "state.sqlite"), "utf8"),
    );
    await assert.rejects(readFile(path.join(restored.vaultRoot, ".env.local"), "utf8"));
    await assert.rejects(readFile(path.join(restored.vaultRoot, "exports", "packs", "bundle.zip"), "utf8"));
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "device-sync", "launcher.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "device-sync", "stdout.log"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "inbox", "config.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "inbox", "state.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "inbox", "secrets", "token.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "state", "secrets", "token.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "state", ".quarantine", "payload.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "state", ".locks", "owner.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "parsers", "toolchain.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "parsers", "worker.pid"), "utf8"),
    );
    await assert.rejects(readFile(path.join(restored.vaultRoot, ".runtime", "cache", "assistant-cache.json"), "utf8"));
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "projections", "gateway.sqlite"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "projections", "query.sqlite"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "search.sqlite"), "utf8"),
    );
    await assert.rejects(readFile(path.join(restored.vaultRoot, ".runtime", "tmp", "scratch.txt"), "utf8"));
    await assert.rejects(readFile(path.join(restored.vaultRoot, ".git", "objects", "skip"), "utf8"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(restoreRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state snapshots restore as authoritative latest state", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-state-"));
  const restoreRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-state-restore-"));

  try {
    const baseVaultRoot = path.join(workspaceRoot, "base-vault");
    const baseAssistantRoot = resolveAssistantStatePaths(baseVaultRoot).assistantStateRoot;
    await mkdir(path.join(baseAssistantRoot, "outbox"), { recursive: true });
    await mkdir(path.join(baseVaultRoot, "raw", "inbox"), { recursive: true });
    await writeFile(path.join(baseVaultRoot, "note.md"), "base note\n", "utf8");
    await writeFile(
      path.join(baseAssistantRoot, "outbox", "intent-a.json"),
      "{\"intent\":\"old\"}\n",
      "utf8",
    );
    await writeFile(path.join(baseVaultRoot, "raw", "inbox", "large.pdf"), "raw evidence\n", "utf8");

    const baseSnapshot = await snapshotHostedExecutionContext({
      vaultRoot: baseVaultRoot,
    });

    const hotVaultRoot = path.join(workspaceRoot, "hot-vault");
    const hotAssistantRoot = resolveAssistantStatePaths(hotVaultRoot).assistantStateRoot;
    await mkdir(path.join(hotAssistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(hotAssistantRoot, "diagnostics"), { recursive: true });
    await writeFile(
      path.join(hotAssistantRoot, "sessions", "session.json"),
      "{\"session\":\"latest\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(hotAssistantRoot, "diagnostics", "debug.json"),
      "{\"debug\":true}\n",
      "utf8",
    );
    await writeFile(path.join(hotVaultRoot, "note.md"), "hot note should not be captured\n", "utf8");

    const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
      vaultRoot: hotVaultRoot,
    });
    assert.equal(hotSnapshot.fileCount, 1);
    assert.equal(
      readHostedBundleTextFile({
        bytes: hotSnapshot.bundle,
        expectedKind: "vault",
        path: ".runtime/operations/assistant/sessions/session.json",
        root: "vault",
      }),
      "{\"session\":\"latest\"}\n",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: hotSnapshot.bundle,
        expectedKind: "vault",
        path: "note.md",
        root: "vault",
      }),
      null,
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: hotSnapshot.bundle,
        expectedKind: "vault",
        path: ".runtime/operations/assistant/diagnostics/debug.json",
        root: "vault",
      }),
      null,
    );

    const restored = await restoreHostedExecutionContext({
      bundle: baseSnapshot.bundle,
      workspaceRoot: restoreRoot,
    });
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "outbox", "intent-a.json"), "utf8"),
      "{\"intent\":\"old\"}\n",
    );

    await clearHostedAssistantRuntimeHotState({
      vaultRoot: restored.vaultRoot,
    });
    await restoreHostedBundleRoots({
      bytes: hotSnapshot.bundle,
      expectedKind: "vault",
      roots: {
        vault: restored.vaultRoot,
      },
    });

    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "outbox", "intent-a.json"), "utf8"),
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"), "utf8"),
      "{\"session\":\"latest\"}\n",
    );
    assert.equal(await readFile(path.join(restored.vaultRoot, "note.md"), "utf8"), "base note\n");
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(restoreRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state snapshots include filtered Codex home state", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-codex-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "05"), {
      recursive: true,
    });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "logs"), { recursive: true });
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      "{\"providerSessionId\":\"thread-test\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "05", "rollout.jsonl"),
      "{\"type\":\"provider-owned\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "logs", "debug.log"),
      "must not snapshot\n",
      "utf8",
    );

    const snapshot = await snapshotHostedAssistantRuntimeHotState({
      operatorHomeRoot,
      vaultRoot,
    });

    assert.equal(hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity({
      bundle: snapshot.bundle,
    }), true);
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".codex-hosted/sessions/2026/05/05/rollout.jsonl",
        root: "operator-home",
      }),
      "{\"type\":\"provider-owned\"}\n",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".codex-hosted/logs/debug.log",
        root: "operator-home",
      }),
      null,
    );

    await clearHostedAssistantRuntimeHotState({
      operatorHomeRoot,
      vaultRoot,
    });

    await assert.rejects(
      readFile(
        path.join(operatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "05", "rollout.jsonl"),
        "utf8",
      ),
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state snapshots omit Codex home without provider resume state", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-codex-unused-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    await mkdir(path.join(assistantRoot, "outbox"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions"), { recursive: true });
    await writeFile(
      path.join(assistantRoot, "outbox", "intent.json"),
      "{\"intent\":\"ready\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "sessions", "stale.jsonl"),
      "{\"thread\":\"stale\"}\n",
      "utf8",
    );

    const snapshot = await snapshotHostedAssistantRuntimeHotState({
      operatorHomeRoot,
      vaultRoot,
    });

    assert.equal(hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity({
      bundle: snapshot.bundle,
    }), false);
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".codex-hosted/sessions/stale.jsonl",
        root: "operator-home",
      }),
      null,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state snapshots reject dangling Codex resume state", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-codex-missing-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      "{\"providerSessionId\":\"thread-test\"}\n",
      "utf8",
    );

    await assert.rejects(
      snapshotHostedAssistantRuntimeHotState({
        vaultRoot,
      }),
      HostedAssistantRuntimeHotStateIncompleteError,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state snapshots reject config-only Codex home continuity", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-codex-config-only-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted"), { recursive: true });
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          providerSessionId: "thread-test",
          resumeRouteId: "route-test",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "config.toml"),
      "model = \"gpt-test\"\n",
      "utf8",
    );

    await assert.rejects(
      snapshotHostedAssistantRuntimeHotState({
        operatorHomeRoot,
        vaultRoot,
      }),
      HostedAssistantRuntimeHotStateIncompleteError,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted full snapshots reject dangling Codex resume state", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-full-codex-missing-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted"), { recursive: true });
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      "{\"providerSessionId\":\"thread-test\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "config.toml"),
      "model = \"gpt-test\"\n",
      "utf8",
    );

    await assert.rejects(
      snapshotHostedExecutionContext({
        operatorHomeRoot,
        vaultRoot,
      }),
      HostedWorkspaceSnapshotContinuityIncompleteError,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted Codex home diagnostics omit relative-path hashes without a hash secret", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-bundle-"));

  try {
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const vaultRoot = path.join(workspaceRoot, "vault");
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "state"), { recursive: true });
    await mkdir(vaultRoot, { recursive: true });
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "state", "lookup.json"),
      "{\"lookup\":\"kept\"}\n",
      "utf8",
    );
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n", "utf8");

    const snapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });

    expect(snapshot.codexHomeSnapshotDiagnostics).toEqual({
      codexHomeIncludedRelHashes: [],
      codexHomeSnapshotCandidateCount: 1,
      codexHomeSnapshotExcludedClassSummary: [],
      codexHomeSnapshotIncludedCount: 1,
    });
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

function assertHostedBundleTextEntries(
  bytes: Uint8Array,
  entries: ReadonlyArray<{
    expected: string | null;
    path: string;
    root: "operator-home" | "vault";
  }>,
): void {
  for (const { expected, path, root } of entries) {
    assert.equal(
      readHostedBundleTextFile({
        bytes,
        expectedKind: "vault",
        path,
        root,
      }),
      expected,
    );
  }
}

function artifactBundleBytes(relativePath: string, root: string, contents: string): Uint8Array {
  return hostedBundle.serializeHostedBundleArchive({
    files: [
      {
        artifact: {
          byteSize: Buffer.byteLength(contents),
          sha256: sha256HostedBundleHex(Buffer.from(contents)),
        },
        path: relativePath,
        root,
      },
    ],
    kind: "vault",
    schema: HOSTED_BUNDLE_SCHEMA,
  });
}

function inlineBundleBytes(relativePath: string, root: string, contents: string): Uint8Array {
  return hostedBundle.serializeHostedBundleArchive({
    files: [
      {
        contentsBase64: Buffer.from(contents).toString("base64"),
        path: relativePath,
        root,
      },
    ],
    kind: "vault",
    schema: HOSTED_BUNDLE_SCHEMA,
  });
}

test("runtime-state portability defaults operational paths to machine-local unless explicitly marked portable", () => {
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/automation-state.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/cron")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/cron/automation-runtime.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/cron/jobs.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/sessions/session_1.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/accepted-turn-inputs/turn_1.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/state")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/state/onboarding")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/state/onboarding/conversation.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/outbox/.quarantine/ignored.json")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/status.json")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/indexes.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/hosted-provider-cleanup.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/hosted-mailbox.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/hosted-system-mailbox.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/diagnostics/snapshot.json")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/cron/runs/cronrun_1.jsonl")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/state/onboarding/first-contact/bootstrap.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/inbox/promotions.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/op_test.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/op_test/payloads/staged.md")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/op_test/payloads/staged.md")?.relativePath).toBe(
    ".runtime/operations/op_test/payloads/staged.md",
  );
  expect(describeVaultLocalStateRelativePath(".runtime/operations/inbox/config.json")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/device-sync/launcher.json")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/parsers/toolchain.json")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/cron/runs/cronrun_1.jsonl")?.relativePath).toBe(
    ".runtime/operations/assistant/cron/runs/cronrun_1.jsonl",
  );
  expect(describeVaultLocalStateRelativePath(".runtime/projections/query.sqlite")).toMatchObject({
    classification: "projection",
    portability: "machine_local",
    owner: "query",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/projections/gateway.sqlite")).toMatchObject({
    classification: "projection",
    portability: "machine_local",
    owner: "gateway-local",
  });
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
        bytes: snapshot.bundle,
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
      bundle: snapshot.bundle,
      workspaceRoot: restoreRoot,
    });

    await assert.rejects(
      readFile(path.join(restored.vaultRoot, "raw", "inbox", "example", "scan.pdf")),
    );
    assert.equal(resolvedHashes.length, 0);

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
      bundle: snapshot.bundle,
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
      bytes: snapshot.bundle,
      expectedKind: "vault",
    });
    assert.deepEqual(
      artifactRefs.map((artifact) => artifact.path),
      ["raw/captures/payload"],
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: "raw/captures/payload",
        root: "vault",
      }),
      null,
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
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
      bundle: snapshot.bundle,
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
      bundle: snapshot.bundle,
      workspaceRoot: restoreRoot,
    })).rejects.toThrow("Hosted bundle artifact size mismatch");
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(restoreRoot, { force: true, recursive: true });
  }
});

test("hosted bundle text helpers patch and remove individual files deterministically", async () => {
  let bundle = writeHostedBundleTextFile({
    bytes: null,
    kind: "vault",
    path: ".murph/hosted/user-env.json",
    root: "operator-home",
    text: "{\"ok\":true}\n",
  });

  assert.equal(
    readHostedBundleTextFile({
      bytes: bundle,
      expectedKind: "vault",
      path: ".murph/hosted/user-env.json",
      root: "operator-home",
    }),
    "{\"ok\":true}\n",
  );

  bundle = writeHostedBundleTextFile({
    bytes: bundle,
    kind: "vault",
    path: ".murph/hosted/user-env.json",
    root: "operator-home",
    text: "{\"ok\":false}\n",
  });

  assert.equal(
    readHostedBundleTextFile({
      bytes: bundle,
      expectedKind: "vault",
      path: ".murph/hosted/user-env.json",
      root: "operator-home",
    }),
    "{\"ok\":false}\n",
  );

  bundle = writeHostedBundleTextFile({
    bytes: bundle,
    kind: "vault",
    path: ".murph/hosted/user-env.json",
    root: "operator-home",
    text: null,
  });

  assert.equal(
    readHostedBundleTextFile({
      bytes: bundle,
      expectedKind: "vault",
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
          expectedKind: "vault",
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

test("hosted bundle restore rejects duplicate root and path entries", () => {
  expect(() => writeHostedBundleTextFile({
    bytes: hostedBundle.serializeHostedBundleArchive({
      files: [
        {
          contentsBase64: Buffer.from("first", "utf8").toString("base64"),
          path: "notes/today.md",
          root: "vault",
        },
      ],
      kind: "vault",
      schema: HOSTED_BUNDLE_SCHEMA,
    }),
    kind: "vault",
    path: "notes/today.md",
    root: "vault",
    text: "second",
  })).not.toThrow();

  expect(() => hostedBundle.serializeHostedBundleArchive({
    files: [
      {
        contentsBase64: Buffer.from("first", "utf8").toString("base64"),
        path: "notes/today.md",
        root: "vault",
      },
      {
        contentsBase64: Buffer.from("second", "utf8").toString("base64"),
        path: "notes/today.md",
        root: "vault",
      },
    ],
    kind: "vault",
    schema: HOSTED_BUNDLE_SCHEMA,
  })).toThrow(/duplicate file entries/i);
});

test("hosted bundle restore rejects duplicate entries when parsing untrusted bundle bytes", () => {
  const bundleBytes = Uint8Array.from(gzipSync(Buffer.from(JSON.stringify({
    files: [
      {
        contentsBase64: Buffer.from("first", "utf8").toString("base64"),
        path: "notes/today.md",
        root: "vault",
      },
      {
        contentsBase64: Buffer.from("second", "utf8").toString("base64"),
        path: "notes/today.md",
        root: "vault",
      },
    ],
    kind: "vault",
    schema: HOSTED_BUNDLE_SCHEMA,
  }), "utf8")));

  expect(() => readHostedBundleTextFile({
    bytes: bundleBytes,
    expectedKind: "vault",
    path: "notes/today.md",
    root: "vault",
  })).toThrow(/duplicate file entries/i);
});

test("hosted bundle restore rejects restore paths that traverse pre-existing symbolic links", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-bundle-symlink-"));

  try {
    const restoreRoot = path.join(workspaceRoot, "vault");
    const escapedRoot = path.join(workspaceRoot, "escaped");

    await mkdir(restoreRoot, { recursive: true });
    await mkdir(escapedRoot, { recursive: true });
    await symlink(escapedRoot, path.join(restoreRoot, "linked"), "dir");

    await expect(
      restoreHostedBundleRoots({
        bytes: Uint8Array.from(
          gzipSync(
            Buffer.from(
              JSON.stringify({
                files: [
                  {
                    contentsBase64: Buffer.from("unexpected", "utf8").toString("base64"),
                    path: "linked/outside.txt",
                    root: "vault",
                  },
                ],
                kind: "vault",
                schema: HOSTED_BUNDLE_SCHEMA,
              }),
              "utf8",
            ),
          ),
        ),
        expectedKind: "vault",
        roots: {
          vault: restoreRoot,
        },
      }),
    ).rejects.toThrow(/symbolic links/i);

    await assert.rejects(readFile(path.join(escapedRoot, "outside.txt"), "utf8"));
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
          kind: "vault",
          schema: HOSTED_BUNDLE_SCHEMA,
        }),
        "utf8",
      ),
    ),
  );
}
