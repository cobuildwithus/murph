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
  listHostedBundleArtifacts,
  readHostedBundleTextFile,
  restoreHostedBundleRoots,
  ASSISTANT_STATE_DIRECTORY_MODE,
  ASSISTANT_STATE_FILE_MODE,
  sha256HostedBundleHex,
  snapshotHostedBundleRoots,
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

test("hosted bundle explicit files snapshot direct files and reject symlink paths", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-bundle-explicit-"));

  try {
    const root = path.join(workspaceRoot, "root");
    const outsideRoot = path.join(workspaceRoot, "outside");
    await mkdir(path.join(root, "nested"), { recursive: true });
    await mkdir(path.join(outsideRoot, "linked"), { recursive: true });
    await writeFile(path.join(root, "nested", "keep.txt"), "keep\n", "utf8");
    await writeFile(path.join(root, "nested", "skip.txt"), "skip\n", "utf8");
    await writeFile(path.join(outsideRoot, "linked", "file.txt"), "outside\n", "utf8");
    await symlink(path.join(outsideRoot, "linked"), path.join(root, "linked"), "dir");
    await symlink(
      path.join(root, "nested", "keep.txt"),
      path.join(root, "nested", "keep-link.txt"),
    );

    const bundle = await snapshotHostedBundleRoots({
      kind: "vault",
      roots: [
        {
          explicitFiles: ["nested/keep.txt", "nested/keep.txt"],
          root,
          rootKey: "vault",
          shouldIncludeRelativePath: () => false,
        },
      ],
    });
    assert.ok(bundle);
    assert.equal(
      readHostedBundleTextFile({
        bytes: bundle,
        expectedKind: "vault",
        path: "nested/keep.txt",
        root: "vault",
      }),
      "keep\n",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: bundle,
        expectedKind: "vault",
        path: "nested/skip.txt",
        root: "vault",
      }),
      null,
    );

    const overlapBundle = await snapshotHostedBundleRoots({
      kind: "vault",
      roots: [
        {
          explicitFiles: ["nested/keep.txt"],
          root,
          rootKey: "vault",
        },
      ],
    });
    assert.ok(overlapBundle);
    assert.equal(
      hostedBundle.parseHostedBundleArchive(overlapBundle).files.filter(
        entry => entry.path === "nested/keep.txt",
      ).length,
      1,
    );

    await assert.rejects(
      snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            explicitFiles: ["linked/file.txt"],
            root,
            rootKey: "vault",
            shouldIncludeRelativePath: () => false,
          },
        ],
      }),
      /explicit file is not a regular file/u,
    );
    await assert.rejects(
      snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            explicitFiles: ["nested/keep-link.txt"],
            root,
            rootKey: "vault",
            shouldIncludeRelativePath: () => false,
          },
        ],
      }),
      /explicit file is not a regular file/u,
    );
    await assert.rejects(
      snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            explicitFiles: ["nested/missing.txt"],
            root,
            rootKey: "vault",
            shouldIncludeRelativePath: () => false,
          },
        ],
      }),
      /explicit file is not a regular file/u,
    );
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
    () => hostedBundle.parseHostedBundleArchive(new Uint8Array(128 * 1024 * 1024 + 1)),
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

test("hosted bundle artifact restore verifies bytes before writing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "hosted-bundle-artifact-"));
  const expected = Buffer.from("synthetic artifact");
  const bytes = hostedBundle.serializeHostedBundleArchive({
    files: [{
      artifact: { byteSize: expected.byteLength, sha256: sha256HostedBundleHex(expected) },
      path: "artifact.txt",
      root: "vault",
    }],
    kind: "vault",
    schema: HOSTED_BUNDLE_SCHEMA,
  });
  try {
    const input = { bytes, expectedKind: "vault" as const, roots: { vault: root } };
    await expect(restoreHostedBundleRoots(input)).rejects.toThrow("requires an artifact resolver");
    await expect(restoreHostedBundleRoots({
      ...input,
      artifactResolver: async () => Buffer.alloc(expected.byteLength),
    })).rejects.toThrow("hash mismatch");
    await expect(readFile(path.join(root, "artifact.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await restoreHostedBundleRoots({ ...input, artifactResolver: async () => expected });
    expect(await readFile(path.join(root, "artifact.txt"))).toEqual(expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/generated-deliveries/report.pdf")).toMatchObject({
    classification: "operational",
    owner: "assistant-runtime",
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
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/state/accepted-turn-inputs/turn_1.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/state")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(
    ".runtime/operations/assistant/state/group-participant-display-names.json",
  )).toMatchObject({
    classification: "operational",
    portability: "portable",
    rebuildable: true,
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/state/outbox-dedupe.sqlite")).toMatchObject({
    classification: "operational",
    portability: "portable",
    rebuildable: true,
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/state/outbox-dedupe.sqlite-wal")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/hosted-pending-image-completion-hint.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
    rebuildable: true,
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/state/session-routing.sqlite")).toMatchObject({
    classification: "operational",
    portability: "portable",
    rebuildable: true,
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/state/session-routing/route.json")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
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
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/hosted-vault-share-publications.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/hosted-system-mailbox.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/diagnostics/snapshot.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/diagnostics/events.jsonl")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/cron/runs/cronrun_1.jsonl")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/journals/runtime-events.jsonl")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/runtime-budgets.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/issues/pending/issue_1.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
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
  expect(describeVaultLocalStateRelativePath(".runtime/operations/clinical-records/retrieval.json")).toMatchObject({
    owner: "vault-usecases-clinical-records",
    portability: "portable",
    rebuildable: false,
  });
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
  for (const section of ["entities", "metrics", "wearables"]) {
    expect(describeVaultLocalStateRelativePath(`.runtime/projections/query-${section}.sqlite`)).toMatchObject({
      classification: "projection",
      portability: "machine_local",
      owner: "query",
      rebuildable: true,
    });
  }
  expect(describeVaultLocalStateRelativePath(".runtime/projections/gateway.sqlite")).toMatchObject({
    classification: "projection",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/projections/gateway.sqlite")?.owner).toBeUndefined();
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
