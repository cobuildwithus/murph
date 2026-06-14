import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { initializeVault } from "@murphai/core";
import { afterEach, test } from "vitest";

import * as parsers from "../src/index.js";
import { prepareAudioInput, resolveFfmpegCommand } from "../src/adapters/ffmpeg.js";
import { createPopplerPdfProvider } from "../src/adapters/poppler-pdf.js";
import { createTextFileProvider } from "../src/adapters/text-file.js";
import type { ParserArtifactRef } from "../src/contracts/artifact.js";
import type { ParserOutput, ProviderRunResult } from "../src/contracts/parse.js";
import type {
  AttachmentParseJobFinalizeResult,
  AttachmentParseJobRecord,
  FailAttachmentParseJobInput,
  ParserRuntimeStore,
  RequeueAttachmentParseJobsInput,
} from "../src/contracts/runtime.js";
import { resolveAttachmentArtifact } from "../src/pipelines/resolve-attachment-artifact.js";
import { createParserRegistry } from "../src/registry/registry.js";
import {
  assertVaultPathOnDisk,
  buildMarkdown,
  collectFilesRecursively,
  isTextLikeArtifact,
  normalizeRelativePath,
  readUtf8IfExists,
  redactSensitiveText,
  resetDirectory,
  resolveVaultRelativePath,
  runCommand,
  splitTextIntoBlocks,
  toArtifactSummary,
} from "../src/shared.js";
import {
  getParserToolchainPaths,
  readParserToolchainConfig,
  writeParserToolchainConfig,
} from "../src/toolchain/config.js";
import {
  discoverParserToolchain,
  ffmpegOptionsFromDoctor,
} from "../src/toolchain/discover.js";

const envSnapshot = {
  FFMPEG_COMMAND: process.env.FFMPEG_COMMAND,
  PDFINFO_COMMAND: process.env.PDFINFO_COMMAND,
  PDFTOTEXT_COMMAND: process.env.PDFTOTEXT_COMMAND,
  WHISPER_COMMAND: process.env.WHISPER_COMMAND,
  WHISPER_MODEL_PATH: process.env.WHISPER_MODEL_PATH,
  PATH: process.env.PATH,
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
  process.env.FFMPEG_COMMAND = envSnapshot.FFMPEG_COMMAND;
  process.env.PDFINFO_COMMAND = envSnapshot.PDFINFO_COMMAND;
  process.env.PDFTOTEXT_COMMAND = envSnapshot.PDFTOTEXT_COMMAND;
  process.env.WHISPER_COMMAND = envSnapshot.WHISPER_COMMAND;
  process.env.WHISPER_MODEL_PATH = envSnapshot.WHISPER_MODEL_PATH;
  process.env.PATH = envSnapshot.PATH;

  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function makeTempDirectory(name: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFile(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(directory, fileName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function writeExecutable(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = await writeFile(directory, fileName, content);
  await fs.chmod(filePath, 0o755);
  return filePath;
}

function buildArtifact(overrides: Partial<ParserArtifactRef> = {}): ParserArtifactRef {
  return {
    absolutePath: "/tmp/example.txt",
    attachmentId: "att_example",
    byteSize: 12,
    captureId: "cap_example",
    fileName: "example.txt",
    kind: "document",
    mime: "text/plain",
    sha256: "sha256-example",
    storedPath: "raw/inbox/example/example.txt",
    ...overrides,
  };
}

async function parseAttachmentWithProviderResult(
  result: ProviderRunResult,
): Promise<ParserOutput> {
  const directory = await makeTempDirectory("murph-parsers-parse-attachment");
  const inputPath = await writeFile(directory, "attachment.txt", "source text");
  const registry = createParserRegistry([
    {
      discover: async () => ({ available: true, reason: "available" }),
      id: "normalization-test-provider",
      locality: "local",
      openness: "open_source",
      priority: 100,
      run: async () => result,
      runtime: "node",
      supports: async () => true,
    },
  ]);

  const parsed = await parsers.parseAttachment({
    artifact: buildArtifact({ absolutePath: inputPath }),
    registry,
    scratchRoot: path.join(directory, "scratch"),
  });

  return parsed.output;
}

function providerResultForRuntimeValidation(value: unknown): ProviderRunResult {
  // These tests intentionally feed malformed provider payloads through the runtime parser boundary.
  return value as ProviderRunResult;
}

function createRuntimeStore(
  capture: ReturnType<ParserRuntimeStore["getCapture"]>,
): ParserRuntimeStore {
  const appliedResult: AttachmentParseJobFinalizeResult = {
    applied: true,
    job: {
      attempts: 1,
      attachmentId: "att_job",
      captureId: "cap_job",
      createdAt: "2026-04-09T00:00:00.000Z",
      jobId: "job_example",
      pipeline: "attachment_text",
      state: "pending",
    },
  };

  return {
    claimNextAttachmentParseJob(): AttachmentParseJobRecord | null {
      return null;
    },
    completeAttachmentParseJob(): AttachmentParseJobFinalizeResult {
      return appliedResult;
    },
    failAttachmentParseJob(_input: FailAttachmentParseJobInput): AttachmentParseJobFinalizeResult {
      return appliedResult;
    },
    getCapture(): typeof capture {
      return capture;
    },
    requeueAttachmentParseJobs(_filters?: RequeueAttachmentParseJobsInput): number {
      return 0;
    },
  };
}

test("parser barrel exports the default registry and key helpers", () => {
  const registry = parsers.createDefaultParserRegistry();
  assert.deepEqual(
    registry.providers.map((provider) => provider.id),
    ["text-file", "poppler.pdf", "zxing-wasm", "whisper.cpp"],
  );
  assert.equal(parsers.createParserRegistry, createParserRegistry);
  assert.equal(parsers.createPopplerPdfProvider, createPopplerPdfProvider);
  assert.equal(parsers.createTextFileProvider, createTextFileProvider);
});

test("text-file provider covers discovery, support, and run edge cases", async () => {
  const directory = await makeTempDirectory("murph-parsers-provider");
  const plainTextPath = await writeFile(directory, "notes.txt", "alpha\nbeta\n");
  const markdownPath = await writeFile(directory, "notes.md", "# heading\n\n- item");

  const textProvider = createTextFileProvider();
  assert.deepEqual(await textProvider.discover(), {
    available: true,
    reason: "Node filesystem reader is always available.",
  });
  assert.equal(
    textProvider.supports({
      artifact: buildArtifact({ absolutePath: plainTextPath, fileName: "notes.txt" }),
      inputPath: plainTextPath,
      intent: "attachment_text",
      scratchDirectory: directory,
    }),
    true,
  );
  assert.equal(
    textProvider.supports({
      artifact: buildArtifact({ kind: "audio", mime: "audio/wav" }),
      inputPath: plainTextPath,
      intent: "attachment_text",
      scratchDirectory: directory,
    }),
    false,
  );
  const plainResult = await textProvider.run({
    artifact: buildArtifact({ absolutePath: plainTextPath, fileName: "notes.txt" }),
    inputPath: plainTextPath,
    intent: "attachment_text",
    scratchDirectory: directory,
  });
  assert.equal(plainResult.markdown, "alpha\n\nbeta");
  const markdownResult = await textProvider.run({
    artifact: buildArtifact({ absolutePath: markdownPath, fileName: "notes.md", mime: "text/markdown" }),
    inputPath: markdownPath,
    intent: "attachment_text",
    scratchDirectory: directory,
  });
  assert.equal(markdownResult.markdown, "# heading\n\n- item");
});

test("parseAttachment preserves explicit normalized blocks, tables, metadata, and warnings", async () => {
  const output = await parseAttachmentWithProviderResult({
    blocks: [
      {
        confidence: 0,
        endMs: 12.5,
        id: "heading_1",
        kind: "heading",
        metadata: {
          flag: true,
          note: "kept",
          score: 0.25,
          source: null,
        },
        order: 0,
        page: 1,
        startMs: null,
        text: "Heading",
      },
      {
        confidence: 1,
        endMs: null,
        id: "table_1",
        kind: "table",
        order: 1,
        page: null,
        startMs: 13,
        text: "Rows",
      },
    ],
    markdown: "  # Heading  ",
    metadata: {
      durationMs: 12.5,
      language: "en",
      pageCount: null,
      warnings: [
        {
          code: "low_confidence",
          message: "Some extracted text had low confidence.",
        },
      ],
    },
    tables: [
      {
        id: "table_1",
        page: null,
        rows: [
          ["Name", "Value"],
          ["alpha", "1"],
        ],
      },
    ],
    text: "  Heading\nRows  ",
  });

  assert.equal(output.providerId, "normalization-test-provider");
  assert.equal(output.text, "Heading\nRows");
  assert.equal(output.markdown, "# Heading");
  assert.deepEqual(output.blocks, [
    {
      confidence: 0,
      endMs: 12.5,
      id: "heading_1",
      kind: "heading",
      metadata: {
        flag: true,
        note: "kept",
        score: 0.25,
        source: null,
      },
      order: 0,
      page: 1,
      startMs: null,
      text: "Heading",
    },
    {
      confidence: 1,
      endMs: null,
      id: "table_1",
      kind: "table",
      order: 1,
      page: null,
      startMs: 13,
      text: "Rows",
    },
  ]);
  assert.deepEqual(output.tables, [
    {
      id: "table_1",
      page: null,
      rows: [
        ["Name", "Value"],
        ["alpha", "1"],
      ],
    },
  ]);
  assert.deepEqual(output.metadata, {
    durationMs: 12.5,
    language: "en",
    pageCount: null,
    warnings: [
      {
        code: "low_confidence",
        message: "Some extracted text had low confidence.",
      },
    ],
  });
});

test("parseAttachment stops on aborts and forwards live signals to providers", async () => {
  const directory = await makeTempDirectory("murph-parsers-parse-attachment-signal");
  const inputPath = await writeFile(directory, "attachment.txt", "source text");
  const aborted = new AbortController();
  aborted.abort();
  let supportsCalls = 0;
  const registry = createParserRegistry([
    {
      discover: async () => ({ available: true, reason: "available" }),
      id: "signal-test-provider",
      locality: "local",
      openness: "open_source",
      priority: 100,
      run: async () => ({ metadata: {}, text: "should not run" }),
      runtime: "node",
      supports: async () => {
        supportsCalls += 1;
        return true;
      },
    },
  ]);

  await assert.rejects(
    parsers.parseAttachment({
      artifact: buildArtifact({ absolutePath: inputPath }),
      registry,
      scratchRoot: path.join(directory, "scratch-aborted"),
      signal: aborted.signal,
    }),
    /aborted/u,
  );
  assert.equal(supportsCalls, 0);

  const live = new AbortController();
  let providerSawSignal = false;
  const signalRegistry = createParserRegistry([
    {
      discover: async () => ({ available: true, reason: "available" }),
      id: "signal-test-provider",
      locality: "local",
      openness: "open_source",
      priority: 100,
      run: async (request) => {
        providerSawSignal = request.signal === live.signal;
        return { metadata: {}, text: "parsed" };
      },
      runtime: "node",
      supports: async () => true,
    },
  ]);

  const parsed = await parsers.parseAttachment({
    artifact: buildArtifact({ absolutePath: inputPath }),
    registry: signalRegistry,
    scratchRoot: path.join(directory, "scratch-live"),
    signal: live.signal,
  });
  assert.equal(parsed.output.text, "parsed");
  assert.equal(providerSawSignal, true);
});

test("parseAttachment rejects malformed provider output at normalization boundaries", async () => {
  const validBlock = {
    id: "block_1",
    kind: "paragraph",
    order: 0,
    text: "body",
  };
  const validTable = {
    id: "table_1",
    rows: [["cell"]],
  };
  const cases: Array<{
    name: string;
    result: unknown;
    message: RegExp;
  }> = [
    {
      message: /Parser provider result must be a plain object/u,
      name: "missing result object",
      result: null,
    },
    {
      message: /Parser text must be a string/u,
      name: "non-string text",
      result: { text: 123 },
    },
    {
      message: /Parser blocks must be an array/u,
      name: "non-array blocks",
      result: { blocks: "not blocks", text: "body" },
    },
    {
      message: /Parser blocks exceed/u,
      name: "too many blocks",
      result: { blocks: new Array(100_001).fill(validBlock), text: "body" },
    },
    {
      message: /unsupported kind/u,
      name: "unsupported block kind",
      result: { blocks: [{ ...validBlock, kind: "unsupported" }], text: "body" },
    },
    {
      message: /Parser block 1 order must be a non-negative integer/u,
      name: "invalid block order",
      result: { blocks: [{ ...validBlock, order: -1 }], text: "body" },
    },
    {
      message: /Parser block 1 confidence must be between 0 and 1/u,
      name: "invalid block confidence",
      result: { blocks: [{ ...validBlock, confidence: 1.5 }], text: "body" },
    },
    {
      message: /Parser tables must be an array/u,
      name: "non-array tables",
      result: { tables: "not tables", text: "body" },
    },
    {
      message: /Parser tables exceed/u,
      name: "too many tables",
      result: { tables: new Array(101).fill(validTable), text: "body" },
    },
    {
      message: /Parser table 1 rows must be an array/u,
      name: "non-array table rows",
      result: { tables: [{ id: "table_1", rows: "not rows" }], text: "body" },
    },
    {
      message: /Parser table 1 row 1 must be an array/u,
      name: "non-array table row",
      result: { tables: [{ id: "table_1", rows: ["not row"] }], text: "body" },
    },
    {
      message: /Parser table 1 row 1 exceeds/u,
      name: "too many table columns",
      result: { tables: [{ id: "table_1", rows: [new Array(51).fill("cell")] }], text: "body" },
    },
    {
      message: /Parser table 1 row 1 cell 1 must be a string/u,
      name: "non-string table cell",
      result: { tables: [{ id: "table_1", rows: [[123]] }], text: "body" },
    },
    {
      message: /Parser metadata field "extra" is not supported/u,
      name: "unsupported top-level metadata",
      result: { metadata: { extra: true }, text: "body" },
    },
    {
      message: /Parser metadata warnings must be an array/u,
      name: "non-array warnings",
      result: { metadata: { warnings: "not warnings" }, text: "body" },
    },
    {
      message: /Parser metadata warnings exceed/u,
      name: "too many warnings",
      result: {
        metadata: {
          warnings: new Array(51).fill({ code: "warn", message: "warning" }),
        },
        text: "body",
      },
    },
    {
      message: /Parser warning 1 must be a plain object/u,
      name: "invalid warning entry",
      result: { metadata: { warnings: ["warning"] }, text: "body" },
    },
    {
      message: /Parser block 1 metadata exceeds/u,
      name: "too many block metadata keys",
      result: {
        blocks: [{
          ...validBlock,
          metadata: Object.fromEntries(
            Array.from({ length: 21 }, (_, index) => [`key_${index}`, index]),
          ),
        }],
        text: "body",
      },
    },
    {
      message: /Parser block 1 metadata contains an invalid metadata key/u,
      name: "invalid block metadata key",
      result: { blocks: [{ ...validBlock, metadata: { "": "empty" } }], text: "body" },
    },
    {
      message: /Parser block 1 metadata contains an unsupported metadata value/u,
      name: "unsupported block metadata value",
      result: { blocks: [{ ...validBlock, metadata: { nested: { value: true } } }], text: "body" },
    },
  ];

  for (const testCase of cases) {
    await assert.rejects(
      () => parseAttachmentWithProviderResult(providerResultForRuntimeValidation(testCase.result)),
      testCase.message,
      testCase.name,
    );
  }
});

test("ffmpeg helpers cover env lookup, system fallback, passthrough, and video failure paths", async () => {
  const directory = await makeTempDirectory("murph-parsers-ffmpeg");
  const systemBin = await makeTempDirectory("murph-parsers-ffmpeg-bin");
  const fakeFfmpeg = await writeExecutable(
    systemBin,
    process.platform === "win32" ? "ffmpeg.cmd" : "ffmpeg",
    [
      process.platform === "win32" ? "@echo off" : "#!/usr/bin/env node",
      process.platform === "win32"
        ? "set output=%9\r\necho wav> %output%"
        : "const fs = require('node:fs'); fs.writeFileSync(process.argv.at(-1), 'wav', 'utf8');",
    ].join("\n"),
  );
  const clipPath = await writeFile(directory, "clip.mov", "video-placeholder");
  const notePath = await writeFile(directory, "note.txt", "plain-placeholder");

  process.env.FFMPEG_COMMAND = fakeFfmpeg;
  assert.equal(await resolveFfmpegCommand(), fakeFfmpeg);

  process.env.FFMPEG_COMMAND = "";
  process.env.PATH = `${systemBin}${path.delimiter}${envSnapshot.PATH ?? ""}`;
  assert.equal(await resolveFfmpegCommand(), fakeFfmpeg);
  const preparedVideo = await prepareAudioInput({
    artifact: buildArtifact({
      absolutePath: clipPath,
      attachmentId: "att_video_ready",
      fileName: "clip.mov",
      kind: "video",
      mime: "video/quicktime",
    }),
    scratchDirectory: directory,
  });
  assert.equal(preparedVideo.preparedKind, "audio");
  assert.match(preparedVideo.inputPath, /att_video_ready\.wav$/u);

  assert.deepEqual(
    await prepareAudioInput({
      artifact: buildArtifact({ absolutePath: notePath, kind: "other" }),
      scratchDirectory: directory,
    }),
    { inputPath: notePath },
  );

  await assert.rejects(
    prepareAudioInput({
      artifact: buildArtifact({
        absolutePath: clipPath,
        attachmentId: "att_video",
        fileName: "clip.mov",
        kind: "video",
        mime: "video/quicktime",
      }),
      ffmpeg: { allowSystemLookup: false, commandCandidates: ["missing-ffmpeg"] },
      scratchDirectory: directory,
    }),
    /extract audio from video attachments/u,
  );
});

test("Poppler PDF provider extracts born-digital PDF text with page metadata", async () => {
  const directory = await makeTempDirectory("murph-parsers-poppler");
  const toolDirectory = await makeTempDirectory("murph-parsers-poppler-bin");
  const pdfPath = await writeFile(directory, "report.pdf", "%PDF-1.7\nfixture");
  const argsCapturePath = path.join(directory, "pdftotext-args.json");
  const pdfInfoCommand = await writeExecutable(
    toolDirectory,
    process.platform === "win32" ? "pdfinfo.cmd" : "pdfinfo",
    process.platform === "win32"
      ? "@echo off\r\necho Pages: 5\r\n"
      : "#!/usr/bin/env node\nprocess.stdout.write('Pages: 5\\n');\n",
  );
  const pdfToTextCommand = await writeExecutable(
    toolDirectory,
    process.platform === "win32" ? "pdftotext.cmd" : "pdftotext",
    process.platform === "win32"
      ? `@echo off\r\necho ["-enc","UTF-8","-f","1","-l","2","-nopgbrk","${pdfPath.replaceAll("\\", "\\\\")}","-"]> ${argsCapturePath}\r\necho FastReport lab panel\r\n`
      : [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          `fs.writeFileSync(${JSON.stringify(argsCapturePath)}, JSON.stringify(process.argv.slice(2)), 'utf8');`,
          "process.stdout.write('FastReport lab panel\\nResult row');",
        ].join("\n"),
  );
  const provider = createPopplerPdfProvider({
    maxPages: 2,
    pdfInfoCommandCandidates: [pdfInfoCommand],
    pdfToTextCommandCandidates: [pdfToTextCommand],
  });
  const request = {
    artifact: buildArtifact({
      absolutePath: pdfPath,
      fileName: "report.pdf",
      mime: "application/pdf",
    }),
    inputPath: pdfPath,
    intent: "attachment_text" as const,
    scratchDirectory: directory,
  };

  assert.equal(await provider.supports(request), true);
  assert.deepEqual(await provider.discover(), {
    available: true,
    executablePath: pdfToTextCommand,
    reason: "Poppler PDF text extraction tools available.",
  });

  const result = await provider.run(request);
  assert.match(result.text, /FastReport lab panel/u);
  assert.equal(result.metadata?.pageCount, 5);
  assert.deepEqual(result.metadata?.warnings, [{
    code: "pdf_page_limit",
    message: "PDF text extraction was limited to the first 2 pages.",
  }]);
  assert.deepEqual(JSON.parse(await fs.readFile(argsCapturePath, "utf8")), [
    "-enc",
    "UTF-8",
    "-f",
    "1",
    "-l",
    "2",
    "-nopgbrk",
    pdfPath,
    "-",
  ]);
  assert.equal(result.blocks?.[0]?.kind, "paragraph");

  await assert.rejects(
    createPopplerPdfProvider({
      maxInputBytes: 4,
      pdfInfoCommandCandidates: [pdfInfoCommand],
      pdfToTextCommandCandidates: [pdfToTextCommand],
    }).run(request),
    /PDF input exceeds parser limit/u,
  );

  const stdoutNoisyPdfToTextCommand = await writeExecutable(
    toolDirectory,
    process.platform === "win32" ? "pdftotext-stdout-noisy.cmd" : "pdftotext-stdout-noisy",
    process.platform === "win32"
      ? "@echo off\r\nnode -e \"process.stdout.write('x'.repeat(200000))\"\r\n"
      : "#!/usr/bin/env node\nprocess.stdout.write('x'.repeat(200000));\n",
  );
  await assert.rejects(
    createPopplerPdfProvider({
      commandTimeoutMs: 10_000,
      maxOutputBytes: 4,
      pdfInfoCommandCandidates: [pdfInfoCommand],
      pdfToTextCommandCandidates: [stdoutNoisyPdfToTextCommand],
    }).run(request),
    /stdout exceeded 4 bytes/u,
  );

  await assert.rejects(
    createPopplerPdfProvider({
      resolvedToolState: {
        available: false,
        pdfInfoCommandPath: null,
        pdfToTextCommandPath: null,
        reason: "pdfinfo CLI executable not found.",
      },
    }).run(request),
    /pdfinfo CLI executable not found/u,
  );
});

test("resolveAttachmentArtifact covers missing captures, missing attachments, and missing stored paths", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsers-artifact");
  await initializeVault({
    createdAt: "2026-04-09T00:00:00.000Z",
    vaultRoot,
  });
  const storedPath = "raw/inbox/example/attachment.txt";
  await writeFile(vaultRoot, storedPath, "artifact");

  await assert.rejects(
    resolveAttachmentArtifact({
      attachmentId: "att_missing",
      captureId: "cap_missing",
      runtime: createRuntimeStore(null),
      vaultRoot,
    }),
    /Unknown inbox capture/u,
  );

  await assert.rejects(
    resolveAttachmentArtifact({
      attachmentId: "att_missing",
      captureId: "cap_example",
      runtime: createRuntimeStore({
        attachments: [],
        captureId: "cap_example",
      }),
      vaultRoot,
    }),
    /Unknown inbox attachment/u,
  );

  await assert.rejects(
    resolveAttachmentArtifact({
      attachmentId: "att_example",
      captureId: "cap_example",
      runtime: createRuntimeStore({
        attachments: [{ attachmentId: "att_example", kind: "document" }],
        captureId: "cap_example",
      }),
      vaultRoot,
    }),
    /does not have a stored path/u,
  );

  const artifact = await resolveAttachmentArtifact({
    attachmentId: "att_example",
    captureId: "cap_example",
    runtime: createRuntimeStore({
      attachments: [{
        attachmentId: "att_example",
        byteSize: 8,
        fileName: "attachment.txt",
        kind: "document",
        mime: "text/plain",
        sha256: "sha-example",
        storedPath,
      }],
      captureId: "cap_example",
    }),
    vaultRoot,
  });
  assert.equal(artifact.absolutePath, path.join(vaultRoot, storedPath));
});

test("parser registry sorts candidates, retries failures, and reports unavailable selections", async () => {
  const request = {
    artifact: buildArtifact(),
    inputPath: "/tmp/example.txt",
    intent: "attachment_text" as const,
    scratchDirectory: "/tmp",
  };

  let flakyAttempts = 0;
  const registry = createParserRegistry([
    {
      discover: async () => ({ available: true, reason: "available" }),
      id: "flaky",
      locality: "local",
      openness: "open_source",
      priority: 900,
      run: async () => {
        flakyAttempts += 1;
        throw new Error("flaky failure");
      },
      runtime: "node",
      supports: async () => true,
    },
    {
      discover: async () => ({ available: true, reason: "available" }),
      id: "steady",
      locality: "local",
      openness: "open_source",
      priority: 800,
      run: async () => ({ blocks: [], metadata: {}, text: "steady result" }),
      runtime: "node",
      supports: async () => true,
    },
    {
      discover: async () => ({ available: false, reason: "missing" }),
      id: "missing",
      locality: "local",
      openness: "open_source",
      priority: 1_000,
      run: async () => ({ blocks: [], metadata: {}, text: "should not run" }),
      runtime: "node",
      supports: async () => true,
    },
  ]);

  const candidates = await registry.listCandidates(request);
  assert.deepEqual(candidates.map((candidate) => candidate.provider.id), ["flaky", "steady"]);
  const run = await registry.run(request);
  assert.equal(flakyAttempts, 1);
  assert.equal(run.selection.provider.id, "steady");
  assert.equal(run.result.text, "steady result");

  await assert.rejects(
    createParserRegistry([
      {
        discover: async () => ({ available: false, reason: "missing" }),
        id: "none",
        locality: "local",
        openness: "open_source",
        priority: 1,
        run: async () => ({ blocks: [], metadata: {}, text: "noop" }),
        runtime: "node",
        supports: async () => true,
      },
    ]).select(request),
    /No parser provider available/u,
  );

  await assert.rejects(
    createParserRegistry([
      {
        discover: async () => ({ available: true, reason: "available" }),
        id: "fails-1",
        locality: "local",
        openness: "open_source",
        priority: 2,
        run: async () => {
          throw new Error("first");
        },
        runtime: "node",
        supports: async () => true,
      },
      {
        discover: async () => ({ available: true, reason: "available" }),
        id: "fails-2",
        locality: "local",
        openness: "open_source",
        priority: 1,
        run: async () => {
          throw new Error("second");
        },
        runtime: "node",
        supports: async () => true,
      },
    ]).run(request),
    /fails-1: first \| fails-2: second/u,
  );
});

test("shared parser helpers cover vault path guards, markdown shaping, and recursive file collection", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsers-shared");
  await initializeVault({
    createdAt: "2026-04-09T00:00:00.000Z",
    vaultRoot,
  });

  const nestedDirectory = path.join(vaultRoot, "derived", "knowledge");
  await resetDirectory(nestedDirectory);
  const nestedFile = await writeFile(vaultRoot, "derived/knowledge/page.md", "# Heading\n\n- item");
  assert.equal(await readUtf8IfExists(nestedFile), "# Heading\n\n- item");
  await assert.rejects(
    readUtf8IfExists(nestedFile, { maxBytes: 4 }),
    /exceeded 4 bytes/u,
  );
  assert.equal(await readUtf8IfExists(path.join(vaultRoot, "missing.txt")), null);
  assert.equal(normalizeRelativePath("derived/knowledge/page.md"), "derived/knowledge/page.md");
  await assert.rejects(
    assertVaultPathOnDisk(vaultRoot, path.join(vaultRoot, "..", "outside.txt")),
    /vault/u,
  );
  assert.equal(
    await resolveVaultRelativePath(vaultRoot, "derived/knowledge/page.md"),
    nestedFile,
  );

  const blocks = splitTextIntoBlocks("# Heading\n\n- item", {});
  assert.equal(blocks[0]?.kind, "heading");
  assert.equal(blocks[1]?.kind, "list_item");
  assert.equal(buildMarkdown("# Heading\n\n- item", blocks), "## # Heading\n\n- item");
  assert.equal(buildMarkdown("single line", []), "single line");
  assert.equal(isTextLikeArtifact("note.yaml", null), true);
  assert.equal(isTextLikeArtifact("photo.jpg", "image/jpeg"), false);

  const recursiveFiles = await collectFilesRecursively(path.join(vaultRoot, "derived"));
  assert.deepEqual(recursiveFiles, [nestedFile]);
  assert.deepEqual(toArtifactSummary(buildArtifact()), {
    attachmentId: "att_example",
    captureId: "cap_example",
    fileName: "example.txt",
    kind: "document",
    mime: "text/plain",
    storedPath: "raw/inbox/example/example.txt",
  });
  assert.equal(
    redactSensitiveText("see /Users/demo/secret/report.txt and keep the rest"),
    "see <REDACTED_PATH> and keep the rest",
  );

  const commandDirectory = await makeTempDirectory("murph-parsers-run-command");
  const failingCommand = await writeExecutable(
    commandDirectory,
    "fail-command",
    "#!/usr/bin/env node\nprocess.stderr.write('/Users/demo/private/failure'); process.exit(1);\n",
  );
  await assert.rejects(
    runCommand(failingCommand, []),
    /<REDACTED_PATH>/u,
  );

  const hangingCommand = await writeExecutable(
    commandDirectory,
    "hang-command",
    "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n",
  );
  await assert.rejects(
    runCommand(hangingCommand, [], { timeoutMs: 10 }),
    /timed out/u,
  );

  if (process.platform !== "win32") {
    const descendantMarkerPath = path.join(commandDirectory, "descendant-survived.txt");
    const wrapperWithDescendant = await writeExecutable(
      commandDirectory,
      "spawn-descendant-command",
      [
        "#!/usr/bin/env node",
        "const { spawn } = require('node:child_process');",
        "const markerPath = process.argv[2];",
        "const childScript = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'alive'), 500); setInterval(() => {}, 1000);`;",
        "spawn(process.execPath, ['-e', childScript], { stdio: 'ignore' });",
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    );
    await assert.rejects(
      runCommand(wrapperWithDescendant, [descendantMarkerPath], { timeoutMs: 100 }),
      /timed out/u,
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    await assert.rejects(fs.access(descendantMarkerPath));

    const successfulDescendantMarkerPath = path.join(
      commandDirectory,
      "successful-descendant-survived.txt",
    );
    const successfulWrapperWithDescendant = await writeExecutable(
      commandDirectory,
      "spawn-successful-descendant-command",
      [
        "#!/usr/bin/env node",
        "const { spawn } = require('node:child_process');",
        "const markerPath = process.argv[2];",
        "const childScript = \"const markerPath = process.argv[1]; setTimeout(() => require('node:fs').writeFileSync(markerPath, 'alive'), 500); setInterval(() => {}, 1000);\";",
        "spawn(process.execPath, ['-e', childScript, markerPath], { stdio: 'ignore' }).unref();",
        "process.stdout.write('ok');",
      ].join("\n"),
    );
    await runCommand(successfulWrapperWithDescendant, [successfulDescendantMarkerPath]);
    await new Promise((resolve) => setTimeout(resolve, 800));
    await assert.rejects(fs.access(successfulDescendantMarkerPath));

    const failingDescendantMarkerPath = path.join(
      commandDirectory,
      "failing-descendant-survived.txt",
    );
    const failingWrapperWithDescendant = await writeExecutable(
      commandDirectory,
      "spawn-failing-descendant-command",
      [
        "#!/usr/bin/env node",
        "const { spawn } = require('node:child_process');",
        "const markerPath = process.argv[2];",
        "const childScript = \"const markerPath = process.argv[1]; setTimeout(() => require('node:fs').writeFileSync(markerPath, 'alive'), 500); setInterval(() => {}, 1000);\";",
        "spawn(process.execPath, ['-e', childScript, markerPath], { stdio: 'ignore' }).unref();",
        "process.stderr.write('failed');",
        "process.exit(2);",
      ].join("\n"),
    );
    await assert.rejects(
      runCommand(failingWrapperWithDescendant, [failingDescendantMarkerPath]),
      /failed/u,
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    await assert.rejects(fs.access(failingDescendantMarkerPath));
  }

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    runCommand(hangingCommand, [], { signal: aborted.signal }),
    /aborted/u,
  );

  const noisyCommand = await writeExecutable(
    commandDirectory,
    "noisy-command",
    "#!/usr/bin/env node\nprocess.stdout.write('0123456789');\n",
  );
  await assert.rejects(
    runCommand(noisyCommand, [], { maxStdoutBytes: 4 }),
    /stdout exceeded 4 bytes/u,
  );

  const noisyStderrCommand = await writeExecutable(
    commandDirectory,
    "noisy-stderr-command",
    "#!/usr/bin/env node\nprocess.stderr.write('0123456789');\n",
  );
  await assert.rejects(
    runCommand(noisyStderrCommand, [], { maxStderrBytes: 4 }),
    /stderr exceeded 4 bytes/u,
  );
});

test("parser toolchain config and discovery cover null reads, clearing updates, env sources, and missing sources", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsers-toolchain");
  const toolDirectory = await makeTempDirectory("murph-parsers-toolchain-bin");
  const modelDirectory = await makeTempDirectory("murph-parsers-toolchain-models");
  const ffmpegPath = await writeExecutable(
    toolDirectory,
    process.platform === "win32" ? "ffmpeg.cmd" : "ffmpeg",
    process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/usr/bin/env node\nprocess.exit(0);\n",
  );
  const whisperPath = await writeExecutable(
    toolDirectory,
    process.platform === "win32" ? "whisper-cli.cmd" : "whisper-cli",
    process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/usr/bin/env node\nprocess.exit(0);\n",
  );
  const pdfInfoPath = await writeExecutable(
    toolDirectory,
    process.platform === "win32" ? "pdfinfo.cmd" : "pdfinfo",
    process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/usr/bin/env node\nprocess.exit(0);\n",
  );
  const pdfToTextPath = await writeExecutable(
    toolDirectory,
    process.platform === "win32" ? "pdftotext.cmd" : "pdftotext",
    process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/usr/bin/env node\nprocess.exit(0);\n",
  );
  const modelPath = await writeFile(modelDirectory, "base.bin", "model");

  await initializeVault({
    createdAt: "2026-04-09T00:00:00.000Z",
    vaultRoot,
  });

  assert.equal(await readParserToolchainConfig(vaultRoot), null);

  await writeParserToolchainConfig({
    tools: {
      ffmpeg: { command: ffmpegPath },
      pdfinfo: { command: pdfInfoPath },
      pdftotext: { command: pdfToTextPath },
      whisper: { command: whisperPath, modelPath: "models/inside.bin" },
    },
    vaultRoot,
  });
  const merged = await writeParserToolchainConfig({
    tools: {
      ffmpeg: { command: null },
      whisper: { modelPath: null },
    },
    vaultRoot,
  });
  assert.equal(merged.config.tools.ffmpeg, undefined);
  assert.deepEqual(merged.config.tools.whisper, {
    command: whisperPath,
  });

  process.env.FFMPEG_COMMAND = ffmpegPath;
  process.env.WHISPER_COMMAND = whisperPath;
  process.env.WHISPER_MODEL_PATH = modelPath;
  process.env.PATH = `${toolDirectory}${path.delimiter}${envSnapshot.PATH ?? ""}`;

  const doctor = await discoverParserToolchain({ vaultRoot });
  assert.equal(doctor.configPath, getParserToolchainPaths(vaultRoot).configPath);
  assert.equal(doctor.tools.ffmpeg.source, "env");
  assert.equal(doctor.tools.ffmpeg.command, ffmpegPath);
  assert.equal(doctor.tools.pdfinfo.source, "config");
  assert.equal(doctor.tools.pdfinfo.command, pdfInfoPath);
  assert.equal(doctor.tools.pdftotext.source, "config");
  assert.equal(doctor.tools.pdftotext.command, pdfToTextPath);
  assert.equal(doctor.tools.whisper.source, "config");
  assert.equal(doctor.tools.whisper.modelPath, modelPath);
  assert.deepEqual(ffmpegOptionsFromDoctor(doctor), {
    allowSystemLookup: true,
    commandCandidates: [ffmpegPath],
  });

  delete process.env.FFMPEG_COMMAND;
  delete process.env.WHISPER_COMMAND;
  delete process.env.WHISPER_MODEL_PATH;
  process.env.PATH = envSnapshot.PATH;

  const emptyVaultRoot = await makeTempDirectory("murph-parsers-toolchain-empty");
  await initializeVault({
    createdAt: "2026-04-09T00:00:00.000Z",
    vaultRoot: emptyVaultRoot,
  });

  process.env.PATH = "";
  delete process.env.PDFINFO_COMMAND;
  delete process.env.PDFTOTEXT_COMMAND;
  const missingDoctor = await discoverParserToolchain({ vaultRoot: emptyVaultRoot });
  assert.equal(missingDoctor.tools.ffmpeg.source, "missing");
  assert.equal(missingDoctor.tools.ffmpeg.available, false);
  assert.equal(missingDoctor.tools.pdfinfo.source, "missing");
  assert.equal(missingDoctor.tools.pdfinfo.available, false);
  assert.equal(missingDoctor.tools.pdftotext.source, "missing");
  assert.equal(missingDoctor.tools.pdftotext.available, false);
  assert.equal(missingDoctor.tools.whisper.source, "missing");
  assert.equal(missingDoctor.tools.whisper.reason, "whisper.cpp CLI executable not found.");

  process.env.PATH = `${toolDirectory}${path.delimiter}${envSnapshot.PATH ?? ""}`;
  process.env.WHISPER_MODEL_PATH = modelPath;
  const envCompositeDoctor = await discoverParserToolchain({ vaultRoot: emptyVaultRoot });
  assert.equal(envCompositeDoctor.tools.whisper.source, "env");
  assert.equal(envCompositeDoctor.tools.whisper.available, true);

  delete process.env.WHISPER_MODEL_PATH;
  const systemCompositeDoctor = await discoverParserToolchain({ vaultRoot: emptyVaultRoot });
  assert.equal(systemCompositeDoctor.tools.whisper.source, "system");
  assert.equal(systemCompositeDoctor.tools.whisper.available, false);
  assert.equal(systemCompositeDoctor.tools.whisper.reason, "Whisper model path is not configured.");
});

test("ffmpeg options mark remote-only transcription so audio passthrough can skip WAV normalization", () => {
  const buildDoctor = (input: { ffmpeg?: boolean; transcription: boolean; whisper: boolean }) => ({
    configPath: "/vault/.runtime/parser-toolchain.json",
    discoveredAt: "2026-06-12T00:00:00.000Z",
    tools: {
      ffmpeg: {
        available: input.ffmpeg !== false,
        command: input.ffmpeg === false ? null : "/opt/tools/ffmpeg",
        source: input.ffmpeg === false ? ("missing" as const) : ("platform" as const),
        reason: input.ffmpeg === false ? "ffmpeg CLI not found." : "ffmpeg CLI available.",
      },
      pdfinfo: {
        available: false,
        command: null,
        source: "missing" as const,
        reason: "pdfinfo CLI not found.",
      },
      pdftotext: {
        available: false,
        command: null,
        source: "missing" as const,
        reason: "pdftotext CLI not found.",
      },
      transcription: {
        available: input.transcription,
        command: null,
        endpoint: input.transcription ? "http://murph-transcribe.worker/v1/transcribe" : null,
        source: input.transcription ? ("platform" as const) : ("missing" as const),
        reason: input.transcription
          ? "Remote transcription endpoint configured."
          : "Remote transcription endpoint is not configured.",
      },
      whisper: {
        available: input.whisper,
        command: input.whisper ? "/opt/tools/whisper-cli" : null,
        modelPath: input.whisper ? "/opt/models/base.bin" : null,
        source: input.whisper ? ("platform" as const) : ("missing" as const),
        reason: input.whisper
          ? "whisper.cpp CLI and model path configured."
          : "whisper.cpp CLI executable not found.",
      },
    },
  });

  assert.deepEqual(
    ffmpegOptionsFromDoctor(buildDoctor({ transcription: true, whisper: false })),
    {
      allowSystemLookup: false,
      commandCandidates: ["/opt/tools/ffmpeg"],
      remoteTranscriptionOnly: true,
    },
  );

  assert.deepEqual(
    ffmpegOptionsFromDoctor(buildDoctor({ ffmpeg: false, transcription: true, whisper: false })),
    { allowSystemLookup: false, remoteTranscriptionOnly: true },
  );

  // A usable local whisper lane needs 16 kHz WAV, so normalization stays on.
  assert.deepEqual(
    ffmpegOptionsFromDoctor(buildDoctor({ transcription: true, whisper: true })),
    {
      allowSystemLookup: false,
      commandCandidates: ["/opt/tools/ffmpeg"],
    },
  );

  assert.deepEqual(
    ffmpegOptionsFromDoctor(buildDoctor({ transcription: false, whisper: false })),
    {
      allowSystemLookup: false,
      commandCandidates: ["/opt/tools/ffmpeg"],
    },
  );

  // Local whisper without a remote endpoint never emits the flag either.
  assert.deepEqual(
    ffmpegOptionsFromDoctor(buildDoctor({ transcription: false, whisper: true })),
    {
      allowSystemLookup: false,
      commandCandidates: ["/opt/tools/ffmpeg"],
    },
  );
});
