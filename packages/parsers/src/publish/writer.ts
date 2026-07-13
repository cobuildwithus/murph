import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  PARSER_RUNTIME_DIRECTORY_RELATIVE_PATH,
  writeTextFileAtomic,
} from "@murphai/runtime-state/node";

import {
  normalizeParserArtifactId,
  normalizeParserArtifactIdentity,
} from "../contracts/artifact.js";
import {
  decodeParserOutput,
  encodeParserOutput,
  PARSER_OUTPUT_MAX_SERIALIZED_BYTES,
  type EncodedParserOutput,
} from "../contracts/parser-output.js";
import type { ParserOutput } from "../contracts/parse.js";
import {
  assertVaultPathOnDisk,
  normalizeRelativePath,
  removeVaultDirectoryIfExists,
  resetVaultDirectory,
  resolveVaultRelativePath,
} from "../shared.js";

export interface PublishedParserResult {
  attemptDirectoryPath: string;
  resultPath: string;
}

export interface ParserAttemptPathIdentity extends PublishedParserResult {
  attempt: number;
  attachmentId: string;
  captureId: string;
}

interface ParserResultFileInput {
  vaultRoot: string;
  resultPath: string;
  output: ParserOutput;
}

interface EncodedParserResultFileInput {
  vaultRoot: string;
  resultPath: string;
  encodedOutput: EncodedParserOutput;
}

export const PARSER_DERIVED_INBOX_ROOT = normalizeRelativePath("derived/inbox");
export const PARSER_RESULT_FILE_NAME = "result.json";
export const PARSER_RESULT_MAX_BYTES = PARSER_OUTPUT_MAX_SERIALIZED_BYTES;

const PARSER_RESULT_DIRECTORY_MODE = 0o700;
const PARSER_RESULT_FILE_MODE = 0o600;

export async function writeParserResult(input: {
  attempt: number;
  vaultRoot: string;
  output: ParserOutput;
}): Promise<PublishedParserResult> {
  const encodedOutput = encodeParserOutput(input.output);
  const artifact = normalizeParserArtifactIdentity(encodedOutput.output.artifact);
  const attempt = normalizeAttempt(input.attempt);
  const attemptDirectoryPath = normalizePublishedParserPath(
    path.posix.join(
      PARSER_DERIVED_INBOX_ROOT,
      artifact.captureId,
      "attachments",
      artifact.attachmentId,
      "attempts",
      String(attempt).padStart(4, "0"),
    ),
  );
  const resultPath = normalizePublishedParserPath(
    path.posix.join(attemptDirectoryPath, PARSER_RESULT_FILE_NAME),
  );
  const absoluteAttemptDirectoryPath = await resetVaultDirectory(
    input.vaultRoot,
    attemptDirectoryPath,
  );
  await fs.chmod(absoluteAttemptDirectoryPath, PARSER_RESULT_DIRECTORY_MODE);

  try {
    await writeEncodedParserResultFileAtomic({
      vaultRoot: input.vaultRoot,
      resultPath,
      encodedOutput,
    });
  } catch (error) {
    await removeVaultDirectoryIfExists(input.vaultRoot, attemptDirectoryPath);
    throw error;
  }

  return {
    attemptDirectoryPath,
    resultPath,
  };
}

export async function readParserResult(input: {
  maxBytes?: number;
  vaultRoot: string;
  resultPath: string;
}): Promise<ParserOutput> {
  const maxBytes = normalizeParserResultReadMaxBytes(input.maxBytes);
  const identity = parseParserResultPath(input.resultPath);
  const absoluteResultPath = await resolveVaultRelativePath(input.vaultRoot, identity.resultPath);
  const stats = await fs.lstat(absoluteResultPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new TypeError("Parser result must be a regular file.");
  }
  if (stats.size > maxBytes) {
    throw new RangeError(
      `Parser result exceeds the ${maxBytes}-byte limit.`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(absoluteResultPath, "utf8"));
  } catch (error) {
    throw new TypeError(
      error instanceof SyntaxError ? "Parser result must contain valid JSON." : "Parser result could not be read.",
    );
  }

  const output = decodeParserOutput(value);
  assertParserResultIdentity(output, identity);
  return output;
}

export async function writeParserResultFileAtomic(input: ParserResultFileInput): Promise<void> {
  await writeEncodedParserResultFileAtomic({
    vaultRoot: input.vaultRoot,
    resultPath: input.resultPath,
    encodedOutput: encodeParserOutput(input.output),
  });
}

async function writeEncodedParserResultFileAtomic(
  input: EncodedParserResultFileInput,
): Promise<void> {
  const prepared = await prepareParserResultFile(input);
  await writeTextFileAtomic(prepared.absoluteResultPath, prepared.serializedOutput, {
    mode: PARSER_RESULT_FILE_MODE,
  });
  await assertVaultPathOnDisk(input.vaultRoot, prepared.absoluteResultPath);
  await fs.chmod(prepared.absoluteResultPath, PARSER_RESULT_FILE_MODE);
}

export async function createParserResultFileAtomic(
  input: ParserResultFileInput,
): Promise<"created" | "existing"> {
  const prepared = await prepareParserResultFile({
    vaultRoot: input.vaultRoot,
    resultPath: input.resultPath,
    encodedOutput: encodeParserOutput(input.output),
  });
  const stageDirectory = await resolveVaultRelativePath(
    input.vaultRoot,
    PARSER_RUNTIME_DIRECTORY_RELATIVE_PATH,
  );
  await fs.mkdir(stageDirectory, { recursive: true, mode: PARSER_RESULT_DIRECTORY_MODE });
  await assertVaultPathOnDisk(input.vaultRoot, stageDirectory);
  const stagedPath = path.join(
    stageDirectory,
    `result-${randomUUID().replaceAll("-", "")}.create`,
  );
  await writeTextFileAtomic(stagedPath, prepared.serializedOutput, {
    mode: PARSER_RESULT_FILE_MODE,
  });

  try {
    await fs.link(stagedPath, prepared.absoluteResultPath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") {
      return "existing";
    }
    throw error;
  } finally {
    await fs.rm(stagedPath, { force: true });
  }

  await assertVaultPathOnDisk(input.vaultRoot, prepared.absoluteResultPath);
  return "created";
}

async function prepareParserResultFile(input: EncodedParserResultFileInput): Promise<{
  absoluteResultPath: string;
  serializedOutput: string;
}> {
  const identity = parseParserResultPath(input.resultPath);
  const { output, serializedOutput } = input.encodedOutput;
  assertParserResultIdentity(output, identity);

  const absoluteResultPath = await resolveVaultRelativePath(input.vaultRoot, identity.resultPath);
  const absoluteAttemptDirectoryPath = path.dirname(absoluteResultPath);
  await assertVaultPathOnDisk(input.vaultRoot, absoluteAttemptDirectoryPath);
  const directoryStats = await fs.lstat(absoluteAttemptDirectoryPath);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new TypeError("Parser attempt path must be a regular directory.");
  }
  await assertVaultPathOnDisk(input.vaultRoot, absoluteResultPath);
  return { absoluteResultPath, serializedOutput };
}

export function parseParserAttemptDirectoryPath(relativePath: string): ParserAttemptPathIdentity {
  const attemptDirectoryPath = normalizePublishedParserPath(relativePath);
  const segments = attemptDirectoryPath.split("/");
  if (
    segments.length !== 7 ||
    segments[0] !== "derived" ||
    segments[1] !== "inbox" ||
    segments[3] !== "attachments" ||
    segments[5] !== "attempts"
  ) {
    throw new TypeError("Parser attempt path has an unsupported shape.");
  }

  const captureId = normalizeParserArtifactId(segments[2], "captureId");
  const attachmentId = normalizeParserArtifactId(segments[4], "attachmentId");
  const attemptSegment = segments[6];
  if (!/^[0-9]{4,}$/u.test(attemptSegment)) {
    throw new TypeError("Parser attempt path has an invalid attempt number.");
  }
  const attempt = Number(attemptSegment);
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new TypeError("Parser attempt path has an invalid attempt number.");
  }

  return {
    attempt,
    attachmentId,
    captureId,
    attemptDirectoryPath,
    resultPath: normalizePublishedParserPath(
      path.posix.join(attemptDirectoryPath, PARSER_RESULT_FILE_NAME),
    ),
  };
}

function parseParserResultPath(relativePath: string): ParserAttemptPathIdentity {
  const normalized = normalizePublishedParserPath(relativePath);
  if (path.posix.basename(normalized) !== PARSER_RESULT_FILE_NAME) {
    throw new TypeError("Parser result path must end in result.json.");
  }

  const identity = parseParserAttemptDirectoryPath(path.posix.dirname(normalized));
  if (identity.resultPath !== normalized) {
    throw new TypeError("Parser result path has an unsupported shape.");
  }
  return identity;
}

function assertParserResultIdentity(
  output: ParserOutput,
  identity: ParserAttemptPathIdentity,
): void {
  if (
    output.artifact.captureId !== identity.captureId ||
    output.artifact.attachmentId !== identity.attachmentId
  ) {
    throw new TypeError("Parser result identity does not match its attempt path.");
  }
}

function normalizeAttempt(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Parser attempt must be a positive integer.");
  }
  return value;
}

function normalizeParserResultReadMaxBytes(value: number | undefined): number {
  if (value === undefined) {
    return PARSER_RESULT_MAX_BYTES;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Parser result read limit must be a positive integer.");
  }
  return Math.min(value, PARSER_RESULT_MAX_BYTES);
}

function normalizePublishedParserPath(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);

  if (
    normalized !== PARSER_DERIVED_INBOX_ROOT &&
    !normalized.startsWith(`${PARSER_DERIVED_INBOX_ROOT}/`)
  ) {
    throw new TypeError("Published parser results must stay within derived/inbox.");
  }

  return normalized;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
