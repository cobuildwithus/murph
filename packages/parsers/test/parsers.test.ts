import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { initializeVault } from "@murph/core";
import {
  createInboxPipeline,
  openInboxRuntime,
  rebuildRuntimeFromVault,
  type InboxRuntimeStore,
} from "@murph/inboxd";

import {
  createConfiguredParserRegistry,
  createInboxParserService,
  createParsedInboxPipeline,
  createParserRegistry,
  createPdfToTextProvider,
  createTextFileProvider,
  createWhisperCppProvider,
  discoverParserToolchain,
  getParserToolchainPaths,
  parseAttachment,
  prepareAudioInput,
  readParserToolchainConfig,
  runInboxDaemonWithParsers,
  runAttachmentParseJobOnce,
  runAttachmentParseWorker,
  writeParserArtifacts,
  writeParserToolchainConfig,
  type ParserProvider,
} from "../src/index.js";
import {
  describeExecutableAvailability,
  removeVaultDirectoryIfExists,
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
  const directory = await makeTempDirectory("murph-parser-audio");
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
  const directory = await makeTempDirectory("murph-parser-executable");
  const executablePath = await writeExternalFile(directory, "fake-tool", "tool-placeholder");
  const previousCommand = process.env.TEST_COMMAND;

  try {
    process.env.TEST_COMMAND = executablePath;
    assert.equal(
      await resolveConfiguredExecutable({
        envValue: () => process.env.TEST_COMMAND,
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

    process.env.TEST_COMMAND = "";
    assert.equal(
      await resolveConfiguredExecutable({
        envValue: () => process.env.TEST_COMMAND,
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
      delete process.env.TEST_COMMAND;
    } else {
      process.env.TEST_COMMAND = previousCommand;
    }
  }
});

test("parser toolchain config writes, reads, and drives local discovery", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-toolchain");
  const toolsDirectory = await makeTempDirectory("murph-parser-toolchain-bin");
  await fs.mkdir(path.join(vaultRoot, "models"), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, "models", "fake.bin"), "model", "utf8");
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

test("parser toolchain doctor reports missing whisper model files clearly", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-toolchain-missing-model");
  const toolsDirectory = await makeTempDirectory("murph-parser-toolchain-missing-model-bin");
  const fakeToolPath = await writeExecutableFile(
    toolsDirectory,
    "fake-parser-tool",
    "#!/usr/bin/env node\nprocess.exit(0);\n",
  );

  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  await writeParserToolchainConfig({
    vaultRoot,
    tools: {
      whisper: {
        command: fakeToolPath,
        modelPath: "./models/missing.bin",
      },
    },
  });

  const doctor = await discoverParserToolchain({ vaultRoot });
  assert.deepEqual(doctor.tools.whisper, {
    available: false,
    command: fakeToolPath,
    modelPath: "./models/missing.bin",
    source: "config",
    reason: "Whisper model path does not exist.",
  });

  await fs.rm(vaultRoot, { recursive: true, force: true });
  await fs.rm(toolsDirectory, { recursive: true, force: true });
});

test("configured parser registry resolves config-relative whisper model paths against the vault root", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-toolchain-runtime-model");
  const toolsDirectory = await makeTempDirectory("murph-parser-toolchain-runtime-bin");
  const outsideDirectory = await makeTempDirectory("murph-parser-toolchain-runtime-cwd");
  const modelPath = path.join(vaultRoot, "models", "runtime.bin");
  await fs.mkdir(path.dirname(modelPath), { recursive: true });
  await fs.writeFile(modelPath, "model", "utf8");
  const fakeWhisperPath = await writeExecutableFile(
    toolsDirectory,
    "fake-whisper-runtime",
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const modelPath = args[args.indexOf('-m') + 1];",
      `if (modelPath !== ${JSON.stringify(modelPath)}) {`,
      "  console.error(`unexpected model path: ${modelPath}`);",
      "  process.exit(1);",
      "}",
      "const outputBase = args[args.indexOf('-of') + 1];",
      "fs.writeFileSync(`${outputBase}.txt`, 'runtime model path ok\\n', 'utf8');",
    ].join("\n"),
  );
  const audioPath = await writeExternalFile(toolsDirectory, "voice.wav", "wav-placeholder");
  const previousCwd = process.cwd();

  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });
  await writeParserToolchainConfig({
    vaultRoot,
    tools: {
      whisper: {
        command: fakeWhisperPath,
        modelPath: "./models/runtime.bin",
      },
    },
  });

  try {
    process.chdir(outsideDirectory);
    const configured = await createConfiguredParserRegistry({ vaultRoot });
    const run = await configured.registry.run({
      intent: "attachment_text",
      artifact: {
        captureId: "cap_whisper_runtime",
        attachmentId: "att_whisper_runtime",
        kind: "audio",
        fileName: "voice.wav",
        mime: "audio/wav",
        storedPath: "raw/inbox/example/voice.wav",
        absolutePath: audioPath,
      },
      inputPath: audioPath,
      scratchDirectory: outsideDirectory,
    });
    assert.equal(run.selection.provider.id, "whisper.cpp");
    assert.equal(run.result.text, "runtime model path ok");
  } finally {
    process.chdir(previousCwd);
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(toolsDirectory, { recursive: true, force: true });
    await fs.rm(outsideDirectory, { recursive: true, force: true });
  }
});

test("pdftotext provider discovers explicit executables and parses PDF text output", async () => {
  const directory = await makeTempDirectory("murph-parser-pdftotext");
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
  const directory = await makeTempDirectory("murph-parser-whisper");
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
  const directory = await makeTempDirectory("murph-parser-whisper-srt-only");
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
  const directory = await makeTempDirectory("murph-parser-whisper-logs");
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

test("registry prefers built-in text parsing for markdown documents", async () => {
  const directory = await makeTempDirectory("murph-parser-registry");
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
  const directory = await makeTempDirectory("murph-parser-fallback");
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

test("parseAttachment uses isolated scratch directories across reruns", async () => {
  const scratchRoot = await makeTempDirectory("murph-parser-scratch-rerun");
  const sourceRoot = await makeTempDirectory("murph-parser-scratch-source");
  const inputPath = await writeExternalFile(sourceRoot, "scan.png", "png-placeholder");
  let runCount = 0;

  const registry = createParserRegistry([
    {
      id: "scratch-sensitive-provider",
      locality: "local",
      openness: "open_source",
      runtime: "node",
      priority: 500,
      async discover() {
        return {
          available: true,
          reason: "available for scratch isolation test",
        };
      },
      supports() {
        return true;
      },
      async run(request) {
        runCount += 1;
        const cachedPath = path.join(request.scratchDirectory, "cached-output.txt");
        const cached = await fs.readFile(cachedPath, "utf8").catch(() => null);
        if (cached) {
          return {
            text: cached.trim(),
          };
        }

        const text = `fresh parse ${runCount}`;
        await fs.writeFile(cachedPath, `${text}\n`, "utf8");
        return {
          text,
        };
      },
    },
  ]);

  const artifact = {
    captureId: "cap_scratch_rerun",
    attachmentId: "att_scratch_rerun",
    kind: "image" as const,
    fileName: "scan.png",
    mime: "image/png",
    storedPath: "raw/inbox/example/scan.png",
    absolutePath: inputPath,
  };

  const first = await parseAttachment({
    artifact,
    registry,
    scratchRoot,
  });
  const second = await parseAttachment({
    artifact,
    registry,
    scratchRoot,
  });

  assert.equal(first.output.text, "fresh parse 1");
  assert.equal(second.output.text, "fresh parse 2");
  assert.deepEqual(await fs.readdir(scratchRoot), []);
});

test("parseAttachment rejects unsafe or malformed attachment IDs before using scratch paths", async () => {
  const scratchRoot = await makeTempDirectory("murph-parser-scratch-unsafe-id");
  const sourceRoot = await makeTempDirectory("murph-parser-scratch-unsafe-id-source");
  const inputPath = await writeExternalFile(sourceRoot, "scan.png", "image-bytes-placeholder");
  let runCount = 0;
  const registry = createParserRegistry([
    {
      id: "fake-image",
      locality: "local",
      openness: "open_source",
      runtime: "embedded",
      priority: 100,
      async discover() {
        return {
          available: true,
          reason: "available for unsafe attachment id validation test",
        };
      },
      supports() {
        return true;
      },
      async run() {
        runCount += 1;
        return {
          text: "should not run",
        };
      },
    },
  ]);

  for (const attachmentId of [
    "../escape",
    "/tmp/escape",
    "..\\..\\raw\\inbox\\foo",
    " att_whitespace ",
    "\natt_newline\n",
    123,
  ]) {
    await assert.rejects(
      () =>
        parseAttachment({
          artifact: {
            captureId: "cap_safe",
            attachmentId: attachmentId as string,
            kind: "image",
            fileName: "scan.png",
            mime: "image/png",
            storedPath: "raw/inbox/example/scan.png",
            absolutePath: inputPath,
          },
          registry,
          scratchRoot,
        }),
      /Parser attachment ID/u,
    );
  }

  for (const captureId of [
    "../escape",
    "..\\..\\raw\\inbox\\foo",
    " cap_whitespace ",
    "\ncap_newline\n",
    123,
  ]) {
    await assert.rejects(
      () =>
        parseAttachment({
          artifact: {
            captureId: captureId as string,
            attachmentId: "att_safe",
            kind: "image",
            fileName: "scan.png",
            mime: "image/png",
            storedPath: "raw/inbox/example/scan.png",
            absolutePath: inputPath,
          },
          registry,
          scratchRoot,
        }),
      /Parser capture ID/u,
    );
  }

  assert.equal(runCount, 0);
  assert.deepEqual(await fs.readdir(scratchRoot), []);
});

test("writeParserArtifacts removes stale optional files on rerun", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-publish-rerun");
  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  const first = await writeParserArtifacts({
    attempt: 1,
    vaultRoot,
    output: {
      schema: "murph.parser-output.v1",
      providerId: "fake-provider",
      artifact: {
        captureId: "cap_publish_rerun",
        attachmentId: "att_publish_rerun",
        kind: "image",
        fileName: "scan.png",
        mime: "image/png",
        storedPath: "raw/inbox/example/scan.png",
      },
      text: "first run text",
      markdown: "first run text",
      blocks: [],
      tables: [
        {
          id: "tbl_0001",
          rows: [["Item", "Qty"]],
        },
      ],
      metadata: {},
      createdAt: "2026-03-13T12:00:00.000Z",
    },
  });
  assert.equal(first.manifestPath, "derived/inbox/cap_publish_rerun/attachments/att_publish_rerun/attempts/0001/manifest.json");
  assert.equal(first.tablesPath, "derived/inbox/cap_publish_rerun/attachments/att_publish_rerun/attempts/0001/tables.json");

  const second = await writeParserArtifacts({
    attempt: 2,
    vaultRoot,
    output: {
      schema: "murph.parser-output.v1",
      providerId: "fake-provider",
      artifact: {
        captureId: "cap_publish_rerun",
        attachmentId: "att_publish_rerun",
        kind: "image",
        fileName: "scan.png",
        mime: "image/png",
        storedPath: "raw/inbox/example/scan.png",
      },
      text: "second run text",
      markdown: "second run text",
      blocks: [],
      tables: [],
      metadata: {},
      createdAt: "2026-03-13T12:05:00.000Z",
    },
  });

  assert.equal(second.tablesPath ?? null, null);
  assert.equal(second.manifestPath, "derived/inbox/cap_publish_rerun/attachments/att_publish_rerun/attempts/0002/manifest.json");
  await fs.access(path.join(vaultRoot, first.tablesPath ?? ""));
  await assert.rejects(fs.access(path.join(vaultRoot, second.attemptDirectoryPath, "tables.json")));
});

test("writeParserArtifacts rejects unsafe or malformed artifact IDs before publishing outside derived inbox", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-publish-unsafe-ids");
  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  await assert.rejects(
    () =>
      writeParserArtifacts({
        attempt: 1,
        vaultRoot,
        output: {
          schema: "murph.parser-output.v1",
          providerId: "fake-provider",
          artifact: {
            captureId: "../../raw/inbox/foo",
            attachmentId: "att_publish_escape",
            kind: "image",
            fileName: "scan.png",
            mime: "image/png",
            storedPath: "raw/inbox/example/scan.png",
          },
          text: "blocked",
          markdown: "blocked",
          blocks: [],
          tables: [],
          metadata: {},
          createdAt: "2026-03-13T12:06:00.000Z",
        },
      }),
    /Parser capture ID/u,
  );
  await assert.rejects(fs.access(path.join(vaultRoot, "raw", "inbox", "foo")));

  await assert.rejects(
    () =>
      writeParserArtifacts({
        attempt: 1,
        vaultRoot,
        output: {
          schema: "murph.parser-output.v1",
          providerId: "fake-provider",
          artifact: {
            captureId: " cap_publish_space ",
            attachmentId: "att_publish_space",
            kind: "image",
            fileName: "scan.png",
            mime: "image/png",
            storedPath: "raw/inbox/example/scan.png",
          },
          text: "blocked",
          markdown: "blocked",
          blocks: [],
          tables: [],
          metadata: {},
          createdAt: "2026-03-13T12:06:30.000Z",
        },
      }),
    /Parser capture ID/u,
  );

  await assert.rejects(
    () =>
      writeParserArtifacts({
        attempt: 1,
        vaultRoot,
        output: {
          schema: "murph.parser-output.v1",
          providerId: "fake-provider",
          artifact: {
            captureId: "cap_publish_alias",
            attachmentId: "alias/other",
            kind: "image",
            fileName: "scan.png",
            mime: "image/png",
            storedPath: "raw/inbox/example/scan.png",
          },
          text: "blocked",
          markdown: "blocked",
          blocks: [],
          tables: [],
          metadata: {},
          createdAt: "2026-03-13T12:07:00.000Z",
        },
      }),
    /Parser attachment ID/u,
  );
  await assert.rejects(
    fs.access(path.join(vaultRoot, "derived", "inbox", "cap_publish_alias", "attachments", "alias")),
  );

  await assert.rejects(
    () =>
      writeParserArtifacts({
        attempt: 1,
        vaultRoot,
        output: {
          schema: "murph.parser-output.v1",
          providerId: "fake-provider",
          artifact: {
            captureId: "cap_publish_type",
            attachmentId: 123 as unknown as string,
            kind: "image",
            fileName: "scan.png",
            mime: "image/png",
            storedPath: "raw/inbox/example/scan.png",
          },
          text: "blocked",
          markdown: "blocked",
          blocks: [],
          tables: [],
          metadata: {},
          createdAt: "2026-03-13T12:07:30.000Z",
        },
      }),
    /Parser attachment ID/u,
  );
});

test("writeParserArtifacts rejects derived attempt paths that traverse symlinks", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-publish-symlink");
  const outsideRoot = await makeTempDirectory("murph-parser-publish-symlink-outside");
  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  const attemptsRoot = path.join(
    vaultRoot,
    "derived",
    "inbox",
    "cap_publish_symlink",
    "attachments",
    "att_publish_symlink",
    "attempts",
  );
  await fs.mkdir(attemptsRoot, { recursive: true });
  await fs.symlink(outsideRoot, path.join(attemptsRoot, "0001"));

  await assert.rejects(
    () =>
      writeParserArtifacts({
        attempt: 1,
        vaultRoot,
        output: {
          schema: "murph.parser-output.v1",
          providerId: "fake-provider",
          artifact: {
            captureId: "cap_publish_symlink",
            attachmentId: "att_publish_symlink",
            kind: "image",
            fileName: "scan.png",
            mime: "image/png",
            storedPath: "raw/inbox/example/scan.png",
          },
          text: "blocked",
          markdown: "blocked",
          blocks: [],
          tables: [],
          metadata: {},
          createdAt: "2026-03-13T12:10:00.000Z",
        },
      }),
    {
      name: "TypeError",
      message: "Vault paths may not traverse symbolic links.",
    },
  );

  assert.deepEqual(await fs.readdir(outsideRoot), []);
});

test("parser cleanup helper rejects attempt directories that traverse symlinks", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-cleanup-symlink");
  const outsideRoot = await makeTempDirectory("murph-parser-cleanup-symlink-outside");
  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  const attemptDirectoryPath = "derived/inbox/cap_cleanup_symlink/attachments/att_cleanup_symlink/attempts/0001";
  const attemptsRoot = path.join(vaultRoot, path.dirname(attemptDirectoryPath));
  const outsideFile = path.join(outsideRoot, "keep.txt");
  await fs.mkdir(attemptsRoot, { recursive: true });
  await fs.writeFile(outsideFile, "do not delete", "utf8");
  await fs.symlink(outsideRoot, path.join(vaultRoot, attemptDirectoryPath));

  await assert.rejects(
    () => removeVaultDirectoryIfExists(vaultRoot, attemptDirectoryPath),
    {
      name: "TypeError",
      message: "Vault paths may not traverse symbolic links.",
    },
  );

  assert.equal(await fs.readFile(outsideFile, "utf8"), "do not delete");
});

test("attachment parse worker fails closed on malformed attachment IDs", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-worker-malformed-id-vault");
  const scratchRoot = await makeTempDirectory("murph-parser-worker-malformed-id-scratch");
  const storedPath = "raw/inbox/example/malformed-id.png";
  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });
  await fs.mkdir(path.join(vaultRoot, path.dirname(storedPath)), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, storedPath), "image-bytes-placeholder", "utf8");

  const attachment = {
    attachmentId: "../escape",
    kind: "image" as const,
    mime: "image/png",
    fileName: "malformed-id.png",
    storedPath,
    parseState: "pending" as "failed" | "pending" | "running",
    derivedPath: null,
    extractedText: null,
    transcriptText: null,
  };
  const capture = {
    captureId: "cap_worker_malformed_id",
    attachments: [attachment],
  };
  let job = {
    jobId: "job_worker_malformed_id",
    captureId: capture.captureId,
    attachmentId: attachment.attachmentId,
    state: "pending" as "failed" | "pending" | "running",
    attempts: 0,
    errorCode: null as string | null,
    errorMessage: null as string | null,
    providerId: null as string | null,
    resultPath: null as string | null,
  };

  const runtime = {
    databasePath: path.join(vaultRoot, ".runtime", "inboxd.sqlite"),
    close() {},
    getCursor() {
      return null;
    },
    setCursor() {},
    findByExternalId() {
      return null;
    },
    upsertCaptureIndex() {
      throw new Error("not used in malformed attachment ID test");
    },
    enqueueDerivedJobs() {},
    listAttachmentParseJobs() {
      return [job];
    },
    claimNextAttachmentParseJob() {
      if (job.state !== "pending") {
        return null;
      }

      job = {
        ...job,
        state: "running",
        attempts: job.attempts + 1,
      };
      attachment.parseState = "running";
      return job;
    },
    requeueAttachmentParseJobs() {
      return 0;
    },
    completeAttachmentParseJob() {
      throw new Error("worker should not complete malformed attachment IDs");
    },
    failAttachmentParseJob(input) {
      job = {
        ...job,
        state: "failed",
        attempts: input.attempt,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage,
        providerId: input.providerId ?? null,
      };
      attachment.parseState = "failed";
      return {
        applied: true,
        job,
      };
    },
    listCaptures() {
      return [capture] as unknown[];
    },
    searchCaptures() {
      return [];
    },
    getCapture(captureId) {
      return captureId === capture.captureId ? (capture as unknown) : null;
    },
  } as unknown as InboxRuntimeStore;

  const results = await runAttachmentParseWorker({
    vaultRoot,
    runtime,
    registry: createParserRegistry([
      {
        id: "unexpected-success-provider",
        locality: "local",
        openness: "open_source",
        runtime: "embedded",
        priority: 100,
        async discover() {
          return {
            available: true,
            reason: "available for malformed attachment ID worker test",
          };
        },
        supports() {
          return true;
        },
        async run() {
          return {
            text: "should not run",
          };
        },
      },
    ]),
    scratchRoot,
    maxJobs: 1,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "failed");
  assert.equal(results[0]?.errorCode, "parser_failed");
  assert.match(results[0]?.errorMessage ?? "", /Parser attachment ID/u);
  assert.equal(attachment.parseState, "failed");
  assert.equal(attachment.derivedPath, null);
  assert.equal(attachment.extractedText, null);
  assert.equal(attachment.transcriptText, null);
  assert.equal(job.state, "failed");
  assert.equal(job.resultPath, null);
  assert.deepEqual(await fs.readdir(scratchRoot), []);
  await assert.rejects(fs.access(path.join(vaultRoot, "derived", "inbox", capture.captureId)));
});

test("attachment parse worker consumes inbox jobs, writes derived artifacts, and updates runtime search", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-worker-vault");
  const sourceRoot = await makeTempDirectory("murph-parser-worker-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "meal-photo.pdf", "document-placeholder");
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
        kind: "document",
        mime: "application/pdf",
        originalPath: imagePath,
        fileName: "meal-photo.pdf",
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
      return (request.preparedKind ?? request.artifact.kind) === "document";
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
  assert.match(results[0]?.manifestPath ?? "", /attempts\/0001\/manifest\.json$/u);
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

test("stale running parser attempts do not overwrite a requeued rerun", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-worker-race-vault");
  const sourceRoot = await makeTempDirectory("murph-parser-worker-race-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "race.pdf", "document-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "imessage",
    externalId: "race-1",
    accountId: "self",
    thread: {
      id: "chat-race-1",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T11:05:00.000Z",
    text: null,
    attachments: [
      {
        kind: "document",
        mime: "application/pdf",
        originalPath: imagePath,
        fileName: "race.pdf",
      },
    ],
    raw: {},
  });

  let runCount = 0;
  let releaseFirstRun: (() => void) | null = null;
  const firstRunStarted = new Promise<void>((resolve) => {
    releaseFirstRun = resolve;
  });

  const registry = createParserRegistry([
    {
      id: "race-parser",
      locality: "local",
      openness: "open_source",
      runtime: "node",
      priority: 500,
      async discover() {
        return {
          available: true,
          reason: "available for race test",
        };
      },
      supports(request) {
        return (request.preparedKind ?? request.artifact.kind) === "document";
      },
      async run() {
        runCount += 1;
        if (runCount === 1) {
          await firstRunStarted;
          return {
            text: "stale attempt text",
          };
        }

        return {
          text: "fresh rerun text",
        };
      },
    },
  ]);

  const firstAttempt = runAttachmentParseJobOnce({
    vaultRoot,
    runtime,
    registry,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    runtime.requeueAttachmentParseJobs({
      captureId: capture.captureId,
      state: "running",
    }),
    1,
  );

  const rerun = await runAttachmentParseJobOnce({
    vaultRoot,
    runtime,
    registry,
  });
  assert.equal(rerun?.status, "succeeded");
  assert.match(rerun?.manifestPath ?? "", /attempts\/0002\/manifest\.json$/u);

  releaseFirstRun?.();
  assert.equal(await firstAttempt, null);

  const refreshed = runtime.getCapture(capture.captureId);
  assert.ok(refreshed);
  assert.equal(refreshed.attachments[0]?.extractedText, "fresh rerun text");
  assert.match(refreshed.attachments[0]?.derivedPath ?? "", /attempts\/0002\/manifest\.json$/u);
  const refreshedManifest = JSON.parse(
    await fs.readFile(path.join(vaultRoot, refreshed.attachments[0]?.derivedPath ?? ""), "utf8"),
  ) as {
    paths: {
      plainTextPath: string;
    };
  };
  assert.match(
    await fs.readFile(path.join(vaultRoot, refreshedManifest.paths.plainTextPath), "utf8"),
    /fresh rerun text/u,
  );
  await assert.rejects(
    fs.access(
      path.join(
        vaultRoot,
        "derived",
        "inbox",
        capture.captureId,
        "attachments",
        refreshed.attachments[0]?.attachmentId ?? "",
        "attempts",
        "0001",
      ),
    ),
  );

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
  const vaultRoot = await makeTempDirectory("murph-parser-worker-fail-vault");
  const sourceRoot = await makeTempDirectory("murph-parser-worker-fail-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "scan.pdf", "document-placeholder");
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
        kind: "document",
        mime: "application/pdf",
        originalPath: imagePath,
        fileName: "scan.pdf",
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
  const vaultRoot = await makeTempDirectory("murph-parser-worker-scoped-vault");
  const sourceRoot = await makeTempDirectory("murph-parser-worker-scoped-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const firstPath = await writeExternalFile(sourceRoot, "first.pdf", "first-document");
  const secondPath = await writeExternalFile(sourceRoot, "second.pdf", "second-document");
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
        kind: "document",
        mime: "application/pdf",
        originalPath: firstPath,
        fileName: "first.pdf",
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
        kind: "document",
        mime: "application/pdf",
        originalPath: secondPath,
        fileName: "second.pdf",
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
        return (request.preparedKind ?? request.artifact.kind) === "document";
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
  const vaultRoot = await makeTempDirectory("murph-parsed-pipeline-vault");
  const sourceRoot = await makeTempDirectory("murph-parsed-pipeline-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "auto-parse.pdf", "document-placeholder");
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
          return (request.preparedKind ?? request.artifact.kind) === "document";
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
        kind: "document",
        mime: "application/pdf",
        originalPath: imagePath,
        fileName: "auto-parse.pdf",
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

test("daemon with parsers drains pending jobs before connector watch work begins", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsed-daemon-startup-vault");
  const sourceRoot = await makeTempDirectory("murph-parsed-daemon-startup-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "startup.pdf", "document-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "imessage",
    externalId: "startup-drain-1",
    thread: {
      id: "chat-startup-drain",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T11:35:00.000Z",
    text: null,
    attachments: [
      {
        kind: "document",
        mime: "application/pdf",
        originalPath: imagePath,
        fileName: "startup.pdf",
      },
    ],
    raw: {},
  });
  pipeline.close();

  const daemonRuntime = await openInboxRuntime({ vaultRoot });
  const controller = new AbortController();
  const connector = {
    id: "noop-imessage",
    source: "imessage",
    accountId: "self",
    kind: "poll" as const,
    capabilities: {
      attachments: true,
      backfill: false,
      ownMessages: false,
      watch: true,
      webhooks: false,
    },
    async watch(_cursor, _emit, signal) {
      if (signal.aborted) {
        return;
      }

      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    async close() {},
  };

  const running = runInboxDaemonWithParsers({
    vaultRoot,
    runtime: daemonRuntime,
    registry: createParserRegistry([
      {
        id: "startup-drain-parser",
        locality: "local",
        openness: "open_source",
        runtime: "node",
        priority: 500,
        async discover() {
          return {
            available: true,
            reason: "available for startup drain test",
          };
        },
        supports(request) {
          return (request.preparedKind ?? request.artifact.kind) === "document";
        },
        async run() {
          return {
            text: "Startup-drained OCR text",
          };
        },
      },
    ]),
    connectors: [connector],
    signal: controller.signal,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort();
  await running;

  const refreshedRuntime = await openInboxRuntime({ vaultRoot });
  try {
    const refreshed = refreshedRuntime.getCapture(capture.captureId);
    assert.ok(refreshed);
    assert.equal(refreshed.attachments[0]?.parseState, "succeeded");
    assert.equal(refreshed.attachments[0]?.extractedText, "Startup-drained OCR text");
  } finally {
    refreshedRuntime.close();
  }
});

test("daemon with parsers skips startup drain when the signal is already aborted", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsed-daemon-aborted-vault");
  const sourceRoot = await makeTempDirectory("murph-parsed-daemon-aborted-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "aborted.pdf", "document-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "imessage",
    externalId: "aborted-drain-1",
    thread: {
      id: "chat-aborted-drain",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T11:36:00.000Z",
    text: null,
    attachments: [
      {
        kind: "document",
        mime: "application/pdf",
        originalPath: imagePath,
        fileName: "aborted.pdf",
      },
    ],
    raw: {},
  });
  pipeline.close();

  let closeCount = 0;
  const daemonRuntime = await openInboxRuntime({ vaultRoot });
  const controller = new AbortController();
  controller.abort();

  await runInboxDaemonWithParsers({
    vaultRoot,
    runtime: daemonRuntime,
    registry: createParserRegistry([]),
    connectors: [
      {
        id: "aborted-imessage",
        source: "imessage",
        accountId: "self",
        kind: "poll" as const,
        capabilities: {
          attachments: true,
          backfill: false,
          ownMessages: false,
          watch: false,
          webhooks: false,
        },
        async close() {
          closeCount += 1;
        },
      },
    ],
    signal: controller.signal,
  });

  const refreshedRuntime = await openInboxRuntime({ vaultRoot });
  try {
    const refreshed = refreshedRuntime.getCapture(capture.captureId);
    assert.ok(refreshed);
    assert.equal(refreshed.attachments[0]?.parseState, "pending");
  } finally {
    refreshedRuntime.close();
  }
  assert.equal(closeCount, 1);
});

test("daemon with parsers stops startup drain after abort between jobs", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsed-daemon-abort-mid-drain-vault");
  const sourceRoot = await makeTempDirectory("murph-parsed-daemon-abort-mid-drain-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const firstPath = await writeExternalFile(sourceRoot, "first.pdf", "first-document");
  const secondPath = await writeExternalFile(sourceRoot, "second.pdf", "second-document");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const first = await pipeline.processCapture({
    source: "imessage",
    externalId: "abort-drain-first",
    thread: {
      id: "chat-abort-drain",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T11:37:00.000Z",
    text: null,
    attachments: [
      {
        kind: "document",
        mime: "application/pdf",
        originalPath: firstPath,
        fileName: "first.pdf",
      },
    ],
    raw: {},
  });
  const second = await pipeline.processCapture({
    source: "imessage",
    externalId: "abort-drain-second",
    thread: {
      id: "chat-abort-drain",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T11:38:00.000Z",
    text: null,
    attachments: [
      {
        kind: "document",
        mime: "application/pdf",
        originalPath: secondPath,
        fileName: "second.pdf",
      },
    ],
    raw: {},
  });
  pipeline.close();

  const daemonRuntime = await openInboxRuntime({ vaultRoot });
  const controller = new AbortController();
  let parseCount = 0;

  await runInboxDaemonWithParsers({
    vaultRoot,
    runtime: daemonRuntime,
    registry: createParserRegistry([
      {
        id: "abort-mid-drain-parser",
        locality: "local",
        openness: "open_source",
        runtime: "node",
        priority: 500,
        async discover() {
          return {
            available: true,
            reason: "available for abort-mid-drain test",
          };
        },
        supports(request) {
          return (request.preparedKind ?? request.artifact.kind) === "document";
        },
        async run() {
          parseCount += 1;
          if (parseCount === 1) {
            controller.abort();
          }

          return {
            text: `drained ${parseCount}`,
          };
        },
      },
    ]),
    connectors: [],
    signal: controller.signal,
  });

  const refreshedRuntime = await openInboxRuntime({ vaultRoot });
  try {
    assert.equal(refreshedRuntime.getCapture(first.captureId)?.attachments[0]?.parseState, "succeeded");
    assert.equal(refreshedRuntime.getCapture(second.captureId)?.attachments[0]?.parseState, "pending");
  } finally {
    refreshedRuntime.close();
  }
});

test("daemon with parsers still rejects connector failures after cleanup", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsed-daemon-failure-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const runtime = await openInboxRuntime({ vaultRoot });

  await assert.rejects(
    runInboxDaemonWithParsers({
      vaultRoot,
      runtime,
      registry: createParserRegistry([]),
      connectors: [
        {
          id: "failing-imessage",
          source: "imessage",
          accountId: "self",
          kind: "poll" as const,
          capabilities: {
            attachments: true,
            backfill: true,
            ownMessages: false,
            watch: false,
            webhooks: false,
          },
          async backfill() {
            throw new Error("daemon blew up");
          },
          async close() {},
        },
      ],
      signal: new AbortController().signal,
    }),
    /Connector "failing-imessage" \(imessage\) failed: daemon blew up/u,
  );
});

test("daemon with parsers can keep healthy connectors running after one connector fails", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsed-daemon-isolated-failure-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const runtime = await openInboxRuntime({ vaultRoot });
  const controller = new AbortController();
  let healthyConnectorAborted = false;
  let healthyConnectorClosed = 0;
  let sawFailingConnectorClose = false;
  let resolveFailingConnectorClose: (() => void) | null = null;
  const failingConnectorClosed = new Promise<void>((resolve) => {
    resolveFailingConnectorClose = resolve;
  });

  const running = runInboxDaemonWithParsers({
    vaultRoot,
    runtime,
    registry: createParserRegistry([]),
    connectors: [
      {
        id: "healthy-email",
        source: "email",
        accountId: "agentmail",
        kind: "poll" as const,
        capabilities: {
          attachments: true,
          backfill: false,
          ownMessages: false,
          watch: true,
          webhooks: false,
        },
        async watch(_cursor, _emit, signal) {
          if (signal.aborted) {
            healthyConnectorAborted = true;
            return;
          }

          await new Promise<void>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                healthyConnectorAborted = true;
                resolve();
              },
              { once: true },
            );
          });
        },
        async close() {
          healthyConnectorClosed += 1;
        },
      },
      {
        id: "failing-imessage",
        source: "imessage",
        accountId: "self",
        kind: "poll" as const,
        capabilities: {
          attachments: true,
          backfill: false,
          ownMessages: false,
          watch: true,
          webhooks: false,
        },
        async watch() {
          throw new Error("daemon blew up");
        },
        async close() {
          sawFailingConnectorClose = true;
          resolveFailingConnectorClose?.();
        },
      },
    ],
    signal: controller.signal,
    continueOnConnectorFailure: true,
  });

  await failingConnectorClosed;
  assert.equal(sawFailingConnectorClose, true);
  assert.equal(healthyConnectorAborted, false);

  controller.abort();
  await running;

  assert.equal(healthyConnectorAborted, true);
  assert.equal(healthyConnectorClosed, 1);
});

test("parsed inbox pipeline stores captures even when auto-drain parsing fails", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsed-pipeline-failure-vault");
  const sourceRoot = await makeTempDirectory("murph-parsed-pipeline-failure-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "auto-fail.pdf", "document-placeholder");
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
        kind: "document",
        mime: "application/pdf",
        originalPath: imagePath,
        fileName: "auto-fail.pdf",
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
  const vaultRoot = await makeTempDirectory("murph-parser-worker-failure-vault");
  const sourceRoot = await makeTempDirectory("murph-parser-worker-failure-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "unknown-document.pdf", "document-placeholder");
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
        kind: "document",
        mime: "application/pdf",
        originalPath: imagePath,
        fileName: "unknown-document.pdf",
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
  const vaultRoot = await makeTempDirectory("murph-parser-worker-audio-vault");
  const sourceRoot = await makeTempDirectory("murph-parser-worker-audio-source");
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
  const vaultRoot = await makeTempDirectory("murph-parser-rebuild-vault");
  const sourceRoot = await makeTempDirectory("murph-parser-rebuild-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "receipt.pdf", "document-placeholder");
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
        kind: "document",
        mime: "application/pdf",
        originalPath: imagePath,
        fileName: "receipt.pdf",
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
          return (request.preparedKind ?? request.artifact.kind) === "document";
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
  const vaultRoot = await makeTempDirectory("murph-parser-worker-failure-vault");
  const sourceRoot = await makeTempDirectory("murph-parser-worker-failure-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "failure-document.pdf", "document-placeholder");
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
        kind: "document",
        mime: "application/pdf",
        originalPath: imagePath,
        fileName: "failure-document.pdf",
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
