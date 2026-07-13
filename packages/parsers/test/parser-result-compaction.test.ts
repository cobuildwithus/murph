import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { initializeVault } from "@murphai/core";
import { test, vi } from "vitest";

import {
  compactLegacyParserAttempts,
  readParserResult,
  type ParserOutput,
} from "../src/index.js";
import { createParserResultFileAtomic } from "../src/publish/writer.ts";

const EXPECTED_REASON_KEYS = [
  "already_compacted",
  "incomplete_legacy_attempt",
  "invalid_attempt_path",
  "invalid_legacy_artifact",
  "invalid_legacy_manifest",
  "legacy_path_mismatch",
  "result_mismatch",
  "unexpected_attempt_entry",
  "unsafe_filesystem_entry",
];

test("legacy parser attempt compaction is explicit, exact, and idempotent", async () => {
  const vaultRoot = await makeVault("murph-parser-legacy-compact");
  const output = buildOutput("cap_compact", "att_compact", {
    tables: [{ id: "table_1", rows: [["name", "value"], ["protein", "31g"]] }],
  });
  const attemptDirectoryPath = attemptPath(output, 1);
  const legacyPaths = await writeLegacyAttempt(vaultRoot, attemptDirectoryPath, output);

  const dryRun = await compactLegacyParserAttempts({ vaultRoot });
  assert.equal(dryRun.mode, "dry-run");
  assert.equal(dryRun.mutated, false);
  assert.equal(dryRun.scannedAttemptCount, 1);
  assert.equal(dryRun.eligibleAttemptCount, 1);
  assert.equal(dryRun.compactedAttemptCount, 0);
  assert.equal(dryRun.deletedFileCount, 0);
  assert.deepEqual(Object.keys(dryRun.reasons).sort(), EXPECTED_REASON_KEYS);
  for (const legacyPath of legacyPaths) {
    await fs.access(path.join(vaultRoot, legacyPath));
  }
  await assert.rejects(fs.access(path.join(vaultRoot, attemptDirectoryPath, "result.json")));

  const applied = await compactLegacyParserAttempts({ vaultRoot, apply: true });
  assert.equal(applied.mode, "apply");
  assert.equal(applied.mutated, true);
  assert.equal(applied.eligibleAttemptCount, 1);
  assert.equal(applied.compactedAttemptCount, 1);
  assert.equal(applied.deletedFileCount, 5);

  const resultPath = `${attemptDirectoryPath}/result.json`;
  assert.deepEqual(await fs.readdir(path.join(vaultRoot, attemptDirectoryPath)), ["result.json"]);
  assert.equal((await fs.stat(path.join(vaultRoot, resultPath))).mode & 0o777, 0o600);
  assert.deepEqual(await readParserResult({ vaultRoot, resultPath }), output);
  for (const legacyPath of legacyPaths) {
    await assert.rejects(fs.access(path.join(vaultRoot, legacyPath)));
  }

  const repeated = await compactLegacyParserAttempts({ vaultRoot, apply: true });
  assert.equal(repeated.mutated, false);
  assert.equal(repeated.scannedAttemptCount, 1);
  assert.equal(repeated.eligibleAttemptCount, 0);
  assert.equal(repeated.compactedAttemptCount, 0);
  assert.equal(repeated.deletedFileCount, 0);
  assert.equal(repeated.reasons.already_compacted, 1);
  assert.deepEqual(await readParserResult({ vaultRoot, resultPath }), output);
});

test("parser result exclusive creation preserves the first valid result", async () => {
  const vaultRoot = await makeVault("murph-parser-result-exclusive");
  const output = buildOutput("cap_exclusive", "att_exclusive");
  const conflictingOutput = { ...output, text: "conflicting text" };
  const attemptDirectoryPath = attemptPath(output, 1);
  const resultPath = `${attemptDirectoryPath}/result.json`;
  await fs.mkdir(path.join(vaultRoot, attemptDirectoryPath), { recursive: true, mode: 0o700 });

  assert.equal(
    await createParserResultFileAtomic({ vaultRoot, resultPath, output }),
    "created",
  );
  assert.equal(
    await createParserResultFileAtomic({ vaultRoot, resultPath, output }),
    "existing",
  );
  assert.equal(
    await createParserResultFileAtomic({ vaultRoot, resultPath, output: conflictingOutput }),
    "existing",
  );
  assert.deepEqual(await readParserResult({ vaultRoot, resultPath }), output);
  assert.deepEqual(await fs.readdir(path.join(vaultRoot, attemptDirectoryPath)), ["result.json"]);
});

test("concurrent legacy parser compaction never rolls back a consumed result", async () => {
  const vaultRoot = await makeVault("murph-parser-legacy-concurrent");
  const output = buildOutput("cap_concurrent", "att_concurrent");
  const attemptDirectoryPath = attemptPath(output, 1);
  const resultPath = `${attemptDirectoryPath}/result.json`;
  await writeLegacyAttempt(vaultRoot, attemptDirectoryPath, output);

  const originalLink = fs.link.bind(fs);
  let releaseCreator!: () => void;
  let markPublished!: () => void;
  const creatorRelease = new Promise<void>((resolve) => {
    releaseCreator = resolve;
  });
  const creatorPublished = new Promise<void>((resolve) => {
    markPublished = resolve;
  });
  let linkCalls = 0;
  const linkSpy = vi.spyOn(fs, "link").mockImplementation(async (existingPath, newPath) => {
    linkCalls += 1;
    if (linkCalls === 1) {
      await originalLink(existingPath, newPath);
      markPublished();
      await creatorRelease;
      return;
    }
    await creatorPublished;
    return originalLink(existingPath, newPath);
  });

  const creator = compactLegacyParserAttempts({ vaultRoot, apply: true });
  let creatorResult: Awaited<ReturnType<typeof compactLegacyParserAttempts>>;
  try {
    await creatorPublished;
    const consumer = await compactLegacyParserAttempts({ vaultRoot, apply: true });
    assert.equal(consumer.compactedAttemptCount, 1);
    releaseCreator();
    creatorResult = await creator;
  } finally {
    releaseCreator();
    linkSpy.mockRestore();
  }

  assert.equal(linkCalls, 1);
  assert.equal(creatorResult.compactedAttemptCount, 0);
  assert.equal(creatorResult.reasons.already_compacted, 1);
  assert.deepEqual(await fs.readdir(path.join(vaultRoot, attemptDirectoryPath)), ["result.json"]);
  assert.deepEqual(await readParserResult({ vaultRoot, resultPath }), output);

  const repeated = await compactLegacyParserAttempts({ vaultRoot, apply: true });
  assert.equal(repeated.mutated, false);
  assert.equal(repeated.reasons.already_compacted, 1);
});

test("concurrent legacy parser creators converge on one exclusive result", async () => {
  const vaultRoot = await makeVault("murph-parser-legacy-exclusive-race");
  const output = buildOutput("cap_exclusive_race", "att_exclusive_race");
  const attemptDirectoryPath = attemptPath(output, 1);
  const resultPath = `${attemptDirectoryPath}/result.json`;
  const absoluteResultPath = path.join(vaultRoot, resultPath);
  await writeLegacyAttempt(vaultRoot, attemptDirectoryPath, output);

  const originalLstat = fs.lstat.bind(fs);
  let releaseChecks!: () => void;
  let markChecksReady!: () => void;
  const checksRelease = new Promise<void>((resolve) => {
    releaseChecks = resolve;
  });
  const checksReady = new Promise<void>((resolve) => {
    markChecksReady = resolve;
  });
  let initialResultChecks = 0;
  const lstatSpy = vi.spyOn(fs, "lstat").mockImplementation(async (targetPath, options) => {
    if (String(targetPath) === absoluteResultPath && initialResultChecks < 2) {
      initialResultChecks += 1;
      if (initialResultChecks === 2) {
        markChecksReady();
      }
      await checksRelease;
    }
    return options === undefined
      ? originalLstat(targetPath)
      : originalLstat(targetPath, options);
  });

  const first = compactLegacyParserAttempts({ vaultRoot, apply: true });
  const second = compactLegacyParserAttempts({ vaultRoot, apply: true });
  let outcomes: Awaited<ReturnType<typeof compactLegacyParserAttempts>>[];
  try {
    await checksReady;
    releaseChecks();
    outcomes = await Promise.all([first, second]);
  } finally {
    releaseChecks();
    lstatSpy.mockRestore();
  }

  assert.equal(initialResultChecks, 2);
  assert.equal(
    outcomes.reduce((count, outcome) => count + outcome.compactedAttemptCount, 0),
    1,
  );
  assert.deepEqual(await fs.readdir(path.join(vaultRoot, attemptDirectoryPath)), ["result.json"]);
  assert.deepEqual(await readParserResult({ vaultRoot, resultPath }), output);

  const repeated = await compactLegacyParserAttempts({ vaultRoot, apply: true });
  assert.equal(repeated.mutated, false);
  assert.equal(repeated.reasons.already_compacted, 1);
});

test("legacy parser attempt compaction bounds each apply pass", async () => {
  const vaultRoot = await makeVault("murph-parser-legacy-bounded");
  const first = buildOutput("cap_bounded_a", "att_bounded_a");
  const second = buildOutput("cap_bounded_b", "att_bounded_b");
  await writeLegacyAttempt(vaultRoot, attemptPath(first, 1), first);
  await writeLegacyAttempt(vaultRoot, attemptPath(second, 1), second);

  const firstPass = await compactLegacyParserAttempts({
    apply: true,
    maxAttempts: 1,
    vaultRoot,
  });
  assert.equal(firstPass.eligibleAttemptCount, 2);
  assert.equal(firstPass.compactedAttemptCount, 1);
  assert.equal(firstPass.hasMore, true);

  const secondPass = await compactLegacyParserAttempts({
    apply: true,
    maxAttempts: 1,
    vaultRoot,
  });
  assert.equal(secondPass.eligibleAttemptCount, 1);
  assert.equal(secondPass.compactedAttemptCount, 1);
  assert.equal(secondPass.hasMore, false);
});

test("legacy parser attempt compaction resumes after partial legacy deletion", async () => {
  const vaultRoot = await makeVault("murph-parser-legacy-resume");
  const output = buildOutput("cap_resume", "att_resume", {
    tables: [{ id: "table_1", rows: [["name", "value"], ["protein", "31g"]] }],
  });
  const attemptDirectoryPath = attemptPath(output, 1);
  const legacyPaths = await writeLegacyAttempt(vaultRoot, attemptDirectoryPath, output);
  await writeExistingResult(vaultRoot, attemptDirectoryPath, output);
  await fs.unlink(path.join(vaultRoot, attemptDirectoryPath, "plain.txt"));
  await fs.unlink(path.join(vaultRoot, attemptDirectoryPath, "normalized.md"));

  const resumed = await compactLegacyParserAttempts({ vaultRoot, apply: true });
  assert.equal(resumed.mutated, true);
  assert.equal(resumed.eligibleAttemptCount, 1);
  assert.equal(resumed.compactedAttemptCount, 1);
  assert.equal(resumed.deletedFileCount, 3);

  const resultPath = `${attemptDirectoryPath}/result.json`;
  assert.deepEqual(await fs.readdir(path.join(vaultRoot, attemptDirectoryPath)), ["result.json"]);
  assert.deepEqual(await readParserResult({ vaultRoot, resultPath }), output);
  for (const legacyPath of legacyPaths) {
    await assert.rejects(fs.access(path.join(vaultRoot, legacyPath)));
  }
});

test("resumed legacy parser compaction rejects manifest, sidecar, and invalid result mismatches", async () => {
  const vaultRoot = await makeVault("murph-parser-legacy-resume-mismatch");

  const manifestMismatchOutput = buildOutput("cap_manifest_mismatch", "att_manifest_mismatch");
  const manifestMismatchAttempt = attemptPath(manifestMismatchOutput, 1);
  await writeLegacyAttempt(vaultRoot, manifestMismatchAttempt, manifestMismatchOutput);
  await writeExistingResult(vaultRoot, manifestMismatchAttempt, {
    ...manifestMismatchOutput,
    metadata: { pageCount: 99 },
  });
  await fs.unlink(path.join(vaultRoot, manifestMismatchAttempt, "plain.txt"));

  const sidecarMismatchOutput = buildOutput("cap_sidecar_mismatch", "att_sidecar_mismatch");
  const sidecarMismatchAttempt = attemptPath(sidecarMismatchOutput, 1);
  await writeLegacyAttempt(vaultRoot, sidecarMismatchAttempt, sidecarMismatchOutput);
  await writeExistingResult(vaultRoot, sidecarMismatchAttempt, sidecarMismatchOutput);
  await fs.unlink(path.join(vaultRoot, sidecarMismatchAttempt, "plain.txt"));
  await fs.writeFile(
    path.join(vaultRoot, sidecarMismatchAttempt, "normalized.md"),
    "## Different\n",
    "utf8",
  );

  const invalidResultOutput = buildOutput("cap_invalid_result", "att_invalid_result");
  const invalidResultAttempt = attemptPath(invalidResultOutput, 1);
  await writeLegacyAttempt(vaultRoot, invalidResultAttempt, invalidResultOutput);
  await fs.writeFile(path.join(vaultRoot, invalidResultAttempt, "result.json"), "{\n", "utf8");

  const summary = await compactLegacyParserAttempts({ vaultRoot, apply: true });
  assert.equal(summary.mutated, false);
  assert.equal(summary.scannedAttemptCount, 3);
  assert.equal(summary.eligibleAttemptCount, 0);
  assert.equal(summary.compactedAttemptCount, 0);
  assert.equal(summary.deletedFileCount, 0);
  assert.equal(summary.reasons.result_mismatch, 3);

  for (const attemptDirectoryPath of [
    manifestMismatchAttempt,
    sidecarMismatchAttempt,
    invalidResultAttempt,
  ]) {
    await fs.access(path.join(vaultRoot, attemptDirectoryPath, "manifest.json"));
    await fs.access(path.join(vaultRoot, attemptDirectoryPath, "result.json"));
  }
  assert.equal(
    await fs.readFile(path.join(vaultRoot, sidecarMismatchAttempt, "normalized.md"), "utf8"),
    "## Different\n",
  );
});

test("legacy parser compaction requires exact same-attempt paths and semantic result equality", async () => {
  const vaultRoot = await makeVault("murph-parser-legacy-strict");
  const pathMismatchOutput = buildOutput("cap_path_mismatch", "att_path_mismatch");
  const pathMismatchAttempt = attemptPath(pathMismatchOutput, 1);
  await writeLegacyAttempt(vaultRoot, pathMismatchAttempt, pathMismatchOutput, {
    plainTextPath: `${attemptPath(pathMismatchOutput, 2)}/plain.txt`,
  });

  const resultMismatchOutput = buildOutput("cap_result_mismatch", "att_result_mismatch");
  const resultMismatchAttempt = attemptPath(resultMismatchOutput, 1);
  const resultMismatchLegacyPaths = await writeLegacyAttempt(
    vaultRoot,
    resultMismatchAttempt,
    resultMismatchOutput,
  );
  const conflictingResult = {
    ...resultMismatchOutput,
    text: "different canonical result",
  };
  await fs.writeFile(
    path.join(vaultRoot, resultMismatchAttempt, "result.json"),
    `${JSON.stringify(conflictingResult, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  const summary = await compactLegacyParserAttempts({ vaultRoot, apply: true });
  assert.equal(summary.mutated, false);
  assert.equal(summary.scannedAttemptCount, 2);
  assert.equal(summary.eligibleAttemptCount, 0);
  assert.equal(summary.reasons.legacy_path_mismatch, 1);
  assert.equal(summary.reasons.result_mismatch, 1);
  await assert.rejects(fs.access(path.join(vaultRoot, pathMismatchAttempt, "result.json")));
  for (const legacyPath of resultMismatchLegacyPaths) {
    await fs.access(path.join(vaultRoot, legacyPath));
  }
  assert.deepEqual(
    await readParserResult({
      vaultRoot,
      resultPath: `${resultMismatchAttempt}/result.json`,
    }),
    conflictingResult,
  );
});

test("legacy parser compaction never follows symlinks or deletes unexpected attempt files", async () => {
  const vaultRoot = await makeVault("murph-parser-legacy-symlink");
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-parser-legacy-outside-"));
  const outsideFile = path.join(outsideRoot, "plain.txt");
  await fs.writeFile(outsideFile, "outside must survive\n", "utf8");

  const symlinkOutput = buildOutput("cap_symlink", "att_symlink");
  const symlinkAttempt = attemptPath(symlinkOutput, 1);
  await writeLegacyAttempt(vaultRoot, symlinkAttempt, symlinkOutput);
  const symlinkPlainPath = path.join(vaultRoot, symlinkAttempt, "plain.txt");
  await fs.unlink(symlinkPlainPath);
  await fs.symlink(outsideFile, symlinkPlainPath);

  const unexpectedOutput = buildOutput("cap_unexpected", "att_unexpected");
  const unexpectedAttempt = attemptPath(unexpectedOutput, 1);
  await writeLegacyAttempt(vaultRoot, unexpectedAttempt, unexpectedOutput);
  const unexpectedPath = path.join(vaultRoot, unexpectedAttempt, "notes.txt");
  await fs.writeFile(unexpectedPath, "preserve me", "utf8");

  const summary = await compactLegacyParserAttempts({ vaultRoot, apply: true });
  assert.equal(summary.mutated, false);
  assert.equal(summary.reasons.unsafe_filesystem_entry, 1);
  assert.equal(summary.reasons.unexpected_attempt_entry, 1);
  assert.equal(await fs.readFile(outsideFile, "utf8"), "outside must survive\n");
  assert.equal(await fs.readFile(unexpectedPath, "utf8"), "preserve me");
  await assert.rejects(fs.access(path.join(vaultRoot, symlinkAttempt, "result.json")));
  await assert.rejects(fs.access(path.join(vaultRoot, unexpectedAttempt, "result.json")));
});

async function makeVault(prefix: string): Promise<string> {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  await initializeVault({
    vaultRoot,
    createdAt: "2026-07-10T12:00:00.000Z",
  });
  return vaultRoot;
}

function buildOutput(
  captureId: string,
  attachmentId: string,
  overrides: Partial<ParserOutput> = {},
): ParserOutput {
  return {
    schema: "murph.parser-output.v1",
    providerId: "legacy-provider",
    artifact: {
      captureId,
      attachmentId,
      kind: "document",
      mime: "text/plain",
      fileName: "notes.txt",
      storedPath: `raw/inbox/2026/07/10/${captureId}/attachments/notes.txt`,
    },
    text: "alpha\nbeta",
    markdown: "## Notes\n\nalpha\nbeta",
    blocks: [
      { id: "block_1", kind: "paragraph", text: "alpha", order: 0 },
      { id: "block_2", kind: "paragraph", text: "beta", order: 1 },
    ],
    tables: [],
    metadata: { pageCount: 1 },
    createdAt: "2026-07-10T12:30:00.000Z",
    ...overrides,
  };
}

function attemptPath(output: ParserOutput, attempt: number): string {
  return [
    "derived",
    "inbox",
    output.artifact.captureId,
    "attachments",
    output.artifact.attachmentId,
    "attempts",
    String(attempt).padStart(4, "0"),
  ].join("/");
}

async function writeLegacyAttempt(
  vaultRoot: string,
  attemptDirectoryPath: string,
  output: ParserOutput,
  pathOverrides: Partial<{
    chunksPath: string;
    markdownPath: string;
    plainTextPath: string;
    tablesPath: string | null;
  }> = {},
): Promise<string[]> {
  const absoluteAttemptDirectory = path.join(vaultRoot, attemptDirectoryPath);
  await fs.mkdir(absoluteAttemptDirectory, { recursive: true, mode: 0o700 });
  const plainTextPath = `${attemptDirectoryPath}/plain.txt`;
  const markdownPath = `${attemptDirectoryPath}/normalized.md`;
  const chunksPath = `${attemptDirectoryPath}/chunks.jsonl`;
  const tablesPath = output.tables.length > 0 ? `${attemptDirectoryPath}/tables.json` : null;
  const manifestPath = `${attemptDirectoryPath}/manifest.json`;

  await fs.writeFile(path.join(vaultRoot, plainTextPath), `${output.text.trim()}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.writeFile(path.join(vaultRoot, markdownPath), `${output.markdown.trim()}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.writeFile(
    path.join(vaultRoot, chunksPath),
    output.blocks.map((block) => JSON.stringify(block)).join("\n") +
      (output.blocks.length > 0 ? "\n" : ""),
    { encoding: "utf8", mode: 0o600 },
  );
  if (tablesPath) {
    await fs.writeFile(
      path.join(vaultRoot, tablesPath),
      `${JSON.stringify(output.tables, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }

  await fs.writeFile(
    path.join(vaultRoot, manifestPath),
    `${JSON.stringify(
      {
        schema: "murph.parser-manifest.v1",
        providerId: output.providerId,
        createdAt: output.createdAt,
        artifact: output.artifact,
        metadata: output.metadata,
        paths: {
          plainTextPath,
          markdownPath,
          chunksPath,
          tablesPath,
          ...pathOverrides,
        },
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  return [
    plainTextPath,
    markdownPath,
    chunksPath,
    ...(tablesPath ? [tablesPath] : []),
    manifestPath,
  ];
}

async function writeExistingResult(
  vaultRoot: string,
  attemptDirectoryPath: string,
  output: ParserOutput,
): Promise<void> {
  await fs.writeFile(
    path.join(vaultRoot, attemptDirectoryPath, "result.json"),
    `${JSON.stringify(output, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}
