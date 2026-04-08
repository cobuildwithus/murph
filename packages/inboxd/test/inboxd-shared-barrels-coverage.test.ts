import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, expectTypeOf, test, vi } from "vitest";

import type { StoredAttachment as BarrelStoredAttachment } from "../src/index.ts";
import type { StoredAttachment as ContractStoredAttachment } from "../src/contracts/capture.ts";

const mocks = vi.hoisted(() => ({
  generateUlidMock: vi.fn(),
  normalizeRelativeVaultPathMock: vi.fn(),
  resolveVaultPathOnDiskMock: vi.fn(),
  assertPathWithinVaultOnDiskMock: vi.fn(),
}));

vi.mock("@murphai/runtime-state", () => ({
  generateUlid: mocks.generateUlidMock,
}));

vi.mock("@murphai/core", () => ({
  assertPathWithinVaultOnDisk: mocks.assertPathWithinVaultOnDiskMock,
  normalizeRelativeVaultPath: mocks.normalizeRelativeVaultPathMock,
  resolveVaultPathOnDisk: mocks.resolveVaultPathOnDiskMock,
}));

import * as sharedModule from "../src/shared.ts";
import * as sharedRuntimeModule from "../src/shared-runtime.ts";
import {
  assertVaultPathOnDisk,
  buildAttachmentId,
  buildFtsQuery,
  buildSnippet,
  createDeterministicInboxCaptureId,
  createInboxCaptureIdentityKey,
  ensureParentDirectory,
  generatePrefixedId,
  mapObjectEntries,
  normalizeRelativePath,
  normalizeStoredAttachments,
  sanitizeFileName,
  sanitizeSegment,
  sha256File,
  tokenizeSearchText,
  walkNamedFiles,
} from "../src/shared.ts";
import {
  createCaptureCheckpoint,
  redactSensitivePaths,
  relayAbort,
  sanitizeRawMetadata,
  toIsoTimestamp,
  waitForAbortOrTimeout,
} from "../src/shared-runtime.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mocks.generateUlidMock.mockReset();
  mocks.normalizeRelativeVaultPathMock.mockReset();
  mocks.resolveVaultPathOnDiskMock.mockReset();
  mocks.assertPathWithinVaultOnDiskMock.mockReset();
});

test("shared barrel re-exports the shared-runtime helpers and contract types without drift", () => {
  assert.equal(sharedModule.createCaptureCheckpoint, sharedRuntimeModule.createCaptureCheckpoint);
  assert.equal(sharedModule.normalizeTextValue, sharedRuntimeModule.normalizeTextValue);
  assert.equal(sharedModule.redactSensitivePaths, sharedRuntimeModule.redactSensitivePaths);
  assert.equal(sharedModule.relayAbort, sharedRuntimeModule.relayAbort);
  assert.equal(sharedModule.sanitizeRawMetadata, sharedRuntimeModule.sanitizeRawMetadata);
  assert.equal(sharedModule.toIsoTimestamp, sharedRuntimeModule.toIsoTimestamp);
  assert.equal(sharedModule.waitForAbortOrTimeout, sharedRuntimeModule.waitForAbortOrTimeout);

  expectTypeOf<BarrelStoredAttachment>().toEqualTypeOf<ContractStoredAttachment>();
  expectTypeOf<Parameters<typeof normalizeStoredAttachments>[1]>().toEqualTypeOf<
    ReadonlyArray<ContractStoredAttachment>
  >();
  expectTypeOf<ReturnType<typeof normalizeStoredAttachments>>().toEqualTypeOf<
    ContractStoredAttachment[]
  >();
});

test("shared-runtime helpers cover sensitive redaction and abort fast paths", async () => {
  function functionValue() {
    return "hidden";
  }

  assert.equal(toIsoTimestamp("2026-04-08T01:02:03.000Z"), "2026-04-08T01:02:03.000Z");
  assert.deepEqual(createCaptureCheckpoint({
    occurredAt: "2026-04-08T01:02:03.000Z",
    externalId: "msg-1",
    receivedAt: "2026-04-08T01:05:00.000Z",
  }), {
    occurredAt: "2026-04-08T01:02:03.000Z",
    externalId: "msg-1",
    receivedAt: "2026-04-08T01:05:00.000Z",
  });

  const sanitized = sanitizeRawMetadata({
    token: "abc123",
    client_key: "secret-key",
    nested: {
      authorizationHeader: "Bearer super-secret",
      windowsPath: "C:\\Users\\operator\\vault\\raw.txt",
      linuxPath: "/home/operator/vault/raw.txt",
      bytes: Uint8Array.from([1, 2, 3]),
      bigintValue: 42n,
      symbolValue: Symbol.for("shared-redaction"),
      functionValue,
    },
    list: [undefined, "Basic opaque-secret", "/Users/operator/vault/file.txt"],
  });

  assert.deepEqual(sanitized, {
    token: "<REDACTED_SECRET>",
    client_key: "<REDACTED_SECRET>",
    nested: {
      authorizationHeader: "<REDACTED_SECRET>",
      windowsPath: "<REDACTED_PATH>",
      linuxPath: "<REDACTED_PATH>",
      bytes: "<3 bytes>",
      bigintValue: "42",
      symbolValue: "Symbol(shared-redaction)",
      functionValue: String(functionValue),
    },
    list: [null, "<REDACTED_SECRET>", "<REDACTED_PATH>"],
  });

  assert.deepEqual(redactSensitivePaths(["/Users/operator/example.txt", "safe"]), [
    "<REDACTED_PATH>",
    "safe",
  ]);

  const source = new AbortController();
  source.abort();
  const target = new AbortController();
  const release = relayAbort(source.signal, target);
  assert.equal(target.signal.aborted, true);
  release();

  vi.useFakeTimers();
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await waitForAbortOrTimeout(alreadyAborted.signal, 5_000);
  assert.equal(vi.getTimerCount(), 0);
});

test("shared helpers normalize ids, snippets, search text, and attachment records deterministically", () => {
  mocks.generateUlidMock.mockReturnValue("01ARZ3NDEKTSV4RRFFQ69G5FAV");

  assert.equal(generatePrefixedId("Capture Prefix", 123), "capture_prefix_01ARZ3NDEKTSV4RRFFQ69G5FAV");
  assert.equal(buildAttachmentId("cap_123", 7), "att_cap_123_07");
  assert.equal(sanitizeSegment("  My File.Name  "), "my-file-name");
  assert.equal(sanitizeSegment("***", "fallback"), "fallback");
  assert.equal(sanitizeFileName("../Quarterly Report.PDF"), "quarterly-report.pdf");

  const attachments = normalizeStoredAttachments("cap_123", [
    { attachmentId: "att_cap_123_01", ordinal: 1, kind: "image" },
    { attachmentId: "att_cap_123_02", ordinal: 2, kind: "document", fileName: "report.pdf" },
  ]);
  assert.deepEqual(attachments, [
    { attachmentId: "att_cap_123_01", ordinal: 1, kind: "image" },
    { attachmentId: "att_cap_123_02", ordinal: 2, kind: "document", fileName: "report.pdf" },
  ]);

  assert.throws(
    () => normalizeStoredAttachments("cap_123", [{ ordinal: 1, kind: "image" } as never]),
    /Missing canonical "attachmentId"/,
  );
  assert.throws(
    () =>
      normalizeStoredAttachments("cap_123", [
        { attachmentId: "att_cap_123_01", kind: "image" } as never,
      ]),
    /Missing canonical "ordinal"/,
  );
  assert.throws(
    () =>
      normalizeStoredAttachments("cap_123", [
        { attachmentId: "att_cap_123_01", ordinal: 1, kind: "image" },
        { attachmentId: "att_cap_123_01", ordinal: 2, kind: "document" },
      ]),
    /Duplicate canonical "attachmentId"/,
  );
  assert.throws(
    () =>
      normalizeStoredAttachments("cap_123", [
        { attachmentId: "att_cap_123_01", ordinal: 1, kind: "image" },
        { attachmentId: "att_cap_123_02", ordinal: 1, kind: "document" },
      ]),
    /Duplicate canonical "ordinal"/,
  );

  assert.deepEqual(tokenizeSearchText(" Alpha, beta... \"Gamma\" "), ["alpha", "beta", "gamma"]);
  assert.equal(buildFtsQuery('Alpha beta "quoted"'), '"alpha"* AND "beta"* AND "quoted"*');
  assert.equal(buildFtsQuery("   "), "");
  assert.equal(
    buildSnippet(null, "   ", "x".repeat(181)),
    `${"x".repeat(177)}...`,
  );
  assert.equal(buildSnippet(undefined, " second "), "second");

  assert.deepEqual(
    mapObjectEntries({ alpha: 1, beta: 2 }, (key, entry) => [key.toUpperCase(), Number(entry) * 10]),
    { ALPHA: 10, BETA: 20 },
  );

  assert.equal(
    createInboxCaptureIdentityKey({
      source: "telegram",
      externalId: "message-1",
    }),
    "telegram\u0000\u0000message-1",
  );
  assert.equal(
    createDeterministicInboxCaptureId({
      source: "telegram",
      externalId: "message-1",
      accountId: null,
    }),
    createDeterministicInboxCaptureId({
      source: "telegram",
      externalId: "message-1",
      accountId: undefined,
    }),
  );
});

test("shared helper wrappers translate cross-package path errors into TypeErrors", async () => {
  mocks.normalizeRelativeVaultPathMock.mockImplementation((relativePath: string) => `vault/${relativePath}`);
  mocks.resolveVaultPathOnDiskMock.mockResolvedValue({ absolutePath: "/vault/inbox/capture.json" });

  assert.equal(normalizeRelativePath("inbox/capture.json"), "vault/inbox/capture.json");
  assert.equal(
    await sharedModule.resolveVaultPath("/vault", "inbox/capture.json"),
    "/vault/inbox/capture.json",
  );

  mocks.normalizeRelativeVaultPathMock.mockImplementation(() => {
    throw new Error("relative path rejected");
  });
  assert.throws(() => normalizeRelativePath("../escape"), /relative path rejected/);

  mocks.resolveVaultPathOnDiskMock.mockRejectedValue("disk lookup failed");
  await assert.rejects(
    () => sharedModule.resolveVaultPath("/vault", "../escape"),
    (error: unknown) =>
      error instanceof TypeError && error.message === "disk lookup failed",
  );

  mocks.assertPathWithinVaultOnDiskMock.mockRejectedValue(new Error("outside vault"));
  await assert.rejects(
    () => assertVaultPathOnDisk("/vault", "/tmp/outside"),
    (error: unknown) => error instanceof TypeError && error.message === "outside vault",
  );
});

test("filesystem helpers create parent directories, hash content, and walk named files with skips", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "inboxd-shared-coverage-"));

  try {
    const nestedDirectory = path.join(tempRoot, "kept", "nested");
    const skippedDirectory = path.join(tempRoot, "skip-me");
    const targetFile = path.join(nestedDirectory, "target.txt");
    const skippedFile = path.join(skippedDirectory, "target.txt");
    const hashedFile = path.join(tempRoot, "hash.txt");

    await mkdir(skippedDirectory, { recursive: true });
    await ensureParentDirectory(targetFile);
    await writeFile(targetFile, "alpha");
    await writeFile(skippedFile, "hidden");
    await writeFile(hashedFile, "murph");

    assert.equal(
      await sha256File(hashedFile),
      "7fa8398c9888bd7abca8fa94f2b0b813aa8a50bca1dd965281741afda32a0db4",
    );

    const walked = await walkNamedFiles(tempRoot, "target.txt", {
      skipDirectories: ["skip-me"],
    });
    assert.deepEqual(walked, [targetFile]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
