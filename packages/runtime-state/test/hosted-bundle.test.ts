import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { expect, test, vi } from "vitest";

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
  HostedAssistantRuntimeHotStateBudgetExceededError,
  listHostedBundleArtifacts,
  clearHostedAssistantRuntimeHotState,
  materializeHostedExecutionArtifacts,
  createHostedPortableWorkspaceManifestFromBundle,
  readHostedPortableWorkspaceDeltaManifestFromBundle,
  readHostedPortableWorkspaceManifestFromBundle,
  readHostedBundleTextFile,
  readHostedWorkspaceSkippedInlineFiles,
  restoreHostedBundleRoots,
  restoreHostedExecutionContext,
  restoreHostedWorkspaceWorkingDelta,
  resolveAssistantStatePaths,
  ASSISTANT_STATE_DIRECTORY_MODE,
  ASSISTANT_STATE_FILE_MODE,
  sha256HostedBundleHex,
  snapshotHostedAssistantRuntimeHotState,
  snapshotHostedBundleRoots,
  snapshotHostedExecutionContext,
  snapshotHostedPortableWorkspaceDelta,
  writeHostedBundleTextFile,
  writeHostedWorkspaceSkippedInlineFiles,
} from "../src/node/index.ts";

const HOSTED_CHECKPOINT_DEBUG_PATHS_ENV = "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS";
const HOSTED_CHECKPOINT_DEBUG_PATHS_FILE_ENV = "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_FILE";
const HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_ENV = "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG";
const HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT_ENV = "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT";
const HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW_ENV = "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW";
const HOSTED_CHECKPOINT_DEBUG_TRACE_SCHEMA = "murph.hosted-checkpoint-debug-paths.v1";
const HOSTED_CHECKPOINT_DEBUG_SUMMARY_LOG_EVENT = "murph.hosted-checkpoint-debug.summary";
const HOSTED_CHECKPOINT_DEBUG_ENTRIES_LOG_EVENT = "murph.hosted-checkpoint-debug.entries";

async function withHostedCheckpointDebugEnv(
  input: {
    enabled?: string;
    log?: string;
    logLimit?: string;
    logRaw?: string;
    outputFile?: string;
  },
  run: () => Promise<void>,
): Promise<void> {
  const previousEnabled = process.env[HOSTED_CHECKPOINT_DEBUG_PATHS_ENV];
  const previousOutputFile = process.env[HOSTED_CHECKPOINT_DEBUG_PATHS_FILE_ENV];
  const previousLog = process.env[HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_ENV];
  const previousLogLimit = process.env[HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT_ENV];
  const previousLogRaw = process.env[HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW_ENV];

  try {
    setOptionalProcessEnv(HOSTED_CHECKPOINT_DEBUG_PATHS_ENV, input.enabled);
    setOptionalProcessEnv(HOSTED_CHECKPOINT_DEBUG_PATHS_FILE_ENV, input.outputFile);
    setOptionalProcessEnv(HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_ENV, input.log);
    setOptionalProcessEnv(HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT_ENV, input.logLimit);
    setOptionalProcessEnv(HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW_ENV, input.logRaw);
    await run();
  } finally {
    setOptionalProcessEnv(HOSTED_CHECKPOINT_DEBUG_PATHS_ENV, previousEnabled);
    setOptionalProcessEnv(HOSTED_CHECKPOINT_DEBUG_PATHS_FILE_ENV, previousOutputFile);
    setOptionalProcessEnv(HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_ENV, previousLog);
    setOptionalProcessEnv(HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT_ENV, previousLogLimit);
    setOptionalProcessEnv(HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW_ENV, previousLogRaw);
  }
}

function setOptionalProcessEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
}

function parseHostedCheckpointDebugArtifact(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  assertRecord(value);
  return value;
}

function readHostedCheckpointDebugRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = record[key];
  assertRecord(value);
  return value;
}

function readHostedCheckpointDebugEntries(
  artifact: Record<string, unknown>,
): Record<string, unknown>[] {
  const value = artifact.entries;
  assert.ok(Array.isArray(value));
  const entries: Record<string, unknown>[] = [];

  for (const entry of value) {
    assertRecord(entry);
    entries.push(entry);
  }

  return entries;
}

function findHostedCheckpointDebugLog(
  calls: readonly unknown[][],
  eventName: string,
): Record<string, unknown> {
  const call = calls.find((candidate) => candidate[0] === eventName);
  assert.ok(call, `missing checkpoint debug log ${eventName}`);
  const payload = call[1];
  if (typeof payload !== "string") {
    throw new TypeError(`checkpoint debug log ${eventName} payload must be a string`);
  }
  return parseHostedCheckpointDebugArtifact(payload);
}

function assertHostedCheckpointDebugEntry(
  entries: readonly Record<string, unknown>[],
  expected: {
    bytes?: number;
    decision?: string;
    depth?: number;
    path: string;
    reason?: string;
    root?: string;
    source?: string;
    type?: string;
  },
): void {
  const entry = entries.find((candidate) =>
    candidate.path === expected.path
    && (expected.source === undefined || candidate.source === expected.source)
    && (expected.reason === undefined || candidate.reason === expected.reason)
  );
  assert.ok(entry, `missing hosted checkpoint debug entry for ${expected.path}`);

  for (const [key, value] of Object.entries(expected)) {
    if (value !== undefined) {
      assert.equal(entry[key], value);
    }
  }
}

function isMissingTestPathError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT",
  );
}

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

    const externalizedPaths: string[] = [];
    const overlapBundle = await snapshotHostedBundleRoots({
      externalizeFile: async (artifact) => {
        externalizedPaths.push(artifact.path);
        return null;
      },
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
    assert.deepEqual(
      externalizedPaths.filter((entry) => entry === "nested/keep.txt"),
      ["nested/keep.txt"],
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

test("hosted bundle explicit file snapshots check liveness before externalizing", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-bundle-explicit-live-"));

  try {
    const root = path.join(workspaceRoot, "root");
    await mkdir(path.join(root, "nested"), { recursive: true });
    await writeFile(path.join(root, "nested", "keep.txt"), "keep\n", "utf8");

    let liveChecks = 0;
    let externalizeCalls = 0;
    await assert.rejects(
      snapshotHostedBundleRoots({
        assertSnapshotLive() {
          liveChecks += 1;
          if (liveChecks >= 5) {
            throw new Error("snapshot stale");
          }
        },
        externalizeFile: async () => {
          externalizeCalls += 1;
          return null;
        },
        kind: "vault",
        roots: [
          {
            explicitFiles: ["nested/keep.txt"],
            root,
            rootKey: "vault",
            shouldIncludeRelativePath: () => false,
          },
        ],
      }),
      /snapshot stale/u,
    );
    assert.equal(externalizeCalls, 0);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted checkpoint debug paths are disabled by default", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-checkpoint-debug-disabled-"));
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    const root = path.join(workspaceRoot, "root");
    const debugOutputPath = path.join(workspaceRoot, "debug.json");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "keep.txt"), "keep\n", "utf8");

    await withHostedCheckpointDebugEnv({ log: "1", outputFile: debugOutputPath }, async () => {
      const bundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [{ root, rootKey: "vault" }],
      });
      assert.ok(bundle);
    });

    await assert.rejects(readFile(debugOutputPath, "utf8"), isMissingTestPathError);
    assert.equal(consoleError.mock.calls.length, 0);
  } finally {
    consoleError.mockRestore();
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted checkpoint debug paths record walker decisions", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-checkpoint-debug-"));

  try {
    const root = path.join(workspaceRoot, "root");
    const debugOutputPath = path.join(workspaceRoot, "checkpoint-debug.json");
    await mkdir(path.join(root, "excluded-dir"), { recursive: true });
    await mkdir(path.join(root, "nested"), { recursive: true });
    await writeFile(path.join(root, "excluded-dir", "hidden.txt"), "hidden\n", "utf8");
    await writeFile(path.join(root, "explicit-only.txt"), "explicit\n", "utf8");
    await writeFile(path.join(root, "external.bin"), "external\n", "utf8");
    await writeFile(path.join(root, "keep.txt"), "keep\n", "utf8");
    await writeFile(path.join(root, "nested", "deep.txt"), "deep\n", "utf8");
    await writeFile(path.join(root, "skip.txt"), "skip\n", "utf8");
    await symlink(path.join(root, "keep.txt"), path.join(root, "keep-link.txt"));

    await withHostedCheckpointDebugEnv({ enabled: "1", outputFile: debugOutputPath }, async () => {
      const bundle = await snapshotHostedBundleRoots({
        externalizeFile: async (entry) => entry.path === "external.bin"
          ? {
              byteSize: entry.bytes.byteLength,
              sha256: sha256HostedBundleHex(entry.bytes),
            }
          : null,
        kind: "vault",
        materializedPreservedArtifactPaths: new Set(["vault:preserved/stale.bin"]),
        preservedArtifacts: [
          {
            path: "preserved/drop.bin",
            ref: {
              byteSize: 4,
              sha256: sha256HostedBundleHex(Buffer.from("drop")),
            },
            root: "vault",
          },
          {
            path: "preserved/old.bin",
            ref: {
              byteSize: 3,
              sha256: sha256HostedBundleHex(Buffer.from("old")),
            },
            root: "vault",
          },
          {
            path: "preserved/stale.bin",
            ref: {
              byteSize: 5,
              sha256: sha256HostedBundleHex(Buffer.from("stale")),
            },
            root: "vault",
          },
        ],
        roots: [
          {
            explicitFiles: ["explicit-only.txt", "keep.txt"],
            root,
            rootKey: "vault",
            shouldIncludeRelativePath(relativePath) {
              return relativePath !== "excluded-dir"
                && relativePath !== "explicit-only.txt"
                && relativePath !== "skip.txt"
                && !relativePath.startsWith("excluded-dir/");
            },
          },
        ],
        shouldIncludePreservedArtifact(artifact) {
          return artifact.path !== "preserved/drop.bin";
        },
      });
      assert.ok(bundle);
    });

    const debugText = await readFile(debugOutputPath, "utf8");
    assert.equal(debugText.includes(workspaceRoot), false);
    assert.equal(debugText.includes(root), false);

    const artifact = parseHostedCheckpointDebugArtifact(debugText);
    assert.equal(artifact.schema, HOSTED_CHECKPOINT_DEBUG_TRACE_SCHEMA);
    assert.equal(artifact.kind, "vault");
    assert.equal(artifact.status, "completed");

    const summary = readHostedCheckpointDebugRecord(artifact, "summary");
    const entries = readHostedCheckpointDebugEntries(artifact);
    assert.equal(summary.archiveFileCount, 5);
    assert.equal(summary.entryCount, entries.length);

    assertHostedCheckpointDebugEntry(entries, {
      decision: "exclude",
      depth: 1,
      path: "excluded-dir",
      reason: "policy_excluded",
      source: "walk",
      type: "directory",
    });
    assertHostedCheckpointDebugEntry(entries, {
      decision: "include",
      path: "external.bin",
      reason: "externalized",
      source: "walk",
      type: "file",
      bytes: Buffer.byteLength("external\n"),
    });
    assertHostedCheckpointDebugEntry(entries, {
      decision: "exclude",
      path: "keep-link.txt",
      reason: "unsupported_type",
      source: "walk",
      type: "symlink",
    });
    assertHostedCheckpointDebugEntry(entries, {
      bytes: Buffer.byteLength("keep\n"),
      decision: "include",
      depth: 1,
      path: "keep.txt",
      reason: "inline",
      source: "walk",
      type: "file",
    });
    assertHostedCheckpointDebugEntry(entries, {
      decision: "descend",
      depth: 1,
      path: "nested",
      reason: "policy_included",
      source: "walk",
      type: "directory",
    });
    assertHostedCheckpointDebugEntry(entries, {
      decision: "include",
      depth: 2,
      path: "nested/deep.txt",
      reason: "inline",
      source: "walk",
      type: "file",
    });
    assertHostedCheckpointDebugEntry(entries, {
      decision: "exclude",
      path: "skip.txt",
      reason: "policy_excluded",
      source: "walk",
      type: "file",
    });
    assertHostedCheckpointDebugEntry(entries, {
      decision: "include",
      depth: 1,
      path: "explicit-only.txt",
      reason: "inline",
      source: "explicit",
      type: "file",
    });
    assertHostedCheckpointDebugEntry(entries, {
      decision: "exclude",
      path: "keep.txt",
      reason: "already_included",
      source: "explicit",
      type: "file",
    });
    assertHostedCheckpointDebugEntry(entries, {
      decision: "exclude",
      path: "preserved/drop.bin",
      reason: "policy_excluded",
      source: "preserved",
      type: "artifact",
    });
    assertHostedCheckpointDebugEntry(entries, {
      decision: "include",
      depth: 2,
      path: "preserved/old.bin",
      reason: "preserved_artifact",
      source: "preserved",
      type: "artifact",
      bytes: 3,
    });
    assertHostedCheckpointDebugEntry(entries, {
      decision: "exclude",
      path: "preserved/stale.bin",
      reason: "not_live",
      source: "preserved",
      type: "artifact",
    });
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted checkpoint debug paths can stream bounded logs", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-checkpoint-debug-log-"));
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    const root = path.join(workspaceRoot, "root");
    const debugOutputPath = path.join(workspaceRoot, "checkpoint-debug.json");
    await mkdir(path.join(root, "nested"), { recursive: true });
    await writeFile(path.join(root, "first.txt"), "first\n", "utf8");
    await writeFile(path.join(root, "nested", "second.txt"), "second\n", "utf8");
    await writeFile(path.join(root, "third.txt"), "third\n", "utf8");

    await withHostedCheckpointDebugEnv({
      enabled: "1",
      log: "1",
      logLimit: "2",
      outputFile: debugOutputPath,
    }, async () => {
      const bundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [{ root, rootKey: "vault" }],
      });
      assert.ok(bundle);
    });

    const joinedLogs = consoleError.mock.calls.flat().join("\n");
    assert.equal(joinedLogs.includes(workspaceRoot), false);
    assert.equal(joinedLogs.includes(root), false);
    assert.equal(joinedLogs.includes(debugOutputPath), false);

    const summaryLog = findHostedCheckpointDebugLog(
      consoleError.mock.calls,
      HOSTED_CHECKPOINT_DEBUG_SUMMARY_LOG_EVENT,
    );
    const entriesLog = findHostedCheckpointDebugLog(
      consoleError.mock.calls,
      HOSTED_CHECKPOINT_DEBUG_ENTRIES_LOG_EVENT,
    );
    assert.equal(summaryLog.schema, HOSTED_CHECKPOINT_DEBUG_TRACE_SCHEMA);
    assert.equal(summaryLog.kind, "vault");
    assert.equal(summaryLog.status, "completed");
    assert.equal(summaryLog.logEntryLimit, 2);
    assert.equal(summaryLog.loggedEntryCount, 2);
    assert.equal(summaryLog.omittedEntryCount, 2);
    assert.equal(summaryLog.entryLogMode, "hashed");
    assert.equal(summaryLog.entryLoggingDisabledReason, null);
    assert.equal(entriesLog.chunkIndex, 0);
    assert.equal(entriesLog.chunkCount, 1);
    assert.equal(entriesLog.entryCount, 2);
    assert.equal(entriesLog.omittedEntryCount, 2);

    const loggedEntries = readHostedCheckpointDebugEntries(entriesLog);
    assert.equal(loggedEntries.length, 2);
    assert.equal(loggedEntries[0]?.decision, "include");
    assert.equal(loggedEntries[0]?.source, "walk");
    assert.equal(loggedEntries[0]?.type, "file");
    assert.equal(typeof loggedEntries[0]?.pathHash, "string");
    assert.equal("path" in (loggedEntries[0] ?? {}), false);
  } finally {
    consoleError.mockRestore();
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted checkpoint debug paths require an explicit log limit for streamed entries", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-checkpoint-debug-log-limit-"));
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    const root = path.join(workspaceRoot, "root");
    const debugOutputPath = path.join(workspaceRoot, "checkpoint-debug.json");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "keep.txt"), "keep\n", "utf8");

    await withHostedCheckpointDebugEnv({
      enabled: "1",
      log: "1",
      outputFile: debugOutputPath,
    }, async () => {
      const bundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [{ root, rootKey: "vault" }],
      });
      assert.ok(bundle);
    });

    const summaryLog = findHostedCheckpointDebugLog(
      consoleError.mock.calls,
      HOSTED_CHECKPOINT_DEBUG_SUMMARY_LOG_EVENT,
    );
    assert.equal(summaryLog.logEntryLimit, null);
    assert.equal(summaryLog.loggedEntryCount, 0);
    assert.equal(summaryLog.omittedEntryCount, 1);
    assert.equal(summaryLog.entryLogMode, "disabled");
    assert.equal(summaryLog.entryLoggingDisabledReason, "missing_log_limit");
    assert.equal(
      consoleError.mock.calls.some((call) => call[0] === HOSTED_CHECKPOINT_DEBUG_ENTRIES_LOG_EVENT),
      false,
    );
  } finally {
    consoleError.mockRestore();
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted checkpoint debug paths require an explicit unsafe flag for raw path logs", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-checkpoint-debug-log-raw-"));
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    const root = path.join(workspaceRoot, "root");
    const debugOutputPath = path.join(workspaceRoot, "checkpoint-debug.json");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "keep.txt"), "keep\n", "utf8");

    await withHostedCheckpointDebugEnv({
      enabled: "1",
      log: "1",
      logLimit: "1",
      logRaw: "1",
      outputFile: debugOutputPath,
    }, async () => {
      const bundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [{ root, rootKey: "vault" }],
      });
      assert.ok(bundle);
    });

    const summaryLog = findHostedCheckpointDebugLog(
      consoleError.mock.calls,
      HOSTED_CHECKPOINT_DEBUG_SUMMARY_LOG_EVENT,
    );
    const entriesLog = findHostedCheckpointDebugLog(
      consoleError.mock.calls,
      HOSTED_CHECKPOINT_DEBUG_ENTRIES_LOG_EVENT,
    );
    assert.equal(summaryLog.entryLogMode, "raw");
    const loggedEntries = readHostedCheckpointDebugEntries(entriesLog);
    assertHostedCheckpointDebugEntry(loggedEntries, {
      decision: "include",
      path: "keep.txt",
      source: "walk",
      type: "file",
    });
    assert.equal(typeof loggedEntries[0]?.pathHash, "string");
  } finally {
    consoleError.mockRestore();
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted checkpoint debug paths protect the output file", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-checkpoint-debug-output-"));

  try {
    const root = path.join(workspaceRoot, "root");
    const debugOutputPath = path.join(workspaceRoot, "checkpoint-debug.json");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "keep.txt"), "keep\n", "utf8");
    await writeFile(debugOutputPath, "old\n", "utf8");
    await chmod(debugOutputPath, 0o666);

    await withHostedCheckpointDebugEnv({ enabled: "1", outputFile: debugOutputPath }, async () => {
      const bundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [{ root, rootKey: "vault" }],
      });
      assert.ok(bundle);
    });

    const outputMode = (await lstat(debugOutputPath)).mode & 0o777;
    assert.equal(outputMode, 0o600);

    const symlinkOutputPath = path.join(workspaceRoot, "checkpoint-debug-link.json");
    await symlink(debugOutputPath, symlinkOutputPath);
    await withHostedCheckpointDebugEnv({ enabled: "1", outputFile: symlinkOutputPath }, async () => {
      await assert.rejects(
        snapshotHostedBundleRoots({
          kind: "vault",
          roots: [{ root, rootKey: "vault" }],
        }),
        /debug output path must not be a symbolic link/u,
      );
    });

    const directoryOutputPath = path.join(workspaceRoot, "checkpoint-debug-dir");
    await mkdir(directoryOutputPath);
    await withHostedCheckpointDebugEnv({ enabled: "1", outputFile: directoryOutputPath }, async () => {
      await assert.rejects(
        snapshotHostedBundleRoots({
          kind: "vault",
          roots: [{ root, rootKey: "vault" }],
        }),
        /debug output path must be a regular file/u,
      );
    });
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
    const assistantArtifactPath = ".runtime/operations/assistant/issues/pending/issue_123.json";

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
      "issues",
      "pending",
    );
    const artifactPath = path.join(pendingDirectory, "issue_123.json");

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

test("hosted workspace working deltas preserve portable edits, deletes, runtime state, and raw artifact refs", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-working-delta-"));
  const artifacts = new Map<string, Uint8Array>();

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const baseRawPath = path.join(vaultRoot, "raw", "captures", "base.pdf");
    await mkdir(path.dirname(baseRawPath), { recursive: true });
    await mkdir(path.join(vaultRoot, "bank"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox"), { recursive: true });
    await writeFile(path.join(vaultRoot, "bank", "experiment.md"), "status: draft\n");
    await writeFile(path.join(vaultRoot, "bank", "deleted.md"), "remove me\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox", "intent.json"), "{\"v\":1}\n");
    const baseRawBytes = Buffer.concat([
      Buffer.from("%PDF-base\n", "utf8"),
      Buffer.alloc(300 * 1024, "b"),
    ]);
    await writeFile(baseRawPath, baseRawBytes);

    const baseSnapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      vaultRoot,
    });
    const baseManifest = readHostedPortableWorkspaceManifestFromBundle(baseSnapshot.bundle);
    assert.ok(baseManifest);
    const baseArtifactRefs = listHostedBundleArtifacts({
      bytes: baseSnapshot.bundle,
      expectedKind: "vault",
    });
    assert.equal(baseArtifactRefs.some((artifact) => artifact.path === "raw/captures/base.pdf"), true);
    const artifactCountAfterBase = artifacts.size;
    assert.equal(
      baseManifest.files.some((file) => file.root === "vault" && file.path === "bank/experiment.md"),
      true,
    );

    await writeFile(path.join(vaultRoot, "bank", "experiment.md"), "status: active\n");
    await rm(path.join(vaultRoot, "bank", "deleted.md"));
    await writeFile(path.join(vaultRoot, "bank", "added.md"), "new file\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox", "intent.json"), "{\"v\":2}\n");
    const addedRawBytes = Buffer.concat([
      Buffer.from("%PDF-added\n", "utf8"),
      Buffer.alloc(300 * 1024, "a"),
    ]);
    await writeFile(path.join(vaultRoot, "raw", "captures", "added.pdf"), addedRawBytes);
    await rm(baseRawPath);

    const delta = await snapshotHostedPortableWorkspaceDelta({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      baseManifest,
      baseSnapshotHash: sha256HostedBundleHex(baseSnapshot.bundle),
      vaultRoot,
      preservedArtifacts: baseArtifactRefs,
    });
    assert.equal(artifacts.size, artifactCountAfterBase + 1);
    assert.equal(delta.kind, "changed");
    const deltaManifest = readHostedPortableWorkspaceDeltaManifestFromBundle(delta.bundle);
    assert.ok(deltaManifest);
    assert.equal(deltaManifest.baseManifestHash, baseManifest.manifestHash);
    assert.equal(
      deltaManifest.upserts.some((file) => file.root === "vault" && file.path === "bank/experiment.md"),
      true,
    );
    assert.equal(
      deltaManifest.upserts.some((file) => file.root === "vault" && file.path === "bank/added.md"),
      true,
    );
    assert.equal(
      deltaManifest.upserts.some((file) => file.root === "vault" && file.path === "raw/captures/added.pdf" && file.artifact),
      true,
    );
    assert.equal(
      deltaManifest.tombstones.some((file) => file.root === "vault" && file.path === "bank/deleted.md"),
      true,
    );
    assert.equal(
      deltaManifest.tombstones.some((file) => file.root === "vault" && file.path === "raw/captures/base.pdf"),
      false,
    );

    const restoreRoot = path.join(workspaceRoot, "restore");
    const restored = await restoreHostedExecutionContext({
      artifactResolver: async ({ ref }) => {
        const artifact = artifacts.get(ref.sha256);
        assert.ok(artifact);
        return artifact;
      },
      bundle: baseSnapshot.bundle,
      shouldRestoreArtifact: () => true,
      workspaceRoot: restoreRoot,
    });
    await restoreHostedWorkspaceWorkingDelta({
      artifactResolver: async ({ ref }) => {
        const artifact = artifacts.get(ref.sha256);
        assert.ok(artifact);
        return artifact;
      },
      baseManifest,
      baseSnapshotHash: sha256HostedBundleHex(baseSnapshot.bundle),
      bundle: delta.bundle,
      roots: {
        vault: restored.vaultRoot,
      },
      shouldRestoreArtifact: () => true,
    });

    assert.equal(await readFile(path.join(restored.vaultRoot, "bank", "experiment.md"), "utf8"), "status: active\n");
    assert.equal(await readFile(path.join(restored.vaultRoot, "bank", "added.md"), "utf8"), "new file\n");
    await assert.rejects(readFile(path.join(restored.vaultRoot, "bank", "deleted.md"), "utf8"));
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "outbox", "intent.json"), "utf8"),
      "{\"v\":2}\n",
    );
    assert.equal(await readFile(path.join(restored.vaultRoot, "raw", "captures", "added.pdf"), "utf8"), addedRawBytes.toString("utf8"));
    assert.equal(await readFile(path.join(restored.vaultRoot, "raw", "captures", "base.pdf"), "utf8"), baseRawBytes.toString("utf8"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted workspace working deltas tombstone deleted materialized non-eager artifacts", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-working-delta-materialized-delete-"));
  const artifacts = new Map<string, Uint8Array>();

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const rawAttachmentPath = path.join(vaultRoot, "raw", "captures", "report.pdf");
    const rawAttachmentBytes = Buffer.concat([
      Buffer.from("%PDF-materialized-delete\n", "utf8"),
      Buffer.alloc(300 * 1024, "d"),
    ]);

    await mkdir(path.dirname(rawAttachmentPath), { recursive: true });
    await writeFile(path.join(vaultRoot, "note.md"), "base\n");
    await writeFile(rawAttachmentPath, rawAttachmentBytes);

    const baseSnapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      vaultRoot,
    });
    const baseManifest = readHostedPortableWorkspaceManifestFromBundle(baseSnapshot.bundle);
    assert.ok(baseManifest);
    const baseArtifactRefs = listHostedBundleArtifacts({
      bytes: baseSnapshot.bundle,
      expectedKind: "vault",
    });
    assert.equal(baseArtifactRefs.some((artifact) =>
      artifact.root === "vault" && artifact.path === "raw/captures/report.pdf"
    ), true);

    await writeFile(path.join(vaultRoot, "note.md"), "changed\n");
    await rm(rawAttachmentPath);

    const delta = await snapshotHostedPortableWorkspaceDelta({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      baseManifest,
      baseSnapshotHash: sha256HostedBundleHex(baseSnapshot.bundle),
      materializedArtifactPaths: new Set(["vault:raw/captures/report.pdf"]),
      preservedArtifacts: baseArtifactRefs,
      vaultRoot,
    });
    assert.equal(delta.kind, "changed");
    const deltaManifest = readHostedPortableWorkspaceDeltaManifestFromBundle(delta.bundle);
    assert.ok(deltaManifest);
    assert.equal(
      deltaManifest.tombstones.some((file) => file.root === "vault" && file.path === "raw/captures/report.pdf"),
      true,
    );

    const restoreRoot = path.join(workspaceRoot, "restore");
    const restored = await restoreHostedExecutionContext({
      artifactResolver: async ({ ref }) => {
        const artifact = artifacts.get(ref.sha256);
        assert.ok(artifact);
        return artifact;
      },
      bundle: baseSnapshot.bundle,
      shouldRestoreArtifact: () => true,
      workspaceRoot: restoreRoot,
    });
    assert.equal(
      await readFile(path.join(restored.vaultRoot, "raw", "captures", "report.pdf"), "utf8"),
      rawAttachmentBytes.toString("utf8"),
    );

    await restoreHostedWorkspaceWorkingDelta({
      artifactResolver: async ({ ref }) => {
        const artifact = artifacts.get(ref.sha256);
        assert.ok(artifact);
        return artifact;
      },
      baseManifest,
      baseSnapshotHash: sha256HostedBundleHex(baseSnapshot.bundle),
      bundle: delta.bundle,
      roots: {
        vault: restored.vaultRoot,
      },
      shouldRestoreArtifact: () => true,
    });

    await assert.rejects(readFile(path.join(restored.vaultRoot, "raw", "captures", "report.pdf"), "utf8"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted workspace working deltas carry forward unmaterialized raw text artifacts", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-working-delta-unmaterialized-carry-"));
  const artifacts = new Map<string, Uint8Array>();

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const rawAttachmentPath = path.join(vaultRoot, "raw", "integrations", "provider", "snapshot.json");
    const rawAttachmentBytes = Buffer.from("{\"kind\":\"snapshot\",\"count\":1}\n", "utf8");

    await mkdir(path.dirname(rawAttachmentPath), { recursive: true });
    await writeFile(path.join(vaultRoot, "note.md"), "base\n");
    await writeFile(rawAttachmentPath, rawAttachmentBytes);

    const baseSnapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      vaultRoot,
    });
    const baseManifest = readHostedPortableWorkspaceManifestFromBundle(baseSnapshot.bundle);
    assert.ok(baseManifest);
    const baseArtifactRefs = listHostedBundleArtifacts({
      bytes: baseSnapshot.bundle,
      expectedKind: "vault",
    });
    assert.equal(baseArtifactRefs.some((artifact) =>
      artifact.root === "vault" && artifact.path === "raw/integrations/provider/snapshot.json"
    ), true);

    await writeFile(path.join(vaultRoot, "note.md"), "changed\n");
    await rm(rawAttachmentPath);

    const delta = await snapshotHostedPortableWorkspaceDelta({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      baseManifest,
      baseSnapshotHash: sha256HostedBundleHex(baseSnapshot.bundle),
      preservedArtifacts: baseArtifactRefs,
      vaultRoot,
    });
    assert.equal(delta.kind, "changed");
    const deltaManifest = readHostedPortableWorkspaceDeltaManifestFromBundle(delta.bundle);
    assert.ok(deltaManifest);
    assert.equal(
      deltaManifest.tombstones.some((file) => file.root === "vault" && file.path === "raw/integrations/provider/snapshot.json"),
      false,
    );
    assert.equal(
      deltaManifest.upserts.some((file) => file.root === "vault" && file.path === "raw/integrations/provider/snapshot.json"),
      false,
    );

    const restoreRoot = path.join(workspaceRoot, "restore");
    const restored = await restoreHostedExecutionContext({
      artifactResolver: async ({ ref }) => {
        const artifact = artifacts.get(ref.sha256);
        assert.ok(artifact);
        return artifact;
      },
      bundle: baseSnapshot.bundle,
      shouldRestoreArtifact: () => false,
      workspaceRoot: restoreRoot,
    });
    await assert.rejects(readFile(path.join(restored.vaultRoot, "raw", "integrations", "provider", "snapshot.json"), "utf8"));

    await restoreHostedWorkspaceWorkingDelta({
      artifactResolver: async ({ ref }) => {
        const artifact = artifacts.get(ref.sha256);
        assert.ok(artifact);
        return artifact;
      },
      baseManifest,
      baseSnapshotHash: sha256HostedBundleHex(baseSnapshot.bundle),
      bundle: delta.bundle,
      roots: {
        vault: restored.vaultRoot,
      },
      shouldRestoreArtifact: () => false,
    });
    await assert.rejects(readFile(path.join(restored.vaultRoot, "raw", "integrations", "provider", "snapshot.json"), "utf8"));

    await materializeHostedExecutionArtifacts({
      artifactResolver: async ({ ref }) => {
        const artifact = artifacts.get(ref.sha256);
        assert.ok(artifact);
        return artifact;
      },
      bundle: baseSnapshot.bundle,
      shouldRestoreArtifact: ({ path: artifactPath, root }) => (
        root === "vault" && artifactPath === "raw/integrations/provider/snapshot.json"
      ),
      workspaceRoot: restoreRoot,
    });
    assert.equal(
      await readFile(path.join(restored.vaultRoot, "raw", "integrations", "provider", "snapshot.json"), "utf8"),
      rawAttachmentBytes.toString("utf8"),
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted workspace working deltas carry forward skipped inline raw files from legacy bases", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-working-delta-skipped-inline-"));

  try {
    const baseVaultRoot = path.join(workspaceRoot, "base-vault");
    const rawPath = path.join(baseVaultRoot, "raw", "integrations", "provider", "legacy.json");
    await mkdir(path.dirname(rawPath), { recursive: true });
    await writeFile(path.join(baseVaultRoot, "note.md"), "base\n");
    await writeFile(rawPath, "{\"legacy\":true}\n");

    const baseBundle = await snapshotHostedBundleRoots({
      kind: "vault",
      roots: [
        {
          root: baseVaultRoot,
          rootKey: "vault",
        },
      ],
    });
    assert.ok(baseBundle);
    const baseManifest = createHostedPortableWorkspaceManifestFromBundle(baseBundle);
    const baseHash = sha256HostedBundleHex(baseBundle);
    assert.equal(
      baseManifest.files.some((file) =>
        file.root === "vault" && file.path === "raw/integrations/provider/legacy.json" && !file.artifact
      ),
      true,
    );

    const restoreRoot = path.join(workspaceRoot, "restore");
    const restoredVaultRoot = path.join(restoreRoot, "vault");
    const skippedInlineFiles: Awaited<ReturnType<typeof readHostedWorkspaceSkippedInlineFiles>> = [];
    await restoreHostedBundleRoots({
      bytes: baseBundle,
      expectedKind: "vault",
      onSkippedInlineFile: (file) => {
        skippedInlineFiles.push(file);
      },
      roots: {
        vault: restoredVaultRoot,
      },
      shouldRestoreInlineFile: ({ path: inlinePath, root }) =>
        !(root === "vault" && inlinePath.startsWith("raw/")),
    });
    await writeHostedWorkspaceSkippedInlineFiles({
      files: skippedInlineFiles,
      vaultRoot: restoredVaultRoot,
    });

    assert.equal(await readFile(path.join(restoredVaultRoot, "note.md"), "utf8"), "base\n");
    await assert.rejects(readFile(path.join(restoredVaultRoot, "raw", "integrations", "provider", "legacy.json"), "utf8"));

    const skipped = await readHostedWorkspaceSkippedInlineFiles({
      vaultRoot: restoredVaultRoot,
    });
    assert.equal(
      (await lstat(path.join(
        restoredVaultRoot,
        ".runtime",
        "cache",
        "hosted-skipped-inline-files.json",
      ))).mode & 0o777,
      0o600,
    );
    const skippedKeys = new Set(skipped.map((file) => `${file.root}:${file.path}`));

    await writeFile(path.join(restoredVaultRoot, "note.md"), "changed\n");
    const delta = await snapshotHostedPortableWorkspaceDelta({
      baseManifest,
      baseSnapshotHash: baseHash,
      preservedInlineManifestFiles: baseManifest.files.filter((file) =>
        skippedKeys.has(`${file.root}:${file.path}`)
      ),
      vaultRoot: restoredVaultRoot,
    });
    assert.equal(delta.kind, "changed");
    const deltaManifest = readHostedPortableWorkspaceDeltaManifestFromBundle(delta.bundle);
    assert.ok(deltaManifest);
    assert.equal(
      deltaManifest.upserts.some((file) => file.root === "vault" && file.path === "note.md"),
      true,
    );
    assert.equal(
      deltaManifest.upserts.some((file) => file.root === "vault" && file.path === "raw/integrations/provider/legacy.json"),
      false,
    );
    assert.equal(
      deltaManifest.tombstones.some((file) => file.root === "vault" && file.path === "raw/integrations/provider/legacy.json"),
      false,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted workspace working deltas can skip non-eager inline raw upserts", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-working-delta-inline-skip-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    await mkdir(path.join(vaultRoot, "bank"), { recursive: true });
    await writeFile(path.join(vaultRoot, "bank", "memory.md"), "base\n");

    const baseSnapshot = await snapshotHostedExecutionContext({
      vaultRoot,
    });
    const baseManifest = readHostedPortableWorkspaceManifestFromBundle(baseSnapshot.bundle);
    assert.ok(baseManifest);

    const rawPath = path.join(vaultRoot, "raw", "integrations", "provider", "working.json");
    await mkdir(path.dirname(rawPath), { recursive: true });
    await writeFile(rawPath, "{\"delta\":true}\n");
    const delta = await snapshotHostedPortableWorkspaceDelta({
      baseManifest,
      baseSnapshotHash: sha256HostedBundleHex(baseSnapshot.bundle),
      vaultRoot,
    });
    assert.equal(delta.kind, "changed");
    const deltaManifest = readHostedPortableWorkspaceDeltaManifestFromBundle(delta.bundle);
    assert.ok(deltaManifest);
    assert.equal(
      deltaManifest.upserts.some((file) =>
        file.root === "vault"
        && file.path === "raw/integrations/provider/working.json"
        && !file.artifact
      ),
      true,
    );

    const restoreVaultRoot = path.join(workspaceRoot, "restore-vault");
    await restoreHostedBundleRoots({
      bytes: baseSnapshot.bundle,
      expectedKind: "vault",
      roots: {
        vault: restoreVaultRoot,
      },
    });

    const skippedInlineFiles: Awaited<ReturnType<typeof readHostedWorkspaceSkippedInlineFiles>> = [];
    await restoreHostedWorkspaceWorkingDelta({
      baseManifest,
      baseSnapshotHash: sha256HostedBundleHex(baseSnapshot.bundle),
      bundle: delta.bundle,
      onSkippedInlineFile: (file) => {
        skippedInlineFiles.push(file);
      },
      roots: {
        vault: restoreVaultRoot,
      },
      shouldRestoreInlineFile: ({ path: inlinePath, root }) =>
        !(root === "vault" && inlinePath.startsWith("raw/")),
    });

    assert.equal(await readFile(path.join(restoreVaultRoot, "bank", "memory.md"), "utf8"), "base\n");
    await assert.rejects(
      readFile(path.join(restoreVaultRoot, "raw", "integrations", "provider", "working.json"), "utf8"),
    );
    assert.deepEqual(
      skippedInlineFiles.map((file) => `${file.root}:${file.path}`),
      ["vault:raw/integrations/provider/working.json"],
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted workspace working delta tombstones reject symlink traversal", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-working-delta-symlink-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    await mkdir(path.join(vaultRoot, "bank"), { recursive: true });
    await writeFile(path.join(vaultRoot, "bank", "deleted.md"), "remove me\n");

    const baseSnapshot = await snapshotHostedExecutionContext({
      vaultRoot,
    });
    const baseManifest = readHostedPortableWorkspaceManifestFromBundle(baseSnapshot.bundle);
    assert.ok(baseManifest);

    await rm(path.join(vaultRoot, "bank", "deleted.md"));
    const delta = await snapshotHostedPortableWorkspaceDelta({
      baseManifest,
      baseSnapshotHash: sha256HostedBundleHex(baseSnapshot.bundle),
      vaultRoot,
    });
    assert.equal(delta.kind, "changed");

    const restoreVaultRoot = path.join(workspaceRoot, "restore-vault");
    const outsideRoot = path.join(workspaceRoot, "outside");
    await mkdir(restoreVaultRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await symlink(outsideRoot, path.join(restoreVaultRoot, "bank"));

    await assert.rejects(
      restoreHostedWorkspaceWorkingDelta({
        baseManifest,
        baseSnapshotHash: sha256HostedBundleHex(baseSnapshot.bundle),
        bundle: delta.bundle,
        roots: {
          vault: restoreVaultRoot,
        },
      }),
      /tombstone path must not contain symlinks/u,
    );
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
    await writeFile(
      path.join(operatorHomeRoot, ".murph", "config.json"),
      `${JSON.stringify({
        hostedAssistant: {
          profiles: [{
            target: {
              adapter: "codex-cli",
              codexCommand: "/tmp/unsafe-codex",
              codexHome: "/tmp/unsafe-codex-home",
            },
          }],
        },
        schema: "murph.operator.v1",
      })}\n`,
    );
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
      null,
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

test("hosted execution snapshots exclude every env-prefixed vault file", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-env-files-"));

  try {
    const artifacts = new Map<string, Uint8Array>();
    const vaultRoot = path.join(workspaceRoot, "vault");

    await mkdir(path.join(vaultRoot, ".runtime", "operations", "op_test"), { recursive: true });
    await mkdir(path.join(vaultRoot, "nested"), { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
    await writeFile(path.join(vaultRoot, ".env"), "blocked-env-value\n");
    await writeFile(path.join(vaultRoot, ".env.local"), "blocked-env-value\n");
    await writeFile(path.join(vaultRoot, ".envrc"), "blocked-env-value\n");
    await writeFile(path.join(vaultRoot, ".env-prod"), "blocked-env-value\n");
    await writeFile(path.join(vaultRoot, ".env_backup"), "blocked-env-value\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "op_test", ".envrc"), "blocked-env-value\n");
    await writeFile(path.join(vaultRoot, "nested", ".env-stage"), "blocked-env-value\n");

    const snapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      vaultRoot,
    });

    assertHostedBundleTextEntries(snapshot.bundle, [
      { expected: "{\"schema\":\"vault\"}\n", path: "vault.json", root: "vault" },
      { expected: null, path: ".env", root: "vault" },
      { expected: null, path: ".env.local", root: "vault" },
      { expected: null, path: ".envrc", root: "vault" },
      { expected: null, path: ".env-prod", root: "vault" },
      { expected: null, path: ".env_backup", root: "vault" },
      { expected: null, path: ".runtime/operations/op_test/.envrc", root: "vault" },
      { expected: null, path: "nested/.env-stage", root: "vault" },
    ]);
    for (const artifactPath of [
      ".env",
      ".env.local",
      ".envrc",
      ".env-prod",
      ".env_backup",
      ".runtime/operations/op_test/.envrc",
      "nested/.env-stage",
    ]) {
      assert.equal(
        hasHostedBundleArtifactPath({
          bytes: snapshot.bundle,
          expectedKind: "vault",
          path: artifactPath,
          root: "vault",
        }),
        false,
      );
    }
    assert.equal(Buffer.from(snapshot.bundle).includes("blocked-env-value"), false);
    assert.equal(artifacts.size, 0);
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
    const activeCodexThreadId = "00000000-0000-4000-8000-000000000001";
    const activeCodexRolloutRelativePath =
      `sessions/2026/05/05/rollout-2026-05-05T01-02-03-${activeCodexThreadId}.jsonl`;
    const activeCodexRolloutJson = "{\"rollout\":\"active\"}\n";
    const activeAssistantSessionJson = JSON.stringify({
      resumeState: {
        codexRolloutRelativePath: activeCodexRolloutRelativePath,
        providerSessionId: activeCodexThreadId,
        resumeRouteId: "route-test",
      },
      session: "saved",
    }) + "\n";
    await mkdir(path.dirname(rawAttachmentPath), { recursive: true });
    await mkdir(path.join(vaultRoot, "exports", "packs"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".git", "objects"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "cron", "runs"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "accepted-turn-inputs"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "state", "accepted-turn-inputs"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "diagnostics"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "future-continuity"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "journals"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "issues", "pending"), { recursive: true });
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
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "05"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "archived_sessions", "2026", "05", "04"), { recursive: true });
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
    await writeFile(path.join(vaultRoot, ".runtime", "projections", "gateway.sqlite"), "retired-gateway-projection\n");
    await writeFile(path.join(vaultRoot, ".runtime", "projections", "query.sqlite"), "query-projection\n");
    await writeFile(path.join(vaultRoot, ".runtime", "projections", "query.sqlite-shm"), "query-projection-shm\n");
    await writeFile(path.join(vaultRoot, ".runtime", "projections", "query.sqlite-wal"), "query-projection-wal\n");
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
    await writeFile(path.join(assistantRuntimeRoot, "diagnostics", "events.jsonl.old"), "{\"kind\":\"assistant.scan.old\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "diagnostics", "snapshot.json"), "{\"status\":\"healthy\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "future-continuity", "next.json"), "{\"survivesWithoutDescriptor\":true}\n");
    await writeFile(
      path.join(assistantRuntimeRoot, "indexes.json"),
      "{\"version\":1,\"aliases\":{\"Rocket Man\":\"session_1\"},\"conversationKeys\":{\"channel:linq|identity:user_1|thread:chat_1\":\"session_1\"}}\n",
    );
    await writeFile(path.join(assistantRuntimeRoot, "journals", "runtime-events.jsonl"), "{\"event\":\"assistant.runtime\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "journals", "runtime-events.jsonl.1"), "{\"event\":\"assistant.runtime.old\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "issues", "pending", "issue_1.json"), "{\"issue\":\"pending\"}\n");
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
    await writeFile(
      path.join(assistantRuntimeRoot, "sessions", "session_1.json"),
      activeAssistantSessionJson,
    );
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
    await writeFile(
      path.join(
        operatorHomeRoot,
        ".codex-hosted",
        "sessions",
        "2026",
        "05",
        "05",
        path.basename(activeCodexRolloutRelativePath),
      ),
      activeCodexRolloutJson,
    );
    await writeFile(
      path.join(
        operatorHomeRoot,
        ".codex-hosted",
        "archived_sessions",
        "2026",
        "05",
        "04",
        "rollout-2026-05-04T01-02-03-00000000-0000-4000-8000-000000000002.jsonl",
      ),
      "{\"rollout\":\"archived\"}\n",
    );
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "history.jsonl"), "{\"turn\":\"kept\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "history.jsonl.db-wal"), "history wal\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "turn.history.jsonl.db-shm"), "history shm\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "rollout.json"), "{\"thread\":\"thread_1\"}\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "state_11.sqlite"), "state db\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "state_11.sqlite-wal"), "state wal\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "state_11.sqlite-shm"), "state shm\n");
    await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "logs_11.sqlite"), "logs db\n");
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
      codexResumeArchivedUnsupportedCount: 0,
      codexResumeInvalidPathCount: 0,
      codexResumeMissingRolloutCount: 0,
      codexResumeRolloutBytes: Buffer.byteLength(activeCodexRolloutJson),
      codexResumeRolloutFileBytes: [Buffer.byteLength(activeCodexRolloutJson)],
      codexResumeRolloutRelHashes: expect.arrayContaining([
        expect.stringMatching(/^h1_[a-f0-9]{24}$/u),
      ]),
      codexResumeThreadCount: 1,
    });
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
        expected: activeAssistantSessionJson,
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
      { expected: null, path: ".runtime/operations/assistant/diagnostics/events.jsonl", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/diagnostics/events.jsonl.old", root: "vault" },
      { expected: "{\"status\":\"healthy\"}\n", path: ".runtime/operations/assistant/diagnostics/snapshot.json", root: "vault" },
      { expected: "{\"status\":\"ok\"}\n", path: ".runtime/operations/assistant/cron/runs/cronrun_1.jsonl", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/journals/runtime-events.jsonl", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/journals/runtime-events.jsonl.1", root: "vault" },
      {
        expected: "{\"survivesWithoutDescriptor\":true}\n",
        path: ".runtime/operations/assistant/future-continuity/next.json",
        root: "vault",
      },
      { expected: "{\"issue\":\"pending\"}\n", path: ".runtime/operations/assistant/issues/pending/issue_1.json", root: "vault" },
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
      { expected: null, path: ".murph/config.json", root: "operator-home" },
      { expected: null, path: ".murph/hosted/user-env.json", root: "operator-home" },
      { expected: null, path: ".codex-hosted/config.toml", root: "operator-home" },
      { expected: null, path: ".codex-hosted/rollout_index.jsonl", root: "operator-home" },
      {
        expected: null,
        path: ".codex-hosted/rollouts/rollout_1/state.json",
        root: "operator-home",
      },
      { expected: null, path: ".codex-hosted/session_index.jsonl", root: "operator-home" },
      {
        expected: null,
        path: `.codex-hosted/${activeCodexRolloutRelativePath}`,
        root: "operator-home",
      },
      {
        expected: null,
        path: ".codex-hosted/archived_sessions/2026/05/04/rollout-2026-05-04T01-02-03-00000000-0000-4000-8000-000000000002.jsonl",
        root: "operator-home",
      },
      {
        expected: null,
        path: ".codex-hosted/sessions/thread_1/history.jsonl",
        root: "operator-home",
      },
      {
        expected: null,
        path: ".codex-hosted/sessions/thread_1/history.jsonl.db-wal",
        root: "operator-home",
      },
      {
        expected: null,
        path: ".codex-hosted/sessions/thread_1/turn.history.jsonl.db-shm",
        root: "operator-home",
      },
      {
        expected: null,
        path: ".codex-hosted/sessions/thread_1/rollout.json",
        root: "operator-home",
      },
      { expected: null, path: ".codex-hosted/state/lookup.json", root: "operator-home" },
      {
        expected: null,
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
      { expected: "query-projection\n", path: ".runtime/projections/query.sqlite", root: "vault" },
      { expected: "query-projection-shm\n", path: ".runtime/projections/query.sqlite-shm", root: "vault" },
      { expected: "query-projection-wal\n", path: ".runtime/projections/query.sqlite-wal", root: "vault" },
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
      artifactRefs.map((artifact) => artifact.path).sort(),
      [
        "raw/inbox/2026-03-28/capture_123/attachments/report.pdf",
        "raw/notes.json",
        `.codex-hosted/${activeCodexRolloutRelativePath}`,
      ].sort(),
    );
    for (const artifactRef of artifactRefs) {
      assert.equal(artifacts.has(artifactRef.ref.sha256), true);
    }

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
      activeAssistantSessionJson,
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
    await assert.rejects(
      () => readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "usage", "pending", "usage_1.json"), "utf8"),
      /ENOENT/u,
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
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "diagnostics", "events.jsonl"), "utf8"),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "diagnostics", "events.jsonl.old"), "utf8"),
      { code: "ENOENT" },
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
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "journals", "runtime-events.jsonl"), "utf8"),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "journals", "runtime-events.jsonl.1"), "utf8"),
      { code: "ENOENT" },
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "runtime-budgets.json"), "utf8"),
      "{\"remainingMs\":1000}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "issues", "pending", "issue_1.json"), "utf8"),
      "{\"issue\":\"pending\"}\n",
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".murph", "config.json"), "utf8"),
      { code: "ENOENT" },
    );
    assert.equal(
      await readFile(
        path.join(restored.operatorHomeRoot, ".codex-hosted", activeCodexRolloutRelativePath),
        "utf8",
      ),
      activeCodexRolloutJson,
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "config.toml"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "rollout_index.jsonl"), "utf8"),
    );
    await assert.rejects(
      readFile(
        path.join(restored.operatorHomeRoot, ".codex-hosted", "rollouts", "rollout_1", "state.json"),
        "utf8",
      ),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "session_index.jsonl"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "history.jsonl"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "history.jsonl.db-wal"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "turn.history.jsonl.db-shm"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "thread_1", "rollout.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "state", "lookup.json"), "utf8"),
    );
    await assert.rejects(
      readFile(
        path.join(restored.operatorHomeRoot, ".codex-hosted", "threads", "thread_1", "state.json"),
        "utf8",
      ),
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
      (
        await lstat(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "05"))
      ).mode & 0o777,
      ASSISTANT_STATE_DIRECTORY_MODE,
    );
    assert.equal(
      (
        await lstat(path.join(restored.operatorHomeRoot, ".codex-hosted", activeCodexRolloutRelativePath))
      ).mode & 0o777,
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
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "projections", "query.sqlite"), "utf8"),
      "query-projection\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "projections", "query.sqlite-shm"), "utf8"),
      "query-projection-shm\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "projections", "query.sqlite-wal"), "utf8"),
      "query-projection-wal\n",
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
    await mkdir(path.join(hotAssistantRoot, "accepted-turn-inputs"), { recursive: true });
    await mkdir(path.join(hotAssistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(hotAssistantRoot, "state", "accepted-turn-inputs"), { recursive: true });
    await mkdir(path.join(hotAssistantRoot, "diagnostics"), { recursive: true });
    await writeFile(
      path.join(hotAssistantRoot, "accepted-turn-inputs", "turn_old.json"),
      "{\"schema\":\"murph.assistant-accepted-turn-input-journal.v1\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(hotAssistantRoot, "sessions", "session.json"),
      "{\"session\":\"latest\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(hotAssistantRoot, "context-snapshot.json"),
      "{\"pendingDirtyDomains\":[\"health_context\"]}\n",
      "utf8",
    );
    await writeFile(
      path.join(hotAssistantRoot, "state", "accepted-turn-inputs", "turn_state.json"),
      "{\"schema\":\"murph.assistant-active-turn-input-state.v1\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(hotAssistantRoot, "diagnostics", "debug.json"),
      "{\"debug\":true}\n",
      "utf8",
    );
    await writeFile(
      path.join(hotAssistantRoot, "hosted-materialized-artifacts.json"),
      "{\"schema\":\"murph.hosted-materialized-artifacts.v1\",\"materializedArtifactPaths\":[\"vault:raw/inbox/example/scan.pdf\"]}\n",
      "utf8",
    );
    await writeFile(path.join(hotVaultRoot, "note.md"), "hot note should not be captured\n", "utf8");

    const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
      vaultRoot: hotVaultRoot,
    });
    assert.equal(hotSnapshot.fileCount, 3);
    assert.equal(
      readHostedBundleTextFile({
        bytes: hotSnapshot.bundle,
        expectedKind: "vault",
        path: ".runtime/operations/assistant/state/accepted-turn-inputs/turn_state.json",
        root: "vault",
      }),
      "{\"schema\":\"murph.assistant-active-turn-input-state.v1\"}\n",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: hotSnapshot.bundle,
        expectedKind: "vault",
        path: ".runtime/operations/assistant/context-snapshot.json",
        root: "vault",
      }),
      "{\"pendingDirtyDomains\":[\"health_context\"]}\n",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: hotSnapshot.bundle,
        expectedKind: "vault",
        path: ".runtime/operations/assistant/accepted-turn-inputs/turn_old.json",
        root: "vault",
      }),
      null,
    );
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
    assert.equal(
      readHostedBundleTextFile({
        bytes: hotSnapshot.bundle,
        expectedKind: "vault",
        path: ".runtime/operations/assistant/hosted-materialized-artifacts.json",
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
    await writeFile(
      path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "hosted-materialized-artifacts.json"),
      "{\"schema\":\"murph.hosted-materialized-artifacts.v1\",\"materializedArtifactPaths\":[\"vault:raw/inbox/example/scan.pdf\"]}\n",
      "utf8",
    );

    await clearHostedAssistantRuntimeHotState({
      vaultRoot: restored.vaultRoot,
    });
    assert.equal(
      await readFile(
        path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "hosted-materialized-artifacts.json"),
        "utf8",
      ),
      "{\"schema\":\"murph.hosted-materialized-artifacts.v1\",\"materializedArtifactPaths\":[\"vault:raw/inbox/example/scan.pdf\"]}\n",
    );
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
    assert.equal(
      await readFile(
        path.join(
          restored.vaultRoot,
          ".runtime",
          "operations",
          "assistant",
          "context-snapshot.json",
        ),
        "utf8",
      ),
      "{\"pendingDirtyDomains\":[\"health_context\"]}\n",
    );
    assert.equal(await readFile(path.join(restored.vaultRoot, "note.md"), "utf8"), "base note\n");
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(restoreRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state snapshots include only exact Codex rollout continuity", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-codex-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const threadId = "00000000-0000-4000-8000-000000000010";
    const rolloutRelativePath =
      `sessions/2026/05/05/rollout-2026-05-05T01-02-03-${threadId}.jsonl`;
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "05"), {
      recursive: true,
    });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "logs"), { recursive: true });
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-test",
        },
      }) + "\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
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

    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: `.codex-hosted/${rolloutRelativePath}`,
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
      vaultRoot,
    });

    assert.equal(
      await readFile(
        path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
        "utf8",
      ),
      "{\"type\":\"provider-owned\"}\n",
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state cleanup retains no Codex home files", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-codex-clear-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const codexHomeRoot = path.join(operatorHomeRoot, ".codex-hosted");
    await mkdir(path.join(codexHomeRoot, "sessions", "2026", "05", "05"), {
      recursive: true,
    });
    await writeFile(path.join(codexHomeRoot, "auth.json"), "{\"fixture\":true}\n", "utf8");
    await writeFile(
      path.join(codexHomeRoot, "sessions", "2026", "05", "05", "rollout.jsonl"),
      "{\"type\":\"provider-owned\"}\n",
      "utf8",
    );
    await writeFile(path.join(operatorHomeRoot, "keep.txt"), "keep\n", "utf8");

    await clearHostedAssistantRuntimeHotState({
      operatorHomeRoot,
      vaultRoot,
    });

    await assert.rejects(lstat(codexHomeRoot), { code: "ENOENT" });
    assert.equal(await readFile(path.join(operatorHomeRoot, "keep.txt"), "utf8"), "keep\n");
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state snapshots do not retry when Codex sessions move during capture", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-codex-drift-"));
  const restoreRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-codex-drift-restore-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const firstThreadId = "00000000-0000-4000-8000-000000000040";
    const nextThreadId = "00000000-0000-4000-8000-000000000041";
    const firstRolloutRelativePath =
      `sessions/2026/05/05/rollout-2026-05-05T01-02-03-${firstThreadId}.jsonl`;
    const nextRolloutRelativePath =
      `sessions/2026/05/05/rollout-2026-05-05T04-05-06-${nextThreadId}.jsonl`;
    const artifacts = new Map<string, Uint8Array>();

    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "05"), {
      recursive: true,
    });
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: firstRolloutRelativePath,
          providerSessionId: firstThreadId,
          resumeRouteId: "route-first",
        },
      }) + "\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", firstRolloutRelativePath),
      "{\"type\":\"first\"}\n",
      "utf8",
    );

    let mutated = false;
    const snapshot = await snapshotHostedAssistantRuntimeHotState({
      assertSnapshotLive: async () => {
        if (mutated) {
          return;
        }
        mutated = true;
        await writeFile(
          path.join(assistantRoot, "sessions", "session.json"),
          JSON.stringify({
            resumeState: {
              codexRolloutRelativePath: nextRolloutRelativePath,
              providerSessionId: nextThreadId,
              resumeRouteId: "route-next",
            },
          }) + "\n",
          "utf8",
        );
        await writeFile(
          path.join(operatorHomeRoot, ".codex-hosted", nextRolloutRelativePath),
          "{\"type\":\"next\"}\n",
          "utf8",
        );
      },
      codexContinuityArtifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      operatorHomeRoot,
      vaultRoot,
    });

    assert.equal(mutated, true);
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".runtime/operations/assistant/sessions/session.json",
        root: "vault",
      }),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: nextRolloutRelativePath,
          providerSessionId: nextThreadId,
          resumeRouteId: "route-next",
        },
      }) + "\n",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: `.codex-hosted/${nextRolloutRelativePath}`,
        root: "operator-home",
      }),
      null,
    );
    const rolloutArtifact = listHostedBundleArtifacts({
      bytes: snapshot.bundle,
      expectedKind: "vault",
    }).find((artifact) =>
      artifact.root === "operator-home"
      && artifact.path === `.codex-hosted/${firstRolloutRelativePath}`
    );
    assert.ok(rolloutArtifact);
    assert.equal(artifacts.has(rolloutArtifact.ref.sha256), true);
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: `.codex-hosted/${firstRolloutRelativePath}`,
        root: "operator-home",
      }),
      null,
    );

    const restored = await restoreHostedExecutionContext({
      artifactResolver: async ({ ref }) => {
        const bytes = artifacts.get(ref.sha256);
        if (!bytes) {
          throw new Error("Missing test Codex continuity artifact.");
        }
        return bytes;
      },
      bundle: snapshot.bundle,
      workspaceRoot: restoreRoot,
    });
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", nextRolloutRelativePath), "utf8"),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", firstRolloutRelativePath), "utf8"),
      { code: "ENOENT" },
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(restoreRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state snapshots can externalize exact Codex rollout continuity", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-codex-artifact-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const restoreRoot = path.join(workspaceRoot, "restore");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const threadId = "00000000-0000-4000-8000-000000000012";
    const rolloutRelativePath =
      `sessions/2026/05/05/rollout-2026-05-05T01-02-03-${threadId}.jsonl`;
    const rolloutText = `${"{\"type\":\"provider-owned\"}\n".repeat(16 * 1024)}`;
    const artifacts = new Map<string, Uint8Array>();
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "05"), {
      recursive: true,
    });
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-test",
        },
      }) + "\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
      rolloutText,
      "utf8",
    );

    const snapshot = await snapshotHostedAssistantRuntimeHotState({
      codexContinuityArtifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      operatorHomeRoot,
      vaultRoot,
    });
    const artifactRefs = listHostedBundleArtifacts({
      bytes: snapshot.bundle,
      expectedKind: "vault",
    });
    const rolloutArtifact = artifactRefs.find((artifact) =>
      artifact.root === "operator-home"
      && artifact.path === `.codex-hosted/${rolloutRelativePath}`
    );

    assert.ok(rolloutArtifact);
    assert.equal(rolloutArtifact.ref.byteSize, Buffer.byteLength(rolloutText));
    assert.equal(rolloutArtifact.ref.sha256, sha256HostedBundleHex(Buffer.from(rolloutText)));
    assert.equal(artifacts.has(rolloutArtifact.ref.sha256), true);
    assert.equal(snapshot.inlineBytes < Buffer.byteLength(rolloutText), true);
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: `.codex-hosted/${rolloutRelativePath}`,
        root: "operator-home",
      }),
      null,
    );

    const restored = await restoreHostedExecutionContext({
      artifactResolver: async ({ ref }) => {
        const bytes = artifacts.get(ref.sha256);
        if (!bytes) {
          throw new Error("Missing test Codex continuity artifact.");
        }
        return bytes;
      },
      bundle: snapshot.bundle,
      workspaceRoot: restoreRoot,
    });

    assert.equal(
      await readFile(
        path.join(restored.operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
        "utf8",
      ),
      rolloutText,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state snapshots do not recursively scan Codex rollout directories", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-codex-direct-"));
  let hardenedDayDirectory: string | null = null;

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const threadId = "00000000-0000-4000-8000-000000000011";
    const rolloutRelativePath =
      `sessions/2026/05/05/rollout-2026-05-05T01-02-03-${threadId}.jsonl`;
    const dayDirectory = path.join(
      operatorHomeRoot,
      ".codex-hosted",
      "sessions",
      "2026",
      "05",
      "05",
    );
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(dayDirectory, { recursive: true });
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-test",
        },
      }) + "\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
      "{\"type\":\"provider-owned\"}\n",
      "utf8",
    );
    for (let index = 0; index < 2_000; index += 1) {
      await writeFile(
        path.join(dayDirectory, `unreferenced-${index}.jsonl`),
        "must not snapshot\n",
        "utf8",
      );
    }

    await chmod(dayDirectory, 0o100);
    hardenedDayDirectory = dayDirectory;

    const snapshot = await snapshotHostedAssistantRuntimeHotState({
      operatorHomeRoot,
      vaultRoot,
    });

    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: `.codex-hosted/${rolloutRelativePath}`,
        root: "operator-home",
      }),
      "{\"type\":\"provider-owned\"}\n",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".codex-hosted/sessions/2026/05/05/unreferenced-0.jsonl",
        root: "operator-home",
      }),
      null,
    );
  } finally {
    if (hardenedDayDirectory) {
      await chmod(hardenedDayDirectory, 0o700).catch(() => undefined);
    }
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted full snapshots do not recursively scan Codex rollout directories", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-full-codex-direct-"));
  let hardenedDayDirectory: string | null = null;

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const threadId = "00000000-0000-4000-8000-000000000032";
    const rolloutRelativePath =
      `sessions/2026/05/05/rollout-2026-05-05T01-02-03-${threadId}.jsonl`;
    const dayDirectory = path.join(
      operatorHomeRoot,
      ".codex-hosted",
      "sessions",
      "2026",
      "05",
      "05",
    );
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(dayDirectory, { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n", "utf8");
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-test",
        },
      }) + "\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
      "{\"type\":\"provider-owned\"}\n",
      "utf8",
    );
    for (let index = 0; index < 2_000; index += 1) {
      await writeFile(
        path.join(dayDirectory, `unreferenced-${index}.jsonl`),
        "must not snapshot\n",
        "utf8",
      );
    }

    await chmod(dayDirectory, 0o100);
    hardenedDayDirectory = dayDirectory;

    const snapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });

    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: `.codex-hosted/${rolloutRelativePath}`,
        root: "operator-home",
      }),
      "{\"type\":\"provider-owned\"}\n",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".codex-hosted/sessions/2026/05/05/unreferenced-0.jsonl",
        root: "operator-home",
      }),
      null,
    );
  } finally {
    if (hardenedDayDirectory) {
      await chmod(hardenedDayDirectory, 0o700).catch(() => undefined);
    }
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state snapshots report non-Codex-layout rollout continuity", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-codex-rollout-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "rollouts"), {
      recursive: true,
    });
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
      path.join(operatorHomeRoot, ".codex-hosted", "rollouts", "rollout.jsonl"),
      "{\"type\":\"provider-owned\"}\n",
      "utf8",
    );

    const snapshot = await snapshotHostedAssistantRuntimeHotState({
      operatorHomeRoot,
      vaultRoot,
    });

    assert.equal(snapshot.codexHomeSnapshotDiagnostics?.codexResumeInvalidPathCount, 1);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state snapshots preflight vault hot-state budget", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-vault-budget-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    await mkdir(path.join(assistantRoot, "outbox"), { recursive: true });
    await writeFile(
      path.join(assistantRoot, "outbox", "large.json"),
      "x".repeat(17 * 1024 * 1024),
      "utf8",
    );

    await assert.rejects(
      snapshotHostedAssistantRuntimeHotState({
        vaultRoot,
      }),
      HostedAssistantRuntimeHotStateBudgetExceededError,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state snapshots exclude Codex home without provider resume state", async () => {
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

test("hosted snapshots ignore non-Codex provider resume handles", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-non-codex-resume-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          providerSessionId: "non-codex-provider-session",
          resumeRouteId: "route-test",
        },
        target: {
          adapter: "other-provider",
        },
      }) + "\n",
      "utf8",
    );

    const snapshot = await snapshotHostedAssistantRuntimeHotState({
      vaultRoot,
    });

    assert.equal(snapshot.codexHomeSnapshotDiagnostics, null);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted restore prunes extra Codex home files", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-codex-restore-stray-"));

  try {
    const sourceOperatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const sourceVaultRoot = path.join(workspaceRoot, "vault");
    const sourceAssistantStateRoot = resolveAssistantStatePaths(sourceVaultRoot).assistantStateRoot;
    const restoreRoot = path.join(workspaceRoot, "restore");
    const threadId = "00000000-0000-4000-8000-000000000027";
    const rolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
    const rolloutJson = "{\"rollout\":\"kept\"}\n";
    await mkdir(path.join(sourceOperatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "06"), {
      recursive: true,
    });
    await mkdir(path.join(sourceAssistantStateRoot, "sessions"), { recursive: true });
    await mkdir(sourceVaultRoot, { recursive: true });
    await writeFile(path.join(sourceVaultRoot, "note.md"), "vault\n", "utf8");
    await writeFile(
      path.join(sourceAssistantStateRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-ready",
        },
      }) + "\n",
      "utf8",
    );
    await writeFile(
      path.join(sourceOperatorHomeRoot, ".codex-hosted", rolloutRelativePath),
      rolloutJson,
      "utf8",
    );
    await writeFile(
      path.join(sourceOperatorHomeRoot, ".codex-hosted", "auth.json"),
      "{\"token\":\"redacted-fixture\"}\n",
      "utf8",
    );
    const bundle = await snapshotHostedBundleRoots({
      kind: "vault",
      roots: [
        {
          root: sourceVaultRoot,
          rootKey: "vault",
        },
        {
          root: sourceOperatorHomeRoot,
          rootKey: "operator-home",
        },
      ],
    });

    const restored = await restoreHostedExecutionContext({
      bundle,
      workspaceRoot: restoreRoot,
    });
    assert.equal(
      await readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", rolloutRelativePath), "utf8"),
      rolloutJson,
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "auth.json"), "utf8"),
      { code: "ENOENT" },
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted restore replaces stale Codex home continuity before restore", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-codex-restore-replace-"));

  try {
    const restoreRoot = path.join(workspaceRoot, "restore");
    const firstBundle = await createHostedCodexContinuityBundle({
      rolloutJson: "{\"rollout\":\"first\"}\n",
      threadId: "00000000-0000-4000-8000-000000000028",
      workspaceRoot: path.join(workspaceRoot, "first"),
    });
    const secondBundle = await createHostedCodexContinuityBundle({
      rolloutJson: "{\"rollout\":\"second\"}\n",
      threadId: "00000000-0000-4000-8000-000000000029",
      workspaceRoot: path.join(workspaceRoot, "second"),
    });

    const firstRestored = await restoreHostedExecutionContext({
      bundle: firstBundle.bundle,
      workspaceRoot: restoreRoot,
    });
    assert.equal(
      await readFile(
        path.join(
          firstRestored.operatorHomeRoot,
          ".codex-hosted",
          firstBundle.rolloutRelativePath,
        ),
        "utf8",
      ),
      "{\"rollout\":\"first\"}\n",
    );

    const secondRestored = await restoreHostedExecutionContext({
      bundle: secondBundle.bundle,
      workspaceRoot: restoreRoot,
    });

    await assert.rejects(readFile(
      path.join(
        secondRestored.operatorHomeRoot,
        ".codex-hosted",
        firstBundle.rolloutRelativePath,
      ),
      "utf8",
    ));
    assert.equal(
      await readFile(
        path.join(
          secondRestored.operatorHomeRoot,
          ".codex-hosted",
          secondBundle.rolloutRelativePath,
        ),
        "utf8",
      ),
      "{\"rollout\":\"second\"}\n",
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted restore clears stale Codex home when next bundle has no continuity", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-codex-restore-clear-"));

  try {
    const restoreRoot = path.join(workspaceRoot, "restore");
    const continuityBundle = await createHostedCodexContinuityBundle({
      rolloutJson: "{\"rollout\":\"first\"}\n",
      threadId: "00000000-0000-4000-8000-000000000031",
      workspaceRoot: path.join(workspaceRoot, "continuity"),
    });
    const plainVaultRoot = path.join(workspaceRoot, "plain", "vault");
    await mkdir(plainVaultRoot, { recursive: true });
    await writeFile(path.join(plainVaultRoot, "note.md"), "plain\n", "utf8");
    const plainBundle = await snapshotHostedBundleRoots({
      kind: "vault",
      roots: [{ root: plainVaultRoot, rootKey: "vault" }],
    });
    assert.ok(plainBundle);

    await restoreHostedExecutionContext({
      bundle: continuityBundle.bundle,
      workspaceRoot: restoreRoot,
    });
    const restored = await restoreHostedExecutionContext({
      bundle: plainBundle,
      workspaceRoot: restoreRoot,
    });

    await assert.rejects(readFile(
      path.join(restored.operatorHomeRoot, ".codex-hosted", continuityBundle.rolloutRelativePath),
      "utf8",
    ));
    assert.equal(await readFile(path.join(restored.vaultRoot, "note.md"), "utf8"), "plain\n");
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted restore does not require a Codex continuity manifest", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-codex-restore-no-manifest-"));

  try {
    const restoreRoot = path.join(workspaceRoot, "restore");
    const sourceVaultRoot = path.join(workspaceRoot, "source", "vault");
    const assistantRoot = resolveAssistantStatePaths(sourceVaultRoot).assistantStateRoot;
    const threadId = "00000000-0000-4000-8000-000000000037";
    const rolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-test",
        },
      }),
      "utf8",
    );
    const bundle = await snapshotHostedBundleRoots({
      kind: "vault",
      roots: [
        {
          root: sourceVaultRoot,
          rootKey: "vault",
        },
      ],
    });
    assert.ok(bundle);

    const restored = await restoreHostedExecutionContext({
      bundle,
      workspaceRoot: restoreRoot,
    });
    assert.equal(
      await readFile(path.join(restored.assistantStateRoot, "sessions", "session.json"), "utf8"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-test",
        },
      }),
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted snapshots ignore live warm-cache Codex home files", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-codex-cache-live-"));

  try {
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const vaultRoot = path.join(workspaceRoot, "vault");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const threadId = "00000000-0000-4000-8000-000000000030";
    const rolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
    const rolloutJson = "{\"rollout\":\"kept\"}\n";
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", path.dirname(rolloutRelativePath)), {
      recursive: true,
    });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "memories"), {
      recursive: true,
    });
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
      rolloutJson,
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "memories", "MEMORY.md"),
      "# Codex memory\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "state_5.sqlite"),
      "state-db\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "memories_1.sqlite"),
      "memories-db\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "config.toml"),
      "sandbox_mode = \"danger-full-access\"\n",
      "utf8",
    );
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-test",
        },
      }) + "\n",
      "utf8",
    );

    const snapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });

    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: `.codex-hosted/${rolloutRelativePath}`,
        root: "operator-home",
      }),
      rolloutJson,
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".codex-hosted/config.toml",
        root: "operator-home",
      }),
      null,
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".codex-hosted/memories/MEMORY.md",
        root: "operator-home",
      }),
      null,
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".codex-hosted/state_5.sqlite",
        root: "operator-home",
      }),
      null,
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".codex-hosted/memories_1.sqlite",
        root: "operator-home",
      }),
      null,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state snapshots report resume state without rollout continuity", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-hot-codex-missing-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      "{\"providerSessionId\":\"thread-test\",\"resumeRouteId\":\"route-test\"}\n",
      "utf8",
    );

    const snapshot = await snapshotHostedAssistantRuntimeHotState({
      vaultRoot,
    });

    assert.equal(snapshot.codexHomeSnapshotDiagnostics?.codexResumeThreadCount, 1);
    assert.equal(snapshot.codexHomeSnapshotDiagnostics?.codexResumeMissingRolloutCount, 1);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted assistant hot-state snapshots report config-only Codex home continuity", async () => {
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

    const snapshot = await snapshotHostedAssistantRuntimeHotState({
      operatorHomeRoot,
      vaultRoot,
    });

    assert.equal(snapshot.codexHomeSnapshotDiagnostics?.codexResumeThreadCount, 1);
    assert.equal(snapshot.codexHomeSnapshotDiagnostics?.codexResumeInvalidPathCount, 1);
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".codex-hosted/config.toml",
        root: "operator-home",
      }),
      null,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted full snapshots report config-only Codex home continuity", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-full-codex-missing-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted"), { recursive: true });
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      "{\"providerSessionId\":\"thread-test\",\"resumeRouteId\":\"route-test\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "config.toml"),
      "model = \"gpt-test\"\n",
      "utf8",
    );

    const snapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });

    assert.equal(snapshot.codexHomeSnapshotDiagnostics?.codexResumeThreadCount, 1);
    assert.equal(snapshot.codexHomeSnapshotDiagnostics?.codexResumeInvalidPathCount, 1);
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".codex-hosted/config.toml",
        root: "operator-home",
      }),
      null,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted full snapshots exclude managed Codex ChatGPT auth", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-full-codex-auth-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const managedAuthJson = buildManagedCodexAuthJson();
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted"), { recursive: true });
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      "{\"providerSessionId\":\"thread-test\",\"resumeRouteId\":\"route-test\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "auth.json"),
      managedAuthJson,
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "credentials.json"),
      "{\"placeholder\":true}\n",
      "utf8",
    );

    const snapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });

    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".codex-hosted/auth.json",
        root: "operator-home",
      }),
      null,
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".codex-hosted/credentials.json",
        root: "operator-home",
      }),
      null,
    );

    const restored = await restoreHostedExecutionContext({
      bundle: snapshot.bundle,
      workspaceRoot: path.join(workspaceRoot, "restore"),
    });
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "auth.json"), "utf8"),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "credentials.json"), "utf8"),
      { code: "ENOENT" },
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted full snapshots exclude unmanaged Codex ChatGPT auth", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-full-codex-auth-invalid-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    await mkdir(vaultRoot, { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted"), { recursive: true });
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "auth.json"),
      buildUnmanagedCodexAuthJson(),
      "utf8",
    );

    const snapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });

    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".codex-hosted/auth.json",
        root: "operator-home",
      }),
      null,
    );

    const restored = await restoreHostedExecutionContext({
      bundle: snapshot.bundle,
      workspaceRoot: path.join(workspaceRoot, "restore"),
    });
    await assert.rejects(
      readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "auth.json"), "utf8"),
      { code: "ENOENT" },
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted snapshots report invalid and archived live Codex rollout paths", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-codex-invalid-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const threadId = "00000000-0000-4000-8000-000000000024";
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "06", "auth"), {
      recursive: true,
    });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "archived_sessions", "2026", "05", "06"), {
      recursive: true,
    });

    const invalidRolloutRelativePath =
      `sessions/2026/05/06/auth/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", invalidRolloutRelativePath),
      "{\"rollout\":\"invalid\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: invalidRolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-test",
        },
      }),
      "utf8",
    );

    const invalidHotSnapshot = await snapshotHostedAssistantRuntimeHotState({
      operatorHomeRoot,
      vaultRoot,
    });
    assert.equal(invalidHotSnapshot.codexHomeSnapshotDiagnostics?.codexResumeInvalidPathCount, 1);
    const invalidFullSnapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });
    assert.equal(invalidFullSnapshot.codexHomeSnapshotDiagnostics?.codexResumeInvalidPathCount, 1);

    const archivedRolloutRelativePath =
      `archived_sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", archivedRolloutRelativePath),
      "{\"rollout\":\"archived\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: archivedRolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-test",
        },
      }),
      "utf8",
    );

    const archivedHotSnapshot = await snapshotHostedAssistantRuntimeHotState({
      operatorHomeRoot,
      vaultRoot,
    });
    assert.equal(
      archivedHotSnapshot.codexHomeSnapshotDiagnostics?.codexResumeArchivedUnsupportedCount,
      1,
    );
    const archivedFullSnapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });
    assert.equal(
      archivedFullSnapshot.codexHomeSnapshotDiagnostics?.codexResumeArchivedUnsupportedCount,
      1,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted snapshots report rollout continuity through Codex home parent symlinks", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-codex-symlink-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const outsideSessionsRoot = path.join(workspaceRoot, "outside-sessions");
    const threadId = "00000000-0000-4000-8000-000000000035";
    const rolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted"), { recursive: true });
    await mkdir(path.join(outsideSessionsRoot, "2026", "05", "06"), { recursive: true });
    await symlink(outsideSessionsRoot, path.join(operatorHomeRoot, ".codex-hosted", "sessions"), "dir");
    await writeFile(
      path.join(outsideSessionsRoot, "2026", "05", "06", `rollout-2026-05-06T01-02-03-${threadId}.jsonl`),
      "{\"rollout\":\"outside\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-test",
        },
      }),
      "utf8",
    );

    const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
      operatorHomeRoot,
      vaultRoot,
    });
    assert.equal(hotSnapshot.codexHomeSnapshotDiagnostics?.codexResumeMissingRolloutCount, 1);
    const fullSnapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });
    assert.equal(fullSnapshot.codexHomeSnapshotDiagnostics?.codexResumeMissingRolloutCount, 1);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted snapshots report rollout continuity when rollout file is a symlink", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-codex-file-symlink-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const outsideRolloutPath = path.join(workspaceRoot, "outside-rollout.jsonl");
    const threadId = "00000000-0000-4000-8000-000000000036";
    const rolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "06"), {
      recursive: true,
    });
    await writeFile(outsideRolloutPath, "{\"rollout\":\"outside\"}\n", "utf8");
    await symlink(
      outsideRolloutPath,
      path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
    );
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-test",
        },
      }),
      "utf8",
    );

    const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
      operatorHomeRoot,
      vaultRoot,
    });
    assert.equal(hotSnapshot.codexHomeSnapshotDiagnostics?.codexResumeMissingRolloutCount, 1);
    const fullSnapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });
    assert.equal(fullSnapshot.codexHomeSnapshotDiagnostics?.codexResumeMissingRolloutCount, 1);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted full snapshots report dangling Codex resume state without fixture policy", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-fixture-continuity-policy-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
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

    const snapshot = await snapshotHostedExecutionContext({
      vaultRoot,
    });

    assert.equal(snapshot.codexHomeSnapshotDiagnostics?.codexResumeMissingRolloutCount, 1);
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".runtime/operations/assistant/sessions/session.json",
        root: "vault",
      }),
      "{\"resumeState\":{\"providerSessionId\":\"thread-test\",\"resumeRouteId\":\"route-test\"}}",
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted full snapshots ignore non-resumable thread-id-only Codex session state", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-thread-only-continuity-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await writeFile(
      path.join(assistantRoot, "sessions", "legacy-session.json"),
      JSON.stringify({
        resumeState: {
          providerSessionId: "legacy-thread-only",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(assistantRoot, "sessions", "v2-session.json"),
      JSON.stringify({
        codexResume: {
          threadId: "v2-thread-only",
        },
      }),
      "utf8",
    );

    const snapshot = await snapshotHostedExecutionContext({
      vaultRoot,
    });

    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".runtime/operations/assistant/sessions/legacy-session.json",
        root: "vault",
      }),
      "{\"resumeState\":{\"providerSessionId\":\"legacy-thread-only\"}}",
    );
    assert.equal(
      readHostedBundleTextFile({
        bytes: snapshot.bundle,
        expectedKind: "vault",
        path: ".runtime/operations/assistant/sessions/v2-session.json",
        root: "vault",
      }),
      "{\"codexResume\":{\"threadId\":\"v2-thread-only\"}}",
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted Codex continuity diagnostics omit relative-path hashes without a hash secret", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-bundle-"));

  try {
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const vaultRoot = path.join(workspaceRoot, "vault");
    const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const threadId = "00000000-0000-4000-8000-000000000003";
    const rolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "06"), { recursive: true });
    await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
      "{\"rollout\":\"kept\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(assistantRoot, "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-test",
        },
      }),
      "utf8",
    );
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n", "utf8");

    const snapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });

    expect(snapshot.codexHomeSnapshotDiagnostics).toEqual({
      codexResumeArchivedUnsupportedCount: 0,
      codexResumeInvalidPathCount: 0,
      codexResumeMissingRolloutCount: 0,
      codexResumeRolloutBytes: "{\"rollout\":\"kept\"}\n".length,
      codexResumeRolloutFileBytes: ["{\"rollout\":\"kept\"}\n".length],
      codexResumeRolloutRelHashes: [],
      codexResumeThreadCount: 1,
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
    portability: "portable",
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
  expect(describeVaultLocalStateRelativePath(".runtime/projections/query.sqlite")).toMatchObject({
    classification: "projection",
    portability: "machine_local",
    owner: "query",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/projections/gateway.sqlite")).toMatchObject({
    classification: "projection",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/projections/gateway.sqlite")?.owner).toBeUndefined();
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

    const materialized = await materializeHostedExecutionArtifacts({
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
    assert.deepEqual(
      [...materialized.materializedArtifactPaths],
      ["vault:raw/inbox/example/scan.pdf"],
    );

    await expect(
      readFile(path.join(restored.vaultRoot, "raw", "inbox", "example", "scan.pdf")),
    ).resolves.toEqual(Buffer.from("pdf-binary-artifact\n", "utf8"));
    assert.equal(resolvedHashes.length, 1);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(restoreRoot, { force: true, recursive: true });
  }
});

test("hosted execution snapshots externalize raw files including small text payloads", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-raw-heuristics-"));
  const restoreRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-raw-heuristics-restore-"));
  const artifacts = new Map<string, Uint8Array>();

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const binaryRawPath = path.join(vaultRoot, "raw", "captures", "payload");
    const smallTextRawPath = path.join(vaultRoot, "raw", "integrations", "provider", "snapshot.json");
    const textRawPath = path.join(vaultRoot, "raw", "captures", "notes.txt");
    const binaryBytes = Uint8Array.from({ length: 256 * 1024 + 16 }, (_, index) => index % 251);
    binaryBytes[0] = 0;
    binaryBytes[17] = 255;
    const smallTextBytes = Buffer.from("{\"kind\":\"snapshot\",\"count\":1}\n", "utf8");
    const textBytes = Buffer.from("notes-line\n".repeat(30_000), "utf8");

    await mkdir(path.dirname(binaryRawPath), { recursive: true });
    await mkdir(path.dirname(smallTextRawPath), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".murph"), { recursive: true });
    await writeFile(binaryRawPath, binaryBytes);
    await writeFile(smallTextRawPath, smallTextBytes);
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
      artifactRefs.map((artifact) => artifact.path).sort(),
      [
        "raw/captures/notes.txt",
        "raw/captures/payload",
        "raw/integrations/provider/snapshot.json",
      ],
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
        path: "raw/integrations/provider/snapshot.json",
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
      null,
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
    await expect(readFile(path.join(restored.vaultRoot, "raw", "integrations", "provider", "snapshot.json"))).resolves.toEqual(
      smallTextBytes,
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

test("hosted execution targeted materialization rejects corrupt artifact bytes", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-artifact-target-integrity-"));
  const restoreRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-artifact-target-integrity-restore-"));
  const artifacts = new Map<string, Uint8Array>();

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const rawAttachmentPath = path.join(vaultRoot, "raw", "inbox", "example", "scan.pdf");

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

    await restoreHostedExecutionContext({
      artifactResolver: async ({ ref }) => {
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

    await expect(materializeHostedExecutionArtifacts({
      artifactResolver: async () => Buffer.from("corrupt-artifact\n", "utf8"),
      shouldRestoreArtifact: ({ path: artifactPath, root }) => (
        root === "vault" && artifactPath === "raw/inbox/example/scan.pdf"
      ),
      bundle: snapshot.bundle,
      workspaceRoot: restoreRoot,
    })).rejects.toThrow("Hosted bundle artifact size mismatch");
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(restoreRoot, { force: true, recursive: true });
  }
});

test("hosted execution targeted materialization rejects same-size corrupt artifact bytes", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-artifact-target-hash-"));
  const restoreRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-artifact-target-hash-restore-"));
  const artifacts = new Map<string, Uint8Array>();

  try {
    const vaultRoot = path.join(workspaceRoot, "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const rawAttachmentPath = path.join(vaultRoot, "raw", "inbox", "example", "scan.pdf");
    const originalBytes = Buffer.from("pdf-binary-artifact\n", "utf8");

    await mkdir(path.dirname(rawAttachmentPath), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".murph"), { recursive: true });
    await writeFile(rawAttachmentPath, originalBytes);
    await writeFile(path.join(operatorHomeRoot, ".murph", "config.json"), "{\"schema\":\"cfg\"}\n");

    const snapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      operatorHomeRoot,
      vaultRoot,
    });

    await restoreHostedExecutionContext({
      artifactResolver: async ({ ref }) => {
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

    const sameSizeCorruptBytes = Buffer.from(originalBytes);
    sameSizeCorruptBytes[0] = sameSizeCorruptBytes[0]! ^ 0xff;
    await expect(materializeHostedExecutionArtifacts({
      artifactResolver: async () => sameSizeCorruptBytes,
      shouldRestoreArtifact: ({ path: artifactPath, root }) => (
        root === "vault" && artifactPath === "raw/inbox/example/scan.pdf"
      ),
      bundle: snapshot.bundle,
      workspaceRoot: restoreRoot,
    })).rejects.toThrow("Hosted bundle artifact hash mismatch");
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

async function createHostedCodexContinuityBundle(input: {
  rolloutJson: string;
  threadId: string;
  workspaceRoot: string;
}): Promise<{
  bundle: Uint8Array;
  rolloutRelativePath: string;
}> {
  const operatorHomeRoot = path.join(input.workspaceRoot, "operator-home");
  const vaultRoot = path.join(input.workspaceRoot, "vault");
  const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
  const rolloutRelativePath =
    `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${input.threadId}.jsonl`;

  await mkdir(path.join(operatorHomeRoot, ".codex-hosted", path.dirname(rolloutRelativePath)), {
    recursive: true,
  });
  await mkdir(path.join(assistantStateRoot, "sessions"), { recursive: true });
  await writeFile(
    path.join(assistantStateRoot, "sessions", "session.json"),
    JSON.stringify({
      resumeState: {
        codexRolloutRelativePath: rolloutRelativePath,
        providerSessionId: input.threadId,
        resumeRouteId: "route-ready",
      },
    }) + "\n",
    "utf8",
  );
  await writeFile(
    path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
    input.rolloutJson,
    "utf8",
  );

  const bundle = await snapshotHostedBundleRoots({
    kind: "vault",
    roots: [
      {
        root: vaultRoot,
        rootKey: "vault",
      },
      {
        root: operatorHomeRoot,
        rootKey: "operator-home",
      },
    ],
  });
  assert.ok(bundle);
  return {
    bundle,
    rolloutRelativePath,
  };
}

function buildManagedCodexAuthJson(): string {
  return JSON.stringify({
    OPENAI_API_KEY: null,
    auth_mode: "chatgpt",
    last_refresh: "2026-06-11T00:00:00.000Z",
    tokens: {
      access_token: "fixture",
      account_id: "account-1234",
      id_token: buildFakeJsonJwtPayload({
        iss: "https://auth.openai.com",
        sub: "user-1",
      }),
      refresh_token: "fixture",
    },
  }) + "\n";
}

function buildUnmanagedCodexAuthJson(): string {
  const managed = JSON.parse(buildManagedCodexAuthJson()) as CodexAuthJsonFixture;
  return JSON.stringify({
    ...managed,
    OPENAI_API_KEY: "",
  }) + "\n";
}

interface CodexAuthJsonFixture {
  OPENAI_API_KEY: null | string;
  auth_mode: string;
  last_refresh: string;
  tokens: {
    access_token: string;
    account_id: string;
    id_token: string;
    refresh_token: string;
  };
}

function buildFakeJsonJwtPayload(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString("base64url"),
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"),
    "signature",
  ].join(".");
}

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
