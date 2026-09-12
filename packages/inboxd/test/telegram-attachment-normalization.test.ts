import assert from "node:assert/strict";
import { test } from "vitest";

import type { TelegramMessageLike } from "@murphai/messaging-ingress/telegram-webhook";
import {
  normalizeHostedTelegramMessage,
  normalizeTelegramUpdate,
  type HostedTelegramAttachmentInput,
  type NormalizeHostedTelegramMessageInput,
  type NormalizeTelegramUpdateInput,
  type TelegramAttachmentDownloadDriver,
} from "../src/connectors/telegram/normalize.ts";

function nativeCapture(
  fields: Partial<TelegramMessageLike>,
  options: Pick<NormalizeTelegramUpdateInput, "downloadDriver" | "signal"> = {},
) {
  return normalizeTelegramUpdate({
    ...options,
    update: {
      update_id: 1,
      message: {
        message_id: 1,
        date: 1_700_000_000,
        chat: { id: 1, type: "private" },
        ...fields,
      },
    },
  });
}

function hostedCapture(
  attachments: HostedTelegramAttachmentInput[],
  options: Pick<NormalizeHostedTelegramMessageInput, "downloadDriver" | "signal"> = {},
) {
  return normalizeHostedTelegramMessage({
    ...options,
    externalId: "fixture-update",
    message: { messageId: "1", threadId: "1", attachments },
    occurredAt: "2023-11-14T22:13:20.000Z",
  });
}

const identity = { externalId: "fixture", byteSize: null };

for (const metadata of [undefined, "", " \t "]) {
  test(`native defaults and complete field order with metadata ${JSON.stringify(metadata)}`, async () => {
    const file = { file_id: "fixture", file_name: metadata, mime_type: metadata };
    // Reverse property order and reuse the same file to detect sorting or deduplication.
    const capture = await nativeCapture({
      sticker: file,
      animation: file,
      video_note: file,
      video: file,
      voice: file,
      audio: file,
      document: file,
      photo: [file],
    });

    assert.deepEqual(capture.attachments, [
      { ...identity, kind: "image", mime: "image/jpeg", fileName: "photo-fixture.jpg" },
      { ...identity, kind: "document", mime: null, fileName: null },
      { ...identity, kind: "audio", mime: "audio/mpeg", fileName: "audio-fixture.bin" },
      { ...identity, kind: "audio", mime: "audio/ogg", fileName: "voice-fixture.ogg" },
      { ...identity, kind: "video", mime: "video/mp4", fileName: "video-fixture.mp4" },
      { ...identity, kind: "video", mime: "video/mp4", fileName: "video-note-fixture.mp4" },
      { ...identity, kind: "video", mime: "video/mp4", fileName: "animation-fixture.mp4" },
      { ...identity, kind: "image", mime: null, fileName: "sticker-fixture.webp" },
    ]);
  });
}

for (const metadata of [undefined, null, "", " \t "]) {
  test(`hosted defaults retain array order and duplicates with metadata ${JSON.stringify(metadata)}`, async () => {
    const kinds = [
      "sticker", "animation", "video_note", "video", "voice", "audio", "document", "photo", "sticker",
    ] as const;
    const capture = await hostedCapture(kinds.map((kind) => ({
      kind,
      fileId: "fixture",
      fileName: metadata,
      mimeType: metadata,
    })));

    assert.deepEqual(capture.attachments, [
      { ...identity, kind: "image", mime: null, fileName: "sticker-fixture.webp" },
      { ...identity, kind: "video", mime: "video/mp4", fileName: "animation-fixture.mp4" },
      { ...identity, kind: "video", mime: "video/mp4", fileName: "video-note-fixture.mp4" },
      { ...identity, kind: "video", mime: "video/mp4", fileName: "video-fixture.mp4" },
      { ...identity, kind: "audio", mime: "audio/ogg", fileName: "voice-fixture.ogg" },
      { ...identity, kind: "audio", mime: "audio/mpeg", fileName: "audio-fixture.bin" },
      { ...identity, kind: "document", mime: null, fileName: null },
      { ...identity, kind: "image", mime: "image/jpeg", fileName: "photo-fixture.jpg" },
      { ...identity, kind: "image", mime: null, fileName: "sticker-fixture.webp" },
    ]);
  });
}

test("supplied fields override every default except native photos without changing fixed media kinds", async () => {
  const file = { file_id: "fixture", file_name: " clip.GIF \t", mime_type: " audio/custom " };
  const native = await nativeCapture({
    photo: [file], document: file, audio: file, voice: file,
    video: file, video_note: file, animation: file, sticker: file,
  });
  const kinds = ["photo", "document", "audio", "voice", "video", "video_note", "animation", "sticker"] as const;
  const hosted = await hostedCapture(kinds.map((kind) => ({
    kind,
    fileId: "fixture",
    fileName: " clip.GIF \t",
    mimeType: " audio/custom ",
  })));
  const supplied = { ...identity, mime: "audio/custom", fileName: "clip.GIF" };

  assert.deepEqual(native.attachments, [
    { ...identity, kind: "image", mime: "image/jpeg", fileName: "photo-fixture.jpg" },
    { ...supplied, kind: "document" },
    { ...supplied, kind: "audio" },
    { ...supplied, kind: "audio" },
    { ...supplied, kind: "video" },
    { ...supplied, kind: "video" },
    { ...supplied, kind: "video" },
    { ...supplied, kind: "image" },
  ]);
  assert.deepEqual(hosted.attachments, [
    { ...supplied, kind: "image" },
    { ...supplied, kind: "image" },
    { ...supplied, kind: "audio" },
    { ...supplied, kind: "audio" },
    { ...supplied, kind: "video" },
    { ...supplied, kind: "video" },
    { ...supplied, kind: "video" },
    { ...supplied, kind: "image" },
  ]);
});

test("MIME and filename overrides fall back independently", async () => {
  const native = await nativeCapture({
    audio: { file_id: "fixture", mime_type: " audio/custom ", file_name: " \t " },
    voice: { file_id: "fixture", mime_type: " \t ", file_name: " recording.GIF " },
  });
  const hosted = await hostedCapture([
    { kind: "audio", fileId: "fixture", mimeType: " audio/custom ", fileName: " \t " },
    { kind: "voice", fileId: "fixture", mimeType: " \t ", fileName: " recording.GIF " },
  ]);
  const expected = [
    { ...identity, kind: "audio", mime: "audio/custom", fileName: "audio-fixture.bin" },
    { ...identity, kind: "audio", mime: "audio/ogg", fileName: "recording.GIF" },
  ];

  assert.deepEqual(native.attachments, expected);
  assert.deepEqual(hosted.attachments, expected);
});

for (const [mime, name, outputMime, outputName, nativeKind, hostedKind] of [
  [" image/png", undefined, "image/png", null, "document", "image"],
  [undefined, "still.PNG ", null, "still.PNG", "document", "image"],
  [" video/mp4 ", "clip.GIF ", "video/mp4", "clip.GIF", "document", "image"],
  ["video/mp4", "clip.GIF", "video/mp4", "clip.GIF", "image", "image"],
  ["audio/ogg", "still.WEBP", "audio/ogg", "still.WEBP", "image", "image"],
  ["video/mp4", "track.OGG", "video/mp4", "track.OGG", "audio", "audio"],
  ["IMAGE/PNG", "track.MP3", "IMAGE/PNG", "track.MP3", "image", "image"],
  ["AUDIO/OGG", "clip.MP4", "AUDIO/OGG", "clip.MP4", "audio", "audio"],
  ["VIDEO/WEBM", "report.PDF", "VIDEO/WEBM", "report.PDF", "video", "video"],
  ["application/pdf", "clip.MOV", "application/pdf", "clip.MOV", "video", "video"],
  [undefined, "report.PDF", null, "report.PDF", "document", "document"],
  ["application/octet-stream", "blob.bin", "application/octet-stream", "blob.bin", "document", "document"],
  ["audio/ogg ", undefined, "audio/ogg", null, "audio", "audio"],
] as const) {
  test(`document inference preserves raw/normalized inputs and priority: ${mime}, ${name}`, async () => {
    const native = await nativeCapture({
      document: { file_id: "fixture", mime_type: mime, file_name: name },
    });
    const hosted = await hostedCapture([
      { kind: "document", fileId: "fixture", mimeType: mime, fileName: name },
    ]);
    const fields = { ...identity, mime: outputMime, fileName: outputName };

    assert.deepEqual(native.attachments, [{ ...fields, kind: nativeKind }]);
    assert.deepEqual(hosted.attachments, [{ ...fields, kind: hostedKind }]);
  });
}

for (const [uniqueId, nativeId, hostedId, photoName, audioName] of [
  [undefined, "fixture", "fixture", "photo-fixture.jpg", "audio-fixture.bin"],
  ["", "", "fixture", "photo-.jpg", "audio-.bin"],
  ["  ", "  ", "fixture", "photo-  .jpg", "audio-  .bin"],
  [" unique ", " unique ", "unique", "photo- unique .jpg", "audio- unique .bin"],
] as const) {
  test(`generated filenames retain raw nullish unique IDs: ${JSON.stringify(uniqueId)}`, async () => {
    const file = { file_id: "fixture", file_unique_id: uniqueId };
    const native = await nativeCapture({ photo: [file], audio: file });
    const hosted = await hostedCapture([
      { kind: "photo", fileId: "fixture", fileUniqueId: uniqueId },
      { kind: "audio", fileId: "fixture", fileUniqueId: uniqueId },
    ]);

    assert.deepEqual(native.attachments, [
      { externalId: nativeId, byteSize: null, kind: "image", mime: "image/jpeg", fileName: photoName },
      { externalId: nativeId, byteSize: null, kind: "audio", mime: "audio/mpeg", fileName: audioName },
    ]);
    assert.deepEqual(hosted.attachments, [
      { externalId: hostedId, byteSize: null, kind: "image", mime: "image/jpeg", fileName: photoName },
      { externalId: hostedId, byteSize: null, kind: "audio", mime: "audio/mpeg", fileName: audioName },
    ]);
  });
}

test("hosted null unique IDs use file IDs", async () => {
  const capture = await hostedCapture([{ kind: "voice", fileId: "fixture", fileUniqueId: null }]);
  assert.deepEqual(capture.attachments, [
    { ...identity, kind: "audio", mime: "audio/ogg", fileName: "voice-fixture.ogg" },
  ]);
});

test("largest native photo uses truthy size then area, retains the first tie, and does not mutate input", async () => {
  const photo = [
    { file_id: "large-area", file_size: 1, width: 1000, height: 1000 },
    { file_id: "zero-size", file_size: 0, width: 4, height: 5 },
    { file_id: "later-tie", file_size: 20, width: 100, height: 100 },
    { file_id: "missing-height", width: 1000 },
    { file_id: "missing-dimensions" },
  ];
  const original = structuredClone(photo);
  const capture = await nativeCapture({ photo });

  assert.deepEqual(capture.attachments, [
    { externalId: "zero-size", kind: "image", mime: "image/jpeg", fileName: "photo-zero-size.jpg", byteSize: 0 },
  ]);
  assert.deepEqual(photo, original);
  assert.deepEqual((await nativeCapture({ photo: [] })).attachments, []);
});

test("hosted sizes keep finite fractional and negative values while native sizes remain provider-shaped", async () => {
  const sizes = [NaN, Infinity, -Infinity, -1.5, 0, 3.25];
  const hosted = await hostedCapture(sizes.map((fileSize) => ({
    kind: "document", fileId: "fixture", fileSize,
  })));
  assert.deepEqual(hosted.attachments.map((attachment) => attachment.byteSize), [null, null, null, -1.5, 0, 3.25]);

  for (const file_size of sizes) {
    const native = await nativeCapture({ document: { file_id: "fixture", file_size } });
    assert.equal(native.attachments[0]?.byteSize, file_size);
  }
});

test("hydration finishes each attachment before the next lookup and forwards exact paths and signals", async () => {
  const signal = new AbortController().signal;
  const calls: string[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  const data = new Uint8Array([1, 2]);
  const downloadDriver: TelegramAttachmentDownloadDriver = {
    async getFile(fileId, receivedSignal) {
      signals.push(receivedSignal);
      calls.push(`get:${fileId}`);
      await Promise.resolve();
      calls.push(`got:${fileId}`);
      return { file_id: fileId, file_path: `opaque/${fileId}`, file_size: 999 };
    },
    async downloadFile(filePath, receivedSignal) {
      signals.push(receivedSignal);
      calls.push(`download:${filePath}`);
      await Promise.resolve();
      calls.push(`downloaded:${filePath}`);
      return data;
    },
  };
  const capture = await nativeCapture({
    audio: { file_id: "first", file_unique_id: "first-unique", file_size: 0 },
    voice: { file_id: "second" },
  }, { downloadDriver, signal });

  assert.deepEqual(calls, [
    "get:first", "got:first", "download:opaque/first", "downloaded:opaque/first",
    "get:second", "got:second", "download:opaque/second", "downloaded:opaque/second",
  ]);
  assert.equal(signals.length, 4);
  for (const receivedSignal of signals) {
    assert.equal(receivedSignal, signal);
  }
  assert.deepEqual(capture.attachments, [
    { externalId: "first-unique", kind: "audio", mime: "audio/mpeg", fileName: "audio-first-unique.bin", byteSize: 0, data },
    { externalId: "second", kind: "audio", mime: "audio/ogg", fileName: "voice-second.ogg", byteSize: 2, data },
  ]);
});
