import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { initializeVault } from "@murphai/core";
import { afterEach, test } from "vitest";

import * as parsers from "../src/index.js";
import { createPdfToTextProvider } from "../src/adapters/pdftotext.js";
import { prepareAudioInput, resolveFfmpegCommand } from "../src/adapters/ffmpeg.js";
import { createTextFileProvider } from "../src/adapters/text-file.js";
import type { ParserArtifactRef } from "../src/contracts/artifact.js";
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
  PDFTOTEXT_COMMAND: process.env.PDFTOTEXT_COMMAND,
  WHISPER_COMMAND: process.env.WHISPER_COMMAND,
  WHISPER_MODEL_PATH: process.env.WHISPER_MODEL_PATH,
  PATH: process.env.PATH,
};

afterEach(() => {
  process.env.FFMPEG_COMMAND = envSnapshot.FFMPEG_COMMAND;
  process.env.PDFTOTEXT_COMMAND = envSnapshot.PDFTOTEXT_COMMAND;
  process.env.WHISPER_COMMAND = envSnapshot.WHISPER_COMMAND;
  process.env.WHISPER_MODEL_PATH = envSnapshot.WHISPER_MODEL_PATH;
  process.env.PATH = envSnapshot.PATH;
});

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
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

function createRuntimeStore(
  capture: ParserRuntimeStore["getCapture"] extends (...args: unknown[]) => infer T ? T : never,
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
    ["text-file", "whisper.cpp", "pdftotext"],
  );
  assert.equal(parsers.createParserRegistry, createParserRegistry);
  assert.equal(parsers.createTextFileProvider, createTextFileProvider);
});

test("text-file and pdftotext providers cover discovery, support, and run edge cases", async () => {
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

  const emptyPdfTool = await writeExecutable(
    directory,
    "fake-pdftotext-empty",
    "#!/usr/bin/env node\nprocess.stdout.write('   ');\n",
  );
  const pdfPath = await writeFile(directory, "scan", "pdf-placeholder");
  const pdfProvider = createPdfToTextProvider({
    commandCandidates: [emptyPdfTool],
    extraArgs: ["-nopgbrk"],
  });
  assert.equal(
    pdfProvider.supports({
      artifact: buildArtifact({
        absolutePath: pdfPath,
        fileName: null,
        mime: "application/pdf",
      }),
      inputPath: pdfPath,
      intent: "attachment_text",
      scratchDirectory: directory,
    }),
    true,
  );
  await assert.rejects(
    pdfProvider.run({
      artifact: buildArtifact({
        absolutePath: pdfPath,
        fileName: "scan.pdf",
        mime: "application/pdf",
      }),
      inputPath: pdfPath,
      intent: "attachment_text",
      scratchDirectory: directory,
    }),
    /did not produce extractable text/u,
  );
  process.env.PDFTOTEXT_COMMAND = "";
  process.env.PATH = "";
  assert.deepEqual(await createPdfToTextProvider({
    commandCandidates: ["definitely-not-a-real-pdftotext"],
  }).discover(), {
    available: false,
    reason: "pdftotext CLI not found.",
  });
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
  const pdftotextPath = await writeExecutable(
    toolDirectory,
    process.platform === "win32" ? "pdftotext.cmd" : "pdftotext",
    process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/usr/bin/env node\nprocess.exit(0);\n",
  );
  const whisperPath = await writeExecutable(
    toolDirectory,
    process.platform === "win32" ? "whisper-cli.cmd" : "whisper-cli",
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
  process.env.PDFTOTEXT_COMMAND = "";
  process.env.WHISPER_COMMAND = whisperPath;
  process.env.WHISPER_MODEL_PATH = modelPath;
  process.env.PATH = `${toolDirectory}${path.delimiter}${envSnapshot.PATH ?? ""}`;

  const doctor = await discoverParserToolchain({ vaultRoot });
  assert.equal(doctor.configPath, getParserToolchainPaths(vaultRoot).configPath);
  assert.equal(doctor.tools.ffmpeg.source, "env");
  assert.equal(doctor.tools.ffmpeg.command, ffmpegPath);
  assert.equal(doctor.tools.pdftotext.source, "system");
  assert.equal(doctor.tools.pdftotext.command, pdftotextPath);
  assert.equal(doctor.tools.whisper.source, "config");
  assert.equal(doctor.tools.whisper.modelPath, modelPath);
  assert.deepEqual(ffmpegOptionsFromDoctor(doctor), {
    allowSystemLookup: true,
    commandCandidates: [ffmpegPath],
  });

  delete process.env.FFMPEG_COMMAND;
  delete process.env.PDFTOTEXT_COMMAND;
  delete process.env.WHISPER_COMMAND;
  delete process.env.WHISPER_MODEL_PATH;
  process.env.PATH = envSnapshot.PATH;

  const emptyVaultRoot = await makeTempDirectory("murph-parsers-toolchain-empty");
  await initializeVault({
    createdAt: "2026-04-09T00:00:00.000Z",
    vaultRoot: emptyVaultRoot,
  });

  process.env.PATH = "";
  const missingDoctor = await discoverParserToolchain({ vaultRoot: emptyVaultRoot });
  assert.equal(missingDoctor.tools.ffmpeg.source, "missing");
  assert.equal(missingDoctor.tools.ffmpeg.available, false);
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
