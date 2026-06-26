import { createHmac, randomBytes } from "node:crypto";
import { stat as statFile, readFile as readFileBytes } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createLinqAttachmentUpload,
  sendLinqVoiceMemo,
  uploadLinqAttachmentBytes,
  type LinqFetch,
} from "@murphai/operator-config/linq-runtime";

const DEFAULT_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
const DEFAULT_ENV_FILES = [".env.local", ".env", "apps/web/.env.local", "apps/web/.env"];

export interface LinqVoiceMemoSendOptions {
  allowNonLinqApiBaseUrl?: boolean;
  apiBaseUrl: string;
  chatId: string;
  confirmLiveLinq: boolean;
  contentType: string;
  filePath: string;
  fingerprintSecret?: string | null;
  uploadFilename: string;
}

export interface LinqVoiceMemoSendReport {
  schema: "murph.linq-voice-memo-send.v1";
  api: {
    baseUrlOrigin: string;
    baseUrlPath: string;
  };
  chat: RedactedIdentifier;
  file: {
    contentType: string;
    sizeBytes: number;
    uploadFilenameExtension: string | null;
  };
  fingerprintScope: "env-secret" | "ephemeral";
  upload: {
    attachment: RedactedIdentifier;
    downloadUrlPresent: boolean;
    expiresAtPresent: boolean;
    requiredHeaderCount: number;
  };
  voiceMemo: {
    providerMessage: RedactedIdentifier;
    providerThread: RedactedIdentifier;
    voiceMemoAttachment: RedactedIdentifier;
    voiceMemoUrlPresent: boolean;
  };
}

export interface RedactedIdentifier {
  fingerprint: string;
  present: boolean;
}

interface LinqVoiceMemoSendDependencies {
  env?: NodeJS.ProcessEnv;
  fetchImplementation?: LinqFetch;
  readFile?: (filePath: string) => Promise<Uint8Array>;
  statFile?: (filePath: string) => Promise<FileStatLike>;
}

interface FileStatLike {
  isFile(): boolean;
  size: number;
}

interface ParsedArgs {
  confirmLiveLinq: boolean;
  env: NodeJS.ProcessEnv;
}

export function readLinqVoiceMemoSendOptions(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): LinqVoiceMemoSendOptions {
  const parsed = parseArgs(args, env);
  const filePath = readRequiredEnv(parsed.env, "LINQ_VOICE_MEMO_FILE");
  const chatId = readLinqVoiceMemoChatId(parsed.env);
  const contentType =
    readOptionalEnv(parsed.env, "LINQ_VOICE_MEMO_CONTENT_TYPE") ??
    inferVoiceMemoContentType(filePath);
  const allowNonLinqApiBaseUrl =
    readOptionalEnv(parsed.env, "LINQ_VOICE_MEMO_ALLOW_NON_LINQ_BASE_URL") === "1";
  const apiBaseUrl = readOptionalEnv(parsed.env, "LINQ_API_BASE_URL") ?? DEFAULT_LINQ_API_BASE_URL;
  assertAllowedLinqApiBaseUrl(apiBaseUrl, allowNonLinqApiBaseUrl);

  return {
    allowNonLinqApiBaseUrl,
    apiBaseUrl,
    chatId,
    confirmLiveLinq: parsed.confirmLiveLinq,
    contentType,
    filePath,
    fingerprintSecret: readOptionalEnv(parsed.env, "LINQ_VOICE_MEMO_LOG_FINGERPRINT_SECRET"),
    uploadFilename:
      readOptionalEnv(parsed.env, "LINQ_VOICE_MEMO_FILENAME") ??
      defaultVoiceMemoUploadFilename(contentType),
  };
}

export async function runLinqVoiceMemoSend(
  options: LinqVoiceMemoSendOptions,
  dependencies: LinqVoiceMemoSendDependencies = {},
): Promise<LinqVoiceMemoSendReport> {
  if (!options.confirmLiveLinq) {
    throw new Error("Refusing to call the live Linq API without --confirm-live-linq.");
  }

  const context = createRedactionContext(options.fingerprintSecret);
  const env = dependencies.env ?? process.env;
  const requestEnv = {
    ...env,
    LINQ_API_BASE_URL: options.apiBaseUrl,
  };
  const statFileImpl = dependencies.statFile ?? statFile;
  const readFileImpl = dependencies.readFile ?? readFileBytes;
  const baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  assertAllowedLinqApiBaseUrl(baseUrl.toString(), options.allowNonLinqApiBaseUrl === true);
  const contentType = normalizeVoiceMemoContentType(options.contentType);
  const uploadFilename = normalizeUploadFilename(options.uploadFilename, contentType);

  let file: FileStatLike;
  try {
    file = await statFileImpl(options.filePath);
  } catch {
    throw new Error("Voice memo file could not be read.");
  }
  if (!file.isFile()) {
    throw new Error("Voice memo path must point to a regular file.");
  }

  let bytes: Uint8Array;
  try {
    bytes = await readFileImpl(options.filePath);
  } catch {
    throw new Error("Voice memo file bytes could not be read.");
  }
  const upload = await createLinqAttachmentUpload(
    {
      contentType,
      filename: uploadFilename,
      sizeBytes: bytes.byteLength,
    },
    {
      env: requestEnv,
      fetchImplementation: dependencies.fetchImplementation,
    },
  );

  await uploadLinqAttachmentBytes(
    {
      bytes,
      requiredHeaders: upload.requiredHeaders,
      uploadUrl: upload.uploadUrl,
    },
    {
      fetchImplementation: dependencies.fetchImplementation,
    },
  );

  const voiceMemo = await sendLinqVoiceMemo(
    {
      attachmentId: upload.attachmentId,
      chatId: options.chatId,
    },
    {
      env: requestEnv,
      fetchImplementation: dependencies.fetchImplementation,
    },
  );

  return {
    schema: "murph.linq-voice-memo-send.v1",
    api: {
      baseUrlOrigin: baseUrl.origin,
      baseUrlPath: baseUrl.pathname,
    },
    chat: redactIdentifier(options.chatId, context),
    file: {
      contentType,
      sizeBytes: bytes.byteLength,
      uploadFilenameExtension: readFilenameExtension(uploadFilename),
    },
    fingerprintScope: context.scope,
    upload: {
      attachment: redactIdentifier(upload.attachmentId, context),
      downloadUrlPresent: upload.downloadUrl !== null,
      expiresAtPresent: upload.expiresAt.length > 0,
      requiredHeaderCount: Object.keys(upload.requiredHeaders).length,
    },
    voiceMemo: {
      providerMessage: redactIdentifier(voiceMemo.providerMessageId, context),
      providerThread: redactIdentifier(voiceMemo.providerThreadId, context),
      voiceMemoAttachment: redactIdentifier(voiceMemo.voiceMemoAttachmentId, context),
      voiceMemoUrlPresent: voiceMemo.voiceMemoUrl !== null,
    },
  };
}

export function loadLinqVoiceMemoEnvFiles(cwd = process.cwd()): string[] {
  const loaded: string[] = [];
  for (const envPath of DEFAULT_ENV_FILES) {
    const absolutePath = path.resolve(cwd, envPath);
    try {
      process.loadEnvFile(absolutePath);
      loaded.push(envPath);
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        continue;
      }
      throw new Error(`Could not load local env file ${envPath}.`);
    }
  }
  return loaded;
}

function parseArgs(args: readonly string[], env: NodeJS.ProcessEnv): ParsedArgs {
  const values = { ...env };
  let confirmLiveLinq = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--confirm-live-linq":
        confirmLiveLinq = true;
        break;
      case "--content-type":
        values.LINQ_VOICE_MEMO_CONTENT_TYPE = readArgValue(args, index, arg);
        index += 1;
        break;
      case "--filename":
        values.LINQ_VOICE_MEMO_FILENAME = readArgValue(args, index, arg);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${redactUnknownArg(arg)}`);
    }
  }

  return {
    confirmLiveLinq,
    env: values,
  };
}

function readLinqVoiceMemoChatId(env: NodeJS.ProcessEnv): string {
  const chatId = readOptionalEnv(env, "LINQ_VOICE_MEMO_CHAT_ID");
  const chatUrl = readOptionalEnv(env, "LINQ_VOICE_MEMO_CHAT_URL");
  const chatIdFromUrl = chatUrl ? parseLinqChatIdFromUrl(chatUrl) : null;

  if (chatId && chatIdFromUrl && chatId !== chatIdFromUrl) {
    throw new Error("LINQ_VOICE_MEMO_CHAT_ID and LINQ_VOICE_MEMO_CHAT_URL point to different chats.");
  }

  if (chatId) {
    return chatId;
  }
  if (chatIdFromUrl) {
    return chatIdFromUrl;
  }

  throw new Error("LINQ_VOICE_MEMO_CHAT_URL or LINQ_VOICE_MEMO_CHAT_ID is required.");
}

export function parseLinqChatIdFromUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("LINQ_VOICE_MEMO_CHAT_URL must be a valid URL.");
  }

  const segments = parsed.pathname
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .filter((segment) => segment.length > 0);
  const chatSegmentIndex = segments.findIndex((segment) => segment === "chat");
  const chatId = chatSegmentIndex >= 0 ? segments[chatSegmentIndex + 1] : null;
  if (!chatId || chatId.trim().length === 0) {
    throw new Error("LINQ_VOICE_MEMO_CHAT_URL must include a chat id.");
  }

  return chatId;
}

function readArgValue(args: readonly string[], index: number, label: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${label} requires a value.`);
  }
  return value;
}

function readRequiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = readOptionalEnv(env, key);
  if (!value) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function readOptionalEnv(env: NodeJS.ProcessEnv, key: string): string | null {
  return normalizeText(env[key]);
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function inferVoiceMemoContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".aac":
      return "audio/aac";
    case ".amr":
      return "audio/amr";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
    case ".opus":
      return "audio/ogg";
    case ".wav":
      return "audio/wav";
    default:
      throw new Error("LINQ_VOICE_MEMO_CONTENT_TYPE is required for this file extension.");
  }
}

function normalizeVoiceMemoContentType(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error("Voice memo content type is required.");
  }
  if (!/^audio\/[a-z0-9.+-]+$/iu.test(normalized)) {
    throw new Error("Voice memo content type must be an audio/* MIME type.");
  }
  return normalized.toLowerCase();
}

function defaultVoiceMemoUploadFilename(contentType: string): string {
  switch (normalizeVoiceMemoContentType(contentType)) {
    case "audio/aac":
      return "voice-memo.aac";
    case "audio/amr":
      return "voice-memo.amr";
    case "audio/mp4":
      return "voice-memo.m4a";
    case "audio/mpeg":
      return "voice-memo.mp3";
    case "audio/ogg":
      return "voice-memo.ogg";
    case "audio/wav":
      return "voice-memo.wav";
    default:
      return "voice-memo.audio";
  }
}

function normalizeUploadFilename(value: string, contentType: string): string {
  const normalized = normalizeText(value) ?? defaultVoiceMemoUploadFilename(contentType);
  if (normalized.includes("/") || normalized.includes("\\") || normalized === "." || normalized === "..") {
    throw new Error("Voice memo upload filename must be a basename.");
  }
  return normalized;
}

function readFilenameExtension(filename: string): string | null {
  const extension = path.extname(filename).toLowerCase();
  return extension.length > 0 ? extension : null;
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return url;
}

function assertAllowedLinqApiBaseUrl(value: string, allowNonLinqApiBaseUrl: boolean): void {
  if (allowNonLinqApiBaseUrl || isCanonicalLinqApiBaseUrl(value)) {
    return;
  }

  throw new Error(
    "LINQ_API_BASE_URL must use the canonical Linq API URL unless LINQ_VOICE_MEMO_ALLOW_NON_LINQ_BASE_URL=1 is set.",
  );
}

function isCanonicalLinqApiBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = normalizeBaseUrl(value);
  } catch {
    return false;
  }

  const pathname = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  return url.protocol === "https:"
    && url.hostname === "api.linqapp.com"
    && pathname === "/api/partner/v3";
}

function createRedactionContext(secret: string | null | undefined): {
  fingerprintSecret: string;
  scope: "env-secret" | "ephemeral";
} {
  const normalized = normalizeText(secret);
  return normalized
    ? {
        fingerprintSecret: normalized,
        scope: "env-secret",
      }
    : {
        fingerprintSecret: randomBytes(32).toString("base64url"),
        scope: "ephemeral",
      };
}

function redactIdentifier(
  value: string | null | undefined,
  context: { fingerprintSecret: string },
): RedactedIdentifier {
  const normalized = normalizeText(value);
  return {
    fingerprint: normalized
      ? `h1_${createHmac("sha256", context.fingerprintSecret)
        .update(normalized, "utf8")
        .digest("hex")
        .slice(0, 16)}`
      : "absent",
    present: normalized !== null,
  };
}

function redactUnknownArg(arg: string | undefined): string {
  if (!arg) {
    return "<missing>";
  }
  const flagName = /^--[a-z0-9-]+/iu.exec(arg)?.[0];
  return flagName ?? "<redacted>";
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function toSafeErrorReport(error: unknown): Record<string, unknown> {
  return {
    ok: false,
    message: error instanceof Error ? error.message : "Unknown error",
    ...(error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? { code: error.code }
      : {}),
  };
}

async function main(): Promise<void> {
  const loadedEnvFiles = loadLinqVoiceMemoEnvFiles();
  const options = readLinqVoiceMemoSendOptions(process.argv.slice(2));
  console.error(
    `[linq-voice-memo] loaded ${loadedEnvFiles.length} local env file(s); creating attachment upload.`,
  );
  const report = await runLinqVoiceMemoSend(options);
  console.log(JSON.stringify({
    ok: true,
    ...report,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify(toSafeErrorReport(error), null, 2));
    process.exitCode = 1;
  });
}
