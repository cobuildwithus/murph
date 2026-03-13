import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { initializeVault } from "@healthybob/core";
import { createInboxPipeline, openInboxRuntime, rebuildRuntimeFromVault } from "@healthybob/inboxd";

import {
  createParserRegistry,
  createTextFileProvider,
  prepareAudioInput,
  runAttachmentParseWorker,
  type ParserProvider,
} from "../src/index.js";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function writeExternalFile(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, content, "utf8");
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
