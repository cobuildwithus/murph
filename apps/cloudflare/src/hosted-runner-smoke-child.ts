import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server as NetServer } from "node:net";
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
  buildMurphGroupReadPermissionProfileTomlLines,
  buildMurphGroupRoomModelMaintenancePermissionProfileTomlLines,
  buildMurphMemberWorkspacePermissionProfileTomlLines,
  MURPH_GROUP_READ_PERMISSION_PROFILE,
  MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE,
} from "@murphai/hosted-execution/assistant-permissions";
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
  HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_AUTOMATION_MUTATION_DENIED_COUNT,
  HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_AUTOMATION_READ_PROOF_COUNT,
  HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_LOCAL_MUTATION_PROOF_COUNT,
  HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
  countAssistantCliSurfaceHotPathProofs,
  parseHostedRunnerSmokeInput,
  type HostedRunnerSmokeResult,
} from "./hosted-runner-smoke-contract.js";

const execFileAsync = promisify(execFile);
const FINNISH_DRY_SAUNA_KEY =
  "protocol_variant:dry-sauna/murph-finnish-standard-3x-week";
const HEALTH_COMMONS_RUNTIME_MODULE: string = "@murphai/health-commons/runtime";
const DEVICE_SYNC_CONFIG_RUNTIME_MODULE: string = "@murphai/device-syncd/config";
const JUNCTION_SDK_RUNTIME_PATH = "/app/node_modules/@junction-api/sdk";
const CODEX_SHELL_ENV_PROBE_COMMAND_TIMEOUT_MS = 45_000;
const CODEX_SHELL_ENV_PROBE_TIMEOUT_MS = 90_000;
const PDF_SMOKE_EXPECTED_TEXT = "Murph hosted PDF smoke fixture";
const PDF_SMOKE_RELATIVE_PATH = "raw/smoke/hosted-runner.pdf";
const CODEX_VAULT_CLI_SMOKE_MEASUREMENT_METRIC = "strict-pull-ups";
const CODEX_VAULT_CLI_SMOKE_MEASUREMENT_NOTE =
  "max strict pull-up baseline, dead hang";
const CODEX_VAULT_CLI_SMOKE_MEASUREMENT_OCCURRED_AT =
  "2026-07-09T12:00:00.000Z";
const CODEX_VAULT_CLI_SMOKE_MEASUREMENT_DATE = "2026-07-09";
const CODEX_VAULT_CLI_SMOKE_EXPLICIT_VAULT_ID =
  "vault_01K11111111111111111111111";
const CODEX_VAULT_CLI_SMOKE_SCHEDULED_LOG_SLUG =
  "hosted-smoke-pull-up-baseline-reminder";
const CODEX_MEMBER_WORKSPACE_SMOKE_SEED_SLUG =
  "hosted-smoke-member-workspace-seed";
const CODEX_MEMBER_WORKSPACE_SMOKE_SUPPORT_SERIES_ID =
  "experiment:hosted-smoke-member-workspace";

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
  await runDeviceSyncRuntimeSmoke();
  const codexPreflight = await runCodexPreflight();
  const assistantCliSurface = await runAssistantCliSurfaceContractSmoke();
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
    codexGroupReadAuthorizedFileRead:
      hostedCodexConfig.groupReadAuthorizedFileRead,
    codexGroupReadDeepEnvReadDenied:
      hostedCodexConfig.groupReadDeepEnvReadDenied,
    codexGroupReadGroupWriteDenied:
      hostedCodexConfig.groupReadGroupWriteDenied,
    codexGroupReadNetworkDenied:
      hostedCodexConfig.groupReadNetworkDenied,
    codexGroupReadOutsideRootReadDenied:
      hostedCodexConfig.groupReadOutsideRootReadDenied,
    codexGroupReadPermissionProfileAttested:
      hostedCodexConfig.groupReadPermissionProfileAttested,
    codexGroupReadRuntimeReadDenied:
      hostedCodexConfig.groupReadRuntimeReadDenied,
    codexGroupReadSecretEnvironmentDenied:
      hostedCodexConfig.groupReadSecretEnvironmentDenied,
    codexGroupReadSiblingRootReadDenied:
      hostedCodexConfig.groupReadSiblingRootReadDenied,
    codexMemberWorkspaceAutomationMutationDeniedCount:
      hostedCodexConfig.memberWorkspaceAutomationMutationDeniedCount,
    codexMemberWorkspaceAutomationReadProofCount:
      hostedCodexConfig.memberWorkspaceAutomationReadProofCount,
    codexMemberWorkspaceAutomationTreeUnchanged:
      hostedCodexConfig.memberWorkspaceAutomationTreeUnchanged,
    codexMemberWorkspaceLocalMutationProofCount:
      hostedCodexConfig.memberWorkspaceLocalMutationProofCount,
    codexMemberWorkspacePermissionProfileAttested:
      hostedCodexConfig.memberWorkspacePermissionProfileAttested,
    codexMemberWorkspacePreloadBypassDenied:
      hostedCodexConfig.memberWorkspacePreloadBypassDenied,
    codexMemberWorkspaceTempWriteAllowed:
      hostedCodexConfig.memberWorkspaceTempWriteAllowed,
    codexMemberWorkspaceVaultWriteAllowed:
      hostedCodexConfig.memberWorkspaceVaultWriteAllowed,
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

async function runAssistantCliSurfaceContractSmoke(): Promise<{
  contractBytes: number;
  hotPathProofCount: number;
}> {
  const contract = await readHostedAssistantCliSurfaceBootstrapContext();
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

async function runDeviceSyncRuntimeSmoke(): Promise<void> {
  const runtime = await import(DEVICE_SYNC_CONFIG_RUNTIME_MODULE) as {
    configuredDeviceSyncProviderKeys?: readonly string[];
  };

  if (!runtime.configuredDeviceSyncProviderKeys?.includes("junction")) {
    throw new Error(
      "Hosted runner smoke could not load the Junction device-sync config graph.",
    );
  }

  try {
    await access(JUNCTION_SDK_RUNTIME_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  throw new Error(
    "Hosted runner smoke found the Junction SDK runtime after production pruning.",
  );
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
  groupReadAuthorizedFileRead: boolean;
  groupReadDeepEnvReadDenied: boolean;
  groupReadGroupWriteDenied: boolean;
  groupReadNetworkDenied: boolean;
  groupReadOutsideRootReadDenied: boolean;
  groupReadPermissionProfileAttested: boolean;
  groupReadRuntimeReadDenied: boolean;
  groupReadSecretEnvironmentDenied: boolean;
  groupReadSiblingRootReadDenied: boolean;
  memberWorkspaceAutomationMutationDeniedCount: number;
  memberWorkspaceAutomationReadProofCount: number;
  memberWorkspaceAutomationTreeUnchanged: boolean;
  memberWorkspaceLocalMutationProofCount: number;
  memberWorkspacePermissionProfileAttested: boolean;
  memberWorkspacePreloadBypassDenied: boolean;
  memberWorkspaceTempWriteAllowed: boolean;
  memberWorkspaceVaultWriteAllowed: boolean;
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
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK:
        "hosted-runner-smoke-callback-secret",
      OPENAI_API_KEY: "hosted-runner-smoke-secret",
    },
    vaultRoot: input.vaultRoot,
    workspaceRoot: input.workspaceRoot,
  });

  return {
    groupReadAuthorizedFileRead: shellProbe.groupReadAuthorizedFileRead,
    groupReadDeepEnvReadDenied: shellProbe.groupReadDeepEnvReadDenied,
    groupReadGroupWriteDenied: shellProbe.groupReadGroupWriteDenied,
    groupReadNetworkDenied: shellProbe.groupReadNetworkDenied,
    groupReadOutsideRootReadDenied: shellProbe.groupReadOutsideRootReadDenied,
    groupReadPermissionProfileAttested:
      shellProbe.groupReadPermissionProfileAttested,
    groupReadRuntimeReadDenied: shellProbe.groupReadRuntimeReadDenied,
    groupReadSecretEnvironmentDenied:
      shellProbe.groupReadSecretEnvironmentDenied,
    groupReadSiblingRootReadDenied: shellProbe.groupReadSiblingRootReadDenied,
    memberWorkspaceAutomationMutationDeniedCount:
      shellProbe.memberWorkspaceAutomationMutationDeniedCount,
    memberWorkspaceAutomationReadProofCount:
      shellProbe.memberWorkspaceAutomationReadProofCount,
    memberWorkspaceAutomationTreeUnchanged:
      shellProbe.memberWorkspaceAutomationTreeUnchanged,
    memberWorkspaceLocalMutationProofCount:
      shellProbe.memberWorkspaceLocalMutationProofCount,
    memberWorkspacePermissionProfileAttested:
      shellProbe.memberWorkspacePermissionProfileAttested,
    memberWorkspacePreloadBypassDenied:
      shellProbe.memberWorkspacePreloadBypassDenied,
    memberWorkspaceTempWriteAllowed:
      shellProbe.memberWorkspaceTempWriteAllowed,
    memberWorkspaceVaultWriteAllowed:
      shellProbe.memberWorkspaceVaultWriteAllowed,
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
    'model = "gpt-5.6-terra"',
    ...(modelCatalogJson
      ? [`model_catalog_json = ${JSON.stringify(modelCatalogJson)}`]
      : []),
    'model_provider = "openai"',
    'model_reasoning_effort = "low"',
    "model_auto_compact_token_limit = 164000",
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    // Mirror the hosted runtime config: non-login shells so the smoke probe
    // exercises the same PATH semantics as production turns.
    "allow_login_shell = false",
    "",
    ...buildMurphGroupReadPermissionProfileTomlLines(),
    ...buildMurphGroupRoomModelMaintenancePermissionProfileTomlLines(),
    ...buildMurphMemberWorkspacePermissionProfileTomlLines(),
    "[skills]",
    "include_instructions = false",
    "",
    "[skills.bundled]",
    "enabled = false",
    "",
    "[shell_environment_policy]",
    `inherit = ${JSON.stringify(HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE)}`,
    // Mirror the hosted runtime config: include_only is the single gate.
    "ignore_default_excludes = true",
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
  workspaceRoot: string;
}): Promise<{
  groupReadAuthorizedFileRead: boolean;
  groupReadDeepEnvReadDenied: boolean;
  groupReadGroupWriteDenied: boolean;
  groupReadNetworkDenied: boolean;
  groupReadOutsideRootReadDenied: boolean;
  groupReadPermissionProfileAttested: boolean;
  groupReadRuntimeReadDenied: boolean;
  groupReadSecretEnvironmentDenied: boolean;
  groupReadSiblingRootReadDenied: boolean;
  memberWorkspaceAutomationMutationDeniedCount: number;
  memberWorkspaceAutomationReadProofCount: number;
  memberWorkspaceAutomationTreeUnchanged: boolean;
  memberWorkspaceLocalMutationProofCount: number;
  memberWorkspacePermissionProfileAttested: boolean;
  memberWorkspacePreloadBypassDenied: boolean;
  memberWorkspaceTempWriteAllowed: boolean;
  memberWorkspaceVaultWriteAllowed: boolean;
  murphPathBytes: number;
  pythonVersion: string;
  schemaVaultOptionHidden: boolean;
  vaultCommandProofCount: number;
  vaultCliLlmsBytes: number;
  vaultWriteProofCount: number;
}> {
  const child = spawn("codex", ["app-server"], {
    cwd: input.vaultRoot,
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
    options: CodexCommandExecOptions = {},
  ): Promise<CodexCommandExecResult> => {
    const message = await sendRequest(
      label,
      "command/exec",
      {
        command,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.permissionProfile
          ? { permissionProfile: options.permissionProfile }
          : {}),
        timeoutMs: CODEX_SHELL_ENV_PROBE_COMMAND_TIMEOUT_MS,
      },
      CODEX_SHELL_ENV_PROBE_TIMEOUT_MS,
    );
    const result = readCodexCommandExecResult(message.result);
    if (result.exitCode !== 0) {
      throw new Error(
        `Codex app-server command failed for ${label}. exitCode=${result.exitCode} stdoutBytes=${Buffer.byteLength(result.stdout, "utf8")} stderrBytes=${Buffer.byteLength(result.stderr, "utf8")} stdoutPreview=${JSON.stringify(result.stdout.slice(0, 512))} stderrPreview=${JSON.stringify(result.stderr.slice(0, 512))}`,
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
      capabilities: {
        experimentalApi: true,
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
    const groupReadProof = await runCodexGroupReadPermissionProbe({
      execCommand,
      sendRequest,
      vaultRoot: input.vaultRoot,
      workspaceRoot: input.workspaceRoot,
    });
    const memberWorkspaceProof = await runCodexMemberWorkspacePermissionProbe({
      execCommand,
      sendRequest,
      vaultRoot: input.vaultRoot,
      workspaceRoot: input.workspaceRoot,
    });

    return {
      ...groupReadProof,
      ...memberWorkspaceProof,
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

async function runCodexMemberWorkspacePermissionProbe(input: {
  execCommand: (
    label: string,
    command: readonly string[],
    options?: CodexCommandExecOptions,
  ) => Promise<CodexCommandExecResult>;
  sendRequest: (
    label: string,
    method: string,
    params: unknown,
    timeoutMs: number,
  ) => Promise<Record<string, unknown>>;
  vaultRoot: string;
  workspaceRoot: string;
}): Promise<CodexMemberWorkspacePermissionProof> {
  const vaultCliCommand = (await resolveCommandPath("vault-cli")).trim();
  const vaultCliEntryPath = await realpath(vaultCliCommand);
  const automationRoot = path.join(input.vaultRoot, "bank", "automations");
  const preloadPath = path.join(
    tmpdir(),
    `murph-member-workspace-preload-${process.pid}.cjs`,
  );
  const preloadMarkerPath = path.join(
    tmpdir(),
    `murph-member-workspace-preload-${process.pid}.marker`,
  );
  const tempWritePath = path.join(
    tmpdir(),
    `murph-member-workspace-temp-${process.pid}.txt`,
  );
  const vaultWritePath = path.join(
    input.vaultRoot,
    "raw",
    "smoke",
    "member-workspace-write.txt",
  );
  const importPath = path.join(
    tmpdir(),
    `murph-member-workspace-import-${process.pid}.json`,
  );
  const deniedSaveSlug = "hosted-smoke-member-workspace-denied-save";
  const importedSlug = "hosted-smoke-member-workspace-import";
  const saveArgs = buildMemberWorkspaceAutomationSaveArgs({
    slug: deniedSaveSlug,
    supportSeriesId: null,
    title: "Hosted smoke member workspace save",
  });
  const seedSaveArgs = buildMemberWorkspaceAutomationSaveArgs({
    slug: CODEX_MEMBER_WORKSPACE_SMOKE_SEED_SLUG,
    supportSeriesId: CODEX_MEMBER_WORKSPACE_SMOKE_SUPPORT_SERIES_ID,
    title: "Hosted smoke member workspace seed",
  });
  const editArgs = [
    "automation",
    "edit",
    CODEX_MEMBER_WORKSPACE_SMOKE_SEED_SLUG,
    "--summary",
    "Member workspace edit proof.",
    "--format",
    "json",
  ] as const;
  const setStatusArgs = [
    "automation",
    "set-status",
    CODEX_MEMBER_WORKSPACE_SMOKE_SEED_SLUG,
    "--status",
    "archived",
    "--format",
    "json",
  ] as const;
  const reconcileArgs = [
    "automation",
    "reconcile-support-series",
    CODEX_MEMBER_WORKSPACE_SMOKE_SUPPORT_SERIES_ID,
    "--format",
    "json",
  ] as const;
  const importedPayload = createMemberWorkspaceAutomationImportPayload({
    slug: importedSlug,
    title: "Hosted smoke member workspace import",
  });
  const importArgs = [
    "automation",
    "import-json",
    "--input",
    `@${importPath}`,
    "--format",
    "json",
  ] as const;

  await runTextCommand(vaultCliCommand, [...seedSaveArgs]);
  const automationTreeBefore = await hashDirectoryTree(automationRoot);

  const threadStart = await input.sendRequest(
    "member-workspace-thread-start",
    "thread/start",
    {
      approvalPolicy: "never",
      config: {
        include_environment_context: false,
        include_permissions_instructions: false,
        "features.request_permissions_tool": false,
      },
      cwd: input.vaultRoot,
      permissions: MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE,
      runtimeWorkspaceRoots: [input.vaultRoot],
    },
    CODEX_SHELL_ENV_PROBE_TIMEOUT_MS,
  );
  assertCodexMemberWorkspaceThreadAttestation(threadStart.result, {
    vaultRoot: input.vaultRoot,
  });

  const commandResult = await input.execCommand(
    "member-workspace-permission-probe",
    [
      "node",
      "-e",
      buildCodexMemberWorkspacePermissionProbeScript(),
      JSON.stringify({
        importPath,
        importedPayload,
        mutationArgs: [saveArgs, editArgs, setStatusArgs, reconcileArgs, importArgs],
        preloadMarkerPath,
        preloadPath,
        readArgs: [
          ["automation", "list", "--limit", "10", "--format", "json"],
          [
            "automation",
            "show",
            CODEX_MEMBER_WORKSPACE_SMOKE_SEED_SLUG,
            "--format",
            "json",
          ],
        ],
        seedSlug: CODEX_MEMBER_WORKSPACE_SMOKE_SEED_SLUG,
        tempWritePath,
        vaultCliEntryPath,
        vaultRoot: input.vaultRoot,
        vaultWritePath,
      }),
    ],
    {
      cwd: input.vaultRoot,
      permissionProfile: MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE,
    },
  );
  const proof = parseCodexMemberWorkspacePermissionProof(commandResult.stdout);
  const automationTreeAfter = await hashDirectoryTree(automationRoot);
  if (automationTreeAfter !== automationTreeBefore) {
    throw new Error(
      "Hosted runner smoke member-workspace profile changed bank/automations.",
    );
  }

  let localMutationProofCount = 0;
  for (const [label, args] of [
    ["member-workspace-local-save", saveArgs],
    ["member-workspace-local-edit", editArgs],
    ["member-workspace-local-set-status", setStatusArgs],
    ["member-workspace-local-reconcile", reconcileArgs],
    ["member-workspace-local-import", importArgs],
  ] as const) {
    const output = await runTextCommand(vaultCliCommand, [...args]);
    parseJsonFromCommandStdout(output, label);
    localMutationProofCount += 1;
  }

  return {
    ...proof,
    memberWorkspaceAutomationTreeUnchanged: true,
    memberWorkspaceLocalMutationProofCount: assertMinimumProofCount(
      localMutationProofCount,
      HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_LOCAL_MUTATION_PROOF_COUNT,
      "member-workspace local mutation",
    ),
    memberWorkspacePermissionProfileAttested: true,
  };
}

function buildMemberWorkspaceAutomationSaveArgs(input: {
  slug: string;
  supportSeriesId: string | null;
  title: string;
}): readonly string[] {
  return [
    "automation",
    "save",
    input.title,
    "--slug",
    input.slug,
    "--instructions",
    "Run the hosted member-workspace permission smoke proof.",
    "--schedule-kind",
    "dailyLocal",
    "--schedule-local-time",
    "08:30",
    "--channel",
    "telegram",
    "--delivery-target",
    "agentmail:hosted-member-workspace-smoke",
    "--identity-id",
    "identity_hosted_member_workspace_smoke",
    "--participant-id",
    "participant_hosted_member_workspace_smoke",
    "--thread-id",
    "thread_hosted_member_workspace_smoke",
    ...(input.supportSeriesId === null
      ? []
      : ["--support-series-id", input.supportSeriesId]),
    "--format",
    "json",
  ];
}

function createMemberWorkspaceAutomationImportPayload(input: {
  slug: string;
  title: string;
}): Record<string, unknown> {
  return {
    continuityPolicy: "preserve",
    instructions: "Run the hosted member-workspace import permission proof.",
    route: {
      channel: "telegram",
      deliveryTarget: "agentmail:hosted-member-workspace-import-smoke",
      identityId: "identity_hosted_member_workspace_import_smoke",
      participantId: "participant_hosted_member_workspace_import_smoke",
      threadId: "thread_hosted_member_workspace_import_smoke",
    },
    schedule: {
      kind: "dailyLocal",
      localTime: "09:15",
    },
    slug: input.slug,
    status: "active",
    tags: [],
    title: input.title,
  };
}

function assertCodexMemberWorkspaceThreadAttestation(
  value: unknown,
  input: {
    vaultRoot: string;
  },
): void {
  const result = readObject(value, "Codex member-workspace thread/start result");
  const activePermissionProfile = readObject(
    result.activePermissionProfile,
    "Codex member-workspace thread/start result.activePermissionProfile",
  );
  const runtimeWorkspaceRoots = readArray(
    result.runtimeWorkspaceRoots,
    "Codex member-workspace thread/start result.runtimeWorkspaceRoots",
  );
  const rootsMatch = runtimeWorkspaceRoots.length === 1
    && typeof runtimeWorkspaceRoots[0] === "string"
    && path.resolve(runtimeWorkspaceRoots[0]) === path.resolve(input.vaultRoot);

  if (
    activePermissionProfile.id !== MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE
    || result.approvalPolicy !== "never"
    || typeof result.cwd !== "string"
    || path.resolve(result.cwd) !== path.resolve(input.vaultRoot)
    || !rootsMatch
  ) {
    throw new Error(
      "Codex app-server did not attest the requested member-workspace execution context.",
    );
  }
}

function buildCodexMemberWorkspacePermissionProbeScript(): string {
  return `
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const input = JSON.parse(process.argv[1]);
fs.rmSync(input.preloadMarkerPath, { force: true });
fs.writeFileSync(input.tempWritePath, "member workspace temp write\\n", { mode: 0o600 });
fs.mkdirSync(path.dirname(input.vaultWritePath), { recursive: true });
fs.writeFileSync(input.vaultWritePath, "member workspace vault write\\n", { mode: 0o600 });
fs.writeFileSync(input.importPath, JSON.stringify(input.importedPayload) + "\\n", { mode: 0o600 });
fs.writeFileSync(input.preloadPath, [
  'const fs = require("node:fs");',
  'const { syncBuiltinESMExports } = require("node:module");',
  'const originalExistsSync = fs.existsSync;',
  'fs.existsSync = (candidate) => String(candidate) === "/app/.murph-hosted-runner-image" ? false : originalExistsSync(candidate);',
  'syncBuiltinESMExports();',
  'fs.appendFileSync(' + JSON.stringify(input.preloadMarkerPath) + ', "1");',
].join("\\n") + "\\n", { mode: 0o600 });
const run = (args) => spawnSync(
  process.execPath,
  ["--require", input.preloadPath, input.vaultCliEntryPath, ...args],
  {
    cwd: input.vaultRoot,
    encoding: "utf8",
    env: { ...process.env, VAULT: input.vaultRoot },
  },
);
const readResults = input.readArgs.map((args) => run(args));
const mutationResults = input.mutationArgs.map((args) => run(args));
const readProofCount = readResults.filter(
  (result) => result.status === 0 && String(result.stdout).includes(input.seedSlug),
).length;
const mutationDeniedCount = mutationResults.filter(
  (result) => result.status !== 0,
).length;
const preloadCount = fs.readFileSync(input.preloadMarkerPath, "utf8").length;
process.stdout.write(JSON.stringify({
  memberWorkspaceAutomationMutationDeniedCount: mutationDeniedCount,
  memberWorkspaceAutomationReadProofCount: readProofCount,
  memberWorkspacePreloadBypassDenied:
    mutationDeniedCount === input.mutationArgs.length
    && preloadCount === input.readArgs.length + input.mutationArgs.length,
  memberWorkspaceTempWriteAllowed:
    fs.readFileSync(input.tempWritePath, "utf8") === "member workspace temp write\\n",
  memberWorkspaceVaultWriteAllowed:
    fs.readFileSync(input.vaultWritePath, "utf8") === "member workspace vault write\\n",
}));
`;
}

function parseCodexMemberWorkspacePermissionProof(
  stdout: string,
): Omit<
  CodexMemberWorkspacePermissionProof,
  "memberWorkspaceAutomationTreeUnchanged"
  | "memberWorkspaceLocalMutationProofCount"
  | "memberWorkspacePermissionProfileAttested"
> {
  const record = readObject(
    parseJsonFromCommandStdout(stdout, "member-workspace-permission-probe"),
    "Codex member-workspace permission proof",
  );
  const mutationDeniedCount = readNonNegativeNumber(
    record.memberWorkspaceAutomationMutationDeniedCount,
    "Codex member-workspace permission proof.memberWorkspaceAutomationMutationDeniedCount",
  );
  const readProofCount = readNonNegativeNumber(
    record.memberWorkspaceAutomationReadProofCount,
    "Codex member-workspace permission proof.memberWorkspaceAutomationReadProofCount",
  );
  if (
    mutationDeniedCount <
      HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_AUTOMATION_MUTATION_DENIED_COUNT
  ) {
    throw new Error(
      "Codex member-workspace permission proof did not deny every automation mutation route.",
    );
  }
  if (
    readProofCount <
      HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_AUTOMATION_READ_PROOF_COUNT
  ) {
    throw new Error(
      "Codex member-workspace permission proof did not preserve automation reads.",
    );
  }
  for (const field of [
    "memberWorkspacePreloadBypassDenied",
    "memberWorkspaceTempWriteAllowed",
    "memberWorkspaceVaultWriteAllowed",
  ] as const) {
    if (record[field] !== true) {
      throw new Error(`Codex member-workspace permission proof.${field} must be true.`);
    }
  }

  return {
    memberWorkspaceAutomationMutationDeniedCount: mutationDeniedCount,
    memberWorkspaceAutomationReadProofCount: readProofCount,
    memberWorkspacePreloadBypassDenied: true,
    memberWorkspaceTempWriteAllowed: true,
    memberWorkspaceVaultWriteAllowed: true,
  };
}

async function hashDirectoryTree(root: string): Promise<string> {
  const entries: string[] = [];
  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relativePath = path.posix.join(relativeDirectory, child.name);
      const absolutePath = path.join(directory, child.name);
      if (child.isDirectory()) {
        entries.push(`directory:${relativePath}`);
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!child.isFile()) {
        throw new Error(
          `Hosted runner smoke automation tree contains unsupported entry ${relativePath}.`,
        );
      }
      const contents = await readFile(absolutePath);
      entries.push(
        `file:${relativePath}:${createHash("sha256").update(contents).digest("hex")}`,
      );
    }
  };

  await visit(root, "");
  return sha256Hex(entries.join("\n"));
}

async function runCodexGroupReadPermissionProbe(input: {
  execCommand: (
    label: string,
    command: readonly string[],
    options?: CodexCommandExecOptions,
  ) => Promise<CodexCommandExecResult>;
  sendRequest: (
    label: string,
    method: string,
    params: unknown,
    timeoutMs: number,
  ) => Promise<Record<string, unknown>>;
  vaultRoot: string;
  workspaceRoot: string;
}): Promise<CodexGroupReadPermissionProof> {
  const operatorHomeRoot = process.env.HOME;
  if (!operatorHomeRoot) {
    throw new Error("Hosted runner smoke group-read probe requires the rebound HOME root.");
  }

  const fixtureRoot = path.join(input.vaultRoot, "raw", "smoke", "group-read");
  const authorizedFilePath = path.join(fixtureRoot, "authorized.txt");
  const deniedWritePath = path.join(fixtureRoot, "denied-write.txt");
  const deepEnvSecretPath = path.join(
    fixtureRoot,
    ...Array.from({ length: 12 }, (_value, index) => `depth-${index + 1}`),
    ".env",
  );
  const runtimeSecretPath = path.join(
    input.vaultRoot,
    ".runtime",
    "hosted-runner-smoke",
    "secret.txt",
  );
  const siblingRootSecretPath = path.join(
    operatorHomeRoot,
    "group-read-sibling-secret.txt",
  );
  const outsideRootSecretPath = path.join(
    input.workspaceRoot,
    "group-read-outside-secret.txt",
  );
  const authorizedFileContents = "authorized group data\n";

  await mkdir(fixtureRoot, { mode: 0o700, recursive: true });
  await mkdir(path.dirname(deepEnvSecretPath), { mode: 0o700, recursive: true });
  await mkdir(path.dirname(runtimeSecretPath), { mode: 0o700, recursive: true });
  await writeFile(authorizedFilePath, authorizedFileContents, { mode: 0o600 });
  await writeFile(deepEnvSecretPath, "deep env secret\n", { mode: 0o600 });
  await writeFile(runtimeSecretPath, "runtime secret\n", { mode: 0o600 });
  await writeFile(siblingRootSecretPath, "sibling secret\n", { mode: 0o600 });
  await writeFile(outsideRootSecretPath, "outside secret\n", { mode: 0o600 });
  await rm(deniedWritePath, { force: true });

  const threadStart = await input.sendRequest(
    "group-read-thread-start",
    "thread/start",
    {
      approvalPolicy: "never",
      config: {
        include_environment_context: false,
        include_permissions_instructions: false,
        project_doc_max_bytes: 0,
        "features.request_permissions_tool": false,
        "skills.include_instructions": false,
      },
      cwd: input.vaultRoot,
      ephemeral: true,
      permissions: MURPH_GROUP_READ_PERMISSION_PROFILE,
      runtimeWorkspaceRoots: [input.vaultRoot],
    },
    CODEX_SHELL_ENV_PROBE_TIMEOUT_MS,
  );
  assertCodexGroupReadThreadAttestation(threadStart.result, {
    vaultRoot: input.vaultRoot,
  });

  let acceptedNetworkConnections = 0;
  const networkServer = createServer((socket) => {
    acceptedNetworkConnections += 1;
    socket.destroy();
  });
  const networkPort = await listenOnLoopback(networkServer);

  try {
    const result = await input.execCommand(
      "group-read-permission-probe",
      [
        "node",
        "-e",
        buildCodexGroupReadPermissionProbeScript(),
        JSON.stringify({
          authorizedFilePath,
          authorizedFileSha256: sha256Hex(authorizedFileContents),
          deepEnvSecretPath,
          deniedWritePath,
          networkPort,
          outsideRootSecretPath,
          runtimeSecretPath,
          secretEnvironmentNames: [
            "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
            "OPENAI_API_KEY",
          ],
          siblingRootSecretPath,
        }),
      ],
      {
        cwd: input.vaultRoot,
        permissionProfile: MURPH_GROUP_READ_PERMISSION_PROFILE,
      },
    );
    const proof = parseCodexGroupReadPermissionProof(result.stdout);

    if (acceptedNetworkConnections !== 0) {
      throw new Error(
        "Hosted runner smoke group-read sandbox allowed a loopback network connection.",
      );
    }

    let deniedWriteExists = false;
    try {
      await access(deniedWritePath);
      deniedWriteExists = true;
    } catch {
      // The sandbox should leave the denied target absent.
    }
    if (deniedWriteExists) {
      throw new Error(
        "Hosted runner smoke group-read sandbox created its denied write target.",
      );
    }

    return {
      ...proof,
      groupReadPermissionProfileAttested: true,
    };
  } finally {
    await closeServer(networkServer);
  }
}

function assertCodexGroupReadThreadAttestation(
  value: unknown,
  input: {
    vaultRoot: string;
  },
): void {
  const result = readObject(value, "Codex group-read thread/start result");
  const activePermissionProfile = readObject(
    result.activePermissionProfile,
    "Codex group-read thread/start result.activePermissionProfile",
  );
  const runtimeWorkspaceRoots = readArray(
    result.runtimeWorkspaceRoots,
    "Codex group-read thread/start result.runtimeWorkspaceRoots",
  );
  const instructionSources = readArray(
    result.instructionSources,
    "Codex group-read thread/start result.instructionSources",
  );
  const rootsMatch = runtimeWorkspaceRoots.length === 1
    && typeof runtimeWorkspaceRoots[0] === "string"
    && path.resolve(runtimeWorkspaceRoots[0]) === path.resolve(input.vaultRoot);

  if (
    activePermissionProfile.id !== MURPH_GROUP_READ_PERMISSION_PROFILE
    || result.approvalPolicy !== "never"
    || typeof result.cwd !== "string"
    || path.resolve(result.cwd) !== path.resolve(input.vaultRoot)
    || instructionSources.length !== 0
    || !rootsMatch
  ) {
    throw new Error(
      "Codex app-server did not attest the requested group-read execution context.",
    );
  }
}

function buildCodexGroupReadPermissionProbeScript(): string {
  return `
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const input = JSON.parse(process.argv[1]);
function readDenied(filePath) {
  try {
    fs.readFileSync(filePath, "utf8");
    return false;
  } catch {
    return true;
  }
}
function writeDenied(filePath) {
  try {
    fs.writeFileSync(filePath, "denied write\\n", { mode: 0o600 });
    return false;
  } catch {
    return true;
  }
}
function networkDenied(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (denied) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(denied);
    };
    socket.once("connect", () => finish(false));
    socket.once("error", () => finish(true));
    socket.setTimeout(1500, () => finish(true));
  });
}
void (async () => {
  let authorizedFileRead = false;
  try {
    const contents = fs.readFileSync(input.authorizedFilePath);
    authorizedFileRead = crypto.createHash("sha256").update(contents).digest("hex")
      === input.authorizedFileSha256;
  } catch {}
  const proof = {
    groupReadAuthorizedFileRead: authorizedFileRead,
    groupReadDeepEnvReadDenied: readDenied(input.deepEnvSecretPath),
    groupReadGroupWriteDenied: writeDenied(input.deniedWritePath),
    groupReadNetworkDenied: await networkDenied(input.networkPort),
    groupReadOutsideRootReadDenied: readDenied(input.outsideRootSecretPath),
    groupReadRuntimeReadDenied: readDenied(input.runtimeSecretPath),
    groupReadSecretEnvironmentDenied: input.secretEnvironmentNames.every(
      (name) => !Object.hasOwn(process.env, name),
    ),
    groupReadSiblingRootReadDenied: readDenied(input.siblingRootSecretPath),
  };
  process.stdout.write(JSON.stringify(proof));
})().catch(() => process.exit(1));
`;
}

function parseCodexGroupReadPermissionProof(
  stdout: string,
): Omit<CodexGroupReadPermissionProof, "groupReadPermissionProfileAttested"> {
  const record = readObject(
    parseJsonFromCommandStdout(stdout, "group-read-permission-probe"),
    "Codex group-read permission proof",
  );
  const expectedTrueFields = [
    "groupReadAuthorizedFileRead",
    "groupReadDeepEnvReadDenied",
    "groupReadGroupWriteDenied",
    "groupReadNetworkDenied",
    "groupReadOutsideRootReadDenied",
    "groupReadRuntimeReadDenied",
    "groupReadSecretEnvironmentDenied",
    "groupReadSiblingRootReadDenied",
  ] as const;

  for (const field of expectedTrueFields) {
    if (record[field] !== true) {
      throw new Error(`Codex group-read permission proof.${field} must be true.`);
    }
  }

  return {
    groupReadAuthorizedFileRead: true,
    groupReadDeepEnvReadDenied: true,
    groupReadGroupWriteDenied: true,
    groupReadNetworkDenied: true,
    groupReadOutsideRootReadDenied: true,
    groupReadRuntimeReadDenied: true,
    groupReadSecretEnvironmentDenied: true,
    groupReadSiblingRootReadDenied: true,
  };
}

async function listenOnLoopback(
  server: NetServer,
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Hosted runner smoke loopback probe did not bind a TCP port.");
  }

  return address.port;
}

async function closeServer(server: NetServer): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
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
  cwdRebound: process.cwd() === expectedVaultRoot,
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

  if (record.cwdRebound !== true) {
    throw new Error("Codex app-server shell env probe did not execute from the restored vault root.");
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
      "--occurred-at",
      CODEX_VAULT_CLI_SMOKE_MEASUREMENT_OCCURRED_AT,
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
  const createdMeasurementEventId = readString(
    measurementAdd.eventId,
    "measurement-add.eventId",
  );
  vaultWriteProofCount += 1;

  const measurementList = await runVaultJson("measurement-list", [
    "measurement",
    "list",
    "--from",
    CODEX_VAULT_CLI_SMOKE_MEASUREMENT_DATE,
    "--to",
    CODEX_VAULT_CLI_SMOKE_MEASUREMENT_DATE,
    "--limit",
    "10",
    "--format",
    "json",
  ]);
  assertMeasurementListIncludesProof(
    measurementList,
    "measurement-list",
    createdMeasurementEventId,
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

function assertMeasurementListIncludesProof(
  value: unknown,
  label: string,
  expectedEventId: string,
): void {
  const record = readObject(value, label);
  const items = readArray(record.items, `${label}.items`);
  if (
    !items.some((item, index) =>
      objectHasListEntityId(item, `${label}.items[${index}]`, expectedEventId)
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
    if (item.slug === CODEX_VAULT_CLI_SMOKE_SCHEDULED_LOG_SLUG) {
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

function objectHasListEntityId(
  value: unknown,
  label: string,
  expectedEventId: string,
): boolean {
  const record = readObject(value, label);
  if (
    record.id === expectedEventId ||
    record.entityId === expectedEventId ||
    record.lookupId === expectedEventId
  ) {
    return true;
  }

  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    return objectHasListEntityId(record.data, `${label}.data`, expectedEventId);
  }

  return false;
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

interface CodexCommandExecOptions {
  cwd?: string;
  permissionProfile?: string;
}

interface CodexMemberWorkspacePermissionProof {
  memberWorkspaceAutomationMutationDeniedCount: number;
  memberWorkspaceAutomationReadProofCount: number;
  memberWorkspaceAutomationTreeUnchanged: boolean;
  memberWorkspaceLocalMutationProofCount: number;
  memberWorkspacePermissionProfileAttested: boolean;
  memberWorkspacePreloadBypassDenied: boolean;
  memberWorkspaceTempWriteAllowed: boolean;
  memberWorkspaceVaultWriteAllowed: boolean;
}

interface CodexGroupReadPermissionProof {
  groupReadAuthorizedFileRead: boolean;
  groupReadDeepEnvReadDenied: boolean;
  groupReadGroupWriteDenied: boolean;
  groupReadNetworkDenied: boolean;
  groupReadOutsideRootReadDenied: boolean;
  groupReadPermissionProfileAttested: boolean;
  groupReadRuntimeReadDenied: boolean;
  groupReadSecretEnvironmentDenied: boolean;
  groupReadSiblingRootReadDenied: boolean;
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
