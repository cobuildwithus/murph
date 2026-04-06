import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { expect, test } from "vitest";

import {
  sameHostedBundlePayloadRef,
  sameHostedExecutionBundleRef,
  type HostedExecutionBundleRef,
} from "../src/index.ts";
import { serializeHostedBundleArchive } from "../src/hosted-bundle.ts";
import {
  describeVaultLocalStateRelativePath,
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
  expect(decodeHostedBundleBase64("")).toEqual(new Uint8Array());
  expect(Buffer.from(decodeHostedBundleBase64(" Zm9v ") ?? [])).toEqual(Buffer.from("foo"));
  expect(() => decodeHostedBundleBase64("%%%")).toThrow("Hosted bundle payload must be valid base64.");
  expect(() => decodeHostedBundleBase64("Zg")).toThrow("Hosted bundle payload must be valid base64.");
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
    await mkdir(path.join(assistantRuntimeRoot, "cron", "runs"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "diagnostics"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "outbox", ".quarantine"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "receipts"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "secrets", "sessions"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "sessions"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "state", "onboarding", "first-contact"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "transcripts"), { recursive: true });
    await mkdir(path.join(assistantRuntimeRoot, "usage", "pending"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".murph", "hosted"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "device-sync"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "inbox"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "op_test", "payloads"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "parsers"), { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "device-sync", "state.sqlite"), "sqlite-control-state\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "device-sync", "launcher.json"), "{\"pid\":1234}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "device-sync", "stdout.log"), "skip-log\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "inbox", "config.json"), "{\"version\":1,\"connectors\":[]}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "inbox", "state.json"), "{\"running\":false}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "inbox", "promotions.json"), "{\"version\":1,\"entries\":[]}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "parsers", "toolchain.json"), "{\"version\":1}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "op_test.json"), "{\"status\":\"committed\"}\n");
    await writeFile(path.join(vaultRoot, ".runtime", "operations", "op_test", "payloads", "staged.md"), "staged payload\n");
    await writeFile(path.join(vaultRoot, ".runtime", "search.sqlite"), "legacy-search\n");
    await writeFile(path.join(vaultRoot, ".env.local"), "secret=true\n");
    await writeFile(path.join(vaultRoot, "exports", "packs", "bundle.zip"), "skip-me\n");
    await writeFile(path.join(vaultRoot, "raw", "notes.json"), "{\"keep\":true}\n");
    await writeFile(rawAttachmentPath, Buffer.from("pdf-binary-artifact\n", "utf8"));
    await writeFile(path.join(assistantRuntimeRoot, "automation.json"), "{\"autoReplyChannels\":[\"linq\"]}\n");
    await writeFile(path.join(assistantRuntimeRoot, "cron", "jobs.json"), "{\"version\":1,\"jobs\":[{\"jobId\":\"cron_1\"}]}\n");
    await writeFile(path.join(assistantRuntimeRoot, "cron", "runs", "cronrun_1.jsonl"), "{\"status\":\"ok\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "diagnostics", "events.jsonl"), "{\"kind\":\"assistant.scan\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "diagnostics", "snapshot.json"), "{\"status\":\"healthy\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "failover.json"), "{\"cooldownUntil\":\"2026-04-06T00:00:00Z\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "outbox", "intent_1.json"), "{\"intent\":\"deliver\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "outbox", ".quarantine", "ignored.json"), "{\"ignored\":true}\n");
    await writeFile(path.join(assistantRuntimeRoot, "receipts", "turn_1.json"), "{\"receipt\":\"saved\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "sessions", "session_1.json"), "{\"session\":\"saved\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "state", "onboarding", "first-contact", "bootstrap.json"), "{\"state\":\"scratch\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "status.json"), "{\"status\":\"running\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "transcripts", "session_1.jsonl"), "{\"role\":\"assistant\"}\n");
    await writeFile(path.join(assistantRuntimeRoot, "usage", "pending", "usage_1.json"), "{\"usage\":true}\n");
    await writeFile(path.join(assistantRuntimeRoot, "secrets", "sessions", "session_1.json"), "{\"secret\":true}\n");
    await writeFile(path.join(operatorHomeRoot, ".murph", "config.json"), "{\"schema\":\"cfg\"}\n");
    await writeFile(
      path.join(operatorHomeRoot, ".murph", "hosted", "user-env.json"),
      "{\"schema\":\"murph.hosted-user-env.v1\",\"env\":{\"OPENAI_API_KEY\":\"sk-user\"}}\n",
    );

    const snapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      operatorHomeRoot,
      vaultRoot,
    });

    assertHostedBundleTextEntries(snapshot.bundle, [
      { expected: "{\"schema\":\"vault\"}\n", path: "vault.json", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant", root: "vault" },
      {
        expected: "{\"autoReplyChannels\":[\"linq\"]}\n",
        path: ".runtime/operations/assistant/automation.json",
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
        expected: "{\"cooldownUntil\":\"2026-04-06T00:00:00Z\"}\n",
        path: ".runtime/operations/assistant/failover.json",
        root: "vault",
      },
      { expected: null, path: ".runtime/operations/assistant/status.json", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/diagnostics/events.jsonl", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/diagnostics/snapshot.json", root: "vault" },
      { expected: null, path: ".runtime/operations/assistant/cron/runs/cronrun_1.jsonl", root: "vault" },
      {
        expected: null,
        path: ".runtime/operations/assistant/state/onboarding/first-contact/bootstrap.json",
        root: "vault",
      },
      { expected: "{\"schema\":\"cfg\"}\n", path: ".murph/config.json", root: "operator-home" },
      { expected: null, path: ".murph/hosted/user-env.json", root: "operator-home" },
      { expected: null, path: "raw/inbox/2026-03-28/capture_123/attachments/report.pdf", root: "vault" },
      {
        expected: "{\"version\":1,\"entries\":[]}\n",
        path: ".runtime/operations/inbox/promotions.json",
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
      { expected: null, path: ".runtime/operations/inbox/config.json", root: "vault" },
      { expected: null, path: ".runtime/operations/device-sync/state.sqlite", root: "vault" },
      { expected: null, path: ".runtime/search.sqlite", root: "vault" },
      { expected: null, path: ".runtime/operations/parsers/toolchain.json", root: "vault" },
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
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "automation.json"), "utf8"),
      "{\"autoReplyChannels\":[\"linq\"]}\n",
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
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "receipts", "turn_1.json"), "utf8"),
      "{\"receipt\":\"saved\"}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "usage", "pending", "usage_1.json"), "utf8"),
      "{\"usage\":true}\n",
    );
    assert.equal(
      await readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "failover.json"), "utf8"),
      "{\"cooldownUntil\":\"2026-04-06T00:00:00Z\"}\n",
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
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "status.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "diagnostics", "events.jsonl"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "diagnostics", "snapshot.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "cron", "runs", "cronrun_1.jsonl"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "state", "onboarding", "first-contact", "bootstrap.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "assistant", "secrets", "sessions", "session_1.json"), "utf8"),
    );
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
      readFile(path.join(restored.vaultRoot, ".runtime", "operations", "parsers", "toolchain.json"), "utf8"),
    );
    await assert.rejects(
      readFile(path.join(restored.vaultRoot, ".runtime", "search.sqlite"), "utf8"),
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(restoreRoot, { force: true, recursive: true });
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

test("runtime-state portability defaults operational paths to machine-local unless explicitly marked portable", () => {
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/automation.json")).toMatchObject({
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
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/status.json")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/diagnostics/snapshot.json")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/assistant/cron/runs/cronrun_1.jsonl")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/inbox/promotions.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/op_test.json")).toMatchObject({
    classification: "operational",
    portability: "portable",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/inbox/config.json")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/operations/parsers/toolchain.json")).toMatchObject({
    classification: "operational",
    portability: "machine_local",
  });
  expect(describeVaultLocalStateRelativePath(".runtime/projections/search.sqlite")).toMatchObject({
    classification: "projection",
    portability: "machine_local",
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
    })).rejects.toThrow("Hosted bundle artifact vault:raw/captures/report.pdf");
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
    bytes: serializeHostedBundleArchive({
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

  expect(() => serializeHostedBundleArchive({
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
  })).toThrow(/duplicate file entry/i);
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
  })).toThrow(/duplicate file entry/i);
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
