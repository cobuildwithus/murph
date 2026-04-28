import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
const FINNISH_DRY_SAUNA_KEY =
  "protocol_variant:dry-sauna/murph-finnish-standard-3x-week";
const HEALTH_COMMONS_RUNTIME_MODULE: string = "@murphai/health-commons/runtime";

async function main(): Promise<void> {
  const input = parseHostedRunnerSmokeInput(parseJsonValue(await readStandardInput()));
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
        expectedTranscriptSnippet: input.expectedTranscriptSnippet,
        expectedVaultId: input.expectedVaultId,
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
  expectedTranscriptSnippet: string | null;
  expectedVaultId: string;
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

  await resolveCommandPath("murph");
  await resolveCommandPath("vault-cli");
  await resolveCommandPath("codex");

  await runTextCommand("murph", ["--help"]);
  await runTextCommand("vault-cli", ["--help"]);
  const codexPreflight = await runCodexPreflight();

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

  const healthCommonsRuntime = await runHealthCommonsSmoke();
  const healthCommonsCli = await runHealthCommonsCliSmoke();

  const wavPath = path.join(input.vaultRoot, input.wavRelativePath);
  await assertPathExists(wavPath);

  const parserScratchRoot = path.join(input.workspaceRoot, "parser-scratch");
  const parserRegistry = await createSmokeParserRegistry();
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
    childCwdIsIsolated: true,
    codexAppServerHelpBytes: codexPreflight.appServerHelpBytes,
    codexCommandDiscovered: true,
    codexVersion: codexPreflight.version,
    healthCommonsCatalogHash: healthCommonsRuntime.catalogHash,
    healthCommonsCliProtocolListBytes: healthCommonsCli.protocolListBytes,
    healthCommonsCliSearchBytes: healthCommonsCli.searchBytes,
    healthCommonsFinnishDrySaunaTitle: healthCommonsRuntime.finnishDrySaunaTitle,
    healthCommonsRuntimeProtocolHitKeys: healthCommonsRuntime.runtimeProtocolHitKeys,
    healthCommonsRuntimeSearchHitKeys: healthCommonsRuntime.runtimeSearchHitKeys,
    murphCommandDiscovered: true,
    normalizedTranscriptMatchesExpectedSnippet: transcriptMatchesExpectedSnippet(
      normalizedParse.text,
      input.expectedTranscriptSnippet,
    ),
    normalizedTranscriptProviderId: normalizedParse.providerId,
    normalizedTranscriptSha256: sha256Hex(normalizedParse.text),
    operatorHomeRebound: true,
    reportedVaultId,
    schema: HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
    vaultCliCommandDiscovered: true,
    vaultRootRebound: true,
    vaultShowBytes: Buffer.byteLength(vaultShowOutput, "utf8"),
    wavTranscriptMatchesExpectedSnippet: transcriptMatchesExpectedSnippet(
      wavParse.text,
      input.expectedTranscriptSnippet,
    ),
    wavTranscriptProviderId: wavParse.providerId,
    wavTranscriptSha256: sha256Hex(wavParse.text),
  };
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

function transcriptMatchesExpectedSnippet(transcript: string, expectedSnippet: string | null): boolean {
  return expectedSnippet
    ? transcript.toLowerCase().includes(expectedSnippet.toLowerCase())
    : transcript.trim().length > 0;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseJsonValue(value: string): unknown {
  return JSON.parse(value);
}

async function assertPathExists(filePath: string): Promise<void> {
  await access(filePath);
}

async function resolveCommandPath(command: string): Promise<string> {
  try {
    return await runTextCommand("/bin/sh", ["-c", `command -v ${escapeShellWord(command)}`]);
  } catch {
    throw new Error(
      `Hosted runner smoke required command "${command}" was not found on PATH.`,
    );
  }
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

async function runHealthCommonsSmoke(): Promise<{
  catalogHash: string;
  finnishDrySaunaTitle: string;
  runtimeProtocolHitKeys: string[];
  runtimeSearchHitKeys: string[];
}> {
  const runtime = await import(HEALTH_COMMONS_RUNTIME_MODULE) as SmokeHealthCommonsRuntime;
  const reader = runtime.getGeneratedHealthCommonsCatalogReader();
  const runtimeSearchHitKeys = reader
    .search({
      query: "sauna",
      entityTypes: ["protocol_variant"],
      limit: 20,
      includeBody: true,
    })
    .map((hit) => hit.entity.key);
  const runtimeProtocolHitKeys = reader
    .listProtocolVariants({
      query: "sauna",
      limit: 20,
    })
    .map((entity) => entity.key);
  const finnishDrySauna = reader.findByKey(FINNISH_DRY_SAUNA_KEY);

  if (!finnishDrySauna) {
    throw new Error(
      `Health Commons runtime catalog is missing ${FINNISH_DRY_SAUNA_KEY}. catalogHash=${reader.catalogHash}`,
    );
  }

  if (!runtimeSearchHitKeys.includes(FINNISH_DRY_SAUNA_KEY)) {
    throw new Error(
      `Health Commons runtime search did not return Finnish Dry Sauna. catalogHash=${reader.catalogHash}; hits=${runtimeSearchHitKeys.join(",")}`,
    );
  }

  if (!runtimeProtocolHitKeys.includes(FINNISH_DRY_SAUNA_KEY)) {
    throw new Error(
      `Health Commons runtime protocol list did not return Finnish Dry Sauna. catalogHash=${reader.catalogHash}; hits=${runtimeProtocolHitKeys.join(",")}`,
    );
  }

  return {
    catalogHash: reader.catalogHash,
    finnishDrySaunaTitle: finnishDrySauna.title,
    runtimeProtocolHitKeys,
    runtimeSearchHitKeys,
  };
}

async function runCodexPreflight(): Promise<{
  appServerHelpBytes: number;
  version: string;
}> {
  try {
    const version = await runTextCommand("codex", ["--version"]);
    const appServerHelp = await runTextCommand("codex", ["app-server", "--help"]);

    return {
      appServerHelpBytes: Buffer.byteLength(appServerHelp, "utf8"),
      version,
    };
  } catch {
    throw new Error(
      "Hosted runner smoke Codex CLI preflight failed. Install Codex CLI in the hosted runner image and ensure `codex app-server --help` succeeds.",
    );
  }
}

async function runHealthCommonsCliSmoke(): Promise<{
  protocolListBytes: number;
  searchBytes: number;
}> {
  const searchOutput = await runTextCommand("vault-cli", [
    "commons",
    "search",
    "sauna",
    "--type",
    "protocol_variant",
    "--limit",
    "10",
    "--format",
    "json",
  ]);
  const protocolListOutput = await runTextCommand("vault-cli", [
    "commons",
    "protocol",
    "list",
    "--query",
    "sauna",
    "--limit",
    "10",
    "--format",
    "json",
  ]);

  const searchJson = JSON.parse(searchOutput);
  const protocolListJson = JSON.parse(protocolListOutput);
  const serializedSearch = JSON.stringify(searchJson);
  const serializedProtocolList = JSON.stringify(protocolListJson);

  if (!serializedSearch.includes(FINNISH_DRY_SAUNA_KEY)) {
    throw new Error(
      `Hosted runner CLI Health Commons search smoke did not include ${FINNISH_DRY_SAUNA_KEY}.`,
    );
  }

  if (!serializedProtocolList.includes(FINNISH_DRY_SAUNA_KEY)) {
    throw new Error(
      `Hosted runner CLI Health Commons protocol list smoke did not include ${FINNISH_DRY_SAUNA_KEY}.`,
    );
  }

  return {
    protocolListBytes: Buffer.byteLength(protocolListOutput, "utf8"),
    searchBytes: Buffer.byteLength(searchOutput, "utf8"),
  };
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

interface SmokeHealthCommonsRuntime {
  getGeneratedHealthCommonsCatalogReader(): SmokeHealthCommonsCatalogReader;
}

interface SmokeHealthCommonsCatalogReader {
  catalogHash: string;
  findByKey(key: string): { title: string } | null;
  listProtocolVariants(input: {
    limit: number;
    query: string;
  }): Array<{ key: string }>;
  search(input: {
    entityTypes: readonly ["protocol_variant"];
    includeBody: true;
    limit: number;
    query: string;
  }): Array<{
    entity: {
      key: string;
    };
  }>;
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
