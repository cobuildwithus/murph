import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  decodeHostedBundleBase64,
  restoreHostedExecutionContext,
} from "@murphai/runtime-state/node";
import type {
  createDefaultParserRegistry as createDefaultParserRegistryType,
  parseAttachment as parseAttachmentType,
  ParserArtifactKind,
  ParserArtifactRef,
  ParserRegistry,
} from "@murphai/parsers";

import {
  HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
  parseHostedRunnerSmokeInput,
  type HostedRunnerSmokeResult,
} from "./hosted-runner-smoke-contract.js";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const input = parseHostedRunnerSmokeInput(JSON.parse(await readStandardInput()) as unknown);
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-smoke-workspace-"));

  try {
    const bundle = decodeHostedBundleBase64(input.bundle);

    if (!bundle) {
      throw new Error("Hosted runner smoke input bundle must decode to bytes.");
    }

    const restored = await restoreHostedExecutionContext({
      bundle,
      workspaceRoot,
    });

    const result = await withSmokeProcessEnvironment(
      {
        envOverrides: {},
        operatorHomeRoot: restored.operatorHomeRoot,
        vaultRoot: restored.vaultRoot,
      },
      async () => runSmokeChecks({
        expectedPdfText: input.expectedPdfText,
        expectedTranscriptSnippet: input.expectedTranscriptSnippet,
        expectedVaultId: input.expectedVaultId,
        pdfRelativePath: input.pdfRelativePath,
        vaultRoot: restored.vaultRoot,
        wavRelativePath: input.wavRelativePath,
        workspaceRoot,
      }),
    );

    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

async function runSmokeChecks(input: {
  expectedPdfText: string;
  expectedTranscriptSnippet: string | null;
  expectedVaultId: string;
  pdfRelativePath: string;
  vaultRoot: string;
  wavRelativePath: string;
  workspaceRoot: string;
}): Promise<HostedRunnerSmokeResult> {
  if (process.cwd() === "/app") {
    throw new Error("Hosted runner smoke child unexpectedly inherited /app as its cwd.");
  }

  if (process.env.HOME !== path.join(input.workspaceRoot, "home")) {
    throw new Error("Hosted runner smoke child did not rebind HOME to the restored operator root.");
  }

  if (process.env.VAULT !== input.vaultRoot) {
    throw new Error("Hosted runner smoke child did not rebind VAULT to the restored vault root.");
  }

  const murphBin = await resolveCommandPath("murph");
  const vaultCliBin = await resolveCommandPath("vault-cli");

  await runTextCommand("murph", ["--help"]);
  await runTextCommand("vault-cli", ["--help"]);

  const vaultShowOutput = await runTextCommand("vault-cli", [
    "vault",
    "show",
    "--vault",
    input.vaultRoot,
    "--format",
    "json",
  ]);
  const reportedVaultId = parseReportedVaultId(vaultShowOutput);

  if (reportedVaultId !== input.expectedVaultId) {
    throw new Error(
      `Hosted runner smoke vault id mismatch: expected ${input.expectedVaultId}, got ${reportedVaultId}.`,
    );
  }

  const pdfPath = path.join(input.vaultRoot, input.pdfRelativePath);
  const wavPath = path.join(input.vaultRoot, input.wavRelativePath);
  await assertPathExists(pdfPath);
  await assertPathExists(wavPath);

  const parserScratchRoot = path.join(input.workspaceRoot, "parser-scratch");
  const parserRegistry = await createSmokeParserRegistry();
  const pdfParse = await parsePdf({
    expectedText: input.expectedPdfText,
    pdfPath,
    registry: parserRegistry,
    scratchRoot: path.join(parserScratchRoot, "pdf"),
  });
  const wavParse = await transcribeWave({
    expectedSnippet: input.expectedTranscriptSnippet,
    registry: parserRegistry,
    scratchRoot: path.join(parserScratchRoot, "wav"),
    wavPath,
  });
  const normalizedParse = await transcribeNormalizedAudio({
    expectedSnippet: input.expectedTranscriptSnippet,
    registry: parserRegistry,
    scratchRoot: path.join(parserScratchRoot, "normalized"),
    wavPath,
  });

  return {
    childCwd: process.cwd(),
    expectedPdfText: input.expectedPdfText,
    murphBin,
    normalizedTranscript: normalizedParse.text,
    normalizedTranscriptProviderId: normalizedParse.providerId,
    operatorHomeRoot: process.env.HOME ?? "",
    pdfProviderId: pdfParse.providerId,
    pdfText: pdfParse.text,
    reportedVaultId,
    schema: HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
    vaultCliBin,
    vaultRoot: input.vaultRoot,
    vaultShowBytes: Buffer.byteLength(vaultShowOutput, "utf8"),
    wavTranscript: wavParse.text,
    wavTranscriptProviderId: wavParse.providerId,
  };
}

async function parsePdf(input: {
  expectedText: string;
  pdfPath: string;
  registry: ParserRegistry;
  scratchRoot: string;
}): Promise<SmokeParseResult> {
  const result = await parseSmokeAttachment({
    artifact: createSmokeArtifact({
      absolutePath: input.pdfPath,
      attachmentId: "att_hosted_runner_pdf",
      captureId: "cap_hosted_runner_pdf",
      kind: "document",
      mime: "application/pdf",
      storedPath: "raw/smoke/hosted-runner.pdf",
    }),
    expectedProviderId: "pdftotext",
    registry: input.registry,
    scratchRoot: input.scratchRoot,
  });

  if (!result.text.includes(input.expectedText)) {
    throw new Error(
      `Hosted runner smoke PDF text did not include the expected fixture text: ${input.expectedText}`,
    );
  }

  return result;
}

async function transcribeWave(input: {
  expectedSnippet: string | null;
  registry: ParserRegistry;
  scratchRoot: string;
  wavPath: string;
}): Promise<SmokeParseResult> {
  const result = await parseSmokeAttachment({
    artifact: createSmokeArtifact({
      absolutePath: input.wavPath,
      attachmentId: "att_hosted_runner_wav",
      captureId: "cap_hosted_runner_wav",
      kind: "audio",
      mime: "audio/wav",
      storedPath: "raw/smoke/hosted-runner.wav",
    }),
    expectedProviderId: "whisper.cpp",
    registry: input.registry,
    scratchRoot: input.scratchRoot,
  });

  assertTranscriptSnippet(result.text, input.expectedSnippet, "WAV");
  return result;
}

async function transcribeNormalizedAudio(input: {
  expectedSnippet: string | null;
  registry: ParserRegistry;
  scratchRoot: string;
  wavPath: string;
}): Promise<SmokeParseResult> {
  await ensureScratchDirectory(input.scratchRoot);
  const mp3Path = path.join(input.scratchRoot, "hosted-runner.mp3");
  const ffmpegCommand = process.env.FFMPEG_COMMAND?.trim() || "ffmpeg";
  await runCommand(ffmpegCommand, [
    "-y",
    "-loglevel",
    "error",
    "-i",
    input.wavPath,
    "-codec:a",
    "libmp3lame",
    mp3Path,
  ], { allowEmptyStdout: true });

  const result = await parseSmokeAttachment({
    artifact: createSmokeArtifact({
      absolutePath: mp3Path,
      attachmentId: "att_hosted_runner_mp3",
      captureId: "cap_hosted_runner_mp3",
      kind: "audio",
      mime: "audio/mpeg",
      storedPath: "raw/smoke/hosted-runner.mp3",
    }),
    expectedProviderId: "whisper.cpp",
    registry: input.registry,
    scratchRoot: input.scratchRoot,
  });

  assertTranscriptSnippet(result.text, input.expectedSnippet, "normalized audio");
  return result;
}

async function ensureScratchDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

function assertTranscriptSnippet(
  transcript: string,
  expectedSnippet: string | null,
  label: string,
): void {
  if (transcript.trim().length === 0) {
    throw new Error(`Hosted runner smoke ${label} transcript was empty.`);
  }

  if (
    expectedSnippet
    && !transcript.toLowerCase().includes(expectedSnippet.toLowerCase())
  ) {
    throw new Error(
      `Hosted runner smoke ${label} transcript did not include the expected snippet: ${expectedSnippet}`,
    );
  }
}

async function assertPathExists(filePath: string): Promise<void> {
  await access(filePath);
}

async function resolveCommandPath(command: string): Promise<string> {
  return runTextCommand("/bin/sh", ["-c", `command -v ${escapeShellWord(command)}`]);
}

async function runTextCommand(file: string, args: string[]): Promise<string> {
  const { stdout } = await runCommand(file, args);
  const normalized = stdout.trim();
  if (normalized.length === 0) {
    throw new Error(`Command produced no stdout: ${file} ${args.join(" ")}`);
  }

  return normalized;
}

function parseReportedVaultId(vaultShowOutput: string): string {
  const record = JSON.parse(vaultShowOutput) as Record<string, unknown>;
  const reportedVaultId = record.vaultId;

  if (typeof reportedVaultId !== "string" || reportedVaultId.trim().length === 0) {
    throw new Error("Hosted runner smoke vault show output did not include a non-empty vaultId.");
  }

  return reportedVaultId.trim();
}

async function runCommand(
  file: string,
  args: string[],
  options: {
    allowEmptyStdout?: boolean;
  } = {},
): Promise<{ stdout: string }> {
  const { stdout } = await execFileAsync(file, args, {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (!options.allowEmptyStdout && stdout.trim().length === 0) {
    throw new Error(`Command produced no stdout: ${file} ${args.join(" ")}`);
  }

  return { stdout };
}

async function loadParsersRuntime(): Promise<{
  createDefaultParserRegistry: typeof createDefaultParserRegistryType;
  parseAttachment: typeof parseAttachmentType;
}> {
  const parsers = await import("@murphai/parsers");

  return {
    createDefaultParserRegistry: parsers.createDefaultParserRegistry,
    parseAttachment: parsers.parseAttachment,
  };
}

async function createSmokeParserRegistry(): Promise<ParserRegistry> {
  const { createDefaultParserRegistry } = await loadParsersRuntime();

  return createDefaultParserRegistry({
    whisper: {
      language: "en",
    },
  });
}

async function parseSmokeAttachment(input: {
  artifact: ParserArtifactRef;
  expectedProviderId: string;
  registry: ParserRegistry;
  scratchRoot: string;
}): Promise<SmokeParseResult> {
  await ensureScratchDirectory(input.scratchRoot);
  const { parseAttachment } = await loadParsersRuntime();
  const result = await parseAttachment({
    artifact: input.artifact,
    registry: input.registry,
    scratchRoot: input.scratchRoot,
  });

  if (result.providerId !== input.expectedProviderId) {
    throw new Error(
      `Hosted runner smoke provider mismatch for ${input.artifact.attachmentId}: expected ${input.expectedProviderId}, got ${result.providerId}.`,
    );
  }

  return {
    providerId: result.providerId,
    text: result.output.text,
  };
}

function createSmokeArtifact(input: {
  absolutePath: string;
  attachmentId: string;
  captureId: string;
  kind: ParserArtifactKind;
  mime: string;
  storedPath: string;
}): ParserArtifactRef {
  return {
    absolutePath: input.absolutePath,
    attachmentId: input.attachmentId,
    captureId: input.captureId,
    fileName: path.basename(input.absolutePath),
    kind: input.kind,
    mime: input.mime,
    storedPath: input.storedPath,
  };
}

interface SmokeParseResult {
  providerId: string;
  text: string;
}

async function withSmokeProcessEnvironment<T>(input: {
  envOverrides: Record<string, string>;
  operatorHomeRoot: string;
  vaultRoot: string;
}, run: () => Promise<T>): Promise<T> {
  const previousValues = new Map<string, string | undefined>();
  const nextValues: Record<string, string> = {
    ...input.envOverrides,
    HOME: input.operatorHomeRoot,
    VAULT: input.vaultRoot,
  };

  for (const [key, value] of Object.entries(nextValues)) {
    previousValues.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return await run();
  } finally {
    for (const [key, previousValue] of previousValues) {
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  }
}

function escapeShellWord(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

await main();
