import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { initializeVault } from "@murphai/core";
import { createVersionedJsonStateEnvelope } from "@murphai/runtime-state/node";
import {
  type Cursor,
  type AttachmentParseJobRecord,
  createParsedInboxPipeline,
  createInboxPipeline,
  type EmitCapture,
  type FailAttachmentParseJobInput,
  type InboxCaptureRecord,
  openInboxRuntime,
  type PollConnector,
  rebuildRuntimeFromVault,
  runInboxDaemonWithParsers,
  type InboxRuntimeStore,
} from "@murphai/inboxd";

import {
  createConfiguredParserRegistry,
  createInboxParserService,
  createParserRegistry,
  createTextFileProvider,
  createWhisperCppProvider,
  discoverParserToolchain,
  getParserToolchainPaths,
  parseAttachment,
  prepareAudioInput,
  PARSER_RESULT_MAX_BYTES,
  readParserResult,
  readParserToolchainConfig,
  runAttachmentParseJobOnce,
  runAttachmentParseWorker,
  writeParserResult,
  writeParserToolchainConfig,
  type AttachmentParseJobClaimFilters,
  type ParserProvider,
  type RequeueAttachmentParseJobsInput,
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
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function writeExternalBytes(directory: string, fileName: string, content: Buffer): Promise<string> {
  const filePath = path.join(directory, fileName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return filePath;
}

function disableFfmpegLookup() {
  return { commandCandidates: ["definitely-not-installed-ffmpeg"], allowSystemLookup: false };
}

function validMp3FrameBytes(): Buffer {
  return Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00]);
}

function validId3Mp3Bytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04]),
    Buffer.from("test", "ascii"),
    validMp3FrameBytes(),
  ]);
}

function validAacAdtsBytes(): Buffer {
  return Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x01, 0x1f, 0xfc, 0x00]);
}

async function writeExecutableFile(directory: string, fileName: string, content: string): Promise<string> {
  if (process.platform === "win32" && path.extname(fileName) === "") {
    await writeExternalFile(directory, `${fileName}.js`, content);
    return writeExternalFile(
      directory,
      `${fileName}.cmd`,
      `@echo off\r\n"${process.execPath}" "%~dpn0.js" %*\r\n`,
    );
  }

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

test("audio preparation hard-caps provider input instead of trusting attachment metadata", async () => {
  const directory = await makeTempDirectory("murph-parser-audio-duration-cap");
  const invocationLogPath = path.join(directory, "ffmpeg-invocation.json");
  const fakeFfmpegPath = await writeExecutableFile(
    directory,
    "fake-duration-cap-ffmpeg",
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(invocationLogPath)}, JSON.stringify(process.argv.slice(2)), "utf8");`,
    ].join("\n"),
  );
  const wavPath = await writeExternalFile(
    directory,
    "long.wav",
    "RIFF----WAVEwav-bytes-placeholder",
  );

  await prepareAudioInput({
    artifact: {
      absolutePath: wavPath,
      attachmentId: "att_audio_duration_cap",
      captureId: "cap_audio_duration_cap",
      fileName: "long.wav",
      kind: "audio",
      mime: "audio/wav",
      storedPath: "raw/inbox/example/long.wav",
    },
    ffmpeg: {
      allowSystemLookup: false,
      commandCandidates: [fakeFfmpegPath],
      maxDurationSeconds: 180,
      remoteTranscriptionOnly: true,
    },
    scratchDirectory: directory,
  });

  const invocation = JSON.parse(await fs.readFile(invocationLogPath, "utf8"));
  assert.ok(Array.isArray(invocation));
  const durationFlag = invocation.indexOf("-t");
  assert.ok(durationFlag >= 0);
  assert.equal(invocation[durationFlag + 1], "180");
});

test("audio preparation passes remote-accepted formats through untouched when remote transcription is the only lane", async () => {
  const directory = await makeTempDirectory("murph-parser-audio-passthrough");
  const remoteOnlyFfmpeg = { ...disableFfmpegLookup(), remoteTranscriptionOnly: true };

  const cafPath = await writeExternalFile(directory, "memo.caf", "caff-caf-bytes-placeholder");
  const cafPrepared = await prepareAudioInput({
    artifact: {
      captureId: "cap_audio_passthrough_1",
      attachmentId: "att_audio_caf",
      kind: "audio",
      fileName: "memo.caf",
      mime: "audio/x-caf",
      storedPath: "raw/inbox/example/memo.caf",
      absolutePath: cafPath,
    },
    scratchDirectory: directory,
    ffmpeg: remoteOnlyFfmpeg,
  });
  assert.equal(cafPrepared.inputPath, cafPath);
  assert.equal(cafPrepared.preparedKind, "audio");

  const wavWithoutMimePath = await writeExternalFile(
    directory,
    "missing-mime.wav",
    "RIFF----WAVEwav-bytes-placeholder",
  );
  const wavWithoutMimePrepared = await prepareAudioInput({
    artifact: {
      captureId: "cap_audio_passthrough_14",
      attachmentId: "att_audio_wav_missing_mime",
      kind: "audio",
      fileName: "missing-mime.wav",
      storedPath: "raw/inbox/example/missing-mime.wav",
      absolutePath: wavWithoutMimePath,
    },
    scratchDirectory: directory,
    ffmpeg: remoteOnlyFfmpeg,
  });
  assert.equal(wavWithoutMimePrepared.inputPath, wavWithoutMimePath);
  assert.equal(wavWithoutMimePrepared.preparedKind, "audio");

  const invalidWavWithoutMimePath = await writeExternalFile(
    directory,
    "spoofed-missing-mime.wav",
    "not-wav-bytes",
  );
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_15",
        attachmentId: "att_audio_spoofed_wav_missing_mime",
        kind: "audio",
        fileName: "spoofed-missing-mime.wav",
        storedPath: "raw/inbox/example/spoofed-missing-mime.wav",
        absolutePath: invalidWavWithoutMimePath,
      },
      scratchDirectory: directory,
      ffmpeg: remoteOnlyFfmpeg,
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );

  const aacPath = await writeExternalBytes(directory, "memo.aac", validAacAdtsBytes());
  const aacPrepared = await prepareAudioInput({
    artifact: {
      captureId: "cap_audio_passthrough_16",
      attachmentId: "att_audio_aac",
      kind: "audio",
      fileName: "memo.aac",
      mime: "audio/aac",
      storedPath: "raw/inbox/example/memo.aac",
      absolutePath: aacPath,
    },
    scratchDirectory: directory,
    ffmpeg: remoteOnlyFfmpeg,
  });
  assert.equal(aacPrepared.inputPath, aacPath);
  assert.equal(aacPrepared.preparedKind, "audio");

  const invalidAacPath = await writeExternalBytes(
    directory,
    "spoofed.aac",
    Buffer.from([0xff, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00]),
  );
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_17",
        attachmentId: "att_audio_spoofed_aac",
        kind: "audio",
        fileName: "spoofed.aac",
        mime: "audio/aac",
        storedPath: "raw/inbox/example/spoofed.aac",
        absolutePath: invalidAacPath,
      },
      scratchDirectory: directory,
      ffmpeg: remoteOnlyFfmpeg,
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );

  const extensionOnlyPath = await writeExternalFile(directory, "memo.ogg", "OggS-ogg-bytes-placeholder");
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_2",
        attachmentId: "att_audio_ogg_extension_only",
        kind: "audio",
        fileName: "memo.ogg",
        storedPath: "raw/inbox/example/memo.ogg",
        absolutePath: extensionOnlyPath,
      },
      scratchDirectory: directory,
      ffmpeg: remoteOnlyFfmpeg,
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );

  const spoofedMp3Path = await writeExternalFile(directory, "spoofed.mp3", "not-audio-bytes");
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_10",
        attachmentId: "att_audio_spoofed_mp3",
        kind: "audio",
        fileName: "spoofed.mp3",
        mime: "audio/mpeg",
        storedPath: "raw/inbox/example/spoofed.mp3",
        absolutePath: spoofedMp3Path,
      },
      scratchDirectory: directory,
      ffmpeg: remoteOnlyFfmpeg,
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );

  const bareId3Path = await writeExternalBytes(
    directory,
    "bare-id3.mp3",
    Buffer.from([
      0x49,
      0x44,
      0x33,
      0x04,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x04,
      0x00,
      0x00,
      0x00,
      0x00,
    ]),
  );
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_12",
        attachmentId: "att_audio_bare_id3_mp3",
        kind: "audio",
        fileName: "bare-id3.mp3",
        mime: "audio/mpeg",
        storedPath: "raw/inbox/example/bare-id3.mp3",
        absolutePath: bareId3Path,
      },
      scratchDirectory: directory,
      ffmpeg: remoteOnlyFfmpeg,
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );

  const invalidSyncMp3Path = await writeExternalBytes(
    directory,
    "invalid-sync.mp3",
    Buffer.from([0xff, 0xe0, 0x00, 0x00, 0x00]),
  );
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_13",
        attachmentId: "att_audio_invalid_sync_mp3",
        kind: "audio",
        fileName: "invalid-sync.mp3",
        mime: "audio/mpeg",
        storedPath: "raw/inbox/example/invalid-sync.mp3",
        absolutePath: invalidSyncMp3Path,
      },
      scratchDirectory: directory,
      ffmpeg: remoteOnlyFfmpeg,
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );

  const oggPath = await writeExternalFile(directory, "memo.ogg", "OggS-ogg-container-placeholder");
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_11",
        attachmentId: "att_audio_ogg_container",
        kind: "audio",
        fileName: "memo.ogg",
        mime: "audio/ogg",
        storedPath: "raw/inbox/example/memo.ogg",
        absolutePath: oggPath,
      },
      scratchDirectory: directory,
      ffmpeg: remoteOnlyFfmpeg,
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );

  // AMR is not verified against the remote model, so it still needs ffmpeg.
  const amrPath = await writeExternalFile(directory, "memo.amr", "amr-bytes-placeholder");
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_3",
        attachmentId: "att_audio_amr",
        kind: "audio",
        fileName: "memo.amr",
        mime: "audio/amr",
        storedPath: "raw/inbox/example/memo.amr",
        absolutePath: amrPath,
      },
      scratchDirectory: directory,
      ffmpeg: remoteOnlyFfmpeg,
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );

  // audio/mp4 routinely carries video, so known video-capable MIME/container
  // signals stay on the ffmpeg -vn path rather than passthrough.
  const mp4Path = await writeExternalFile(directory, "memo-audio.mp4", "mp4-bytes-placeholder");
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_5",
        attachmentId: "att_audio_mp4",
        kind: "audio",
        fileName: "memo-audio.mp4",
        mime: "audio/mp4",
        storedPath: "raw/inbox/example/memo-audio.mp4",
        absolutePath: mp4Path,
      },
      scratchDirectory: directory,
      ffmpeg: remoteOnlyFfmpeg,
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );

  const m4aNamedMp4Path = await writeExternalFile(directory, "voice-note.m4a", "mp4-bytes-placeholder");
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_6",
        attachmentId: "att_audio_mp4_m4a_name",
        kind: "audio",
        fileName: "voice-note.m4a",
        mime: "audio/mp4",
        storedPath: "raw/inbox/example/voice-note.m4a",
        absolutePath: m4aNamedMp4Path,
      },
      scratchDirectory: directory,
      ffmpeg: remoteOnlyFfmpeg,
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );

  const parameterizedMp4MimePath = await writeExternalFile(
    directory,
    "voice-note-parameterized.m4a",
    "mp4-bytes-placeholder",
  );
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_9",
        attachmentId: "att_audio_parameterized_mp4_mime",
        kind: "audio",
        fileName: "voice-note-parameterized.m4a",
        mime: " audio/mp4; codecs=mp4a.40.2 ",
        storedPath: "raw/inbox/example/voice-note-parameterized.m4a",
        absolutePath: parameterizedMp4MimePath,
      },
      scratchDirectory: directory,
      ffmpeg: remoteOnlyFfmpeg,
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );

  const videoMimeWithAudioNamePath = await writeExternalFile(
    directory,
    "video-disguised-as-audio.m4a",
    "video-bytes-placeholder",
  );
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_7",
        attachmentId: "att_video_mime_audio_name",
        kind: "audio",
        fileName: "video-disguised-as-audio.m4a",
        mime: "video/mp4",
        storedPath: "raw/inbox/example/video-disguised-as-audio.m4a",
        absolutePath: videoMimeWithAudioNamePath,
      },
      scratchDirectory: directory,
      ffmpeg: remoteOnlyFfmpeg,
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );

  const mp4NamedM4aMimePath = await writeExternalFile(directory, "looks-safe.mp4", "mp4-bytes-placeholder");
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_8",
        attachmentId: "att_mp4_name_m4a_mime",
        kind: "audio",
        fileName: "looks-safe.mp4",
        mime: "audio/x-m4a",
        storedPath: "raw/inbox/example/looks-safe.mp4",
        absolutePath: mp4NamedM4aMimePath,
      },
      scratchDirectory: directory,
      ffmpeg: remoteOnlyFfmpeg,
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );

  // Without the remote-only flag the local whisper lane may run, so compressed
  // audio still normalizes through ffmpeg.
  const mp3Path = await writeExternalFile(directory, "memo.mp3", "mp3-bytes-placeholder");
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_4",
        attachmentId: "att_audio_mp3_local",
        kind: "audio",
        fileName: "memo.mp3",
        mime: "audio/mpeg",
        storedPath: "raw/inbox/example/memo.mp3",
        absolutePath: mp3Path,
      },
      scratchDirectory: directory,
      ffmpeg: disableFfmpegLookup(),
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );
});

test("remote-only audio passthrough skips an available ffmpeg while video still extracts through it", async () => {
  const directory = await makeTempDirectory("murph-parser-audio-passthrough-ffmpeg");
  const invocationLogPath = path.join(directory, "ffmpeg-invocations.log");
  const fakeFfmpegPath = await writeExecutableFile(
    directory,
    "fake-passthrough-ffmpeg",
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(invocationLogPath)}, JSON.stringify(process.argv.slice(2)) + "\\n", "utf8");`,
    ].join("\n"),
  );
  const remoteOnlyFfmpeg = {
    commandCandidates: [fakeFfmpegPath],
    allowSystemLookup: false,
    remoteTranscriptionOnly: true,
  };

  // WAV previously transcoded to 16 kHz mono whenever ffmpeg resolved; the
  // remote-only lane must return the original bytes without invoking ffmpeg.
  const wavPath = await writeExternalFile(directory, "memo.wav", "RIFF----WAVEwav-bytes-placeholder");
  const wavPrepared = await prepareAudioInput({
    artifact: {
      captureId: "cap_audio_passthrough_ffmpeg_1",
      attachmentId: "att_audio_wav_remote_only",
      kind: "audio",
      fileName: "memo.wav",
      mime: "audio/wav",
      storedPath: "raw/inbox/example/memo.wav",
      absolutePath: wavPath,
    },
    scratchDirectory: directory,
    ffmpeg: remoteOnlyFfmpeg,
  });
  assert.equal(wavPrepared.inputPath, wavPath);
  assert.equal(wavPrepared.preparedKind, "audio");

  const mp3Path = await writeExternalBytes(directory, "memo.mp3", validId3Mp3Bytes());
  const mp3Prepared = await prepareAudioInput({
    artifact: {
      captureId: "cap_audio_passthrough_ffmpeg_2",
      attachmentId: "att_audio_mp3_remote_only",
      kind: "audio",
      fileName: "memo.mp3",
      mime: "audio/mpeg",
      storedPath: "raw/inbox/example/memo.mp3",
      absolutePath: mp3Path,
    },
    scratchDirectory: directory,
    ffmpeg: remoteOnlyFfmpeg,
  });
  assert.equal(mp3Prepared.inputPath, mp3Path);
  assert.equal(mp3Prepared.preparedKind, "audio");
  await assert.rejects(fs.access(invocationLogPath));

  // Video stays on ffmpeg extraction, and the video-capable .mp4 container is
  // deliberately absent from the remote passthrough allowlist.
  const videoPath = await writeExternalFile(directory, "clip.mp4", "mp4-bytes-placeholder");
  const videoPrepared = await prepareAudioInput({
    artifact: {
      captureId: "cap_audio_passthrough_ffmpeg_3",
      attachmentId: "att_video_remote_only",
      kind: "video",
      fileName: "clip.mp4",
      mime: "video/mp4",
      storedPath: "raw/inbox/example/clip.mp4",
      absolutePath: videoPath,
    },
    scratchDirectory: directory,
    ffmpeg: remoteOnlyFfmpeg,
  });
  assert.equal(videoPrepared.inputPath, path.join(directory, "att_video_remote_only.mp3"));
  assert.equal(videoPrepared.preparedKind, "audio");
  const invocations = (await fs.readFile(invocationLogPath, "utf8")).trim().split("\n");
  assert.equal(invocations.length, 1);
  const videoInvocation = JSON.parse(invocations[0] ?? "[]");
  assert.deepEqual(videoInvocation, [
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "64k",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    videoPrepared.inputPath,
  ]);
});

test("remote-only audio passthrough matches mime case-insensitively and requires the flag to be exactly true", async () => {
  const directory = await makeTempDirectory("murph-parser-audio-passthrough-case");
  const remoteOnlyFfmpeg = { ...disableFfmpegLookup(), remoteTranscriptionOnly: true };

  // Mixed-case mime with an unrecognized extension exercises mime matching alone.
  const upperMimePath = await writeExternalBytes(directory, "memo.bin", validMp3FrameBytes());
  const upperMimePrepared = await prepareAudioInput({
    artifact: {
      captureId: "cap_audio_passthrough_case_1",
      attachmentId: "att_audio_upper_mime",
      kind: "audio",
      fileName: "memo.bin",
      mime: "Audio/MPEG",
      storedPath: "raw/inbox/example/memo.bin",
      absolutePath: upperMimePath,
    },
    scratchDirectory: directory,
    ffmpeg: remoteOnlyFfmpeg,
  });
  assert.equal(upperMimePrepared.inputPath, upperMimePath);
  assert.equal(upperMimePrepared.preparedKind, "audio");

  const upperExtensionPath = await writeExternalBytes(directory, "MEMO.MP3", validMp3FrameBytes());
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_case_2",
        attachmentId: "att_audio_upper_extension",
        kind: "audio",
        fileName: "MEMO.MP3",
        storedPath: "raw/inbox/example/MEMO.MP3",
        absolutePath: upperExtensionPath,
      },
      scratchDirectory: directory,
      ffmpeg: remoteOnlyFfmpeg,
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );

  // The flag must be exactly true; an explicit false keeps the ffmpeg requirement.
  const mp3Path = await writeExternalFile(directory, "memo.mp3", "mp3-bytes-placeholder");
  await assert.rejects(
    prepareAudioInput({
      artifact: {
        captureId: "cap_audio_passthrough_case_3",
        attachmentId: "att_audio_mp3_flag_false",
        kind: "audio",
        fileName: "memo.mp3",
        mime: "audio/mpeg",
        storedPath: "raw/inbox/example/memo.mp3",
        absolutePath: mp3Path,
      },
      scratchDirectory: directory,
      ffmpeg: { ...disableFfmpegLookup(), remoteTranscriptionOnly: false },
    }),
    /ffmpeg is required to normalize non-WAV audio attachments for transcription/u,
  );
});

test("remote-only audio passthrough falls back to ffmpeg when the original exceeds the remote upload cap", async () => {
  const directory = await makeTempDirectory("murph-parser-audio-passthrough-cap");
  const invocationLogPath = path.join(directory, "ffmpeg-invocations.log");
  const fakeFfmpegPath = await writeExecutableFile(
    directory,
    "fake-passthrough-cap-ffmpeg",
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(invocationLogPath)}, JSON.stringify(process.argv.slice(2)) + "\\n", "utf8");`,
    ].join("\n"),
  );
  const oversizedMp3 = Buffer.alloc(16 * 1024 * 1024 + 1);
  validMp3FrameBytes().copy(oversizedMp3);
  const mp3Path = await writeExternalBytes(directory, "oversized.mp3", oversizedMp3);

  const prepared = await prepareAudioInput({
    artifact: {
      captureId: "cap_audio_passthrough_cap",
      attachmentId: "att_audio_passthrough_cap",
      kind: "audio",
      fileName: "oversized.mp3",
      mime: "audio/mpeg",
      storedPath: "raw/inbox/example/oversized.mp3",
      absolutePath: mp3Path,
    },
    scratchDirectory: directory,
    ffmpeg: {
      commandCandidates: [fakeFfmpegPath],
      allowSystemLookup: false,
      remoteTranscriptionOnly: true,
    },
  });

  assert.equal(prepared.inputPath, path.join(directory, "att_audio_passthrough_cap.mp3"));
  assert.equal(prepared.preparedKind, "audio");
  const invocations = (await fs.readFile(invocationLogPath, "utf8")).trim().split("\n");
  assert.equal(invocations.length, 1);
  const invocation = JSON.parse(invocations[0] ?? "[]");
  assert.deepEqual(invocation, [
    "-y",
    "-i",
    mp3Path,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "64k",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    prepared.inputPath,
  ]);
});

test("shared executable helpers preserve lazy resolution, availability, and missing-tool errors", async () => {
  const directory = await makeTempDirectory("murph-parser-executable");
  const executablePath = await writeExecutableFile(
    directory,
    "fake-tool",
    "#!/usr/bin/env node\nprocess.exit(0);\n",
  );
  const nonExecutablePath = await writeExternalFile(directory, "fake-tool.txt", "tool-placeholder");
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
    process.env.TEST_COMMAND = nonExecutablePath;
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
      pdfinfo: {
        command: fakeToolPath,
      },
      pdftotext: {
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
  assert.equal(loaded.config.tools.pdfinfo?.command, fakeToolPath);
  assert.equal(loaded.config.tools.pdftotext?.command, fakeToolPath);
  assert.equal(loaded.config.tools.whisper?.modelPath, "models/fake.bin");

  const doctor = await discoverParserToolchain({ vaultRoot });
  assert.equal(doctor.configPath, getParserToolchainPaths(vaultRoot).configPath);
  assert.deepEqual(doctor.tools.ffmpeg, {
    available: true,
    command: fakeToolPath,
    source: "config",
    reason: "ffmpeg CLI available.",
  });
  assert.deepEqual(doctor.tools.pdfinfo, {
    available: true,
    command: fakeToolPath,
    source: "config",
    reason: "pdfinfo CLI available.",
  });
  assert.deepEqual(doctor.tools.pdftotext, {
    available: true,
    command: fakeToolPath,
    source: "config",
    reason: "pdftotext CLI available.",
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
  const configured = await createConfiguredParserRegistry({ vaultRoot });
  assert.deepEqual(configured.doctor.tools.whisper, doctor.tools.whisper);
  const whisperProvider = configured.registry.providers.find((provider) => provider.id === "whisper.cpp");
  assert.ok(whisperProvider);
  assert.deepEqual(await whisperProvider.discover(), {
    available: false,
    reason: "Whisper model path does not exist.",
    executablePath: fakeToolPath,
  });
  const audioPath = await writeExternalFile(vaultRoot, "missing-model.wav", "wav-placeholder");
  await assert.rejects(
    configured.registry.select({
      intent: "attachment_text",
      artifact: {
        captureId: "cap_whisper_missing_model",
        attachmentId: "att_whisper_missing_model",
        kind: "audio",
        fileName: "missing-model.wav",
        mime: "audio/wav",
        storedPath: "raw/inbox/example/missing-model.wav",
        absolutePath: audioPath,
      },
      inputPath: audioPath,
      scratchDirectory: vaultRoot,
    }),
    /No parser provider available for artifact att_whisper_missing_model/u,
  );

  await fs.rm(vaultRoot, { recursive: true, force: true });
  await fs.rm(toolsDirectory, { recursive: true, force: true });
});

test("configured parser registry keeps the discovered whisper command snapshot pinned", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-toolchain-command-snapshot");
  const discoveredCommandDirectory = await makeTempDirectory("murph-parser-toolchain-command-discovered");
  const driftedCommandDirectory = await makeTempDirectory("murph-parser-toolchain-command-drifted");
  const modelPath = path.join(vaultRoot, "models", "runtime.bin");
  await fs.mkdir(path.dirname(modelPath), { recursive: true });
  await fs.writeFile(modelPath, "model", "utf8");
  const discoveredCommandPath = await writeExecutableFile(
    discoveredCommandDirectory,
    "fake-whisper-discovered",
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const outputBase = args[args.indexOf('-of') + 1];",
      "fs.writeFileSync(`${outputBase}.txt`, 'discovered command pinned\\n', 'utf8');",
    ].join("\n"),
  );
  const driftedCommandPath = await writeExecutableFile(
    driftedCommandDirectory,
    "fake-whisper-drifted",
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const outputBase = args[args.indexOf('-of') + 1];",
      "fs.writeFileSync(`${outputBase}.txt`, 'drifted command used\\n', 'utf8');",
    ].join("\n"),
  );
  const audioPath = await writeExternalFile(discoveredCommandDirectory, "voice.wav", "wav-placeholder");
  const previousWhisperCommand = process.env.WHISPER_COMMAND;

  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });
  await writeParserToolchainConfig({
    vaultRoot,
    tools: {
      whisper: {
        modelPath: "./models/runtime.bin",
      },
    },
  });

  try {
    process.env.WHISPER_COMMAND = discoveredCommandPath;
    const configured = await createConfiguredParserRegistry({ vaultRoot });
    assert.equal(configured.doctor.tools.whisper.command, discoveredCommandPath);
    process.env.WHISPER_COMMAND = driftedCommandPath;

    const run = await configured.registry.run({
      intent: "attachment_text",
      artifact: {
        captureId: "cap_whisper_command_snapshot",
        attachmentId: "att_whisper_command_snapshot",
        kind: "audio",
        fileName: "voice.wav",
        mime: "audio/wav",
        storedPath: "raw/inbox/example/voice.wav",
        absolutePath: audioPath,
      },
      inputPath: audioPath,
      scratchDirectory: driftedCommandDirectory,
    });

    assert.equal(run.selection.provider.id, "whisper.cpp");
    assert.equal(run.selection.availability.executablePath, discoveredCommandPath);
    assert.equal(run.result.text, "discovered command pinned");
  } finally {
    if (previousWhisperCommand === undefined) {
      delete process.env.WHISPER_COMMAND;
    } else {
      process.env.WHISPER_COMMAND = previousWhisperCommand;
    }
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(discoveredCommandDirectory, { recursive: true, force: true });
    await fs.rm(driftedCommandDirectory, { recursive: true, force: true });
  }
});

test("configured parser registry keeps the discovered whisper model snapshot pinned", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-toolchain-model-snapshot");
  const toolsDirectory = await makeTempDirectory("murph-parser-toolchain-model-snapshot-bin");
  const discoveredModelPath = path.join(vaultRoot, "models", "discovered.bin");
  const driftedModelPath = path.join(vaultRoot, "models", "drifted.bin");
  await fs.mkdir(path.dirname(discoveredModelPath), { recursive: true });
  await fs.writeFile(discoveredModelPath, "model", "utf8");
  await fs.writeFile(driftedModelPath, "drifted-model", "utf8");
  const commandPath = await writeExecutableFile(
    toolsDirectory,
    "fake-whisper-model-snapshot",
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const modelPath = args[args.indexOf('-m') + 1];",
      `if (modelPath !== ${JSON.stringify(discoveredModelPath)}) {`,
      "  console.error(`unexpected model path: ${modelPath}`);",
      "  process.exit(1);",
      "}",
      "const outputBase = args[args.indexOf('-of') + 1];",
      "fs.writeFileSync(`${outputBase}.txt`, 'discovered model pinned\\n', 'utf8');",
    ].join("\n"),
  );
  const audioPath = await writeExternalFile(toolsDirectory, "voice.wav", "wav-placeholder");
  const previousWhisperCommand = process.env.WHISPER_COMMAND;
  const previousWhisperModelPath = process.env.WHISPER_MODEL_PATH;

  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  try {
    process.env.WHISPER_COMMAND = commandPath;
    process.env.WHISPER_MODEL_PATH = discoveredModelPath;
    const configured = await createConfiguredParserRegistry({ vaultRoot });
    assert.equal(configured.doctor.tools.whisper.modelPath, discoveredModelPath);
    process.env.WHISPER_MODEL_PATH = driftedModelPath;

    const run = await configured.registry.run({
      intent: "attachment_text",
      artifact: {
        captureId: "cap_whisper_model_snapshot",
        attachmentId: "att_whisper_model_snapshot",
        kind: "audio",
        fileName: "voice.wav",
        mime: "audio/wav",
        storedPath: "raw/inbox/example/voice.wav",
        absolutePath: audioPath,
      },
      inputPath: audioPath,
      scratchDirectory: toolsDirectory,
    });

    assert.equal(run.selection.provider.id, "whisper.cpp");
    assert.equal(run.selection.availability.details?.modelPath, discoveredModelPath);
    assert.equal(run.result.text, "discovered model pinned");
  } finally {
    if (previousWhisperCommand === undefined) {
      delete process.env.WHISPER_COMMAND;
    } else {
      process.env.WHISPER_COMMAND = previousWhisperCommand;
    }
    if (previousWhisperModelPath === undefined) {
      delete process.env.WHISPER_MODEL_PATH;
    } else {
      process.env.WHISPER_MODEL_PATH = previousWhisperModelPath;
    }
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(toolsDirectory, { recursive: true, force: true });
  }
});

test("configured parser registry accepts a platform toolchain without env or system lookup", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-toolchain-platform");
  const toolsDirectory = await makeTempDirectory("murph-parser-toolchain-platform-bin");
  const modelPath = path.join(vaultRoot, "models", "platform.bin");
  const driftedModelPath = path.join(vaultRoot, "models", "drifted.bin");
  await fs.mkdir(path.dirname(modelPath), { recursive: true });
  await fs.writeFile(modelPath, "model", "utf8");
  await fs.writeFile(driftedModelPath, "drifted-model", "utf8");
  const platformWhisperCommandPath = await writeExecutableFile(
    toolsDirectory,
    "fake-platform-whisper",
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
      "fs.writeFileSync(`${outputBase}.txt`, 'platform toolchain pinned\\n', 'utf8');",
    ].join("\n"),
  );
  const driftedWhisperCommandPath = await writeExecutableFile(
    toolsDirectory,
    "fake-drifted-whisper",
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const outputBase = args[args.indexOf('-of') + 1];",
      "fs.writeFileSync(`${outputBase}.txt`, 'drifted env command used\\n', 'utf8');",
    ].join("\n"),
  );
  const fakeFfmpegPath = await writeExecutableFile(
    toolsDirectory,
    "fake-platform-ffmpeg",
    "#!/usr/bin/env node\nprocess.exit(0);\n",
  );
  const audioPath = await writeExternalFile(toolsDirectory, "voice.wav", "wav-placeholder");
  const previousWhisperCommand = process.env.WHISPER_COMMAND;
  const previousWhisperModelPath = process.env.WHISPER_MODEL_PATH;

  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  try {
    process.env.WHISPER_COMMAND = driftedWhisperCommandPath;
    process.env.WHISPER_MODEL_PATH = driftedModelPath;
    const configured = await createConfiguredParserRegistry({
      readVaultToolchainConfig: false,
      toolchain: {
        source: "platform",
        tools: {
          ffmpeg: {
            command: fakeFfmpegPath,
          },
          whisper: {
            command: platformWhisperCommandPath,
            modelPath,
          },
        },
      },
      vaultRoot,
    });

    assert.deepEqual(configured.doctor.tools.ffmpeg, {
      available: true,
      command: fakeFfmpegPath,
      source: "platform",
      reason: "ffmpeg CLI available.",
    });
    assert.deepEqual(configured.ffmpeg, {
      commandCandidates: [fakeFfmpegPath],
      allowSystemLookup: false,
    });
    assert.deepEqual(configured.doctor.tools.whisper, {
      available: true,
      command: platformWhisperCommandPath,
      modelPath,
      source: "platform",
      reason: "whisper.cpp CLI and model path configured.",
    });

    const run = await configured.registry.run({
      intent: "attachment_text",
      artifact: {
        captureId: "cap_whisper_platform_toolchain",
        attachmentId: "att_whisper_platform_toolchain",
        kind: "audio",
        fileName: "voice.wav",
        mime: "audio/wav",
        storedPath: "raw/inbox/example/voice.wav",
        absolutePath: audioPath,
      },
      inputPath: audioPath,
      scratchDirectory: toolsDirectory,
    });

    assert.equal(run.selection.provider.id, "whisper.cpp");
    assert.equal(run.selection.availability.executablePath, platformWhisperCommandPath);
    assert.equal(run.selection.availability.details?.modelPath, modelPath);
    assert.equal(run.result.text, "platform toolchain pinned");
  } finally {
    if (previousWhisperCommand === undefined) {
      delete process.env.WHISPER_COMMAND;
    } else {
      process.env.WHISPER_COMMAND = previousWhisperCommand;
    }
    if (previousWhisperModelPath === undefined) {
      delete process.env.WHISPER_MODEL_PATH;
    } else {
      process.env.WHISPER_MODEL_PATH = previousWhisperModelPath;
    }
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(toolsDirectory, { recursive: true, force: true });
  }
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

test("parser toolchain discovery resolves config-relative commands from the vault root and rejects non-executable overrides", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-toolchain-relative-command");
  const outsideDirectory = await makeTempDirectory("murph-parser-toolchain-relative-command-cwd");
  const modelPath = path.join(vaultRoot, "models", "relative.bin");
  await fs.mkdir(path.dirname(modelPath), { recursive: true });
  await fs.writeFile(modelPath, "model", "utf8");
  const ffmpegPath = await writeExecutableFile(
    vaultRoot,
    path.join("tools", "ffmpeg-local"),
    "#!/usr/bin/env node\nprocess.exit(0);\n",
  );
  const whisperPath = await writeExecutableFile(
    vaultRoot,
    path.join("tools", "whisper-local"),
    [
      `#!${process.execPath}`,
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const outputBase = args[args.indexOf('-of') + 1];",
      "fs.writeFileSync(`${outputBase}.txt`, 'relative command ok\\n', 'utf8');",
    ].join("\n"),
  );
  await writeExternalFile(
    vaultRoot,
    path.join("tools", "not-executable.txt"),
    "not executable",
  );
  const invalidDirectoryPath = path.join(vaultRoot, "tools", "not-a-command");
  await fs.mkdir(invalidDirectoryPath, { recursive: true });
  const audioPath = await writeExternalFile(outsideDirectory, "voice.wav", "wav-placeholder");
  const previousCwd = process.cwd();
  const previousFfmpegCommand = process.env.FFMPEG_COMMAND;
  const previousWhisperCommand = process.env.WHISPER_COMMAND;
  const previousPath = process.env.PATH;

  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  try {
    process.env.PATH = "";
    await writeParserToolchainConfig({
      vaultRoot,
      tools: {
        ffmpeg: {
          command: process.platform === "win32" ? ".\\tools\\ffmpeg-local.cmd" : ".\\tools\\ffmpeg-local",
        },
        whisper: {
          command: process.platform === "win32" ? ".\\tools\\whisper-local.cmd" : "./tools/whisper-local",
          modelPath: "models/relative.bin",
        },
      },
    });

    process.chdir(outsideDirectory);
    const doctor = await discoverParserToolchain({ vaultRoot });
    assert.equal(doctor.tools.ffmpeg.available, true);
    assert.equal(doctor.tools.ffmpeg.command, ffmpegPath);
    assert.equal(doctor.tools.ffmpeg.source, "config");
    assert.equal(doctor.tools.whisper.available, true);
    assert.equal(doctor.tools.whisper.command, whisperPath);
    assert.equal(doctor.tools.whisper.modelPath, "models/relative.bin");
    assert.equal(doctor.tools.whisper.source, "config");

    const configured = await createConfiguredParserRegistry({ vaultRoot });
    const run = await configured.registry.run({
      intent: "attachment_text",
      artifact: {
        captureId: "cap_whisper_relative",
        attachmentId: "att_whisper_relative",
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
    assert.equal(run.result.text, "relative command ok");

    await writeParserToolchainConfig({
      vaultRoot,
      tools: {
        ffmpeg: {
          command: "./tools/not-executable.txt",
        },
        whisper: {
          command: "./tools/not-a-command",
        },
      },
    });
    const invalidDoctor = await discoverParserToolchain({ vaultRoot });
    assert.deepEqual(invalidDoctor.tools.ffmpeg, {
      available: false,
      command: null,
      source: "config",
      reason: "ffmpeg CLI not found.",
    });
    assert.deepEqual(invalidDoctor.tools.whisper, {
      available: false,
      command: null,
      modelPath: "models/relative.bin",
      source: "config",
      reason: "whisper.cpp CLI executable not found.",
    });

    process.env.FFMPEG_COMMAND = ffmpegPath;
    process.env.WHISPER_COMMAND = whisperPath;
    process.env.PATH = path.dirname(whisperPath);
    const envShadowedDoctor = await discoverParserToolchain({ vaultRoot });
    assert.deepEqual(envShadowedDoctor.tools.ffmpeg, invalidDoctor.tools.ffmpeg);
    assert.deepEqual(envShadowedDoctor.tools.whisper, invalidDoctor.tools.whisper);
  } finally {
    process.chdir(previousCwd);
    if (previousFfmpegCommand === undefined) {
      delete process.env.FFMPEG_COMMAND;
    } else {
      process.env.FFMPEG_COMMAND = previousFfmpegCommand;
    }
    if (previousWhisperCommand === undefined) {
      delete process.env.WHISPER_COMMAND;
    } else {
      process.env.WHISPER_COMMAND = previousWhisperCommand;
    }
    process.env.PATH = previousPath;
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(outsideDirectory, { recursive: true, force: true });
  }
});

test("parser toolchain config rejects relative whisper model paths that escape the vault root", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-toolchain-escape");

  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  await assert.rejects(
    writeParserToolchainConfig({
      vaultRoot,
      tools: {
        whisper: {
          modelPath: "../shared/model.bin",
        },
      },
    }),
    /modelPath relative paths must stay inside the vault root/u,
  );

  const { configPath } = getParserToolchainPaths(vaultRoot);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(
    configPath,
    `${JSON.stringify(
      createVersionedJsonStateEnvelope({
        schema: "murph.parser-toolchain-config.v1",
        schemaVersion: 1,
        value: {
          updatedAt: "2026-03-13T12:34:56.000Z",
          tools: {
            whisper: {
              modelPath: "../shared/model.bin",
            },
          },
        },
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );

  await assert.rejects(
    readParserToolchainConfig(vaultRoot),
    /modelPath relative paths must stay inside the vault root/u,
  );

  await fs.rm(vaultRoot, { recursive: true, force: true });
});

test("parser toolchain config rejects relative whisper model paths that escape through symlinks", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-toolchain-symlink-escape");
  const outsideRoot = await makeTempDirectory("murph-parser-toolchain-symlink-outside");

  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });
  await fs.writeFile(path.join(outsideRoot, "model.bin"), "model", "utf8");
  await fs.symlink(outsideRoot, path.join(vaultRoot, "models-link"));

  await assert.rejects(
    writeParserToolchainConfig({
      vaultRoot,
      tools: {
        whisper: {
          modelPath: "models-link/model.bin",
        },
      },
    }),
    /modelPath relative paths must stay inside the vault root/u,
  );

  const { configPath } = getParserToolchainPaths(vaultRoot);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(
    configPath,
    `${JSON.stringify(
      createVersionedJsonStateEnvelope({
        schema: "murph.parser-toolchain-config.v1",
        schemaVersion: 1,
        value: {
          updatedAt: "2026-03-13T12:34:56.000Z",
          tools: {
            whisper: {
              modelPath: "models-link/model.bin",
            },
          },
        },
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );

  await assert.rejects(
    readParserToolchainConfig(vaultRoot),
    /modelPath relative paths must stay inside the vault root/u,
  );

  await fs.rm(vaultRoot, { recursive: true, force: true });
  await fs.rm(outsideRoot, { recursive: true, force: true });
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

test("whisper.cpp provider reports command signals before checking transcript files", async () => {
  if (process.platform === "win32") {
    return;
  }

  const directory = await makeTempDirectory("murph-parser-whisper-signal");
  const audioPath = await writeExternalFile(directory, "note.wav", "wav-bytes-placeholder");
  const modelPath = await writeExternalFile(directory, "ggml-base.en.bin", "model-placeholder");
  const commandPath = await writeExecutableFile(
    directory,
    "fake-whisper-signal.sh",
    [
      "#!/usr/bin/env sh",
      "echo 'sensitive transcript text' >&2",
      "kill -TERM $$",
    ].join("\n"),
  );
  const provider = createWhisperCppProvider({
    commandCandidates: [commandPath],
    modelPath,
  });

  await assert.rejects(
    provider.run({
      intent: "attachment_text",
      artifact: {
        captureId: "cap_whisper_signal",
        attachmentId: "att_whisper_signal",
        kind: "audio",
        fileName: "note.wav",
        mime: "audio/wav",
        storedPath: "raw/inbox/example/note.wav",
        absolutePath: audioPath,
      },
      inputPath: audioPath,
      scratchDirectory: directory,
    }),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.match(error.message, /Command failed \(fake-whisper-signal\.sh\): signal SIGTERM/u);
      assert.doesNotMatch(error.message, /sensitive transcript text/u);
      return true;
    },
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
      runtime: "node",
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

test("parseAttachment accepts CSV-sized provider output within the raised text guardrail", async () => {
  const scratchRoot = await makeTempDirectory("murph-parser-scratch-output-large");
  const sourceRoot = await makeTempDirectory("murph-parser-scratch-output-large-source");
  const inputPath = await writeExternalFile(sourceRoot, "scan.csv", "csv-bytes-placeholder");
  const raisedTextLimit = 10 * 1024 * 1024;
  const csvBlockCount = 31_500;
  const registry = createParserRegistry([
    {
      id: "fake-csv",
      locality: "local",
      openness: "open_source",
      runtime: "node",
      priority: 100,
      async discover() {
        return {
          available: true,
          reason: "available for parser output limits test",
        };
      },
      supports() {
        return true;
      },
      async run() {
        return {
          text: "x".repeat(raisedTextLimit),
          markdown: "m".repeat(1_000_000),
          blocks: Array.from({ length: csvBlockCount }, (_, index) => ({
            id: `row_${index}`,
            kind: "line",
            order: index,
            text: `row ${index}`,
          })),
        };
      },
    },
  ]);

  const result = await parseAttachment({
    artifact: {
      captureId: "cap_output_large",
      attachmentId: "att_output_large",
      kind: "document",
      fileName: "scan.csv",
      mime: "text/comma-separated-values",
      storedPath: "raw/inbox/example/scan.csv",
      absolutePath: inputPath,
    },
    registry,
    scratchRoot,
  });

  assert.equal(result.output.text.length, raisedTextLimit);
  assert.equal(result.output.markdown.length, 1_000_000);
  assert.equal(result.output.blocks.length, csvBlockCount);
  assert.deepEqual(await fs.readdir(scratchRoot), []);
});

test("parseAttachment rejects provider output above the raised text guardrail", async () => {
  const scratchRoot = await makeTempDirectory("murph-parser-scratch-output-limits");
  const sourceRoot = await makeTempDirectory("murph-parser-scratch-output-limits-source");
  const inputPath = await writeExternalFile(sourceRoot, "scan.png", "image-bytes-placeholder");
  const raisedTextLimit = 10 * 1024 * 1024;
  const registry = createParserRegistry([
    {
      id: "fake-image",
      locality: "local",
      openness: "open_source",
      runtime: "node",
      priority: 100,
      async discover() {
        return {
          available: true,
          reason: "available for parser output limits test",
        };
      },
      supports() {
        return true;
      },
      async run() {
        return {
          text: "x".repeat(raisedTextLimit + 1),
        };
      },
    },
  ]);

  await assert.rejects(
    () =>
      parseAttachment({
        artifact: {
          captureId: "cap_output_limits",
          attachmentId: "att_output_limits",
          kind: "image",
          fileName: "scan.png",
          mime: "image/png",
          storedPath: "raw/inbox/example/scan.png",
          absolutePath: inputPath,
        },
        registry,
        scratchRoot,
      }),
    /Parser text exceeds/u,
  );

  assert.deepEqual(await fs.readdir(scratchRoot), []);
});

test("writeParserResult publishes one private validated result per attempt", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-publish-rerun");
  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  const firstOutput = {
    schema: "murph.parser-output.v1" as const,
    providerId: "fake-provider",
    artifact: {
      captureId: "cap_publish_rerun",
      attachmentId: "att_publish_rerun",
      kind: "image" as const,
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
  };
  const first = await writeParserResult({
    attempt: 1,
    vaultRoot,
    output: firstOutput,
  });
  assert.equal(first.resultPath, "derived/inbox/cap_publish_rerun/attachments/att_publish_rerun/attempts/0001/result.json");
  assert.equal(
    (await fs.stat(path.join(vaultRoot, first.attemptDirectoryPath))).mode & 0o777,
    0o700,
  );
  assert.equal(
    (await fs.stat(path.join(vaultRoot, first.resultPath))).mode & 0o777,
    0o600,
  );
  assert.deepEqual(
    await readParserResult({ vaultRoot, resultPath: first.resultPath }),
    firstOutput,
  );
  assert.deepEqual(await fs.readdir(path.join(vaultRoot, first.attemptDirectoryPath)), [
    "result.json",
  ]);

  const second = await writeParserResult({
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

  assert.equal(second.resultPath, "derived/inbox/cap_publish_rerun/attachments/att_publish_rerun/attempts/0002/result.json");
  assert.deepEqual(await fs.readdir(path.join(vaultRoot, second.attemptDirectoryPath)), [
    "result.json",
  ]);
  await assert.rejects(fs.access(path.join(vaultRoot, second.attemptDirectoryPath, "tables.json")));
});

test("parser result reads enforce the canonical serialized byte limit", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-result-size-limit");
  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  const published = await writeParserResult({
    attempt: 1,
    vaultRoot,
    output: {
      schema: "murph.parser-output.v1",
      providerId: "fake-provider",
      artifact: {
        captureId: "cap_result_limit",
        attachmentId: "att_result_limit",
        kind: "document",
        storedPath: "raw/inbox/example/result-limit.txt",
      },
      text: "bounded",
      markdown: "bounded",
      blocks: [],
      tables: [],
      metadata: {},
      createdAt: "2026-03-13T12:00:00.000Z",
    },
  });
  await fs.truncate(
    path.join(vaultRoot, published.resultPath),
    PARSER_RESULT_MAX_BYTES + 1,
  );

  await assert.rejects(
    () => readParserResult({ vaultRoot, resultPath: published.resultPath }),
    new RegExp(`Parser result exceeds the ${PARSER_RESULT_MAX_BYTES}-byte limit\\.`),
  );
});

test("writeParserResult rejects unsafe or malformed artifact IDs before publishing outside derived inbox", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-publish-unsafe-ids");
  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  await assert.rejects(
    () =>
      writeParserResult({
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
      writeParserResult({
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
      writeParserResult({
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
      writeParserResult({
        attempt: 1,
        vaultRoot,
        output: {
          schema: "murph.parser-output.v1",
          providerId: "fake-provider",
          artifact: {
            captureId: "cap_publish_type",
            // @ts-expect-error Intentional malformed runtime payload for normalization coverage.
            attachmentId: 123,
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

test("writeParserResult rejects derived attempt paths that traverse symlinks", async () => {
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
      writeParserResult({
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
    ordinal: 0,
    kind: "image" as const,
    mime: "image/png",
    fileName: "malformed-id.png",
    storedPath,
    parseState: "pending" as "failed" | "pending" | "running",
    derivedPath: null,
    extractedText: null,
    transcriptText: null,
  };
  const capture: InboxCaptureRecord = {
    captureId: "cap_worker_malformed_id",
    source: "telegram",
    accountId: "bot",
    externalId: "message-worker-malformed-id",
    thread: {
      id: "thread_worker_malformed_id",
      title: null,
      isDirect: true,
    },
    actor: {
      id: null,
      displayName: null,
      isSelf: false,
    },
    occurredAt: "2026-03-13T12:00:00.000Z",
    receivedAt: "2026-03-13T12:00:01.000Z",
    text: null,
    raw: {},
    sourceDirectory: "raw/inbox/telegram/bot/2026/03/cap_worker_malformed_id",
    eventId: "evt_worker_malformed_id",
    createdAt: "2026-03-13T12:00:01.000Z",
    attachments: [attachment],
  };
  let job: AttachmentParseJobRecord = {
    jobId: "job_worker_malformed_id",
    captureId: capture.captureId,
    attachmentId: attachment.attachmentId,
    pipeline: "attachment_text",
    state: "pending" as "failed" | "pending" | "running",
    attempts: 0,
    errorCode: null as string | null,
    errorMessage: null as string | null,
    providerId: null as string | null,
    resultPath: null as string | null,
    createdAt: "2026-03-13T12:00:01.000Z",
  };

  const runtime: InboxRuntimeStore = {
    databasePath: path.join(vaultRoot, ".runtime", "inboxd.sqlite"),
    close() {},
    redactCaptureText() {
      return false;
    },
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
    failAttachmentParseJob(input: FailAttachmentParseJobInput) {
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
      return [capture];
    },
    searchCaptures() {
      return [];
    },
    getCapture(captureId: string) {
      return captureId === capture.captureId ? capture : null;
    },
    getAttachment(attachmentId: string) {
      return attachmentId === attachment.attachmentId ? { capture, attachment } : null;
    },
  };

  const results = await runAttachmentParseWorker({
    vaultRoot,
    runtime,
    registry: createParserRegistry([
      {
        id: "unexpected-success-provider",
        locality: "local",
        openness: "open_source",
        runtime: "node",
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

  const imagePath = await writeExternalFile(sourceRoot, "meal-photo.wav", "wav-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "telegram",
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
        kind: "audio",
        mime: "audio/wav",
        originalPath: imagePath,
        fileName: "meal-photo.wav",
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
      return (request.preparedKind ?? request.artifact.kind) === "audio";
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
    ffmpeg: disableFfmpegLookup(),
    maxJobs: 1,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "succeeded");
  assert.equal(results[0]?.providerId, "fake-image-parser");
  assert.ok(results[0]?.resultPath);
  assert.match(results[0]?.resultPath ?? "", /attempts\/0001\/result\.json$/u);
  assert.equal(results[0]?.job.state, "succeeded");
  assert.equal(results[0]?.job.resultPath, results[0]?.resultPath);
  assert.equal(results[0]?.job.providerId, "fake-image-parser");

  const refreshed = runtime.getCapture(capture.captureId);
  assert.ok(refreshed);
  assert.equal(refreshed.attachments[0]?.parseState, "succeeded");
  assert.equal(refreshed.attachments[0]?.parserProviderId, "fake-image-parser");
  assert.equal(refreshed.attachments[0]?.derivedPath, results[0]?.resultPath);
  assert.equal(refreshed.attachments[0]?.transcriptText, "Omelet with spinach and feta");

  const hits = runtime.searchCaptures({
    text: "spinach",
    limit: 10,
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.captureId, capture.captureId);

  const parserResult = await readParserResult({
    vaultRoot,
    resultPath: results[0]?.resultPath ?? "",
  });
  assert.equal(parserResult.providerId, "fake-image-parser");
  assert.match(parserResult.text, /Omelet with spinach and feta/);
  assert.match(parserResult.markdown, /## OCR/);
  assert.match(JSON.stringify(parserResult.blocks), /Omelet with spinach and feta/);

  pipeline.close();
});

test("attachment parse worker requeues its claimed job when provider parsing aborts", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-worker-aborted-provider-vault");
  const sourceRoot = await makeTempDirectory("murph-parser-worker-aborted-provider-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const audioPath = await writeExternalFile(
    sourceRoot,
    "aborted-provider.wav",
    "wav-bytes-placeholder",
  );
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "telegram",
    externalId: "aborted-provider-1",
    accountId: "self",
    thread: {
      id: "chat-aborted-provider-1",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T11:04:00.000Z",
    text: null,
    attachments: [
      {
        kind: "audio",
        mime: "audio/wav",
        originalPath: audioPath,
        fileName: "aborted-provider.wav",
      },
    ],
    raw: {},
  });
  const storedCapture = runtime.getCapture(capture.captureId);
  assert.ok(storedCapture);
  const attachmentId = storedCapture.attachments[0]?.attachmentId;
  assert.ok(attachmentId);

  const requeueFilters: RequeueAttachmentParseJobsInput[] = [];
  const requeueAttachmentParseJobs = runtime.requeueAttachmentParseJobs.bind(runtime);
  runtime.requeueAttachmentParseJobs = (filters) => {
    assert.ok(filters);
    requeueFilters.push(filters);
    return requeueAttachmentParseJobs(filters);
  };

  const controller = new AbortController();
  const results = await runAttachmentParseWorker({
    vaultRoot,
    runtime,
    registry: createParserRegistry([
      {
        id: "aborted-provider",
        locality: "remote",
        openness: "closed",
        runtime: "remote_api",
        priority: 500,
        async discover() {
          return {
            available: true,
            reason: "available for provider abort test",
          };
        },
        supports(request) {
          return (request.preparedKind ?? request.artifact.kind) === "audio";
        },
        async run(request) {
          assert.equal(request.signal, controller.signal);
          controller.abort();
          throw new Error("provider parse aborted");
        },
      },
    ]),
    ffmpeg: disableFfmpegLookup(),
    maxJobs: 1,
    signal: controller.signal,
  });

  assert.deepEqual(results, []);
  assert.deepEqual(requeueFilters, [
    {
      attachmentId,
      captureId: capture.captureId,
      state: "running",
    },
  ]);
  assert.equal(runtime.getCapture(capture.captureId)?.attachments[0]?.parseState, "pending");
  const jobs = runtime.listAttachmentParseJobs({ captureId: capture.captureId, limit: 10 });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.state, "pending");
  assert.equal(jobs[0]?.attempts, 1);
  assert.equal(jobs[0]?.errorCode ?? null, null);
  assert.equal(jobs[0]?.errorMessage ?? null, null);

  pipeline.close();
});

test("stale running parser attempts do not overwrite a requeued rerun", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-worker-race-vault");
  const sourceRoot = await makeTempDirectory("murph-parser-worker-race-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "race.wav", "wav-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "telegram",
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
        kind: "audio",
        mime: "audio/wav",
        originalPath: imagePath,
        fileName: "race.wav",
      },
    ],
    raw: {},
  });

  let runCount = 0;
  let signalFirstRunStarted: (() => void) | undefined;
  const firstRunStarted = new Promise<void>((resolve) => {
    signalFirstRunStarted = resolve;
  });
  let releaseFirstRun: (() => void) | undefined;
  const firstRunRelease = new Promise<void>((resolve) => {
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
        return (request.preparedKind ?? request.artifact.kind) === "audio";
      },
      async run() {
        runCount += 1;
        if (runCount === 1) {
          signalFirstRunStarted?.();
          await firstRunRelease;
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
    ffmpeg: disableFfmpegLookup(),
  });

  await firstRunStarted;
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
    ffmpeg: disableFfmpegLookup(),
  });
  assert.equal(rerun?.status, "succeeded");
  assert.match(rerun?.resultPath ?? "", /attempts\/0002\/result\.json$/u);

  releaseFirstRun?.();
  assert.equal(await firstAttempt, null);

  const refreshed = runtime.getCapture(capture.captureId);
  assert.ok(refreshed);
  assert.equal(refreshed.attachments[0]?.transcriptText, "fresh rerun text");
  assert.match(refreshed.attachments[0]?.derivedPath ?? "", /attempts\/0002\/result\.json$/u);
  const refreshedResult = await readParserResult({
    vaultRoot,
    resultPath: refreshed.attachments[0]?.derivedPath ?? "",
  });
  assert.match(refreshedResult.text, /fresh rerun text/u);
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

test("attachment parse worker removes published attempts when completion fails after publish", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-worker-post-publish-failure-vault");
  const sourceRoot = await makeTempDirectory("murph-parser-worker-post-publish-failure-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "completion-error.wav", "wav-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "telegram",
    externalId: "completion-error-1",
    accountId: "self",
    thread: {
      id: "chat-completion-error-1",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T11:10:00.000Z",
    text: null,
    attachments: [
      {
        kind: "audio",
        mime: "audio/wav",
        originalPath: imagePath,
        fileName: "completion-error.wav",
      },
    ],
    raw: {},
  });
  const storedCapture = runtime.getCapture(capture.captureId);
  assert.ok(storedCapture);
  const attachmentId = storedCapture.attachments[0]?.attachmentId;
  assert.ok(attachmentId);

  runtime.completeAttachmentParseJob = () => {
    throw new Error("completion finalization exploded");
  };

  const results = await runAttachmentParseWorker({
    vaultRoot,
    runtime,
    registry: createParserRegistry([
      {
        id: "post-publish-provider",
        locality: "local",
        openness: "open_source",
        runtime: "node",
        priority: 500,
        async discover() {
          return {
            available: true,
            reason: "available for post-publish cleanup test",
          };
        },
        supports(request) {
          return (request.preparedKind ?? request.artifact.kind) === "audio";
        },
        async run() {
          return {
            text: "cleanup after failure",
          };
        },
      },
    ]),
    ffmpeg: disableFfmpegLookup(),
    maxJobs: 1,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "failed");
  assert.equal(results[0]?.errorCode, "parser_failed");
  assert.match(results[0]?.errorMessage ?? "", /completion finalization exploded/u);
  const refreshed = runtime.getCapture(capture.captureId);
  assert.ok(refreshed);
  assert.equal(refreshed.attachments[0]?.parseState, "failed");
  assert.equal(refreshed.attachments[0]?.derivedPath ?? null, null);
  assert.equal(refreshed.attachments[0]?.extractedText ?? null, null);
  assert.equal(
    runtime.listAttachmentParseJobs({ captureId: capture.captureId, limit: 10 })[0]?.state,
    "failed",
  );
  await assert.rejects(
    fs.access(
      path.join(
        vaultRoot,
        "derived",
        "inbox",
        capture.captureId,
        "attachments",
        attachmentId,
        "attempts",
        "0001",
      ),
    ),
  );

  pipeline.close();
});

test("attachment parse worker removes published attempts when failure finalization throws", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-worker-failure-finalize-vault");
  const sourceRoot = await makeTempDirectory("murph-parser-worker-failure-finalize-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "failure-finalize.wav", "wav-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "telegram",
    externalId: "failure-finalize-1",
    accountId: "self",
    thread: {
      id: "chat-failure-finalize-1",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T11:11:00.000Z",
    text: null,
    attachments: [
      {
        kind: "audio",
        mime: "audio/wav",
        originalPath: imagePath,
        fileName: "failure-finalize.wav",
      },
    ],
    raw: {},
  });
  const storedCapture = runtime.getCapture(capture.captureId);
  assert.ok(storedCapture);
  const attachmentId = storedCapture.attachments[0]?.attachmentId;
  assert.ok(attachmentId);

  runtime.completeAttachmentParseJob = () => {
    throw new Error("completion finalization exploded");
  };
  runtime.failAttachmentParseJob = () => {
    throw new Error("failure finalization exploded");
  };

  await assert.rejects(
    runAttachmentParseJobOnce({
      vaultRoot,
      runtime,
      registry: createParserRegistry([
        {
          id: "post-publish-provider",
          locality: "local",
          openness: "open_source",
          runtime: "node",
          priority: 500,
          async discover() {
            return {
              available: true,
              reason: "available for failure-finalization cleanup test",
            };
          },
          supports(request) {
            return (request.preparedKind ?? request.artifact.kind) === "audio";
          },
          async run() {
            return {
              text: "cleanup after thrown finalizer",
            };
          },
        },
      ]),
      ffmpeg: disableFfmpegLookup(),
    }),
    /failure finalization exploded/u,
  );
  await assert.rejects(
    fs.access(
      path.join(
        vaultRoot,
        "derived",
        "inbox",
        capture.captureId,
        "attachments",
        attachmentId,
        "attempts",
        "0001",
      ),
    ),
  );

  pipeline.close();
});

test("parser service forwards scoped drain and requeue filters to the runtime", async () => {
  const claimFilters: Array<AttachmentParseJobClaimFilters | undefined> = [];
  const requeueFilters: Array<RequeueAttachmentParseJobsInput | undefined> = [];
  const runtime = {
    claimNextAttachmentParseJob(filters?: AttachmentParseJobClaimFilters) {
      claimFilters.push(filters);
      return null;
    },
    requeueAttachmentParseJobs(filters?: RequeueAttachmentParseJobsInput) {
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

  const imagePath = await writeExternalFile(sourceRoot, "scan.wav", "wav-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "telegram",
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
        kind: "audio",
        mime: "audio/wav",
        originalPath: imagePath,
        fileName: "scan.wav",
      },
    ],
    raw: {},
  });

  const registry = createParserRegistry([]);
  const result = await runAttachmentParseWorker({
    vaultRoot,
    runtime,
    registry,
    ffmpeg: disableFfmpegLookup(),
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

  const firstPath = await writeExternalFile(sourceRoot, "first.wav", "first-audio");
  const secondPath = await writeExternalFile(sourceRoot, "second.wav", "second-audio");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const first = await pipeline.processCapture({
    source: "telegram",
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
        kind: "audio",
        mime: "audio/wav",
        originalPath: firstPath,
        fileName: "first.wav",
      },
    ],
    raw: {},
  });
  const second = await pipeline.processCapture({
    source: "telegram",
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
        kind: "audio",
        mime: "audio/wav",
        originalPath: secondPath,
        fileName: "second.wav",
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
        return (request.preparedKind ?? request.artifact.kind) === "audio";
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
    ffmpeg: disableFfmpegLookup(),
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

test("parser publication accepts text-provider output above the obsolete 64 MiB limit", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-large-text-vault");
  const sourceRoot = await makeTempDirectory("murph-parser-large-text-source");
  const scratchRoot = await makeTempDirectory("murph-parser-large-text-scratch");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const line = "界".repeat(16_000);
  const lineCount = 500;
  const sourceText = Array.from({ length: lineCount }, () => line).join("\n");
  const textPath = await writeExternalFile(sourceRoot, "large.txt", sourceText);
  const parsed = await parseAttachment({
    artifact: {
      captureId: "cap_large_text",
      attachmentId: "att_large_text",
      kind: "document",
      mime: "text/plain",
      fileName: "large.txt",
      storedPath: "raw/inbox/example/large.txt",
      absolutePath: textPath,
    },
    registry: createParserRegistry([createTextFileProvider()]),
    scratchRoot,
  });

  const published = await writeParserResult({
    attempt: 1,
    vaultRoot,
    output: parsed.output,
  });

  const resultStats = await fs.lstat(path.join(vaultRoot, published.resultPath));
  assert.ok(resultStats.size > 64 * 1024 * 1024);

  const output = await readParserResult({
    vaultRoot,
    resultPath: published.resultPath,
  });
  assert.equal(output.text.length, sourceText.length);
  assert.equal(output.blocks.length, lineCount);
  assert.deepEqual(await fs.readdir(scratchRoot), []);
});

test("parsed inbox pipeline auto-drains parser jobs for each processed capture", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsed-pipeline-vault");
  const sourceRoot = await makeTempDirectory("murph-parsed-pipeline-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "auto-parse.wav", "wav-bytes-placeholder");
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
          return (request.preparedKind ?? request.artifact.kind) === "audio";
        },
        async run() {
          return {
            text: "Auto-drained OCR text",
          };
        },
      },
    ]),
    ffmpeg: disableFfmpegLookup(),
  });

  const capture = await pipeline.processCapture({
    source: "telegram",
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
        kind: "audio",
        mime: "audio/wav",
        originalPath: imagePath,
        fileName: "auto-parse.wav",
      },
    ],
    raw: {},
  });

  const refreshed = runtime.getCapture(capture.captureId);
  assert.ok(refreshed);
  assert.equal(refreshed.attachments[0]?.parseState, "succeeded");
  assert.equal(refreshed.attachments[0]?.transcriptText, "Auto-drained OCR text");
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

  const imagePath = await writeExternalFile(sourceRoot, "startup.wav", "wav-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "telegram",
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
        kind: "audio",
        mime: "audio/wav",
        originalPath: imagePath,
        fileName: "startup.wav",
      },
    ],
    raw: {},
  });
  pipeline.close();

  const daemonRuntime = await openInboxRuntime({ vaultRoot });
  const controller = new AbortController();
  let resolveWatchStarted: (() => void) | null = null;
  const watchStarted = new Promise<void>((resolve) => {
    resolveWatchStarted = resolve;
  });
  const connector: PollConnector = {
    id: "noop-telegram",
    source: "telegram",
    accountId: "self",
    kind: "poll" as const,
    capabilities: {
      attachments: true,
      backfill: false,
      ownMessages: false,
      watch: true,
      webhooks: false,
    },
    async backfill(cursor: Cursor | null) {
      return cursor;
    },
    async watch(_cursor: Cursor | null, _emit: EmitCapture, signal: AbortSignal) {
      if (signal.aborted) {
        return;
      }

      resolveWatchStarted?.();
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
          return (request.preparedKind ?? request.artifact.kind) === "audio";
        },
        async run() {
          return {
            text: "Startup-drained OCR text",
          };
        },
      },
    ]),
    ffmpeg: disableFfmpegLookup(),
    connectors: [connector],
    signal: controller.signal,
  });

  await watchStarted;
  controller.abort();
  await running;

  const refreshedRuntime = await openInboxRuntime({ vaultRoot });
  try {
    const refreshed = refreshedRuntime.getCapture(capture.captureId);
    assert.ok(refreshed);
    assert.equal(refreshed.attachments[0]?.parseState, "succeeded");
    assert.equal(refreshed.attachments[0]?.transcriptText, "Startup-drained OCR text");
  } finally {
    refreshedRuntime.close();
  }
});

test("daemon with parsers skips startup drain when the signal is already aborted", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsed-daemon-aborted-vault");
  const sourceRoot = await makeTempDirectory("murph-parsed-daemon-aborted-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "aborted.wav", "wav-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "telegram",
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
        kind: "audio",
        mime: "audio/wav",
        originalPath: imagePath,
        fileName: "aborted.wav",
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
    ffmpeg: disableFfmpegLookup(),
    connectors: [
      {
        id: "aborted-telegram",
        source: "telegram",
        accountId: "self",
        kind: "poll" as const,
        capabilities: {
          attachments: true,
          backfill: false,
          ownMessages: false,
          watch: false,
          webhooks: false,
        },
        async backfill(cursor: Cursor | null) {
          return cursor;
        },
        async watch(_cursor: Cursor | null, _emit: EmitCapture, _signal: AbortSignal) {},
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

test("daemon with parsers leaves startup drain jobs pending when abort arrives before finalization", async () => {
  const vaultRoot = await makeTempDirectory("murph-parsed-daemon-abort-mid-drain-vault");
  const sourceRoot = await makeTempDirectory("murph-parsed-daemon-abort-mid-drain-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const firstPath = await writeExternalFile(sourceRoot, "first.wav", "first-audio");
  const secondPath = await writeExternalFile(sourceRoot, "second.wav", "second-audio");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const first = await pipeline.processCapture({
    source: "telegram",
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
        kind: "audio",
        mime: "audio/wav",
        originalPath: firstPath,
        fileName: "first.wav",
      },
    ],
    raw: {},
  });
  const second = await pipeline.processCapture({
    source: "telegram",
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
        kind: "audio",
        mime: "audio/wav",
        originalPath: secondPath,
        fileName: "second.wav",
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
          return (request.preparedKind ?? request.artifact.kind) === "audio";
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
    ffmpeg: disableFfmpegLookup(),
    connectors: [],
    signal: controller.signal,
  });

  const refreshedRuntime = await openInboxRuntime({ vaultRoot });
  try {
    assert.equal(refreshedRuntime.getCapture(first.captureId)?.attachments[0]?.parseState, "pending");
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
          id: "failing-telegram",
          source: "telegram",
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
          async watch(_cursor: Cursor | null, _emit: EmitCapture, _signal: AbortSignal) {},
          async close() {},
        },
      ],
      signal: new AbortController().signal,
    }),
    /Connector "failing-telegram" \(telegram\) failed: daemon blew up/u,
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
          id: "healthy-linq",
          source: "linq",
        accountId: "primary",
        kind: "poll" as const,
          capabilities: {
            attachments: true,
            backfill: false,
            ownMessages: false,
            watch: true,
            webhooks: false,
          },
          async backfill(cursor: Cursor | null) {
            return cursor;
          },
          async watch(_cursor: Cursor | null, _emit: EmitCapture, signal: AbortSignal) {
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
          id: "failing-telegram",
          source: "telegram",
        accountId: "self",
        kind: "poll" as const,
          capabilities: {
            attachments: true,
            backfill: false,
            ownMessages: false,
            watch: true,
            webhooks: false,
          },
          async backfill(cursor: Cursor | null) {
            return cursor;
          },
          async watch(_cursor: Cursor | null, _emit: EmitCapture, _signal: AbortSignal) {
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

  const imagePath = await writeExternalFile(sourceRoot, "auto-fail.wav", "wav-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createParsedInboxPipeline({
    vaultRoot,
    runtime,
    registry: createParserRegistry([]),
    ffmpeg: disableFfmpegLookup(),
  });

  const capture = await pipeline.processCapture({
    source: "telegram",
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
        kind: "audio",
        mime: "audio/wav",
        originalPath: imagePath,
        fileName: "auto-fail.wav",
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

  const imagePath = await writeExternalFile(sourceRoot, "unknown-audio.wav", "wav-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "telegram",
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
        kind: "audio",
        mime: "audio/wav",
        originalPath: imagePath,
        fileName: "unknown-audio.wav",
      },
    ],
    raw: {},
  });

  const results = await runAttachmentParseWorker({
    vaultRoot,
    runtime,
    registry: createParserRegistry([]),
    ffmpeg: disableFfmpegLookup(),
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
    source: "telegram",
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

  const imagePath = await writeExternalFile(sourceRoot, "receipt.wav", "wav-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "telegram",
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
        kind: "audio",
        mime: "audio/wav",
        originalPath: imagePath,
        fileName: "receipt.wav",
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
        return (request.preparedKind ?? request.artifact.kind) === "audio";
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
    ffmpeg: disableFfmpegLookup(),
    maxJobs: 1,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "succeeded");

  const parsedCapture = runtime.getCapture(capture.captureId);
  assert.ok(parsedCapture);
  assert.equal(parsedCapture.attachments[0]?.parseState, "succeeded");
  assert.equal(parsedCapture.attachments[0]?.transcriptText, "Distinct rebuild-only OCR text");
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
    enqueueParserJobs: true,
    vaultRoot,
    runtime: rebuiltRuntime,
  });

  const rebuilt = rebuiltRuntime.getCapture(capture.captureId);
  assert.ok(rebuilt);
  assert.equal(rebuilt.attachments[0]?.parseState, "pending");
  assert.equal(rebuilt.attachments[0]?.derivedPath ?? null, null);
  assert.equal(rebuilt.attachments[0]?.transcriptText ?? null, null);
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

  const imagePath = await writeExternalFile(sourceRoot, "failure-audio.wav", "wav-bytes-placeholder");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "telegram",
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
        kind: "audio",
        mime: "audio/wav",
        originalPath: imagePath,
        fileName: "failure-audio.wav",
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
    ffmpeg: disableFfmpegLookup(),
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

test("configured parser registry transcribes audio through a configured remote transcription endpoint", async () => {
  const { createServer } = await import("node:http");
  const vaultRoot = await makeTempDirectory("murph-parser-toolchain-remote-transcription");
  const toolsDirectory = await makeTempDirectory("murph-parser-toolchain-remote-transcription-bin");
  const audioPath = await writeExternalFile(toolsDirectory, "voice.wav", "wav-placeholder");
  const requests: Array<{ contentType: string | undefined; method: string | undefined }> = [];
  const server = createServer((request, response) => {
    let bodyBytes = 0;
    request.on("data", (chunk: Buffer) => {
      bodyBytes += chunk.byteLength;
    });
    request.on("end", () => {
      requests.push({
        contentType: request.headers["content-type"],
        method: request.method,
      });
      assert.equal(bodyBytes > 0, true);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        durationMs: 1_200,
        language: "en",
        segments: [{ endMs: 1_200, startMs: 0, text: "remote transcript ok" }],
        text: "remote transcript ok",
      }));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.equal(typeof address === "object" && address !== null, true);
  const endpoint = `http://127.0.0.1:${(address as { port: number }).port}/v1/transcribe`;

  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  try {
    const configured = await createConfiguredParserRegistry({
      allowEnvToolchain: false,
      allowSystemToolchainLookup: false,
      readVaultToolchainConfig: false,
      toolchain: {
        source: "platform",
        tools: {
          transcription: {
            endpoint,
          },
        },
      },
      vaultRoot,
    });

    assert.deepEqual(configured.doctor.tools.transcription, {
      available: true,
      command: null,
      endpoint,
      source: "platform",
      reason: "Remote transcription endpoint configured.",
    });
    assert.equal(configured.doctor.tools.whisper.available, false);

    const run = await configured.registry.run({
      intent: "attachment_text",
      artifact: {
        captureId: "cap_remote_transcription_registry",
        attachmentId: "att_remote_transcription_registry",
        kind: "audio",
        fileName: "voice.wav",
        mime: "audio/wav",
        storedPath: "raw/inbox/example/voice.wav",
        absolutePath: audioPath,
      },
      inputPath: audioPath,
      preparedKind: "audio",
      scratchDirectory: toolsDirectory,
    });

    assert.equal(run.selection.provider.id, "remote-transcription");
    assert.equal(run.result.text, "remote transcript ok");
    assert.equal(run.result.metadata?.durationMs, 1_200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, "POST");
    assert.equal(requests[0]?.contentType, "application/octet-stream");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(toolsDirectory, { recursive: true, force: true });
  }
});

test("configured remote-only parser passthrough uploads original accepted audio bytes", async () => {
  const { createServer } = await import("node:http");
  const vaultRoot = await makeTempDirectory("murph-parser-toolchain-remote-passthrough");
  const toolsDirectory = await makeTempDirectory("murph-parser-toolchain-remote-passthrough-bin");
  const scratchRoot = await makeTempDirectory("murph-parser-toolchain-remote-passthrough-scratch");
  const invocationLogPath = path.join(toolsDirectory, "ffmpeg-invocations.log");
  const fakeFfmpegPath = await writeExecutableFile(
    toolsDirectory,
    "fake-remote-passthrough-ffmpeg",
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(invocationLogPath)}, JSON.stringify(process.argv.slice(2)) + "\\n", "utf8");`,
    ].join("\n"),
  );
  const audioPath = await writeExternalFile(toolsDirectory, "voice.caf", "caff-original-caf-bytes");
  const requests: Array<{
    body: string;
    contentType: string | undefined;
    method: string | undefined;
  }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      requests.push({
        body: Buffer.concat(chunks).toString("utf8"),
        contentType: request.headers["content-type"],
        method: request.method,
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        durationMs: 1_200,
        language: "en",
        segments: [{ endMs: 1_200, startMs: 0, text: "remote passthrough ok" }],
        text: "remote passthrough ok",
      }));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.equal(typeof address === "object" && address !== null, true);
  const endpoint = `http://127.0.0.1:${(address as { port: number }).port}/v1/transcribe`;

  await initializeVault({
    vaultRoot,
    createdAt: "2026-06-12T12:00:00.000Z",
  });

  try {
    const configured = await createConfiguredParserRegistry({
      allowEnvToolchain: false,
      allowSystemToolchainLookup: false,
      readVaultToolchainConfig: false,
      toolchain: {
        source: "platform",
        tools: {
          ffmpeg: {
            command: fakeFfmpegPath,
          },
          transcription: {
            endpoint,
          },
        },
      },
      vaultRoot,
    });

    assert.equal(configured.ffmpeg?.remoteTranscriptionOnly, true);
    const parsed = await parseAttachment({
      artifact: {
        captureId: "cap_remote_passthrough_registry",
        attachmentId: "att_remote_passthrough_registry",
        kind: "audio",
        fileName: "voice.caf",
        mime: "audio/x-caf",
        storedPath: "raw/inbox/example/voice.caf",
        absolutePath: audioPath,
      },
      ffmpeg: configured.ffmpeg,
      registry: configured.registry,
      scratchRoot,
    });

    assert.equal(parsed.providerId, "remote-transcription");
    assert.equal(parsed.output.text, "remote passthrough ok");
    assert.deepEqual(requests, [{
      body: "caff-original-caf-bytes",
      contentType: "application/octet-stream",
      method: "POST",
    }]);
    await assert.rejects(fs.access(invocationLogPath));

    const noFfmpegAudioPath = await writeExternalFile(
      toolsDirectory,
      "voice-no-ffmpeg.caf",
      "caff-original-caf-bytes-without-ffmpeg",
    );
    const configuredWithoutFfmpeg = await createConfiguredParserRegistry({
      allowEnvToolchain: false,
      allowSystemToolchainLookup: false,
      readVaultToolchainConfig: false,
      toolchain: {
        source: "platform",
        tools: {
          transcription: {
            endpoint,
          },
        },
      },
      vaultRoot,
    });

    assert.deepEqual(configuredWithoutFfmpeg.ffmpeg, {
      allowSystemLookup: false,
      remoteTranscriptionOnly: true,
    });
    const parsedWithoutFfmpeg = await parseAttachment({
      artifact: {
        captureId: "cap_remote_passthrough_no_ffmpeg",
        attachmentId: "att_remote_passthrough_no_ffmpeg",
        kind: "audio",
        fileName: "voice-no-ffmpeg.caf",
        mime: "audio/x-caf",
        storedPath: "raw/inbox/example/voice-no-ffmpeg.caf",
        absolutePath: noFfmpegAudioPath,
      },
      ffmpeg: configuredWithoutFfmpeg.ffmpeg,
      registry: configuredWithoutFfmpeg.registry,
      scratchRoot,
    });

    assert.equal(parsedWithoutFfmpeg.providerId, "remote-transcription");
    assert.equal(parsedWithoutFfmpeg.output.text, "remote passthrough ok");
    assert.deepEqual(requests.at(-1), {
      body: "caff-original-caf-bytes-without-ffmpeg",
      contentType: "application/octet-stream",
      method: "POST",
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(toolsDirectory, { recursive: true, force: true });
    await fs.rm(scratchRoot, { recursive: true, force: true });
  }
});

test("parser toolchain config persists, merges, and validates transcription endpoints", async () => {
  const vaultRoot = await makeTempDirectory("murph-parser-toolchain-transcription-config");
  const endpoint = "https://transcribe.example.test/v1/transcribe";
  const replacementEndpoint = "http://127.0.0.1:8788/v1/transcribe";

  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-13T12:00:00.000Z",
  });

  try {
    const written = await writeParserToolchainConfig({
      vaultRoot,
      now: new Date("2026-03-13T12:34:56.000Z"),
      tools: {
        transcription: {
          endpoint,
        },
      },
    });
    assert.deepEqual(written.config.tools.transcription, { endpoint });

    const loaded = await readParserToolchainConfig(vaultRoot);
    assert.ok(loaded);
    assert.deepEqual(loaded.config.tools.transcription, { endpoint });

    const doctor = await discoverParserToolchain({ vaultRoot });
    assert.deepEqual(doctor.tools.transcription, {
      available: true,
      command: null,
      endpoint,
      source: "config",
      reason: "Remote transcription endpoint configured.",
    });

    const replaced = await writeParserToolchainConfig({
      vaultRoot,
      tools: {
        transcription: {
          endpoint: ` ${replacementEndpoint} `,
        },
      },
    });
    assert.deepEqual(replaced.config.tools.transcription, {
      endpoint: replacementEndpoint,
    });

    const deleted = await writeParserToolchainConfig({
      vaultRoot,
      tools: {
        transcription: {
          endpoint: null,
        },
      },
    });
    assert.equal(deleted.config.tools.transcription, undefined);
    const reloaded = await readParserToolchainConfig(vaultRoot);
    assert.ok(reloaded);
    assert.equal(reloaded.config.tools.transcription, undefined);
    const missingDoctor = await discoverParserToolchain({ vaultRoot });
    assert.deepEqual(missingDoctor.tools.transcription, {
      available: false,
      command: null,
      endpoint: null,
      source: "missing",
      reason: "Remote transcription endpoint is not configured.",
    });

    await writeParserToolchainConfig({
      vaultRoot,
      tools: {
        transcription: {
          endpoint,
        },
      },
    });
    const { configPath } = getParserToolchainPaths(vaultRoot);
    const persisted = await fs.readFile(configPath, "utf8");
    assert.equal(persisted.includes(endpoint), true);

    await fs.writeFile(configPath, persisted.replaceAll(endpoint, "not-a-url"), "utf8");
    await assert.rejects(
      readParserToolchainConfig(vaultRoot),
      /Parser tool "transcription" endpoint must be an absolute http\(s\) URL\./u,
    );

    await fs.writeFile(
      configPath,
      persisted.replaceAll(`"${endpoint}"`, `"ftp://transcribe.example.test/v1"`),
      "utf8",
    );
    await assert.rejects(
      readParserToolchainConfig(vaultRoot),
      /Parser tool "transcription" endpoint must be an absolute http\(s\) URL\./u,
    );

    await fs.writeFile(
      configPath,
      persisted.replaceAll(`"${endpoint}"`, "42"),
      "utf8",
    );
    await assert.rejects(
      readParserToolchainConfig(vaultRoot),
      /Parser tool "transcription" endpoint must be a string, null, or omitted\./u,
    );
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
});
