import { promises as fs } from "node:fs";
import path from "node:path";

import type { ParserArtifactRef } from "../contracts/artifact.js";
import { ensureDirectory, readConfiguredEnvValue, resolveConfiguredExecutable, runCommand } from "../shared.js";
import { REMOTE_TRANSCRIPTION_MAX_INPUT_BYTES } from "./remote-transcription.js";

export interface FfmpegToolOptions {
  commandCandidates?: string[];
  allowSystemLookup?: boolean;
  commandTimeoutMs?: number;
  maxCommandOutputBytes?: number;
  /**
   * True when remote transcription is the only available transcription lane
   * (remote endpoint configured, local whisper.cpp unavailable). Audio in a
   * container format the remote model is verified to accept is passed through
   * untouched instead of being normalized to 16 kHz WAV, which only local
   * whisper.cpp requires.
   */
  remoteTranscriptionOnly?: boolean;
}

export async function resolveFfmpegCommand(
  options: FfmpegToolOptions = {},
): Promise<string | null> {
  return resolveConfiguredExecutable({
    explicitCandidates: options.commandCandidates,
    envValue: () =>
      options.allowSystemLookup === false
        ? null
        : readConfiguredEnvValue(process.env, ["FFMPEG_COMMAND"]),
    fallbackCommands: options.allowSystemLookup === false ? [] : ["ffmpeg"],
  });
}

export async function prepareAudioInput(input: {
  artifact: ParserArtifactRef;
  scratchDirectory: string;
  ffmpeg?: FfmpegToolOptions;
  signal?: AbortSignal;
}): Promise<{ inputPath: string; preparedKind?: "audio" }> {
  const { artifact, scratchDirectory } = input;

  if (artifact.kind !== "audio" && artifact.kind !== "video") {
    return { inputPath: artifact.absolutePath };
  }

  const remoteTranscriptionOnly = input.ffmpeg?.remoteTranscriptionOnly === true;
  if (
    artifact.kind === "audio" &&
    remoteTranscriptionOnly &&
    await isRemoteTranscriptionDirectAudioArtifact(artifact)
  ) {
    return { inputPath: artifact.absolutePath, preparedKind: "audio" };
  }

  const command = await resolveFfmpegCommand(input.ffmpeg);
  if (!command) {
    if (
      artifact.kind === "audio" &&
      !remoteTranscriptionOnly &&
      isDirectWhisperAudioArtifact(artifact)
    ) {
      return { inputPath: artifact.absolutePath, preparedKind: "audio" };
    }

    throw new TypeError(
      artifact.kind === "video"
        ? "ffmpeg is required to extract audio from video attachments."
        : "ffmpeg is required to normalize non-WAV audio attachments for transcription.",
    );
  }

  await ensureDirectory(scratchDirectory);
  const outputPath = path.join(
    scratchDirectory,
    `${artifact.attachmentId}${remoteTranscriptionOnly ? ".mp3" : ".wav"}`,
  );
  const ffmpegArgs = remoteTranscriptionOnly
    ? [
        "-y",
        "-i",
        artifact.absolutePath,
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
        outputPath,
      ]
    : [
        "-y",
        "-i",
        artifact.absolutePath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        outputPath,
      ];
  await runCommand(command, ffmpegArgs, {
    signal: input.signal,
    ...(input.ffmpeg?.maxCommandOutputBytes === undefined
      ? {}
      : {
          maxStderrBytes: input.ffmpeg.maxCommandOutputBytes,
          maxStdoutBytes: input.ffmpeg.maxCommandOutputBytes,
        }),
    ...(input.ffmpeg?.commandTimeoutMs === undefined
      ? {}
      : {
          timeoutMs: input.ffmpeg.commandTimeoutMs,
        }),
  });

  return {
    inputPath: outputPath,
    preparedKind: "audio",
  };
}

// Container formats verified accepted by the hosted remote transcription model
// (@cf/openai/whisper-large-v3-turbo; live-checked against the production model
// on 2026-06-12). AMR is deliberately absent: it is unverified, so it stays on
// the ffmpeg preparation path. MP4-family containers are also deliberately
// absent: they routinely carry video, and the ffmpeg `-vn` path avoids sending
// those video-capable container bytes through passthrough.
const REMOTE_TRANSCRIPTION_DIRECT_AUDIO_MIMES = new Set([
  "audio/aac",
  "audio/x-aac",
  "audio/aiff",
  "audio/x-aiff",
  "audio/caf",
  "audio/x-caf",
  "audio/mp3",
  "audio/mpeg",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
]);

const REMOTE_TRANSCRIPTION_BLOCKED_AUDIO_MIMES = new Set([
  "audio/m4a",
  "audio/mp4",
  "audio/x-m4a",
]);

const REMOTE_TRANSCRIPTION_BLOCKED_AUDIO_EXTENSIONS = new Set([
  ".m4a",
  ".mp4",
]);

async function isRemoteTranscriptionDirectAudioArtifact(
  artifact: ParserArtifactRef,
): Promise<boolean> {
  const mime = normalizeMediaType(artifact.mime);
  const fileName = artifact.fileName?.toLowerCase() ?? "";
  const extension = path.extname(fileName);
  if (REMOTE_TRANSCRIPTION_BLOCKED_AUDIO_EXTENSIONS.has(extension)) {
    return false;
  }

  if (mime.startsWith("video/") || REMOTE_TRANSCRIPTION_BLOCKED_AUDIO_MIMES.has(mime)) {
    return false;
  }

  let directMime: string | null = null;
  if (REMOTE_TRANSCRIPTION_DIRECT_AUDIO_MIMES.has(mime)) {
    directMime = mime;
  } else if (mime === "" && (extension === ".wav" || extension === ".wave")) {
    directMime = "audio/wav";
  }
  if (directMime === null) {
    return false;
  }

  const stat = await fs.stat(artifact.absolutePath);
  if (stat.size > REMOTE_TRANSCRIPTION_MAX_INPUT_BYTES) {
    return false;
  }

  return await hasRemoteTranscriptionDirectAudioSignature(
    artifact.absolutePath,
    directMime,
    stat.size,
  );
}

function isDirectWhisperAudioArtifact(artifact: ParserArtifactRef): boolean {
  const fileName = artifact.fileName?.toLowerCase() ?? "";
  const mime = normalizeMediaType(artifact.mime);
  return (
    fileName.endsWith(".wav") ||
    fileName.endsWith(".wave") ||
    mime === "audio/wav" ||
    mime === "audio/x-wav" ||
    mime === "audio/wave"
  );
}

function normalizeMediaType(value: string | null | undefined): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

async function hasRemoteTranscriptionDirectAudioSignature(
  filePath: string,
  mime: string,
  fileSize: number,
): Promise<boolean> {
  const isMp3 = mime === "audio/mp3" || mime === "audio/mpeg";
  const header = await readFileHeader(filePath, isMp3 ? 10 : 16);
  if (header.length === 0) {
    return false;
  }

  if (mime === "audio/caf" || mime === "audio/x-caf") {
    return header.subarray(0, 4).equals(Buffer.from("caff", "ascii"));
  }

  if (mime === "audio/aiff" || mime === "audio/x-aiff") {
    return (
      header.subarray(0, 4).equals(Buffer.from("FORM", "ascii")) &&
      (
        header.subarray(8, 12).equals(Buffer.from("AIFF", "ascii")) ||
        header.subarray(8, 12).equals(Buffer.from("AIFC", "ascii"))
      )
    );
  }

  if (mime === "audio/wav" || mime === "audio/wave" || mime === "audio/x-wav") {
    return (
      header.subarray(0, 4).equals(Buffer.from("RIFF", "ascii")) &&
      header.subarray(8, 12).equals(Buffer.from("WAVE", "ascii"))
    );
  }

  if (isMp3) {
    return await hasMp3AudioFrameSignature(filePath, fileSize, header);
  }

  if (mime === "audio/aac" || mime === "audio/x-aac") {
    return hasValidAacAdtsFrameHeader(header, fileSize);
  }

  return false;
}

function hasValidAacAdtsFrameHeader(header: Buffer, fileSize: number): boolean {
  if (fileSize < 7 || header.length < 7) {
    return false;
  }

  const byte0 = header[0];
  const byte1 = header[1];
  const byte2 = header[2];
  const byte3 = header[3];
  const byte4 = header[4];
  const byte5 = header[5];
  if (
    byte0 === undefined ||
    byte1 === undefined ||
    byte2 === undefined ||
    byte3 === undefined ||
    byte4 === undefined ||
    byte5 === undefined
  ) {
    return false;
  }

  const hasSync = byte0 === 0xff && (byte1 & 0xf0) === 0xf0;
  const layer = (byte1 >> 1) & 0x03;
  const profile = (byte2 >> 6) & 0x03;
  const sampleRateIndex = (byte2 >> 2) & 0x0f;
  const headerLength = (byte1 & 0x01) === 0x01 ? 7 : 9;
  const frameLength =
    ((byte3 & 0x03) << 11) |
    (byte4 << 3) |
    ((byte5 & 0xe0) >> 5);
  return (
    hasSync &&
    layer === 0x00 &&
    profile !== 0x03 &&
    sampleRateIndex < 0x0d &&
    header.length >= headerLength &&
    frameLength > headerLength &&
    frameLength <= fileSize
  );
}

async function hasMp3AudioFrameSignature(
  filePath: string,
  fileSize: number,
  initialHeader: Buffer,
): Promise<boolean> {
  if (!initialHeader.subarray(0, 3).equals(Buffer.from("ID3", "ascii"))) {
    return hasValidMp3FrameHeader(initialHeader, 0);
  }

  const frameOffset = readId3v2AudioFrameOffset(initialHeader);
  if (frameOffset === null || frameOffset > fileSize - 4) {
    return false;
  }

  const header = await readFileHeader(filePath, frameOffset + 4);
  return hasValidMp3FrameHeader(header, frameOffset);
}

function readId3v2AudioFrameOffset(header: Buffer): number | null {
  if (header.length < 10 || !header.subarray(0, 3).equals(Buffer.from("ID3", "ascii"))) {
    return null;
  }

  const versionMajor = header[3];
  const versionMinor = header[4];
  const flags = header[5];
  if (
    versionMajor === undefined ||
    versionMinor === undefined ||
    flags === undefined ||
    versionMajor < 2 ||
    versionMajor > 4 ||
    versionMinor === 0xff
  ) {
    return null;
  }

  const sizeBytes = header.subarray(6, 10);
  if (sizeBytes.length !== 4 || sizeBytes.some((byte) => (byte & 0x80) !== 0)) {
    return null;
  }

  const size0 = sizeBytes[0];
  const size1 = sizeBytes[1];
  const size2 = sizeBytes[2];
  const size3 = sizeBytes[3];
  if (
    size0 === undefined ||
    size1 === undefined ||
    size2 === undefined ||
    size3 === undefined
  ) {
    return null;
  }

  const tagSize =
    (size0 << 21) |
    (size1 << 14) |
    (size2 << 7) |
    size3;
  return 10 + tagSize + (versionMajor === 4 && (flags & 0x10) !== 0 ? 10 : 0);
}

function hasValidMp3FrameHeader(header: Buffer, offset: number): boolean {
  if (offset < 0 || header.length < offset + 4) {
    return false;
  }

  const byte0 = header[offset];
  const byte1 = header[offset + 1];
  const byte2 = header[offset + 2];
  if (byte0 === undefined || byte1 === undefined || byte2 === undefined) {
    return false;
  }

  const hasFrameSync = byte0 === 0xff && (byte1 & 0xe0) === 0xe0;
  const version = (byte1 >> 3) & 0x03;
  const layer = (byte1 >> 1) & 0x03;
  const bitrateIndex = (byte2 >> 4) & 0x0f;
  const sampleRateIndex = (byte2 >> 2) & 0x03;
  return (
    hasFrameSync &&
    version !== 0x01 &&
    layer !== 0x00 &&
    bitrateIndex !== 0x00 &&
    bitrateIndex !== 0x0f &&
    sampleRateIndex !== 0x03
  );
}

async function readFileHeader(filePath: string, bytes: number): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
