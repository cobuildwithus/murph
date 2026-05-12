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
  createHostedRunnerNativeParserToolchain,
} from "./runner-native-parser-toolchain.ts";
import {
  HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
  parseHostedRunnerSmokeInput,
  type HostedRunnerSmokeResult,
} from "./hosted-runner-smoke-contract.js";

const execFileAsync = promisify(execFile);
const FINNISH_DRY_SAUNA_KEY =
  "protocol_variant:dry-sauna/murph-finnish-standard-3x-week";
const HEALTH_COMMONS_RUNTIME_MODULE: string = "@murphai/health-commons/runtime";
const CODEX_SHELL_ENV_PROBE_COMMAND_TIMEOUT_MS = 20_000;
const CODEX_SHELL_ENV_PROBE_TIMEOUT_MS = 30_000;
const PDF_SMOKE_EXPECTED_TEXT = "Murph hosted PDF smoke fixture";
const PDF_SMOKE_RELATIVE_PATH = "raw/smoke/hosted-runner.pdf";

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
  const hostedCodexConfig =
    await runHostedCodexConfigShellEnvironmentPolicySmoke(input.workspaceRoot);
  const pythonVersion = await runPythonToolchainSmoke();

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
  const parserRegistry = await createSmokeParserRegistry();
  const pdfParse = await parsePdfDocument({
    pdfPath,
    registry: parserRegistry,
    scratchRoot: path.join(parserScratchRoot, "pdf-parser"),
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
    childCwdIsIsolated: true,
    codexAppServerHelpBytes: codexPreflight.appServerHelpBytes,
    codexCommandDiscovered: true,
    codexHostedConfigShellEnvironmentPolicyAllowlisted:
      hostedCodexConfig.shellEnvironmentPolicyAllowlisted,
    codexHostedShellMurphPathBytes: hostedCodexConfig.murphPathBytes,
    codexHostedShellPythonVersion: hostedCodexConfig.pythonVersion,
    codexHostedShellVaultCliLlmsBytes: hostedCodexConfig.vaultCliLlmsBytes,
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
    pdfParserProviderId: pdfParse.providerId,
    pdfTextSha256: sha256Hex(pdfParse.text),
    pythonVersion,
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

async function runHostedCodexConfigShellEnvironmentPolicySmoke(
  workspaceRoot: string,
): Promise<{
  murphPathBytes: number;
  pythonVersion: string;
  shellEnvironmentPolicyAllowlisted: boolean;
  vaultCliLlmsBytes: number;
}> {
  const codexHome = path.join(workspaceRoot, "hosted-codex-config-smoke-home", ".codex-hosted");
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
    runtimeEnv: {
      PATH: process.env.PATH ?? "",
      VAULT: process.env.VAULT ?? "",
      OPENAI_API_KEY: "hosted-runner-smoke-secret",
    },
    vaultRoot: process.env.VAULT ?? "",
  });

  return {
    murphPathBytes: shellProbe.murphPathBytes,
    pythonVersion: shellProbe.pythonVersion,
    shellEnvironmentPolicyAllowlisted: true,
    vaultCliLlmsBytes: shellProbe.vaultCliLlmsBytes,
  };
}

function buildHostedRunnerSmokeCodexConfigToml(): string {
  return [
    'model = "gpt-5.5"',
    'model_provider = "openai"',
    'model_reasoning_effort = "medium"',
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
    'inherit = "all"',
    'include_only = ["CI", "CODEX_HOME", "CODEX_CA_CERTIFICATE", "COLORTERM", "CURL_CA_BUNDLE", "FORCE_COLOR", "HOME", "MURPH_HOSTED_CLI_BRIDGE_TOKEN", "MURPH_HOSTED_CLI_BRIDGE_URL", "MURPH_HOSTED_RUNTIME_PROCESS", "LANG", "LC_ALL", "LC_CTYPE", "NODE_EXTRA_CA_CERTS", "NO_COLOR", "PATH", "REQUESTS_CA_BUNDLE", "SSL_CERT_DIR", "SSL_CERT_FILE", "TEMP", "TERM", "TMP", "TMPDIR", "VAULT"]',
    "",
  ].join("\n");
}

async function runCodexAppServerShellEnvironmentProbe(input: {
  codexHome: string;
  runtimeEnv: Record<string, string>;
  vaultRoot: string;
}): Promise<{
  murphPathBytes: number;
  pythonVersion: string;
  vaultCliLlmsBytes: number;
}> {
  const child = spawn("codex", ["app-server"], {
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
  let settled = false;

  const completed = new Promise<{
    murphPathBytes: number;
    pythonVersion: string;
    vaultCliLlmsBytes: number;
  }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(
        `Timed out waiting for Codex app-server shell env probe. stderrBytes=${Buffer.byteLength(stderr, "utf8")}`,
      ));
    }, CODEX_SHELL_ENV_PROBE_TIMEOUT_MS);

    const finish = (
      error?: Error,
      result?: {
        murphPathBytes: number;
        pythonVersion: string;
        vaultCliLlmsBytes: number;
      },
    ): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }

      if (!result) {
        reject(new Error("Codex app-server shell env probe finished without a result."));
        return;
      }

      resolve(result);
    };

    child.once("error", finish);
    child.once("exit", (code, signal) => {
      if (!settled) {
        finish(new Error(
          `Codex app-server exited before shell env probe completed: ${code ?? signal}. stderrBytes=${Buffer.byteLength(stderr, "utf8")}`,
        ));
      }
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

        const message = JSON.parse(trimmed) as Record<string, unknown>;
        if (message.id !== 2) {
          continue;
        }

        if (message.error) {
          finish(new Error(`Codex app-server shell env probe failed: ${JSON.stringify(message.error)}`));
          return;
        }

        const result = readCodexCommandExecResult(message.result);
        const probe = assertCodexShellEnvironmentProbeResult({
          result,
          vaultRoot: input.vaultRoot,
        });
        finish(undefined, probe);
      }
    });
  });

  try {
    childStdin.write(`${JSON.stringify({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "hosted-runner-smoke",
          version: "1",
        },
      },
    })}\n`);
    childStdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
    childStdin.write(`${JSON.stringify({
      id: 2,
      method: "command/exec",
      params: {
        command: [
          "/bin/sh",
          "-lc",
          [
            "vault_cli_path=$(command -v vault-cli || true)",
            "murph_path=$(command -v murph || true)",
            "python_path=$(command -v python || true)",
            "python3_path=$(command -v python3 || true)",
            "if [ -z \"$vault_cli_path\" ]; then printf '%s\\n' 'probe_step_failed:resolve-vault-cli'; exit 127; fi",
            "if [ -z \"$murph_path\" ]; then printf '%s\\n' 'probe_step_failed:resolve-murph'; exit 127; fi",
            "if [ -z \"$python_path\" ]; then printf '%s\\n' 'probe_step_failed:resolve-python'; exit 127; fi",
            "if [ -z \"$python3_path\" ]; then printf '%s\\n' 'probe_step_failed:resolve-python3'; exit 127; fi",
            "probe_tmp=$(mktemp -d)",
            "vault_cli_manifest_path=\"$probe_tmp/vault-cli-llms.json\"",
            "\"$vault_cli_path\" --llms --format json > \"$vault_cli_manifest_path\" || { status=$?; printf '%s\\n' 'probe_step_failed:vault-cli-llms'; exit \"$status\"; }",
            "vault_cli_manifest_bytes=$(wc -c < \"$vault_cli_manifest_path\" | tr -d '[:space:]')",
            "murph_path_bytes=${#murph_path}",
            "rm -rf \"$probe_tmp\"",
            "python_version=$(\"$python3_path\" --version) || { status=$?; printf '%s\\n' 'probe_step_failed:python3-version'; exit \"$status\"; }",
            "\"$python_path\" -c 'import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)' || { status=$?; printf '%s\\n' 'probe_step_failed:python-major'; exit \"$status\"; }",
            "printf '%s\\n' \"$vault_cli_path\"",
            "printf '%s\\n' \"$murph_path\"",
            "printf '%s\\n' \"$python_path\"",
            "printf '%s\\n' \"$python3_path\"",
            "printf '%s\\n' \"$vault_cli_manifest_bytes\"",
            "printf '%s\\n' \"$murph_path_bytes\"",
            "printf '%s\\n' \"$python_version\"",
            "printf '%s\\n' \"${VAULT:-}\"",
            "printf '%s\\n' \"${OPENAI_API_KEY:-}\"",
          ].join("; "),
        ],
        timeoutMs: CODEX_SHELL_ENV_PROBE_COMMAND_TIMEOUT_MS,
      },
    })}\n`);
    return await completed;
  } finally {
    childStdin.end();
    child.kill();
  }
}

function readCodexCommandExecResult(value: unknown): {
  exitCode: number;
  stderr: string;
  stdout: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Codex app-server shell env probe result must be an object.");
  }

  const record = value as Record<string, unknown>;
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

function assertCodexShellEnvironmentProbeResult(input: {
  result: {
    exitCode: number;
    stderr: string;
    stdout: string;
  };
  vaultRoot: string;
}): {
  murphPathBytes: number;
  pythonVersion: string;
  vaultCliLlmsBytes: number;
} {
  if (input.result.exitCode !== 0) {
    const failedStep = readProbeFailureStep(input.result.stdout);
    const failedStepSuffix = failedStep ? ` during ${failedStep}` : "";
    throw new Error(
      `Codex app-server shell env probe exited ${input.result.exitCode}${failedStepSuffix}. stdoutBytes=${Buffer.byteLength(input.result.stdout, "utf8")} stderrBytes=${Buffer.byteLength(input.result.stderr, "utf8")}`,
    );
  }

  const [
    vaultCliPath,
    murphPath,
    pythonPath,
    python3Path,
    vaultCliLlmsBytesText,
    murphPathBytesText,
    pythonVersion,
    vaultRoot,
    providerCredential,
    ...extra
  ] =
    input.result.stdout.split(/\r?\n/u);
  if (
    !vaultCliPath
    || !murphPath
    || !pythonPath
    || !python3Path
    || extra.some((line) => line.trim().length > 0)
  ) {
    throw new Error("Codex app-server shell env probe did not resolve expected commands cleanly.");
  }

  const vaultCliLlmsBytes = parsePositiveByteCount(
    vaultCliLlmsBytesText,
    "vault-cli --llms --format json",
  );
  const murphPathBytes = parsePositiveByteCount(murphPathBytesText, "murph path resolution");
  if (!pythonVersion || !/^Python\s+3\./u.test(pythonVersion)) {
    throw new Error("Codex app-server shell env probe did not execute python3 --version.");
  }

  if (vaultRoot !== input.vaultRoot) {
    throw new Error("Codex app-server shell env probe did not inherit the hosted VAULT path.");
  }

  if (providerCredential && providerCredential.trim().length > 0) {
    throw new Error("Codex app-server shell env probe leaked the provider credential env.");
  }

  return {
    murphPathBytes,
    pythonVersion,
    vaultCliLlmsBytes,
  };
}

function parsePositiveByteCount(value: string | undefined, label: string): number {
  if (!value || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`Codex app-server shell env probe did not execute ${label}.`);
  }

  return Number(value);
}

function readProbeFailureStep(stdout: string): string | null {
  const firstLine = stdout.split(/\r?\n/u).find((line) => line.trim().length > 0);
  const match = firstLine?.match(/^probe_step_failed:([a-z0-9-]+)$/u);
  return match?.[1] ?? null;
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
  const nativeToolchain = createHostedRunnerNativeParserToolchain();

  return createDefaultParserRegistry({
    whisper: {
      commandCandidates: nativeToolchain.tools.whisper?.command
        ? [nativeToolchain.tools.whisper.command]
        : undefined,
      language: "en",
      modelPath: nativeToolchain.tools.whisper?.modelPath ?? undefined,
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
