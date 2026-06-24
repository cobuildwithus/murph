import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Writable } from "node:stream";
import { promisify } from "node:util";

import {
  CURRENT_VAULT_FORMAT_VERSION,
} from "@murphai/contracts";
import {
  decodeHostedBundleBase64,
  restoreHostedExecutionContext,
} from "@murphai/runtime-state/node";
import {
  HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE,
  HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  readHostedAssistantCliSurfaceBootstrapContext,
} from "@murphai/assistant-runtime/hosted-assistant-bootstrap";
import type {
  createDefaultParserRegistry as createDefaultParserRegistryType,
  parseAttachment as parseAttachmentType,
  prepareAudioInput as prepareAudioInputType,
  ParserArtifactKind,
  ParserArtifactRef,
  ParserRegistry,
} from "@murphai/parsers";

import {
  createHostedRunnerNativeParserToolchain,
} from "./runner-native-parser-toolchain.ts";
import {
  HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT,
  HOSTED_RUNNER_SMOKE_CLI_VAULT_COMMAND_PROOF_COUNT,
  HOSTED_RUNNER_SMOKE_CLI_VAULT_WRITE_PROOF_COUNT,
  HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
  countAssistantCliSurfaceHotPathProofs,
  parseHostedRunnerSmokeInput,
  type HostedRunnerSmokeResult,
} from "./hosted-runner-smoke-contract.js";

const execFileAsync = promisify(execFile);
const FINNISH_DRY_SAUNA_KEY =
  "protocol_variant:dry-sauna/murph-finnish-standard-3x-week";
const HEALTH_COMMONS_RUNTIME_MODULE: string = "@murphai/health-commons/runtime";
const CODEX_SHELL_ENV_PROBE_COMMAND_TIMEOUT_MS = 45_000;
const CODEX_SHELL_ENV_PROBE_TIMEOUT_MS = 90_000;
const PDF_SMOKE_EXPECTED_TEXT = "Murph hosted PDF smoke fixture";
const PDF_SMOKE_RELATIVE_PATH = "raw/smoke/hosted-runner.pdf";
const CODEX_VAULT_CLI_SMOKE_MEASUREMENT_METRIC = "strict-pull-ups";
const CODEX_VAULT_CLI_SMOKE_MEASUREMENT_NOTE =
  "max strict pull-up baseline, dead hang";
const CODEX_VAULT_CLI_SMOKE_EXPLICIT_VAULT_ID =
  "vault_01K11111111111111111111111";
const CODEX_VAULT_CLI_SMOKE_SCHEDULED_LOG_SLUG =
  "hosted-smoke-pull-up-baseline-reminder";

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
  const assistantCliSurface = await runAssistantCliSurfaceContractSmoke(input.vaultRoot);
  const hostedCodexConfig =
    await runHostedCodexConfigShellEnvironmentPolicySmoke({
      expectedVaultId: input.expectedVaultId,
      vaultRoot: input.vaultRoot,
      workspaceRoot: input.workspaceRoot,
    });
  const pythonVersion = await runPythonToolchainSmoke();
  const ripgrepVersion = await runRipgrepToolchainSmoke({
    scratchRoot: path.join(input.workspaceRoot, "ripgrep-smoke"),
  });

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
  const pdfPath = path.join(input.vaultRoot, PDF_SMOKE_RELATIVE_PATH);
  await runPdfToolchainSmoke({
    pdfPath,
    scratchRoot: path.join(parserScratchRoot, "pdf"),
  });
  const { createDefaultParserRegistry } = await loadParsersRuntime();
  const parserRegistry = createDefaultParserRegistry();
  const pdfParse = await parsePdfDocument({
    pdfPath,
    registry: parserRegistry,
    scratchRoot: path.join(parserScratchRoot, "pdf-parser"),
  });
  const audioToolchain = await runAudioToolchainSmoke({
    scratchRoot: path.join(parserScratchRoot, "audio"),
    wavPath,
  });

  return {
    audioNormalizedMp3Bytes: audioToolchain.normalizedMp3Bytes,
    audioPreparedWavBytes: audioToolchain.preparedWavBytes,
    childCwdIsIsolated: true,
    codexAppServerHelpBytes: codexPreflight.appServerHelpBytes,
    codexCommandDiscovered: true,
    codexHostedCliSurfaceContractBytes: assistantCliSurface.contractBytes,
    codexHostedCliSurfaceHotPathProofCount: assistantCliSurface.hotPathProofCount,
    codexHostedConfigShellEnvironmentPolicyAllowlisted:
      hostedCodexConfig.shellEnvironmentPolicyAllowlisted,
    codexHostedCliSchemaVaultOptionHidden: hostedCodexConfig.schemaVaultOptionHidden,
    codexHostedCliVaultCommandProofCount: hostedCodexConfig.vaultCommandProofCount,
    codexHostedCliVaultWriteProofCount: hostedCodexConfig.vaultWriteProofCount,
    codexHostedShellMurphPathBytes: hostedCodexConfig.murphPathBytes,
    codexHostedShellPythonVersion: hostedCodexConfig.pythonVersion,
    codexHostedShellVaultCliLlmsBytes: hostedCodexConfig.vaultCliLlmsBytes,
    codexVersion: codexPreflight.version,
    healthCommonsCatalogHash: healthCommonsRuntime.catalogHash,
    healthCommonsCliProtocolListBytes: healthCommonsCli.protocolListBytes,
    healthCommonsFinnishDrySaunaTitle: healthCommonsRuntime.finnishDrySaunaTitle,
    healthCommonsRuntimeProtocolHitKeys: healthCommonsRuntime.runtimeProtocolHitKeys,
    healthCommonsRuntimeSearchHitKeys: healthCommonsRuntime.runtimeSearchHitKeys,
    murphCommandDiscovered: true,
    operatorHomeRebound: true,
    pdfParserProviderId: pdfParse.providerId,
    pdfTextSha256: sha256Hex(pdfParse.text),
    pythonVersion,
    reportedVaultIdMatchesExpected: true,
    ripgrepCommandDiscovered: true,
    ripgrepVersion,
    schema: HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
    vaultCliCommandDiscovered: true,
    vaultRootRebound: true,
    vaultShowBytes: Buffer.byteLength(vaultShowOutput, "utf8"),
  };
}

async function runAssistantCliSurfaceContractSmoke(vaultRoot: string): Promise<{
  contractBytes: number;
  hotPathProofCount: number;
}> {
  const contract = await readHostedAssistantCliSurfaceBootstrapContext({
    sessionId: "hosted-runner-smoke",
    vault: vaultRoot,
  });
  if (!contract) {
    throw new Error("Hosted runner smoke assistant CLI surface contract was missing.");
  }

  const hotPathProofCount = countAssistantCliSurfaceHotPathProofs(contract);
  if (hotPathProofCount < HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT) {
    throw new Error(
      `Hosted runner smoke assistant CLI surface contract was missing hot-path schemas. proofCount=${hotPathProofCount}`,
    );
  }

  return {
    contractBytes: Buffer.byteLength(contract, "utf8"),
    hotPathProofCount,
  };
}

async function parsePdfDocument(input: {
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
      storedPath: PDF_SMOKE_RELATIVE_PATH,
    }),
    expectedProviderId: "poppler.pdf",
    registry: input.registry,
    scratchRoot: input.scratchRoot,
  });

  if (!result.text.includes(PDF_SMOKE_EXPECTED_TEXT)) {
    throw new Error(
      "Hosted runner smoke parser PDF output did not include the expected fixture text.",
    );
  }

  return result;
}

async function runAudioToolchainSmoke(input: {
  scratchRoot: string;
  wavPath: string;
}): Promise<{
  normalizedMp3Bytes: number;
  preparedWavBytes: number;
}> {
  await ensureScratchDirectory(input.scratchRoot);
  const mp3Path = path.join(input.scratchRoot, "hosted-runner.mp3");
  const ffmpegCommand =
    createHostedRunnerNativeParserToolchain().tools.ffmpeg?.command ?? "ffmpeg";
  await runCommand(ffmpegCommand, [
    "-y",
    "-loglevel",
    "error",
    "-i",
    input.wavPath,
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "64k",
    mp3Path,
  ], { allowEmptyStdout: true });
  const normalizedMp3 = await stat(mp3Path);
  if (normalizedMp3.size <= 0) {
    throw new Error("Hosted runner smoke ffmpeg MP3 normalization output was empty.");
  }

  // Exercise the ffmpeg normalization path used when local whisper is available
  // or the source format is not eligible for remote-only passthrough.
  const { prepareAudioInput } = await loadParsersRuntime();
  const preparedScratchDirectory = path.join(input.scratchRoot, "prepared");
  await ensureScratchDirectory(preparedScratchDirectory);
  const prepared = await prepareAudioInput({
    artifact: createSmokeArtifact({
      absolutePath: mp3Path,
      attachmentId: "att_hosted_runner_mp3",
      captureId: "cap_hosted_runner_mp3",
      kind: "audio",
      mime: "audio/mpeg",
      storedPath: "raw/smoke/hosted-runner.mp3",
    }),
    ffmpeg: { commandCandidates: [ffmpegCommand] },
    scratchDirectory: preparedScratchDirectory,
  });
  if (prepared.preparedKind !== "audio") {
    throw new Error("Hosted runner smoke audio preparation did not report an audio artifact.");
  }
  const preparedWav = await stat(prepared.inputPath);
  if (preparedWav.size <= 0) {
    throw new Error("Hosted runner smoke audio preparation output was empty.");
  }

  return {
    normalizedMp3Bytes: normalizedMp3.size,
    preparedWavBytes: preparedWav.size,
  };
}

async function ensureScratchDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

async function runPdfToolchainSmoke(input: {
  pdfPath: string;
  scratchRoot: string;
}): Promise<void> {
  await assertPathExists(input.pdfPath);
  await resolveCommandPath("file");
  await resolveCommandPath("mutool");
  await resolveCommandPath("pdfinfo");
  await resolveCommandPath("pdftotext");
  await resolveCommandPath("pdftoppm");
  await resolveCommandPath("qpdf");

  const pdfMime = await runTextCommand("file", [
    "--mime-type",
    "-b",
    input.pdfPath,
  ]);
  if (pdfMime.trim() !== "application/pdf") {
    throw new Error(
      `Hosted runner smoke expected PDF fixture MIME application/pdf, got ${pdfMime}.`,
    );
  }

  const pdfInfo = await runTextCommand("pdfinfo", [input.pdfPath]);
  if (!/^Pages:\s+1$/mu.test(pdfInfo)) {
    throw new Error("Hosted runner smoke PDF fixture did not report exactly one page.");
  }

  const qpdfCheck = await runTextCommand("qpdf", ["--check", input.pdfPath]);
  if (!/no syntax or stream encoding errors found/imu.test(qpdfCheck)) {
    throw new Error("Hosted runner smoke qpdf check did not validate the PDF fixture.");
  }

  const mutoolInfo = await runTextCommand("mutool", ["info", input.pdfPath]);
  if (!/^Pages:\s+1$/mu.test(mutoolInfo)) {
    throw new Error("Hosted runner smoke mutool info did not report exactly one page.");
  }

  await ensureScratchDirectory(input.scratchRoot);
  const textPath = path.join(input.scratchRoot, "hosted-runner.txt");
  await runCommand(
    "pdftotext",
    ["-enc", "UTF-8", "-nopgbrk", input.pdfPath, textPath],
    { allowEmptyStdout: true },
  );

  const extractedText = await readFile(textPath, "utf8");
  if (!extractedText.includes(PDF_SMOKE_EXPECTED_TEXT)) {
    throw new Error(
      "Hosted runner smoke pdftotext output did not include the expected fixture text.",
    );
  }

  const pageRoot = path.join(input.scratchRoot, "page");
  await runCommand(
    "pdftoppm",
    ["-png", "-r", "150", "-f", "1", "-l", "1", input.pdfPath, pageRoot],
    { allowEmptyStdout: true },
  );

  const renderedPagePath = `${pageRoot}-1.png`;
  const renderedPage = await stat(renderedPagePath);
  if (renderedPage.size <= 0) {
    throw new Error("Hosted runner smoke pdftoppm output page was empty.");
  }

  const renderedPageMime = await runTextCommand("file", [
    "--mime-type",
    "-b",
    renderedPagePath,
  ]);
  if (renderedPageMime.trim() !== "image/png") {
    throw new Error(
      `Hosted runner smoke expected rendered PDF page MIME image/png, got ${renderedPageMime}.`,
    );
  }
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
  const indexReader = runtime.getGeneratedHealthCommonsProtocolIndexReader();
  const runSpecReader = runtime.getGeneratedHealthCommonsProtocolRunSpecReader();
  const graphReader = runtime.getGeneratedHealthCommonsProtocolFamilyGraphReader();
  const runtimeSearchHitKeys = graphReader
    .listProtocolMatches({
      lookup: "sauna",
      limit: 20,
    })
    .map((hit) => hit.protocol.key);
  const runtimeProtocolHitKeys = indexReader
    .listProtocols({
      query: "sauna",
      limit: 20,
    })
    .map((protocol) => protocol.key);
  const finnishDrySauna = runSpecReader.findByLookup(FINNISH_DRY_SAUNA_KEY);

  if (!finnishDrySauna) {
    throw new Error(
      `Health Commons runtime protocol run specs are missing ${FINNISH_DRY_SAUNA_KEY}. catalogHash=${runSpecReader.catalogHash}`,
    );
  }

  if (!runtimeSearchHitKeys.includes(FINNISH_DRY_SAUNA_KEY)) {
    throw new Error(
      `Health Commons runtime protocol graph did not return Finnish Dry Sauna. catalogHash=${graphReader.catalogHash}; hits=${runtimeSearchHitKeys.join(",")}`,
    );
  }

  if (!runtimeProtocolHitKeys.includes(FINNISH_DRY_SAUNA_KEY)) {
    throw new Error(
      `Health Commons runtime protocol index did not return Finnish Dry Sauna. catalogHash=${indexReader.catalogHash}; hits=${runtimeProtocolHitKeys.join(",")}`,
    );
  }

  return {
    catalogHash: indexReader.catalogHash,
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

async function runPythonToolchainSmoke(): Promise<string> {
  await resolveCommandPath("python");
  await resolveCommandPath("python3");

  const pythonVersion = await runTextCommand("python3", ["--version"]);
  if (!/^Python\s+3\./u.test(pythonVersion)) {
    throw new Error(
      `Hosted runner smoke expected python3 to report Python 3.x, got ${pythonVersion}.`,
    );
  }

  const pythonAliasVersion = await runTextCommand("python", [
    "-c",
    "import sys; print(sys.version_info.major)",
  ]);
  if (pythonAliasVersion.trim() !== "3") {
    throw new Error("Hosted runner smoke expected python to resolve to Python 3.");
  }

  return pythonVersion;
}

async function runRipgrepToolchainSmoke(input: {
  scratchRoot: string;
}): Promise<string> {
  await resolveCommandPath("rg");
  const ripgrepVersion = readRipgrepVersionProbeResult(
    await runTextCommand("rg", ["--version"]),
  );

  await ensureScratchDirectory(input.scratchRoot);
  await writeFile(
    path.join(input.scratchRoot, "needle.txt"),
    "hosted runner ripgrep smoke\n",
    { mode: 0o600 },
  );

  const searchOutput = await runTextCommand("rg", [
    "--line-number",
    "ripgrep smoke",
    input.scratchRoot,
  ]);
  if (!searchOutput.includes("needle.txt:1:hosted runner ripgrep smoke")) {
    throw new Error("Hosted runner smoke rg search did not find the scratch proof file.");
  }

  return ripgrepVersion;
}

async function runHostedCodexConfigShellEnvironmentPolicySmoke(input: {
  expectedVaultId: string;
  vaultRoot: string;
  workspaceRoot: string;
}): Promise<{
  murphPathBytes: number;
  pythonVersion: string;
  schemaVaultOptionHidden: boolean;
  shellEnvironmentPolicyAllowlisted: boolean;
  vaultCommandProofCount: number;
  vaultCliLlmsBytes: number;
  vaultWriteProofCount: number;
}> {
  const codexHome = path.join(
    input.workspaceRoot,
    "hosted-codex-config-smoke-home",
    ".codex-hosted",
  );
  await mkdir(codexHome, {
    mode: 0o700,
    recursive: true,
  });
  await chmod(codexHome, 0o700);

  const codexConfigPath = path.join(codexHome, "config.toml");
  await writeFile(codexConfigPath, buildHostedRunnerSmokeCodexConfigToml(), { mode: 0o600 });
  await chmod(codexConfigPath, 0o600);

  const config = await readFile(codexConfigPath, "utf8");
  if (!/^\[shell_environment_policy\]$/mu.test(config)) {
    throw new Error("Hosted runner smoke Codex config is missing [shell_environment_policy].");
  }

  if (!/^inherit\s*=\s*"all"$/mu.test(config)) {
    throw new Error(
      "Hosted runner smoke Codex config must set shell_environment_policy.inherit to all.",
    );
  }

  if (
    !/^include_only\s*=\s*\[/mu.test(config)
    || !/"PATH"/u.test(config)
    || !/"VAULT"/u.test(config)
    || /include_only\s*=\s*\[[^\]]*"OPENAI_API_KEY"/mu.test(config)
    || /include_only\s*=\s*\[[^\]]*"VERCEL_AI_API_KEY"/mu.test(config)
  ) {
    throw new Error(
      "Hosted runner smoke Codex config must allowlist PATH and VAULT without provider credentials.",
    );
  }

  if (config.includes("hosted-runner-smoke-secret")) {
    throw new Error("Hosted runner smoke Codex config leaked the provider credential value.");
  }

  const shellProbe = await runCodexAppServerShellEnvironmentProbe({
    codexHome,
    expectedVaultId: input.expectedVaultId,
    runtimeEnv: {
      PATH: process.env.PATH ?? "",
      VAULT: process.env.VAULT ?? "",
      OPENAI_API_KEY: "hosted-runner-smoke-secret",
    },
    vaultRoot: input.vaultRoot,
  });

  return {
    murphPathBytes: shellProbe.murphPathBytes,
    pythonVersion: shellProbe.pythonVersion,
    schemaVaultOptionHidden: shellProbe.schemaVaultOptionHidden,
    shellEnvironmentPolicyAllowlisted: true,
    vaultCommandProofCount: shellProbe.vaultCommandProofCount,
    vaultCliLlmsBytes: shellProbe.vaultCliLlmsBytes,
    vaultWriteProofCount: shellProbe.vaultWriteProofCount,
  };
}

function buildHostedRunnerSmokeCodexConfigToml(): string {
  const modelCatalogJson = readHostedCodexModelCatalogJsonPath();

  return [
    'model = "gpt-5.5"',
    ...(modelCatalogJson
      ? [`model_catalog_json = ${JSON.stringify(modelCatalogJson)}`]
      : []),
    'model_provider = "openai"',
    'model_reasoning_effort = "low"',
    "model_auto_compact_token_limit = 128000",
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    "",
    "[skills]",
    "include_instructions = false",
    "",
    "[skills.bundled]",
    "enabled = false",
    "",
    "[shell_environment_policy]",
    `inherit = ${JSON.stringify(HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE)}`,
    `include_only = ${tomlStringArray(HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY)}`,
    "",
  ].join("\n");
}

function readHostedCodexModelCatalogJsonPath(): string | null {
  const value = process.env[HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]?.trim();
  return value && value.length > 0 ? value : null;
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

async function runCodexAppServerShellEnvironmentProbe(input: {
  codexHome: string;
  expectedVaultId: string;
  runtimeEnv: Record<string, string>;
  vaultRoot: string;
}): Promise<{
  murphPathBytes: number;
  pythonVersion: string;
  schemaVaultOptionHidden: boolean;
  vaultCommandProofCount: number;
  vaultCliLlmsBytes: number;
  vaultWriteProofCount: number;
}> {
  const child = spawn("codex", ["app-server"], {
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      ...input.runtimeEnv,
      CODEX_HOME: input.codexHome,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const childStdin = child.stdin;
  const childStdout = child.stdout;
  const childStderr = child.stderr;
  if (!childStdin || !childStdout || !childStderr) {
    child.kill();
    throw new Error("Codex app-server shell env probe failed to open stdio pipes.");
  }
  childStdout.setEncoding("utf8");
  childStderr.setEncoding("utf8");

  let stdoutBuffer = "";
  let stderr = "";
  let nextRequestId = 1;
  let terminalError: Error | null = null;
  const pendingRequests = new Map<number, CodexAppServerPendingRequest>();

  const rejectPendingRequests = (error: Error): void => {
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      pendingRequests.delete(id);
    }
  };
  const failCodexAppServer = (error: Error): void => {
    terminalError ??= error;
    rejectPendingRequests(error);
  };

  child.once("error", failCodexAppServer);
  child.once("exit", (code, signal) => {
    failCodexAppServer(new Error(
      `Codex app-server exited before shell env probe completed: ${code ?? signal}. stderrBytes=${Buffer.byteLength(stderr, "utf8")}`,
    ));
  });
  childStdin.once("error", (error: Error) => {
    failCodexAppServer(new Error(
      `Codex app-server stdin failed. errorName=${error.name}`,
    ));
  });
  childStderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  childStdout.on("data", (chunk) => {
    stdoutBuffer += String(chunk);
    const lines = stdoutBuffer.split(/\r?\n/u);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        rejectPendingRequests(new Error("Codex app-server emitted malformed JSON."));
        return;
      }

      const message = readObject(parsed, "Codex app-server response");
      const id = message.id;
      if (typeof id !== "number") {
        continue;
      }

      const pending = pendingRequests.get(id);
      if (!pending) {
        continue;
      }

      clearTimeout(pending.timeout);
      pendingRequests.delete(id);
      if (message.error) {
        pending.reject(new Error(
          `Codex app-server request failed for ${pending.label}. errorBytes=${Buffer.byteLength(JSON.stringify(message.error), "utf8")}`,
        ));
        continue;
      }

      pending.resolve(message);
    }
  });

  const sendRequest = (
    label: string,
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> => {
    const id = nextRequestId;
    nextRequestId += 1;

    return new Promise((resolve, reject) => {
      if (terminalError) {
        reject(terminalError);
        return;
      }

      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        const error = new Error(
          `Timed out waiting for Codex app-server request ${label}. stderrBytes=${Buffer.byteLength(stderr, "utf8")}`,
        );
        failCodexAppServer(error);
        killProcessGroup(child.pid);
        child.kill("SIGKILL");
        reject(error);
      }, timeoutMs);

      pendingRequests.set(id, {
        label,
        reject,
        resolve,
        timeout,
      });

      void writeJsonRpcLine(childStdin, {
        id,
        method,
        params,
      }, label).catch((error: Error) => {
        clearTimeout(timeout);
        pendingRequests.delete(id);
        failCodexAppServer(error);
        reject(error);
      });
    });
  };

  const execCommand = async (
    label: string,
    command: readonly string[],
  ): Promise<CodexCommandExecResult> => {
    const message = await sendRequest(
      label,
      "command/exec",
      {
        command,
        timeoutMs: CODEX_SHELL_ENV_PROBE_COMMAND_TIMEOUT_MS,
      },
      CODEX_SHELL_ENV_PROBE_TIMEOUT_MS,
    );
    const result = readCodexCommandExecResult(message.result);
    if (result.exitCode !== 0) {
      throw new Error(
        `Codex app-server command failed for ${label}. exitCode=${result.exitCode} stdoutBytes=${Buffer.byteLength(result.stdout, "utf8")} stderrBytes=${Buffer.byteLength(result.stderr, "utf8")}`,
      );
    }

    return result;
  };

  try {
    await sendRequest("initialize", "initialize", {
      clientInfo: {
        name: "hosted-runner-smoke",
        version: "1",
      },
    }, CODEX_SHELL_ENV_PROBE_TIMEOUT_MS);
    await writeJsonRpcLine(
      childStdin,
      { method: "initialized", params: {} },
      "initialized",
    );

    const environmentProbe = parseCodexEnvironmentProbe(
      (await execCommand("environment-probe", [
        "node",
        "-e",
        buildCodexEnvironmentProbeScript(),
        input.vaultRoot,
      ])).stdout,
      input.vaultRoot,
    );
    const pythonVersion = readPythonVersionProbeResult(
      (await execCommand("python3-version", ["python3", "--version"])).stdout,
    );
    readRipgrepVersionProbeResult(
      (await execCommand("rg-version", ["rg", "--version"])).stdout,
    );
    await execCommand("python-major", [
      "python",
      "-c",
      "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)",
    ]);
    const vaultCliLlms = await execCommand("vault-cli-llms", [
      "vault-cli",
      "--llms",
      "--format",
      "json",
    ]);
    assertRootLlmsHidesVault(vaultCliLlms.stdout);
    const vaultCliProof = await runCodexVaultCliProof({
      execCommand,
      expectedVaultId: input.expectedVaultId,
      vaultRoot: input.vaultRoot,
    });

    return {
      murphPathBytes: environmentProbe.murphPathBytes,
      pythonVersion,
      schemaVaultOptionHidden: vaultCliProof.schemaVaultOptionHidden,
      vaultCommandProofCount: vaultCliProof.vaultCommandProofCount,
      vaultCliLlmsBytes: parsePositiveByteCount(
        String(Buffer.byteLength(vaultCliLlms.stdout, "utf8")),
        "vault-cli --llms --format json",
      ),
      vaultWriteProofCount: vaultCliProof.vaultWriteProofCount,
    };
  } finally {
    childStdin.end();
    killProcessGroup(child.pid);
    child.kill("SIGKILL");
    rejectPendingRequests(new Error("Codex app-server shell env probe was stopped."));
  }
}

function buildCodexEnvironmentProbeScript(): string {
  return `
const fs = require("node:fs");
const path = require("node:path");
const expectedVaultRoot = process.argv[1];
function findExecutable(name) {
  const pathValue = process.env.PATH || "";
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return "";
}
const proof = {
  murphPathBytes: Buffer.byteLength(findExecutable("murph"), "utf8"),
  providerCredentialPresent: Boolean(process.env.OPENAI_API_KEY || process.env.VERCEL_AI_API_KEY),
  python3PathBytes: Buffer.byteLength(findExecutable("python3"), "utf8"),
  pythonPathBytes: Buffer.byteLength(findExecutable("python"), "utf8"),
  rgPathBytes: Buffer.byteLength(findExecutable("rg"), "utf8"),
  vaultCliPathBytes: Buffer.byteLength(findExecutable("vault-cli"), "utf8"),
  vaultRootInherited: process.env.VAULT === expectedVaultRoot,
};
process.stdout.write(JSON.stringify(proof));
`;
}

function parseCodexEnvironmentProbe(
  stdout: string,
  vaultRoot: string,
): {
  murphPathBytes: number;
} {
  const record = readObject(parseJsonFromCommandStdout(stdout, "environment-probe"), "environment probe");
  const vaultCliPathBytes = readPositiveNumber(
    record.vaultCliPathBytes,
    "environment probe.vaultCliPathBytes",
  );
  const murphPathBytes = readPositiveNumber(
    record.murphPathBytes,
    "environment probe.murphPathBytes",
  );
  readPositiveNumber(record.pythonPathBytes, "environment probe.pythonPathBytes");
  readPositiveNumber(record.python3PathBytes, "environment probe.python3PathBytes");
  readPositiveNumber(record.rgPathBytes, "environment probe.rgPathBytes");

  if (vaultCliPathBytes <= 0) {
    throw new Error("Codex app-server environment probe did not resolve vault-cli.");
  }

  if (record.vaultRootInherited !== true) {
    throw new Error("Codex app-server shell env probe did not inherit the hosted VAULT path.");
  }

  if (record.providerCredentialPresent === true) {
    throw new Error("Codex app-server shell env probe leaked the provider credential env.");
  }

  if (process.env.VAULT !== vaultRoot) {
    throw new Error("Hosted runner smoke process did not keep the restored VAULT path.");
  }

  return {
    murphPathBytes,
  };
}

function readPythonVersionProbeResult(stdout: string): string {
  const pythonVersion = stdout.trim();
  if (!/^Python\s+3\./u.test(pythonVersion)) {
    throw new Error("Codex app-server shell env probe did not execute python3 --version.");
  }

  return pythonVersion;
}

function readRipgrepVersionProbeResult(stdout: string): string {
  const firstLine = stdout.split(/\r?\n/u)[0]?.trim() ?? "";
  if (!/^ripgrep\s+\d/u.test(firstLine)) {
    throw new Error("Hosted runner smoke did not execute rg --version.");
  }

  return firstLine;
}

function assertRootLlmsHidesVault(stdout: string): void {
  const manifest = parseJsonFromCommandStdout(stdout, "vault-cli-llms");
  readArray(readObject(manifest, "vault-cli-llms").commands, "vault-cli-llms.commands");

  if (stdout.includes("--vault")) {
    throw new Error("Codex app-server vault-cli proof exposed --vault in root LLM metadata.");
  }
}

async function createExplicitVaultProofRoot(activeVaultRoot: string): Promise<string> {
  const explicitVaultRoot = path.join(path.dirname(activeVaultRoot), "explicit-vault-proof");
  await mkdir(explicitVaultRoot, { recursive: true });
  await writeFile(
    path.join(explicitVaultRoot, "vault.json"),
    `${JSON.stringify({
      createdAt: "2026-05-21T00:00:00Z",
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      timezone: "UTC",
      title: "Explicit Vault Proof",
      vaultId: CODEX_VAULT_CLI_SMOKE_EXPLICIT_VAULT_ID,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    path.join(explicitVaultRoot, "CORE.md"),
    [
      "---",
      "schemaVersion: hv/core@v1",
      `vaultId: ${CODEX_VAULT_CLI_SMOKE_EXPLICIT_VAULT_ID}`,
      "title: Explicit Vault Proof",
      "---",
      "# Explicit Vault Proof",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  return explicitVaultRoot;
}

async function runCodexVaultCliProof(input: {
  execCommand: (
    label: string,
    command: readonly string[],
  ) => Promise<CodexCommandExecResult>;
  expectedVaultId: string;
  vaultRoot: string;
}): Promise<{
  schemaVaultOptionHidden: boolean;
  vaultCommandProofCount: number;
  vaultWriteProofCount: number;
}> {
  let vaultCommandProofCount = 0;
  let vaultWriteProofCount = 0;
  const runVaultJson = async (
    label: string,
    args: readonly string[],
  ): Promise<unknown> => {
    const result = await input.execCommand(label, ["vault-cli", ...args]);
    vaultCommandProofCount += 1;
    return parseJsonFromCommandStdout(result.stdout, label);
  };
  const explicitVaultProofRoot = await createExplicitVaultProofRoot(input.vaultRoot);
  const assertVaultShow = (
    value: unknown,
    label: string,
    expectedVaultId: string,
  ): void => {
    const record = readObject(value, label);
    const vaultId = readString(record.vaultId, `${label}.vaultId`);
    if (vaultId !== expectedVaultId) {
      throw new Error(`Codex app-server vault-cli proof ${label} did not match the expected vault id.`);
    }
  };

  assertVaultShow(
    await runVaultJson("vault-show-default", ["vault", "show", "--format", "json"]),
    "vault-show-default",
    input.expectedVaultId,
  );
  assertVaultShow(
    await runVaultJson("vault-show-explicit", [
      "--vault",
      explicitVaultProofRoot,
      "vault",
      "show",
      "--format",
      "json",
    ]),
    "vault-show-explicit",
    CODEX_VAULT_CLI_SMOKE_EXPLICIT_VAULT_ID,
  );

  const measurementAdd = readObject(
    await runVaultJson("measurement-add", [
      "measurement",
      "add",
      "--metric",
      CODEX_VAULT_CLI_SMOKE_MEASUREMENT_METRIC,
      "--value",
      "26",
      "--unit",
      "reps",
      "--measurement-note",
      CODEX_VAULT_CLI_SMOKE_MEASUREMENT_NOTE,
      "--format",
      "json",
    ]),
    "measurement-add",
  );
  if (measurementAdd.created !== true || measurementAdd.kind !== "measurement") {
    throw new Error("Codex app-server vault-cli proof did not create a measurement.");
  }
  const createdMeasurement = readFirstObject(
    measurementAdd.measurements,
    "measurement-add.measurements",
  );
  assertMeasurementProof(createdMeasurement, "measurement-add.measurements[0]");
  vaultWriteProofCount += 1;

  const measurementList = await runVaultJson("measurement-list", [
    "measurement",
    "list",
    "--limit",
    "10",
    "--format",
    "json",
  ]);
  assertMeasurementListIncludesProof(
    measurementList,
    "measurement-list",
  );

  const scheduledLogSave = readObject(
    await runVaultJson("scheduled-log-save", [
      "scheduled-log",
      "save",
      "Hosted smoke pull-up baseline reminder",
      "--slug",
      CODEX_VAULT_CLI_SMOKE_SCHEDULED_LOG_SLUG,
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "08:00",
      "--action-kind",
      "measurement.add",
      "--action-title",
      "Hosted smoke pull-up baseline",
      "--measurement-metric",
      CODEX_VAULT_CLI_SMOKE_MEASUREMENT_METRIC,
      "--measurement-value",
      "26",
      "--measurement-unit",
      "reps",
      "--measurement-note",
      CODEX_VAULT_CLI_SMOKE_MEASUREMENT_NOTE,
      "--format",
      "json",
    ]),
    "scheduled-log-save",
  );
  if (scheduledLogSave.created !== true) {
    throw new Error("Codex app-server vault-cli proof did not create a scheduled log.");
  }
  vaultWriteProofCount += 1;

  const scheduledLogShow = readObject(
    await runVaultJson("scheduled-log-show", [
      "scheduled-log",
      "show",
      CODEX_VAULT_CLI_SMOKE_SCHEDULED_LOG_SLUG,
      "--format",
      "json",
    ]),
    "scheduled-log-show",
  );
  const scheduledLog = readObject(scheduledLogShow.scheduledLog, "scheduled-log-show.scheduledLog");
  const scheduledAction = readObject(scheduledLog.action, "scheduled-log-show.scheduledLog.action");
  if (scheduledAction.kind !== "measurement.add") {
    throw new Error("Codex app-server vault-cli proof scheduled log action had the wrong kind.");
  }
  assertMeasurementProof(
    readFirstObject(
      scheduledAction.measurements,
      "scheduled-log-show.scheduledLog.action.measurements",
    ),
    "scheduled-log-show.scheduledLog.action.measurements[0]",
  );

  const scheduledLogList = await runVaultJson("scheduled-log-list", [
    "scheduled-log",
    "list",
    "--limit",
    "10",
    "--format",
    "json",
  ]);
  assertScheduledLogListIncludesProof(
    scheduledLogList,
    "scheduled-log-list",
  );

  assertListProof(
    await runVaultJson("workout-list", [
      "workout",
      "list",
      "--limit",
      "5",
      "--format",
      "json",
    ]),
    "workout-list",
  );
  assertListProof(
    await runVaultJson("experiment-list", [
      "experiment",
      "list",
      "--limit",
      "5",
      "--format",
      "json",
    ]),
    "experiment-list",
  );

  const measurementSchema = readObject(
    await runVaultJson("measurement-add-schema", [
      "measurement",
      "add",
      "--schema",
      "--format",
      "json",
    ]),
    "measurement-add-schema",
  );
  const schemaVaultHidden = schemaHidesVaultAndKeepsMeasurementNote(measurementSchema);
  const llmsFull = readObject(
    await runVaultJson("measurement-llms-full", [
      "--llms-full",
      "--format",
      "json",
      "measurement",
    ]),
    "measurement-llms-full",
  );
  const manifestVaultHidden = measurementAddManifestHidesVault(llmsFull);

  if (!schemaVaultHidden || !manifestVaultHidden) {
    throw new Error("Codex app-server vault-cli proof exposed vault in schema metadata.");
  }

  return {
    schemaVaultOptionHidden: true,
    vaultCommandProofCount: assertMinimumProofCount(
      vaultCommandProofCount,
      HOSTED_RUNNER_SMOKE_CLI_VAULT_COMMAND_PROOF_COUNT,
      "vault command",
    ),
    vaultWriteProofCount: assertMinimumProofCount(
      vaultWriteProofCount,
      HOSTED_RUNNER_SMOKE_CLI_VAULT_WRITE_PROOF_COUNT,
      "vault write",
    ),
  };
}

function assertMeasurementProof(record: Record<string, unknown>, label: string): void {
  const metric = readString(record.metric, `${label}.metric`);
  if (metric !== CODEX_VAULT_CLI_SMOKE_MEASUREMENT_METRIC) {
    throw new Error(`Codex app-server vault-cli proof ${label} had the wrong metric.`);
  }

  const note = readString(record.note, `${label}.note`);
  if (note !== CODEX_VAULT_CLI_SMOKE_MEASUREMENT_NOTE) {
    throw new Error(`Codex app-server vault-cli proof ${label} did not preserve the prose note.`);
  }
}

function assertMeasurementListIncludesProof(value: unknown, label: string): void {
  const record = readObject(value, label);
  const items = readArray(record.items, `${label}.items`);
  if (
    !items.some((item, index) =>
      objectHasMeasurementProof(item, `${label}.items[${index}]`)
    )
  ) {
    throw new Error(`Codex app-server vault-cli proof ${label} did not include the measurement write.`);
  }
}

function assertScheduledLogListIncludesProof(value: unknown, label: string): void {
  const record = readObject(value, label);
  const items = readArray(record.items, `${label}.items`);
  for (const [index, itemValue] of items.entries()) {
    const item = readObject(itemValue, `${label}.items[${index}]`);
    if (item.slug !== CODEX_VAULT_CLI_SMOKE_SCHEDULED_LOG_SLUG) {
      continue;
    }

    const action = readObject(item.action, `${label}.items[${index}].action`);
    if (action.kind !== "measurement.add") {
      continue;
    }

    if (
      readArray(action.measurements, `${label}.items[${index}].action.measurements`)
        .some((measurement, measurementIndex) =>
          objectHasMeasurementProof(
            measurement,
            `${label}.items[${index}].action.measurements[${measurementIndex}]`,
          )
        )
    ) {
      return;
    }
  }

  throw new Error(`Codex app-server vault-cli proof ${label} did not include the scheduled write.`);
}

function objectHasMeasurementProof(value: unknown, label: string): boolean {
  const record = readObject(value, label);
  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    return objectHasMeasurementProof(record.data, `${label}.data`);
  }
  const measurements = Array.isArray(record.measurements)
    ? record.measurements
    : [record];

  return measurements.some((measurementValue, index) => {
    const measurement = readObject(measurementValue, `${label}.measurements[${index}]`);
    return (
      measurement.metric === CODEX_VAULT_CLI_SMOKE_MEASUREMENT_METRIC
      && measurement.note === CODEX_VAULT_CLI_SMOKE_MEASUREMENT_NOTE
    );
  });
}

function assertListProof(value: unknown, label: string): void {
  const record = readObject(value, label);
  readNonNegativeNumber(record.count, `${label}.count`);
  const filters = readObject(record.filters, `${label}.filters`);
  if (filters.limit !== 5) {
    throw new Error(`Codex app-server vault-cli proof ${label} did not preserve the list limit.`);
  }
}

function schemaHidesVaultAndKeepsMeasurementNote(schema: Record<string, unknown>): boolean {
  const options = readObject(schema.options, "measurement-add-schema.options");
  const properties = readObject(options.properties, "measurement-add-schema.options.properties");

  return !Object.hasOwn(properties, "vault") && Object.hasOwn(properties, "measurementNote");
}

function measurementAddManifestHidesVault(manifest: Record<string, unknown>): boolean {
  const commands = readArray(manifest.commands, "measurement-llms-full.commands");
  for (const commandValue of commands) {
    const command = readObject(commandValue, "measurement-llms-full.commands[]");
    if (command.name !== "measurement add") {
      continue;
    }

    const schema = readObject(command.schema, "measurement-llms-full.measurement-add.schema");
    const options = readObject(
      schema.options,
      "measurement-llms-full.measurement-add.schema.options",
    );
    const properties = readObject(
      options.properties,
      "measurement-llms-full.measurement-add.schema.options.properties",
    );
    const examples = JSON.stringify(command.examples ?? []);

    return !Object.hasOwn(properties, "vault") && !examples.includes("--vault");
  }

  throw new Error("Codex app-server vault-cli proof did not find measurement add in the manifest.");
}

function parseJsonFromCommandStdout(stdout: string, label: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(
      `Codex app-server command ${label} did not return JSON. stdoutBytes=${Buffer.byteLength(stdout, "utf8")}`,
    );
  }
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

function readFirstObject(value: unknown, label: string): Record<string, unknown> {
  const values = readArray(value, label);
  if (values.length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }

  return readObject(values[0], `${label}[0]`);
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function readPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number.`);
  }

  return value;
}

function readNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }

  return value;
}

function assertMinimumProofCount(value: number, minimum: number, label: string): number {
  if (value < minimum) {
    throw new Error(`Codex app-server vault-cli proof ran too few ${label} checks.`);
  }

  return value;
}

function writeJsonRpcLine(
  stream: Writable,
  value: unknown,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      cleanup();
      reject(new Error(
        `Codex app-server request write failed for ${label}. errorName=${error.name}`,
      ));
    };
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      stream.off("error", onError);
      stream.off("drain", onDrain);
    };
    stream.once("error", onError);
    const wrote = stream.write(`${JSON.stringify(value)}\n`, () => {
      cleanup();
      resolve();
    });
    if (!wrote) {
      stream.once("drain", onDrain);
    }
  });
}

function killProcessGroup(pid: number | undefined): void {
  if (typeof pid !== "number" || process.platform === "win32") {
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // best-effort cleanup only
  }
}

interface CodexAppServerPendingRequest {
  label: string;
  reject: (error: Error) => void;
  resolve: (value: Record<string, unknown>) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface CodexCommandExecResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

function readCodexCommandExecResult(value: unknown): CodexCommandExecResult {
  const record = readObject(value, "Codex app-server shell env probe result");

  if (typeof record.exitCode !== "number") {
    throw new TypeError("Codex app-server shell env probe result.exitCode must be a number.");
  }

  if (typeof record.stdout !== "string") {
    throw new TypeError("Codex app-server shell env probe result.stdout must be a string.");
  }

  return {
    exitCode: record.exitCode,
    stderr: typeof record.stderr === "string" ? record.stderr : "",
    stdout: record.stdout,
  };
}

function parsePositiveByteCount(value: string | undefined, label: string): number {
  if (!value || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`Codex app-server shell env probe did not execute ${label}.`);
  }

  return Number(value);
}

async function runHealthCommonsCliSmoke(): Promise<{
  protocolListBytes: number;
}> {
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

  const protocolListJson = JSON.parse(protocolListOutput);
  const serializedProtocolList = JSON.stringify(protocolListJson);

  if (!serializedProtocolList.includes(FINNISH_DRY_SAUNA_KEY)) {
    throw new Error(
      `Hosted runner CLI Health Commons protocol list smoke did not include ${FINNISH_DRY_SAUNA_KEY}.`,
    );
  }

  return {
    protocolListBytes: Buffer.byteLength(protocolListOutput, "utf8"),
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
  prepareAudioInput: typeof prepareAudioInputType;
}> {
  const parsers = await import("@murphai/parsers");

  return {
    createDefaultParserRegistry: parsers.createDefaultParserRegistry,
    parseAttachment: parsers.parseAttachment,
    prepareAudioInput: parsers.prepareAudioInput,
  };
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
  getGeneratedHealthCommonsProtocolFamilyGraphReader(): SmokeHealthCommonsProtocolFamilyGraphReader;
  getGeneratedHealthCommonsProtocolIndexReader(): SmokeHealthCommonsProtocolIndexReader;
  getGeneratedHealthCommonsProtocolRunSpecReader(): SmokeHealthCommonsProtocolRunSpecReader;
}

interface SmokeHealthCommonsProtocolIndexReader {
  catalogHash: string;
  listProtocols(input: {
    limit: number;
    query: string;
  }): Array<{ key: string }>;
}

interface SmokeHealthCommonsProtocolRunSpecReader {
  catalogHash: string;
  findByLookup(key: string): { title: string } | null;
}

interface SmokeHealthCommonsProtocolFamilyGraphReader {
  catalogHash: string;
  listProtocolMatches(input: {
    limit: number;
    lookup: string;
  }): Array<{
    protocol: {
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
