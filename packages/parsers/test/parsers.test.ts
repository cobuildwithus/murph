import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { initializeVault } from "@healthybob/core";
import { createInboxPipeline, openInboxRuntime, rebuildRuntimeFromVault } from "@healthybob/inboxd";

import {
  createConfiguredParserRegistry,
  createInboxParserService,
  createParsedInboxPipeline,
  createPaddleOcrProvider,
  createParserRegistry,
  createPdfToTextProvider,
  createTextFileProvider,
  createWhisperCppProvider,
  discoverParserToolchain,
  getParserToolchainPaths,
  prepareAudioInput,
  readParserToolchainConfig,
  runAttachmentParseWorker,
  writeParserToolchainConfig,
  type ParserProvider,
} from "../src/index.js";
import {
  describeExecutableAvailability,
  resolveConfiguredExecutable,
  requireExecutable,
} from "../src/shared.js";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function writeExternalFile(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function writeExecutableFile(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = await writeExternalFile(directory, fileName, content);
  await fs.chmod(filePath, 0o755);
  return filePath;
}

test("audio preparation accepts WAV directly and requires ffmpeg for other audio formats", async () => {
  const directory = await makeTempDirectory("healthybob-parser-audio");
  const wavPath = await writeExternalFile(directory, "note.wav", "wav-bytes-placeholder");
  const wavPrepared = await prepareAudioInput({
    artifact: {
      captureId: "cap_audio_1",
      attachmentId: "att_audio_wav",
      kind: "audio",
      fileName: "note.wav",
      mime: "audio/wav",
      storedPath: "raw/inbox/example/note.wav",
      absolutePath: wavPath,
    },
    scratchDirectory: directory,
    ffmpeg: { commandCandidates: ["definitely-not-installed-ffmpeg"], allowSystemLookup: false },
  });

  assert.equal(wavPrepared.inputPath, wavPath);
  assert.equal(wavPrepared.preparedKind, "audio");

  const mp3Path = await writeExternalFile(directory, "note.mp3", "mp3-bytes-placeholder");
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_2",
        attachmentId: "att_audio_mp3",
        kind: "audio",
        fileName: "note.mp3",
        mime: "audio/mpeg",
        storedPath: "raw/inbox/example/note.mp3",
        absolutePath: mp3Path,
      },
      scratchDirectory: directory,
      ffmpeg: { commandCandidates: ["definitely-not-installed-ffmpeg"], allowSystemLookup: false },
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );
});

test("shared executable helpers preserve lazy resolution, availability, and missing-tool errors", async () => {
  const directory = await makeTempDirectory("healthybob-parser-executable");
  const executablePath = await writeExternalFile(directory, "fake-tool", "tool-placeholder");
  const previousCommand = process.env.HEALTHYBOB_TEST_COMMAND;

  try {
    process.env.HEALTHYBOB_TEST_COMMAND = executablePath;
    assert.equal(
      await resolveConfiguredExecutable({
        envValue: () => process.env.HEALTHYBOB_TEST_COMMAND,
      }),
      executablePath,
    );

    const available = describeExecutableAvailability({
      executablePath,
      availableReason: "tool available",
      missingReason: "tool missing",
    });
    assert.deepEqual(available, {
      available: true,
      reason: "tool available",
      executablePath,
    });

    process.env.HEALTHYBOB_TEST_COMMAND = "";
    assert.equal(
      await resolveConfiguredExecutable({
        envValue: () => process.env.HEALTHYBOB_TEST_COMMAND,
      }),
      null,
    );
    assert.deepEqual(
      describeExecutableAvailability({
        executablePath: null,
        availableReason: "tool available",
        missingReason: "tool missing",
      }),
      {
        available: false,
        reason: "tool missing",
      },
    );

    assert.equal(requireExecutable(executablePath, "tool missing"), executablePath);
    assert.throws(() => requireExecutable(null, "tool missing"), /tool missing/u);
  } finally {
    if (previousCommand === undefined) {
      delete process.env.HEALTHYBOB_TEST_COMMAND;
    } else {
      process.env.HEALTHYBOB_TEST_COMMAND = previousCommand;
    }
  }
});

test("parser toolchain config writes, reads, and drives local discovery", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-parser-toolchain");
  const toolsDirectory = await makeTempDirectory("healthybob-parser-toolchain-bin");
  const fakeToolPath = await writeExecutableFile(
    toolsDirectory,
    "fake-parser-tool",
    "#!/usr/bin/env node\nprocess.exit(0);\n",
  );

  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  const written = await writeParserToolchainConfig({
    vaultRoot,
    now: new Date("2026-03-13T12:34:56.000Z"),
    tools: {
      ffmpeg: {
        command: fakeToolPath,
      },
      whisper: {
        command: fakeToolPath,
        modelPath: "models/fake.bin",
      },
    },
  });

  assert.equal(written.config.updatedAt, "2026-03-13T12:34:56.000Z");
  assert.equal(written.configPath, getParserToolchainPaths(vaultRoot).configPath);

  const loaded = await readParserToolchainConfig(vaultRoot);
  assert.ok(loaded);
  assert.equal(loaded.config.tools.ffmpeg?.command, fakeToolPath);
  assert.equal(loaded.config.tools.whisper?.modelPath, "models/fake.bin");

  const doctor = await discoverParserToolchain({ vaultRoot });
  assert.equal(doctor.configPath, getParserToolchainPaths(vaultRoot).configPath);
  assert.deepEqual(doctor.tools.ffmpeg, {
    available: true,
    command: fakeToolPath,
    source: "config",
    reason: "ffmpeg CLI available.",
  });
  assert.deepEqual(doctor.tools.whisper, {
    available: true,
    command: fakeToolPath,
    modelPath: "models/fake.bin",
    source: "config",
    reason: "whisper.cpp CLI and model path configured.",
  });

  const configured = await createConfiguredParserRegistry({ vaultRoot });
  assert.equal(configured.doctor.tools.ffmpeg.command, fakeToolPath);
  assert.deepEqual(configured.ffmpeg, {
    commandCandidates: [fakeToolPath],
    allowSystemLookup: false,
  });

  await fs.rm(vaultRoot, { recursive: true, force: true });
  await fs.rm(toolsDirectory, { recursive: true, force: true });
});

test("pdftotext provider discovers explicit executables and parses PDF text output", async () => {
  const directory = await makeTempDirectory("healthybob-parser-pdftotext");
  const executablePath = await writeExecutableFile(
    directory,
    "fake-pdftotext",
    "#!/usr/bin/env node\nprocess.stdout.write('Page one\\fPage two\\n');\n",
  );
  const inputPath = await writeExternalFile(directory, "scan.pdf", "pdf-placeholder");
  const provider = createPdfToTextProvider({
    commandCandidates: [executablePath],
  });

  assert.deepEqual(await provider.discover(), {
    available: true,
    reason: "pdftotext CLI available.",
    executablePath,
  });
  assert.equal(
    provider.supports({
      intent: "attachment_text",
      artifact: {
        captureId: "cap_pdf_support",
        attachmentId: "att_pdf_support",
        kind: "document",
        fileName: "scan.pdf",
        mime: "application/pdf",
        storedPath: "raw/inbox/example/scan.pdf",
        absolutePath: inputPath,
      },
      inputPath,
      scratchDirectory: directory,
    }),
    true,
  );
  assert.equal(
    provider.supports({
      intent: "attachment_text",
      artifact: {
        captureId: "cap_text_support",
        attachmentId: "att_text_support",
        kind: "document",
        fileName: "note.txt",
        mime: "text/plain",
        storedPath: "raw/inbox/example/note.txt",
        absolutePath: inputPath,
      },
      inputPath,
      scratchDirectory: directory,
    }),
    false,
  );

  const result = await provider.run({
    intent: "attachment_text",
    artifact: {
      captureId: "cap_pdf_run",
      attachmentId: "att_pdf_run",
      kind: "document",
      fileName: "scan.pdf",
      mime: "application/pdf",
      storedPath: "raw/inbox/example/scan.pdf",
      absolutePath: inputPath,
    },
    inputPath,
    scratchDirectory: directory,
  });

  assert.equal(result.text, "Page one\fPage two");
  assert.equal(result.metadata?.pageCount, 2);
  assert.match(result.markdown ?? "", /Page one/u);
});

test("whisper.cpp provider reports missing model paths and parses transcript artifacts", async () => {
  const directory = await makeTempDirectory("healthybob-parser-whisper");
  const executablePath = await writeExecutableFile(
    directory,
    "fake-whisper",
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const outputBase = args[args.indexOf('-of') + 1];",
      "fs.writeFileSync(`${outputBase}.txt`, 'hello from whisper\\n', 'utf8');",
      "fs.writeFileSync(",
      "  `${outputBase}.srt`,",
      "  '1\\n00:00:00,000 --> 00:00:01,500\\nhello there\\n\\n2\\n00:00:01,500 --> 00:00:03,000\\ngeneral kenobi\\n',",
      "  'utf8',",
      ");",
    ].join("\n"),
  );
  const inputPath = await writeExternalFile(directory, "voice-note.wav", "wav-placeholder");

  const missingModelProvider = createWhisperCppProvider({
    commandCandidates: [executablePath],
  });
  assert.deepEqual(await missingModelProvider.discover(), {
    available: false,
    reason: "Whisper model path is not configured.",
    executablePath,
  });

  const provider = createWhisperCppProvider({
    commandCandidates: [executablePath],
    modelPath: "models/fake.bin",
    language: "en",
  });
  assert.deepEqual(await provider.discover(), {
    available: true,
    reason: "whisper.cpp CLI and model path configured.",
    executablePath,
    details: {
      modelPath: "models/fake.bin",
    },
  });

  const result = await provider.run({
    intent: "attachment_text",
    artifact: {
      captureId: "cap_audio_run",
      attachmentId: "att_audio_run",
      kind: "audio",
      fileName: "voice-note.wav",
      mime: "audio/wav",
      storedPath: "raw/inbox/example/voice-note.wav",
      absolutePath: inputPath,
    },
    inputPath,
    scratchDirectory: directory,
  });

  assert.equal(result.text, "hello from whisper");
  assert.equal(result.blocks?.length, 2);
  assert.equal(result.blocks?.[0]?.text, "hello there");
  assert.equal(result.blocks?.[1]?.text, "general kenobi");
  assert.equal(result.metadata?.durationMs, 3000);
  assert.equal(result.metadata?.language, "en");
});

test("whisper.cpp provider derives transcript text from SRT artifacts when TXT is absent", async () => {
  const directory = await makeTempDirectory("healthybob-parser-whisper-srt-only");
  const executablePath = await writeExecutableFile(
    directory,
    "fake-whisper-srt-only",
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const outputBase = args[args.indexOf('-of') + 1];",
      "fs.writeFileSync(",
      "  `${outputBase}.srt`,",
      "  '1\\n00:00:00,000 --> 00:00:01,250\\nalpha\\n\\n2\\n00:00:01,250 --> 00:00:02,500\\nbeta\\n',",
      "  'utf8',",
      ");",
      "process.stdout.write('stdout noise');",
      "process.stderr.write('stderr noise');",
    ].join("\n"),
  );
  const inputPath = await writeExternalFile(directory, "voice-note.wav", "wav-placeholder");
  const provider = createWhisperCppProvider({
    commandCandidates: [executablePath],
    modelPath: "models/fake.bin",
  });

  const result = await provider.run({
    intent: "attachment_text",
    artifact: {
      captureId: "cap_audio_srt_only",
      attachmentId: "att_audio_srt_only",
      kind: "audio",
      fileName: "voice-note.wav",
      mime: "audio/wav",
      storedPath: "raw/inbox/example/voice-note.wav",
      absolutePath: inputPath,
    },
    inputPath,
    scratchDirectory: directory,
  });

  assert.equal(result.text, "alpha beta");
  assert.doesNotMatch(result.text, /stdout noise/u);
  assert.doesNotMatch(result.text, /stderr noise/u);
  assert.equal(result.blocks?.length, 2);
  assert.equal(result.blocks?.[0]?.text, "alpha");
  assert.equal(result.blocks?.[1]?.text, "beta");
  assert.equal(result.metadata?.durationMs, 2500);
});

test("whisper.cpp provider rejects stdout-only logs when no transcript artifact is written", async () => {
  const directory = await makeTempDirectory("healthybob-parser-whisper-logs");
  const audioPath = await writeExternalFile(directory, "note.wav", "wav-bytes-placeholder");
  const modelPath = await writeExternalFile(directory, "ggml-base.en.bin", "model-placeholder");
  const commandPath = await writeExecutableFile(
    directory,
    "fake-whisper.sh",
    ['#!/usr/bin/env bash', 'echo "whisper.cpp: loaded model"', "exit 0"].join("\n"),
  );
  const provider = createWhisperCppProvider({
    commandCandidates: [commandPath],
    modelPath,
  });

  await assert.rejects(
    provider.run({
      intent: "attachment_text",
      artifact: {
        captureId: "cap_whisper_logs",
        attachmentId: "att_whisper_logs",
        kind: "audio",
        fileName: "note.wav",
        mime: "audio/wav",
        storedPath: "raw/inbox/example/note.wav",
        absolutePath: audioPath,
      },
      inputPath: audioPath,
      scratchDirectory: directory,
    }),
    /whisper\.cpp did not produce a transcript file/u,
  );
});

test("PaddleOCR provider discovers explicit executables and harvests OCR artifacts", async () => {
  const directory = await makeTempDirectory("healthybob-parser-paddleocr");
  const executablePath = await writeExecutableFile(
    directory,
    "fake-paddleocr",
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const outputArg = process.argv.slice(2).find((arg) => arg.startsWith('--output='));",
      "const outputDirectory = outputArg ? outputArg.slice('--output='.length) : process.cwd();",
      "fs.mkdirSync(outputDirectory, { recursive: true });",
      "fs.writeFileSync(path.join(outputDirectory, 'page1.md'), '# Receipt\\n\\nMilk\\n', 'utf8');",
      "fs.writeFileSync(path.join(outputDirectory, 'page1.txt'), 'Milk\\nEggs\\n', 'utf8');",
      "fs.writeFileSync(",
      "  path.join(outputDirectory, 'page1.json'),",
      "  JSON.stringify({ markdownText: '## Extra', rec_texts: ['Scanned', 'text'], tableRows: [['Item', 'Qty'], ['Milk', '1']] }),",
      "  'utf8',",
      ");",
      "process.stdout.write('stdout ocr');",
    ].join("\n"),
  );
  const inputPath = await writeExternalFile(directory, "receipt.png", "png-placeholder");
  const provider = createPaddleOcrProvider({
    commandCandidates: [executablePath],
  });

  assert.deepEqual(await provider.discover(), {
    available: true,
    reason: "PaddleOCR CLI available.",
    executablePath,
  });
  assert.equal(
    provider.supports({
      intent: "attachment_text",
      artifact: {
        captureId: "cap_image_support",
        attachmentId: "att_image_support",
        kind: "image",
        fileName: "receipt.png",
        mime: "image/png",
        storedPath: "raw/inbox/example/receipt.png",
        absolutePath: inputPath,
      },
      inputPath,
      scratchDirectory: directory,
    }),
    true,
  );

  const result = await provider.run({
    intent: "attachment_text",
    artifact: {
      captureId: "cap_image_run",
      attachmentId: "att_image_run",
      kind: "image",
      fileName: "receipt.png",
      mime: "image/png",
      storedPath: "raw/inbox/example/receipt.png",
      absolutePath: inputPath,
    },
    inputPath,
    scratchDirectory: directory,
  });

  assert.match(result.text, /Milk/u);
  assert.match(result.text, /Scanned text/u);
  assert.doesNotMatch(result.text, /stdout ocr/u);
  assert.equal(result.tables?.length, 1);
  assert.deepEqual(result.tables?.[0]?.rows, [
    ["Item", "Qty"],
    ["Milk", "1"],
  ]);
  assert.equal(result.metadata?.pageCount, 2);
});

test("PaddleOCR provider rejects stdout-only logs when no structured output files are written", async () => {
  const directory = await makeTempDirectory("healthybob-parser-paddle-logs");
  const imagePath = await writeExternalFile(directory, "scan.png", "image-placeholder");
  const commandPath = await writeExecutableFile(
    directory,
    "fake-paddle.sh",
    ['#!/usr/bin/env bash', 'echo "INFO: OCR complete"', "exit 0"].join("\n"),
  );
  const provider = createPaddleOcrProvider({
    commandCandidates: [commandPath],
  });

  await assert.rejects(
    provider.run({
      intent: "attachment_text",
      artifact: {
        captureId: "cap_paddle_logs",
        attachmentId: "att_paddle_logs",
        kind: "image",
        fileName: "scan.png",
        mime: "image/png",
        storedPath: "raw/inbox/example/scan.png",
        absolutePath: imagePath,
      },
      inputPath: imagePath,
      scratchDirectory: directory,
    }),
    /PaddleOCR did not produce extractable text/u,
  );
});

test("registry prefers built-in text parsing for markdown documents", async () => {
  const directory = await makeTempDirectory("healthybob-parser-registry");
  const filePath = await writeExternalFile(directory, "note.md", "# Breakfast\n\nEggs and toast");
  const registry = createParserRegistry([
    {
      id: "fallback-doc-parser",
      locality: "local",
      openness: "open_source",
      runtime: "cli",
      priority: 50,
      async discover() {
        return {
          available: true,
          reason: "available",
        };
      },
      supports() {
        return true;
      },
      async run() {
        return {
          text: "fallback",
        };
      },
    },
    createTextFileProvider(),
  ]);

  const selection = await registry.select({
    intent: "attachment_text",
    artifact: {
      captureId: "cap_1",
      attachmentId: "att_1",
      kind: "document",
      fileName: "note.md",
      mime: "text/markdown",
      storedPath: "raw/inbox/example/note.md",
      absolutePath: filePath,
    },
    inputPath: filePath,
    scratchDirectory: directory,
  });

  assert.equal(selection.provider.id, "text-file");
});

test("registry falls through to the next available provider when a higher-ranked provider fails", async () => {
  const directory = await makeTempDirectory("healthybob-parser-fallback");
  const filePath = await writeExternalFile(directory, "scan.pdf", "pdf-placeholder");
  const registry = createParserRegistry([
    {
      id: "native-pdf",
      locality: "local",
      openness: "open_source",
      runtime: "cli",
      priority: 900,
      async discover() {
        return { available: true, reason: "available" };
      },
      supports() {
        return true;
      },
      async run() {
        throw new Error("no extractable text");
      },
    },
    {
      id: "ocr-fallback",
      locality: "local",
      openness: "open_source",
      runtime: "python",
      priority: 500,
      async discover() {
        return { available: true, reason: "available" };
      },
      supports() {
        return true;
      },
      async run() {
        return { text: "Recovered from OCR" };
      },
    },
  ]);

  const run = await registry.run({
    intent: "attachment_text",
    artifact: {
      captureId: "cap_pdf_1",
      attachmentId: "att_pdf_1",
      kind: "document",
      fileName: "scan.pdf",
      mime: "application/pdf",
      storedPath: "raw/inbox/example/scan.pdf",
      absolutePath: filePath,
    },
    inputPath: filePath,
    scratchDirectory: directory,
  });

  assert.equal(run.selection.provider.id, "ocr-fallback");
  assert.equal(run.result.text, "Recovered from OCR");
});

test("attachment parse worker consumes inbox jobs, writes derived artifacts, and updates runtime search", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-parser-worker-vault");
  const sourceRoot = await makeTempDirectory("healthybob-parser-worker-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "meal-photo.png", "image-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "imessage",
    externalId: "img-1",
    accountId: "self",
    thread: {
      id: "chat-1",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T11:00:00.000Z",
    text: null,
    attachments: [
      {
        kind: "image",
        mime: "image/png",
        originalPath: imagePath,
        fileName: "meal-photo.png",
      },
    ],
    raw: {},
  });
  const storedCapture = runtime.getCapture(capture.captureId);
  assert.ok(storedCapture);

  const fakeImageProvider: ParserProvider = {
    id: "fake-image-parser",
    locality: "local",
    openness: "open_source",
    runtime: "node",
    priority: 500,
    async discover() {
      return {
        available: true,
        reason: "fake provider available for tests",
      };
    },
    supports(request) {
      return (request.preparedKind ?? request.artifact.kind) === "image";
    },
    async run() {
      return {
        text: "Omelet with spinach and feta",
        markdown: "## OCR\n\nOmelet with spinach and feta",
        blocks: [
          {
            id: "blk_0001",
            kind: "paragraph",
            text: "Omelet with spinach and feta",
            order: 0,
          },
        ],
      };
    },
  };

  const registry = createParserRegistry([fakeImageProvider]);
  const results = await runAttachmentParseWorker({
    vaultRoot,
    runtime,
    registry,
    maxJobs: 1,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "succeeded");
  assert.equal(results[0]?.providerId, "fake-image-parser");
  assert.ok(results[0]?.manifestPath);
  assert.equal(results[0]?.job.state, "succeeded");
  assert.equal(results[0]?.job.resultPath, results[0]?.manifestPath);
  assert.equal(results[0]?.job.providerId, "fake-image-parser");

  const refreshed = runtime.getCapture(capture.captureId);
  assert.ok(refreshed);
  assert.equal(refreshed.attachments[0]?.parseState, "succeeded");
  assert.equal(refreshed.attachments[0]?.parserProviderId, "fake-image-parser");
  assert.equal(refreshed.attachments[0]?.derivedPath, results[0]?.manifestPath);
  assert.equal(refreshed.attachments[0]?.extractedText, "Omelet with spinach and feta");

  const hits = runtime.searchCaptures({
    text: "spinach",
    limit: 10,
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.captureId, capture.captureId);

  const manifestPath = path.join(vaultRoot, results[0]?.manifestPath ?? "");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
    providerId: string;
    paths: {
      plainTextPath: string;
      markdownPath: string;
      chunksPath: string;
    };
  };
  assert.equal(manifest.providerId, "fake-image-parser");
  const plainText = await fs.readFile(path.join(vaultRoot, manifest.paths.plainTextPath), "utf8");
  const markdown = await fs.readFile(path.join(vaultRoot, manifest.paths.markdownPath), "utf8");
  const chunks = await fs.readFile(path.join(vaultRoot, manifest.paths.chunksPath), "utf8");
  assert.match(plainText, /Omelet with spinach and feta/);
  assert.match(markdown, /## OCR/);
  assert.match(chunks, /Omelet with spinach and feta/);

  pipeline.close();
});

test("parser service forwards scoped drain and requeue filters to the runtime", async () => {
  const claimFilters: Array<Record<string, unknown> | undefined> = [];
  const requeueFilters: Array<Record<string, unknown> | undefined> = [];
  const runtime = {
    claimNextAttachmentParseJob(filters) {
      claimFilters.push(filters);
      return null;
    },
    requeueAttachmentParseJobs(filters) {
      requeueFilters.push(filters);
      return 2;
    },
  } as Pick<
    Awaited<ReturnType<typeof openInboxRuntime>>,
    "claimNextAttachmentParseJob" | "requeueAttachmentParseJobs"
  > as Awaited<ReturnType<typeof openInboxRuntime>>;

  const service = createInboxParserService({
    vaultRoot: "/tmp/ignored",
    runtime,
    registry: createParserRegistry([]),
  });

  assert.deepEqual(
    await service.drain({
      captureId: "cap_1",
      attachmentId: "att_1",
      maxJobs: 3,
    }),
    [],
  );
  assert.equal(
    await service.drainOnce({
      captureId: "cap_2",
    }),
    null,
  );
  assert.equal(
    service.requeue({
      attachmentId: "att_3",
      state: "failed",
    }),
    2,
  );
  assert.deepEqual(claimFilters, [
    {
      captureId: "cap_1",
      attachmentId: "att_1",
    },
    {
      captureId: "cap_2",
    },
  ]);
  assert.deepEqual(requeueFilters, [
    {
      attachmentId: "att_3",
      state: "failed",
    },
  ]);
});

test("attachment parse worker marks jobs failed when no provider is available", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-parser-worker-fail-vault");
  const sourceRoot = await makeTempDirectory("healthybob-parser-worker-fail-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "scan.png", "image-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "imessage",
    externalId: "img-fail-1",
    accountId: "self",
    thread: {
      id: "chat-fail-1",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T11:10:00.000Z",
    text: null,
    attachments: [
      {
        kind: "image",
        mime: "image/png",
        originalPath: imagePath,
        fileName: "scan.png",
      },
    ],
    raw: {},
  });

  const registry = createParserRegistry([]);
  const result = await runAttachmentParseWorker({
    vaultRoot,
    runtime,
    registry,
    maxJobs: 1,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.status, "failed");
  assert.equal(result[0]?.errorCode, "provider_unavailable");

  const refreshed = runtime.getCapture(capture.captureId);
  assert.ok(refreshed);
  assert.equal(refreshed.attachments[0]?.parseState, "failed");
  assert.equal(
    runtime.listAttachmentParseJobs({ captureId: capture.captureId })[0]?.state,
    "failed",
  );

  pipeline.close();
});

test("attachment parse worker can drain jobs scoped to a single capture", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-parser-worker-scoped-vault");
  const sourceRoot = await makeTempDirectory("healthybob-parser-worker-scoped-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const firstPath = await writeExternalFile(sourceRoot, "first.png", "first-image");
  const secondPath = await writeExternalFile(sourceRoot, "second.png", "second-image");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const first = await pipeline.processCapture({
    source: "imessage",
    externalId: "scoped-first",
    thread: {
      id: "chat-scoped",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T11:20:00.000Z",
    text: null,
    attachments: [
      {
        kind: "image",
        mime: "image/png",
        originalPath: firstPath,
        fileName: "first.png",
      },
    ],
    raw: {},
  });
  const second = await pipeline.processCapture({
    source: "imessage",
    externalId: "scoped-second",
    thread: {
      id: "chat-scoped",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T11:21:00.000Z",
    text: null,
    attachments: [
      {
        kind: "image",
        mime: "image/png",
        originalPath: secondPath,
        fileName: "second.png",
      },
    ],
    raw: {},
  });

  const registry = createParserRegistry([
    {
      id: "fake-image-parser",
      locality: "local",
      openness: "open_source",
      runtime: "node",
      priority: 500,
      async discover() {
        return {
          available: true,
          reason: "available for scoped worker test",
        };
      },
      supports(request) {
        return (request.preparedKind ?? request.artifact.kind) === "image";
      },
      async run() {
        return {
          text: "Scoped OCR text",
        };
      },
    },
  ]);

  const results = await runAttachmentParseWorker({
    vaultRoot,
    runtime,
    registry,
    maxJobs: 10,
    jobFilters: {
      captureId: first.captureId,
    },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "succeeded");
  assert.equal(results[0]?.job.captureId, first.captureId);
  assert.equal(runtime.getCapture(first.captureId)?.attachments[0]?.parseState, "succeeded");
  assert.equal(runtime.getCapture(second.captureId)?.attachments[0]?.parseState, "pending");

  pipeline.close();
});

test("parsed inbox pipeline auto-drains parser jobs for each processed capture", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-parsed-pipeline-vault");
  const sourceRoot = await makeTempDirectory("healthybob-parsed-pipeline-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "auto-parse.png", "image-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createParsedInboxPipeline({
    vaultRoot,
    runtime,
    registry: createParserRegistry([
      {
        id: "auto-image-parser",
        locality: "local",
        openness: "open_source",
        runtime: "node",
        priority: 500,
        async discover() {
          return {
            available: true,
            reason: "available for parsed pipeline test",
          };
        },
        supports(request) {
          return (request.preparedKind ?? request.artifact.kind) === "image";
        },
        async run() {
          return {
            text: "Auto-drained OCR text",
          };
        },
      },
    ]),
  });

  const capture = await pipeline.processCapture({
    source: "imessage",
    externalId: "auto-drain-1",
    thread: {
      id: "chat-auto-drain",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T11:30:00.000Z",
    text: null,
    attachments: [
      {
        kind: "image",
        mime: "image/png",
        originalPath: imagePath,
        fileName: "auto-parse.png",
      },
    ],
    raw: {},
  });

  const refreshed = runtime.getCapture(capture.captureId);
  assert.ok(refreshed);
  assert.equal(refreshed.attachments[0]?.parseState, "succeeded");
  assert.equal(refreshed.attachments[0]?.extractedText, "Auto-drained OCR text");
  assert.equal(
    runtime.listAttachmentParseJobs({
      captureId: capture.captureId,
      limit: 10,
    })[0]?.state,
    "succeeded",
  );

  pipeline.close();
});

test("parsed inbox pipeline stores captures even when auto-drain parsing fails", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-parsed-pipeline-failure-vault");
  const sourceRoot = await makeTempDirectory("healthybob-parsed-pipeline-failure-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "auto-fail.png", "image-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createParsedInboxPipeline({
    vaultRoot,
    runtime,
    registry: createParserRegistry([]),
  });

  const capture = await pipeline.processCapture({
    source: "imessage",
    externalId: "auto-drain-fail-1",
    thread: {
      id: "chat-auto-fail",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T11:31:00.000Z",
    text: null,
    attachments: [
      {
        kind: "image",
        mime: "image/png",
        originalPath: imagePath,
        fileName: "auto-fail.png",
      },
    ],
    raw: {},
  });

  const refreshed = runtime.getCapture(capture.captureId);
  assert.ok(refreshed);
  assert.equal(refreshed.attachments[0]?.parseState, "failed");
  assert.equal(refreshed.attachments[0]?.derivedPath ?? null, null);
  assert.equal(refreshed.attachments[0]?.extractedText ?? null, null);
  assert.equal(
    runtime.searchCaptures({
      text: "auto-drained",
      limit: 10,
    }).length,
    0,
  );
  assert.equal(
    runtime.listAttachmentParseJobs({
      captureId: capture.captureId,
      limit: 10,
    })[0]?.state,
    "failed",
  );

  pipeline.close();
});

test("attachment parse worker marks jobs failed when no provider can handle the attachment", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-parser-worker-failure-vault");
  const sourceRoot = await makeTempDirectory("healthybob-parser-worker-failure-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "unknown-image.png", "image-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "imessage",
    externalId: "img-fail-1",
    accountId: "self",
    thread: {
      id: "chat-fail-1",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T12:00:00.000Z",
    text: null,
    attachments: [
      {
        kind: "image",
        mime: "image/png",
        originalPath: imagePath,
        fileName: "unknown-image.png",
      },
    ],
    raw: {},
  });

  const results = await runAttachmentParseWorker({
    vaultRoot,
    runtime,
    registry: createParserRegistry([]),
    maxJobs: 1,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "failed");
  assert.equal(results[0]?.errorCode, "provider_unavailable");
  assert.match(results[0]?.errorMessage ?? "", /No parser provider available/u);

  const failedCapture = runtime.getCapture(capture.captureId);
  assert.ok(failedCapture);
  assert.equal(failedCapture.attachments[0]?.parseState, "failed");
  assert.equal(failedCapture.attachments[0]?.derivedPath ?? null, null);
  assert.equal(failedCapture.attachments[0]?.extractedText ?? null, null);

  const jobs = runtime.listAttachmentParseJobs({ captureId: capture.captureId, limit: 10 });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.state, "failed");
  assert.equal(jobs[0]?.errorCode, "provider_unavailable");

  pipeline.close();
});

test("attachment parse worker stores audio output as transcript text", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-parser-worker-audio-vault");
  const sourceRoot = await makeTempDirectory("healthybob-parser-worker-audio-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const audioPath = await writeExternalFile(sourceRoot, "voice-note.wav", "wav-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "imessage",
    externalId: "audio-1",
    accountId: "self",
    thread: {
      id: "chat-audio-1",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T12:05:00.000Z",
    text: null,
    attachments: [
      {
        kind: "audio",
        mime: "audio/wav",
        originalPath: audioPath,
        fileName: "voice-note.wav",
      },
    ],
    raw: {},
  });

  const fakeAudioProvider: ParserProvider = {
    id: "fake-audio-parser",
    locality: "local",
    openness: "open_source",
    runtime: "node",
    priority: 500,
    async discover() {
      return {
        available: true,
        reason: "fake provider available for tests",
      };
    },
    supports(request) {
      return (request.preparedKind ?? request.artifact.kind) === "audio";
    },
    async run() {
      return {
        text: "Remember to log breakfast",
      };
    },
  };

  const results = await runAttachmentParseWorker({
    vaultRoot,
    runtime,
    registry: createParserRegistry([fakeAudioProvider]),
    ffmpeg: { commandCandidates: ["definitely-not-installed-ffmpeg"], allowSystemLookup: false },
    maxJobs: 1,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "succeeded");

  const refreshed = runtime.getCapture(capture.captureId);
  assert.ok(refreshed);
  assert.equal(refreshed.attachments[0]?.parseState, "succeeded");
  assert.equal(refreshed.attachments[0]?.transcriptText, "Remember to log breakfast");
  assert.equal(refreshed.attachments[0]?.extractedText ?? null, null);

  const hits = runtime.searchCaptures({
    text: "breakfast",
    limit: 10,
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.captureId, capture.captureId);
  assert.match(hits[0]?.snippet ?? "", /Remember to log breakfast/u);

  pipeline.close();
});

test("successful parser results stay derived-only and rebuild re-enqueues work from raw evidence", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-parser-rebuild-vault");
  const sourceRoot = await makeTempDirectory("healthybob-parser-rebuild-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "receipt.png", "image-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "imessage",
    externalId: "img-rebuild-1",
    accountId: "self",
    thread: {
      id: "chat-rebuild-1",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T12:15:00.000Z",
    text: null,
    attachments: [
      {
        kind: "image",
        mime: "image/png",
        originalPath: imagePath,
        fileName: "receipt.png",
      },
    ],
    raw: {},
  });

  const registry = createParserRegistry([
    {
      id: "fake-derived-only-parser",
      locality: "local",
      openness: "open_source",
      runtime: "node",
      priority: 500,
      async discover() {
        return {
          available: true,
          reason: "available for rebuild test",
        };
      },
      supports(request) {
        return (request.preparedKind ?? request.artifact.kind) === "image";
      },
      async run() {
        return {
          text: "Distinct rebuild-only OCR text",
        };
      },
    },
  ]);

  const results = await runAttachmentParseWorker({
    vaultRoot,
    runtime,
    registry,
    maxJobs: 1,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "succeeded");

  const parsedCapture = runtime.getCapture(capture.captureId);
  assert.ok(parsedCapture);
  assert.equal(parsedCapture.attachments[0]?.parseState, "succeeded");
  assert.equal(parsedCapture.attachments[0]?.extractedText, "Distinct rebuild-only OCR text");
  assert.equal(
    runtime.searchCaptures({
      text: "rebuild-only",
      limit: 10,
    }).length,
    1,
  );

  pipeline.close();

  await fs.rm(path.join(vaultRoot, ".runtime"), { recursive: true, force: true });
  await fs.rm(path.join(vaultRoot, "derived"), { recursive: true, force: true });

  const rebuiltRuntime = await openInboxRuntime({ vaultRoot });
  await rebuildRuntimeFromVault({
    vaultRoot,
    runtime: rebuiltRuntime,
  });

  const rebuilt = rebuiltRuntime.getCapture(capture.captureId);
  assert.ok(rebuilt);
  assert.equal(rebuilt.attachments[0]?.parseState, "pending");
  assert.equal(rebuilt.attachments[0]?.derivedPath ?? null, null);
  assert.equal(rebuilt.attachments[0]?.extractedText ?? null, null);
  assert.equal(
    rebuiltRuntime.searchCaptures({
      text: "rebuild-only",
      limit: 10,
    }).length,
    0,
  );

  const jobs = rebuiltRuntime.listAttachmentParseJobs({ captureId: capture.captureId, limit: 10 });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.attachmentId, rebuilt.attachments[0]?.attachmentId);
  assert.equal(jobs[0]?.state, "pending");

  rebuiltRuntime.close();
});

test("attachment parse worker redacts local paths from stored failure messages", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-parser-worker-failure-vault");
  const sourceRoot = await makeTempDirectory("healthybob-parser-worker-failure-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "failure-image.png", "image-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "imessage",
    externalId: "img-failure-1",
    accountId: "self",
    thread: {
      id: "chat-failure",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T12:00:00.000Z",
    text: null,
    attachments: [
      {
        kind: "image",
        mime: "image/png",
        originalPath: imagePath,
        fileName: "failure-image.png",
      },
    ],
    raw: {},
  });

  const failingProvider: ParserProvider = {
    id: "failing-image-parser",
    locality: "local",
    openness: "open_source",
    runtime: "node",
    priority: 500,
    async discover() {
      return {
        available: true,
        reason: "available for failure test",
      };
    },
    supports() {
      return true;
    },
    async run() {
      throw new Error("failed to read /Users/example/private-input.png");
    },
  };

  const registry = createParserRegistry([failingProvider]);
  const results = await runAttachmentParseWorker({
    vaultRoot,
    runtime,
    registry,
    maxJobs: 1,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "failed");
  assert.equal(results[0]?.errorCode, "parser_failed");
  assert.equal(results[0]?.errorMessage?.includes("/Users/"), false);
  assert.equal(results[0]?.errorMessage?.includes("<REDACTED_PATH>"), true);

  const jobs = runtime.listAttachmentParseJobs({
    captureId: capture.captureId,
    limit: 10,
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.state, "failed");
  assert.equal(jobs[0]?.errorMessage?.includes("/Users/"), false);
  assert.equal(jobs[0]?.errorMessage?.includes("<REDACTED_PATH>"), true);

  pipeline.close();
});
