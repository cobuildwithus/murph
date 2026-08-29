import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import {
  buildHostedRunnerExecutablePath,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
  HOSTED_RUNNER_EXECUTABLE_PATH,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  drainHostedAssistantDeliveryControlPlaneWritesBestEffort,
  drainHostedRuntimeDeferredUsageCompletionsBestEffort,
  drainHostedRuntimeLogWritesBestEffort,
} from "@murphai/assistant-runtime/hosted-invocation";

import {
  DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT,
  DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
  DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT,
  readDeployLiveModelTurnSmokeCodexOutputText,
} from "./deploy-smoke-live-model.ts";
import {
  runHostedWorkspaceInvocation,
} from "./hosted-workspace-invocation.ts";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "./runner-injected-credential.ts";
import {
  HOSTED_RUNNER_CONTAINER_CA_ENV_KEYS,
} from "./runner-container-ca-env.ts";

const HOSTED_CONTAINER_CODEX_SHELL_SMOKE_TIMEOUT_MS = 45_000;
const HOSTED_CONTAINER_CODEX_SHELL_SMOKE_MODEL = "gpt-5.6-terra";
const HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_TIMEOUT_MS = 60_000;
const HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_STDOUT_TAIL_MAX_CHARS = 16 * 1024;
const HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_ERROR_MESSAGE_MAX_CHARS = 512;
const HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_STDOUT_EXCERPT_MAX_CHARS = 220;
const HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_STDERR_EXCERPT_MAX_CHARS = 160;
const HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_CHUNK_BYTES = 1024 * 1024;
const HOSTED_CONTAINER_CLOUDFLARE_CA_CERT_PATH =
  "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const HOSTED_CONTAINER_CODEX_SMOKE_HOME_DIRECTORY = ".codex-deploy-smoke";

export interface HostedContainerCodexShellSmokeResult {
  client: "codex-app-server";
  cliSurfaceContractBytes: number;
  cliSurfaceHotPathProofCount: number;
  murphPathBytes: number;
  noteAddBytes: number;
  stderrBytes: number;
  vaultCliLlmsBytes: number;
  vaultCliPathBytes: number;
  vaultShowBytes: number;
}

interface HostedContainerCodexCommandExecResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface HostedContainerLiveModelTurnSmokeResult {
  durationMs: number;
  model: string;
  stdoutBytes: number;
}

export interface HostedContainerDirectR2PresignedPutSmokeResult {
  byteLength: number;
  durationMs: number;
  ok: boolean;
  payloadSha256: string;
  responseBodyBytes: number;
  status: number;
}

export interface HostedContainerHeavyRuntimeCore {
  buildLiveModelTurnSmokeSafeText(value: string): string;
  deployLiveModelTurnSmokeModel: string;
  drainFatalRuntimeBestEffort(input: { timeoutMs: number }): Promise<void>;
  drainShutdownRuntimeBestEffort(input: { timeoutMs: number }): Promise<void>;
  runCodexShellSmoke(input: { signal: AbortSignal }): Promise<HostedContainerCodexShellSmokeResult>;
  runDirectR2PresignedPutSmoke(input: {
    byteLength: number;
    presignedPutUrl: string;
    signal: AbortSignal;
    tlsCaCertificatePem?: string;
  }): Promise<HostedContainerDirectR2PresignedPutSmokeResult>;
  runLiveModelTurnSmoke(input: {
    model: string;
    signal: AbortSignal;
  }): Promise<HostedContainerLiveModelTurnSmokeResult>;
  runWorkspaceInvocation: typeof runHostedWorkspaceInvocation;
}

export interface HostedContainerHeavyRuntime extends HostedContainerHeavyRuntimeCore {
  stopWarmCodex(reason: string): Promise<void>;
  waitForBackgroundAssistantWork(signal: AbortSignal | null): Promise<void>;
}

async function runHostedContainerDirectR2PresignedPutSmoke(input: {
  byteLength: number;
  presignedPutUrl: string;
  signal: AbortSignal;
  tlsCaCertificatePem?: string;
}): Promise<HostedContainerDirectR2PresignedPutSmokeResult> {
  const startedAt = Date.now();
  const payload = createHostedContainerDeterministicPayloadStream(input.byteLength);
  const response = await putHostedContainerDirectR2SmokePayload({
    byteLength: input.byteLength,
    payload: payload.stream,
    presignedPutUrl: input.presignedPutUrl,
    signal: input.signal,
    tlsCaCertificatePem: input.tlsCaCertificatePem,
  });
  return {
    byteLength: input.byteLength,
    durationMs: Date.now() - startedAt,
    ok: response.status >= 200 && response.status < 300,
    payloadSha256: payload.readSha256(),
    responseBodyBytes: response.bodyBytes,
    status: response.status,
  };
}

function createHostedContainerDeterministicPayloadStream(byteLength: number): {
  readSha256: () => string;
  stream: Readable;
} {
  const hash = createHash("sha256");
  let offset = 0;
  let digest: string | null = null;
  const stream = new Readable({
    read() {
      if (offset >= byteLength) {
        digest = hash.digest("hex");
        this.push(null);
        return;
      }

      const chunkLength = Math.min(
        HOSTED_CONTAINER_DIRECT_R2_PRESIGNED_PUT_CHUNK_BYTES,
        byteLength - offset,
      );
      const chunk = Buffer.allocUnsafe(chunkLength);
      for (let index = 0; index < chunkLength; index += 1) {
        chunk[index] = (offset + index) & 0xff;
      }
      offset += chunkLength;
      hash.update(chunk);
      this.push(chunk);
    },
  });

  return {
    readSha256() {
      if (digest === null) {
        throw new Error("Direct R2 presigned PUT smoke payload digest was read before upload completed.");
      }
      return digest;
    },
    stream,
  };
}

async function putHostedContainerDirectR2SmokePayload(input: {
  byteLength: number;
  payload: Readable;
  presignedPutUrl: string;
  signal: AbortSignal;
  tlsCaCertificatePem?: string;
}): Promise<{ bodyBytes: number; status: number }> {
  const url = new URL(input.presignedPutUrl);
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;

  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: { bodyBytes: number; status: number }): void => {
      if (settled) {
        return;
      }
      settled = true;
      input.signal.removeEventListener("abort", abort);
      if (error) {
        reject(error);
        return;
      }
      resolve(result ?? { bodyBytes: 0, status: 0 });
    };
    const abort = (): void => {
      clientRequest.destroy(new Error("Direct R2 presigned PUT smoke aborted."));
    };
    const clientRequest = request(url, {
      ...(input.tlsCaCertificatePem ? { ca: input.tlsCaCertificatePem } : {}),
      headers: {
        "content-length": String(input.byteLength),
        "content-type": "application/octet-stream",
        "if-none-match": "*",
      },
      method: "PUT",
      signal: input.signal,
    }, (response) => {
      let bodyBytes = 0;
      response.on("data", (chunk) => {
        bodyBytes += Buffer.byteLength(chunk);
      });
      response.once("error", finish);
      response.once("end", () => {
        finish(undefined, {
          bodyBytes,
          status: response.statusCode ?? 0,
        });
      });
      response.resume();
    });

    input.signal.addEventListener("abort", abort, { once: true });
    clientRequest.once("error", finish);
    input.payload.once("error", finish);
    input.payload.pipe(clientRequest);
  });
}

async function runHostedContainerCodexShellSmoke(input: {
  signal: AbortSignal;
}): Promise<HostedContainerCodexShellSmokeResult> {
  return await withHostedContainerCodexSmokeWorkspace(
    HOSTED_CONTAINER_CODEX_SHELL_SMOKE_MODEL,
    async (workspace) =>
      await runHostedContainerCodexShellAppServerProbe({
        ...workspace,
        signal: input.signal,
      }),
  );
}

// The live model turn is deliberately a single non-interactive `codex exec`
// subprocess with exit-code semantics. Codex app-server RPC plumbing is
// already proven by the Codex shell smoke and the hosted-local E2E gates;
// the only boundary this step closes is real OpenAI auth/quota/network for
// one deployed model turn, so it stays as small as possible.
//
// The codex subprocess receives only the well-known injected-credential
// placeholder: managed-container egress to api.openai.com is intercepted by
// the Worker, which authorizes the deploy-smoke live-turn fence and injects
// the real Worker-owned OPENAI_API_KEY upstream, the same egress path
// production turns use. The raw key never enters the container.
async function runHostedContainerLiveModelTurnSmoke(input: {
  model: string;
  signal: AbortSignal;
}): Promise<HostedContainerLiveModelTurnSmokeResult> {
  return await withHostedContainerCodexSmokeWorkspace(input.model, async (workspace) =>
    await new Promise((resolve, reject) => {
      const startedAtMs = Date.now();
      let stdoutBytes = 0;
      let stdoutTail = "";
      let stderrBuffer = "";
      let settled = false;
      let timeout: NodeJS.Timeout | null = null;
      let abort: () => void = () => {};
      const child = spawn("codex", [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "-",
      ], {
        cwd: workspace.smokeVaultRoot,
        env: buildHostedContainerCodexShellSmokeProcessEnv({
          ...workspace,
          liveProviderEgress: true,
        }),
        stdio: ["pipe", "pipe", "pipe"],
      });

      const finish = (error: Error | null, result?: HostedContainerLiveModelTurnSmokeResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        input.signal.removeEventListener("abort", abort);
        child.kill();
        if (error) {
          reject(error);
          return;
        }
        resolve(result ?? {
          durationMs: Date.now() - startedAtMs,
          model: input.model,
          stdoutBytes,
        });
      };

      abort = (): void => {
        finish(new Error("Hosted live model turn smoke aborted."));
      };
      timeout = setTimeout(() => {
        finish(new Error(
          "Hosted live model turn smoke timed out after "
            + `${HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_TIMEOUT_MS}ms. `
            + `stderrExcerpt=${JSON.stringify(buildHostedContainerLiveModelTurnSmokeSafeText(stderrBuffer))}`,
        ));
      }, HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_TIMEOUT_MS);
      input.signal.addEventListener("abort", abort, { once: true });

      child.stdout?.on("data", (chunk) => {
        const text = String(chunk);
        stdoutBytes += Buffer.byteLength(text);
        stdoutTail = `${stdoutTail}${text}`.slice(
          -HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_STDOUT_TAIL_MAX_CHARS,
        );
      });
      child.stderr?.on("data", (chunk) => {
        // Keep only a bounded prefix; the excerpt is re-capped on use.
        if (stderrBuffer.length < 4_096) {
          stderrBuffer += String(chunk);
        }
      });
      child.once("error", (error) => {
        finish(new Error(
          `Hosted live model turn smoke failed to spawn codex exec. ${error.message}`,
        ));
      });
      child.once("close", (code, signal) => {
        if (code === 0) {
          const outputText = readDeployLiveModelTurnSmokeCodexOutputText(stdoutTail);
          if (outputText !== DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT) {
            finish(new Error(
              "Hosted live model turn smoke did not return the expected output. "
                + `stdoutBytes=${stdoutBytes} `
                + `outputText=${JSON.stringify(buildHostedContainerLiveModelTurnSmokeSafeText(outputText ?? ""))}`,
            ));
            return;
          }
          finish(null, {
            durationMs: Date.now() - startedAtMs,
            model: input.model,
            stdoutBytes,
          });
          return;
        }
        finish(new Error(
          `Hosted live model turn smoke codex exec exited with ${code ?? signal ?? "unknown"}. `
            + `stdoutBytes=${stdoutBytes} `
            + `stderrExcerpt=${JSON.stringify(buildHostedContainerLiveModelTurnSmokeSafeText(
              stderrBuffer,
              HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_STDERR_EXCERPT_MAX_CHARS,
            ))} `
            + `stdoutExcerpt=${JSON.stringify(buildHostedContainerLiveModelTurnSmokeStdoutSafeText(stdoutTail))}`,
        ));
      });
      child.stdin?.end(DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT);
    }));
}

// Smoke failure text may embed Codex stdout/stderr. Keep only bounded,
// printable diagnostic text and scrub obvious credential shapes before the
// message leaves the container.
function buildHostedContainerLiveModelTurnSmokeSafeText(
  value: string,
  maxChars = HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_ERROR_MESSAGE_MAX_CHARS,
): string {
  return value
    .replace(/(Authorization:\s*(?:Bearer|Basic)\s+)[^\s"',}]+/giu, "$1<REDACTED>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer <REDACTED>")
    .replace(
      /((?:api|auth|access|refresh|id)?[_-]?(?:token|secret|password|private[_-]?jwk|key)\s*[:=]\s*)[^\s"',}]+/giu,
      "$1<REDACTED>",
    )
    .replace(/\b(?:sk|pk|rk)-(?:proj-)?[A-Za-z0-9_-]{8,}\b/gu, "<REDACTED>")
    .replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9_]{8,}\b/gu, "<REDACTED>")
    .replace(/\bwhsec[_-][A-Za-z0-9_-]{8,}\b/gu, "<REDACTED>")
    .replace(/\bgh[opsru]_[A-Za-z0-9_]{16,}\b/gu, "<REDACTED>")
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{16,}\b/gu, "<REDACTED>")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/gu, "<REDACTED>")
    .replace(/[^\x20-\x7e]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxChars);
}

function buildHostedContainerLiveModelTurnSmokeStdoutSafeText(value: string): string {
  const extractedText = value
    .split(/\r?\n/gu)
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return "";
        }
        const record = parsed as Record<string, unknown>;
        if (typeof record.message === "string") {
          return record.message;
        }
        const error = record.error;
        if (error && typeof error === "object" && !Array.isArray(error)) {
          const errorRecord = error as Record<string, unknown>;
          return typeof errorRecord.message === "string" ? errorRecord.message : "";
        }
      } catch {
        return "";
      }
      return "";
    })
    .filter((line) => line.length > 0)
    .join(" ");
  return buildHostedContainerLiveModelTurnSmokeSafeText(
    extractedText,
    HOSTED_CONTAINER_LIVE_MODEL_TURN_SMOKE_STDOUT_EXCERPT_MAX_CHARS,
  );
}

async function withHostedContainerCodexSmokeWorkspace<T>(
  model: string,
  run: (workspace: { codexHome: string; smokeVaultRoot: string }) => Promise<T>,
): Promise<T> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-codex-shell-smoke-"));
  let codexWorkspaceRoot: string | null = null;
  try {
    const codexSmokeHomeRoot = resolveHostedContainerCodexSmokeHomeRoot();
    await mkdir(codexSmokeHomeRoot, {
      mode: 0o700,
      recursive: true,
    });
    await chmod(codexSmokeHomeRoot, 0o700);
    codexWorkspaceRoot = await mkdtemp(path.join(
      codexSmokeHomeRoot,
      "hosted-codex-shell-smoke-",
    ));
    const codexHome = path.join(codexWorkspaceRoot, ".codex-smoke");
    const smokeVaultRoot = path.join(workspaceRoot, "vault");
    await mkdir(codexHome, {
      mode: 0o700,
      recursive: true,
    });
    await chmod(codexHome, 0o700);
    await mkdir(smokeVaultRoot, {
      mode: 0o700,
      recursive: true,
    });
    await chmod(smokeVaultRoot, 0o700);
    await writeFile(
      path.join(smokeVaultRoot, "vault.json"),
      `${JSON.stringify({
        createdAt: "2026-05-22T00:00:00.000Z",
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        timezone: "UTC",
        title: "Hosted Codex Shell Smoke",
        vaultId: "vault_01JY0000000000000000000000",
      }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      path.join(smokeVaultRoot, "CORE.md"),
      [
        "---",
        "schemaVersion: hv/core@v1",
        "vaultId: vault_01JY0000000000000000000000",
        "title: Hosted Codex Shell Smoke",
        "---",
        "# Hosted Codex Shell Smoke",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    await writeFile(
      path.join(codexHome, "config.toml"),
      buildHostedContainerCodexShellSmokeConfig(model),
      { mode: 0o600 },
    );

    return await run({
      codexHome,
      smokeVaultRoot,
    });
  } finally {
    await Promise.all([
      rm(workspaceRoot, {
        force: true,
        recursive: true,
      }),
      ...(codexWorkspaceRoot ? [rm(codexWorkspaceRoot, {
        force: true,
        recursive: true,
      })] : []),
    ]);
  }
}

export function resolveHostedContainerCodexSmokeHomeRoot(
  source: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const base = normalizeAbsoluteHostedContainerPath(source.HOSTED_HOME)
    ?? normalizeAbsoluteHostedContainerPath(source.HOME)
    ?? normalizeAbsoluteHostedContainerPath(homedir());
  if (!base) {
    throw new Error("Hosted Codex shell smoke requires an absolute runner home directory.");
  }
  const smokeHomeRoot = path.join(base, HOSTED_CONTAINER_CODEX_SMOKE_HOME_DIRECTORY);
  if (isPathInside(smokeHomeRoot, tmpdir())) {
    throw new Error("Hosted Codex shell smoke CODEX_HOME parent must not be under the system temporary directory.");
  }
  return smokeHomeRoot;
}

function normalizeAbsoluteHostedContainerPath(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || !path.isAbsolute(normalized)) {
    return null;
  }
  return path.resolve(normalized);
}

function isPathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function buildHostedContainerCodexShellSmokeConfig(model: string): string {
  const modelCatalogJson = readHostedCodexModelCatalogJsonPath();

  return [
    `model = ${JSON.stringify(model)}`,
    ...(modelCatalogJson
      ? [`model_catalog_json = ${JSON.stringify(modelCatalogJson)}`]
      : []),
    'model_provider = "hosted-shell-smoke"',
    'model_reasoning_effort = "low"',
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    "check_for_update_on_startup = false",
    // Mirror the hosted runtime config: non-login shells so the smoke probe
    // exercises the same PATH semantics as production turns.
    "allow_login_shell = false",
    "",
    "[features]",
    "plugins = false",
    "multi_agent_v2 = true",
    "",
    '[model_providers."hosted-shell-smoke"]',
    'name = "OpenAI"',
    'base_url = "https://api.openai.com/v1"',
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    'requires_openai_auth = false',
    "supports_websockets = false",
    "request_max_retries = 4",
    "stream_max_retries = 5",
    "",
    "[skills]",
    "include_instructions = false",
    "",
    "[skills.bundled]",
    "enabled = false",
    "",
    "[history]",
    'persistence = "none"',
    "",
    "[shell_environment_policy]",
    'inherit = "all"',
    'include_only = ["PATH", "VAULT", "HOME", "CODEX_HOME", "TMPDIR"]',
    "",
    "[shell_environment_policy.set]",
    `PATH = ${JSON.stringify(HOSTED_RUNNER_EXECUTABLE_PATH)}`,
    "",
  ].join("\n");
}

function readHostedCodexModelCatalogJsonPath(): string | null {
  const value = process.env[HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]?.trim();
  return value && value.length > 0 ? value : null;
}

async function runHostedContainerCodexShellAppServerProbe(input: {
  codexHome: string;
  signal: AbortSignal;
  smokeVaultRoot: string;
}): Promise<HostedContainerCodexShellSmokeResult> {
  return await new Promise((resolve, reject) => {
    let stdoutBuffer = "";
    let stderrBytes = 0;
    let settled = false;
    let nextRequestId = 1;
    let timeout: NodeJS.Timeout | null = null;
    let abort: () => void = () => {};
    const pending = new Map<number, {
      label: string;
      reject: (error: Error) => void;
      resolve: (value: Record<string, unknown>) => void;
    }>();
    const child = spawn("codex", ["app-server"], {
      cwd: input.smokeVaultRoot,
      env: buildHostedContainerCodexShellSmokeProcessEnv(input),
      stdio: ["pipe", "pipe", "pipe"],
    });

    const finish = (error?: Error, result?: HostedContainerCodexShellSmokeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      input.signal.removeEventListener("abort", abort);
      for (const request of pending.values()) {
        request.reject(error ?? new Error("Hosted Codex shell smoke stopped."));
      }
      pending.clear();
      try {
        child.stdin.end();
      } catch {
        // Best-effort cleanup for a diagnostic-only smoke process.
      }
      child.kill();
      if (error) {
        reject(error);
        return;
      }
      resolve(result ?? {
        client: "codex-app-server",
        cliSurfaceContractBytes: 0,
        cliSurfaceHotPathProofCount: 0,
        murphPathBytes: 0,
        noteAddBytes: 0,
        stderrBytes,
        vaultCliLlmsBytes: 0,
        vaultCliPathBytes: 0,
        vaultShowBytes: 0,
      });
    };

    const fail = (error: Error): void => {
      finish(error);
    };

    abort = (): void => {
      fail(new Error("Hosted Codex shell smoke aborted."));
    };
    timeout = setTimeout(() => {
      fail(new Error(`Hosted Codex shell smoke timed out. stderrBytes=${stderrBytes}`));
    }, HOSTED_CONTAINER_CODEX_SHELL_SMOKE_TIMEOUT_MS);

    input.signal.addEventListener("abort", abort, { once: true });
    child.stderr?.on("data", (chunk) => {
      stderrBytes += Buffer.byteLength(chunk);
    });
    child.stdout?.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      const lines = stdoutBuffer.split(/\r?\n/u);
      stdoutBuffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          fail(new Error("Hosted Codex shell smoke app-server emitted malformed JSON."));
          return;
        }
        const message = readHostedContainerCodexRpcMessage(parsed);
        if (typeof message.id !== "number") {
          continue;
        }
        const request = pending.get(message.id);
        if (!request) {
          continue;
        }
        pending.delete(message.id);
        if (message.error !== undefined) {
          request.reject(new Error(
            `Hosted Codex shell smoke request failed for ${request.label}. `
              + `errorBytes=${Buffer.byteLength(JSON.stringify(message.error), "utf8")}`,
          ));
          continue;
        }
        request.resolve(message);
      }
    });
    child.once("error", fail);
    child.once("exit", (code, signal) => {
      if (!settled) {
        fail(new Error(
          `Hosted Codex shell smoke app-server exited early with ${code ?? signal ?? "unknown"}. `
            + `stderrBytes=${stderrBytes}`,
        ));
      }
    });

    const sendRequest = (
      label: string,
      method: string,
      params: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      const id = nextRequestId;
      nextRequestId += 1;
      return new Promise((requestResolve, requestReject) => {
        pending.set(id, {
          label,
          reject: requestReject,
          resolve: requestResolve,
        });
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
          if (!error) {
            return;
          }
          pending.delete(id);
          requestReject(error);
          fail(new Error(`Hosted Codex shell smoke failed to write ${label}.`));
        });
      });
    };

    const sendNotification = (method: string, params: Record<string, unknown>): void => {
      child.stdin.write(`${JSON.stringify({ method, params })}\n`);
    };

    const execCommand = async (
      label: string,
      command: readonly string[],
    ): Promise<HostedContainerCodexCommandExecResult> => {
      const message = await sendRequest(label, "command/exec", {
        command,
        timeoutMs: 15_000,
      });
      const result = readHostedContainerCodexCommandExecResult(message.result);
      if (result.exitCode !== 0) {
        throw new Error(
          `Hosted Codex shell smoke command failed for ${label}. `
            + `exitCode=${result.exitCode} stdoutBytes=${Buffer.byteLength(result.stdout, "utf8")} `
            + `stderrBytes=${Buffer.byteLength(result.stderr, "utf8")}`,
        );
      }
      return result;
    };

    void (async () => {
      await sendRequest("initialize", "initialize", {
        clientInfo: {
          name: "hosted-codex-shell-smoke",
          version: "1",
        },
      });
      sendNotification("initialized", {});
      const environmentProbe = readHostedContainerCodexShellEnvironmentProbe(
        (await execCommand("environment-probe", [
          "node",
          "-e",
          buildHostedContainerCodexShellEnvironmentProbeScript(),
          input.smokeVaultRoot,
        ])).stdout,
      );
      const vaultCliLlms = await execCommand("vault-cli-llms", [
        "vault-cli",
        "--llms",
        "--format",
        "json",
      ]);
      const cliSurface = await runHostedContainerCliSurfaceContractSmoke();
      const vaultShow = await execCommand("vault-show", [
        "vault-cli",
        "vault",
        "show",
        "--format",
        "json",
      ]);
      const noteAdd = await execCommand("event-note-add", [
        "vault-cli",
        "event",
        "note",
        "add",
        "--note",
        "Hosted deploy smoke note",
        "--format",
        "json",
      ]);
      finish(undefined, {
        client: "codex-app-server",
        cliSurfaceContractBytes: cliSurface.contractBytes,
        cliSurfaceHotPathProofCount: cliSurface.hotPathProofCount,
        murphPathBytes: environmentProbe.murphPathBytes,
        noteAddBytes: Buffer.byteLength(noteAdd.stdout, "utf8"),
        stderrBytes,
        vaultCliLlmsBytes: Buffer.byteLength(vaultCliLlms.stdout, "utf8"),
        vaultCliPathBytes: environmentProbe.vaultCliPathBytes,
        vaultShowBytes: Buffer.byteLength(vaultShow.stdout, "utf8"),
      });
    })().catch((error: unknown) => {
      fail(error instanceof Error ? error : new Error("Hosted Codex shell smoke failed."));
    });
  });
}

async function runHostedContainerCliSurfaceContractSmoke(): Promise<{
  contractBytes: number;
  hotPathProofCount: number;
}> {
  // Deploy-smoke-only modules: loaded lazily so the cold-boot job path never
  // pays their module-evaluation cost.
  const [
    { readHostedAssistantCliSurfaceBootstrapContext },
    {
      HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT,
      countAssistantCliSurfaceHotPathProofs,
    },
  ] = await Promise.all([
    import("@murphai/assistant-runtime/hosted-assistant-bootstrap"),
    import("./hosted-runner-smoke-contract.ts"),
  ]);
  const contract = await readHostedAssistantCliSurfaceBootstrapContext();
  if (!contract) {
    throw new Error("Hosted Codex shell smoke assistant CLI surface contract was missing.");
  }

  const hotPathProofCount = countAssistantCliSurfaceHotPathProofs(contract);
  if (hotPathProofCount < HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT) {
    throw new Error(
      `Hosted Codex shell smoke assistant CLI surface contract was missing hot-path schemas. proofCount=${hotPathProofCount}`,
    );
  }

  return {
    contractBytes: Buffer.byteLength(contract, "utf8"),
    hotPathProofCount,
  };
}

function buildHostedContainerCodexShellSmokeProcessEnv(input: {
  codexHome: string;
  liveProviderEgress?: boolean;
  smokeVaultRoot: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    CODEX_HOME: input.codexHome,
    HOME: path.dirname(input.smokeVaultRoot),
    // The live-turn smoke sends the well-known injected-credential
    // placeholder so the Worker egress intercept swaps in the real key,
    // exactly like production turns. The app-server shell smoke keeps a
    // local-only fake instead, proving no provider credential reaches its
    // command env.
    OPENAI_API_KEY: input.liveProviderEgress
      ? HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL
      : "hosted-codex-shell-smoke-secret",
    PATH: buildHostedRunnerExecutablePath(process.env.PATH),
    TMPDIR: path.dirname(input.smokeVaultRoot),
    VAULT: input.smokeVaultRoot,
  };

  if (input.liveProviderEgress) {
    // codex must trust the Cloudflare container egress-interception CA to
    // reach api.openai.com through the Worker.
    for (const key of HOSTED_RUNNER_CONTAINER_CA_ENV_KEYS) {
      copyOptionalHostedContainerSmokeEnv(env, key);
    }
  }
  copyOptionalHostedContainerSmokeEnv(env, "CI");
  copyOptionalHostedContainerSmokeEnv(env, "COLORTERM");
  copyOptionalHostedContainerSmokeEnv(env, "FORCE_COLOR");
  copyOptionalHostedContainerSmokeEnv(env, "LANG");
  copyOptionalHostedContainerSmokeEnv(env, "LC_ALL");
  copyOptionalHostedContainerSmokeEnv(env, "LC_CTYPE");
  copyOptionalHostedContainerSmokeEnv(env, "NO_COLOR");
  copyOptionalHostedContainerSmokeEnv(env, "TERM");
  return env;
}

function buildHostedContainerCodexShellEnvironmentProbeScript(): string {
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
process.stdout.write(JSON.stringify({
  murphPathBytes: Buffer.byteLength(findExecutable("murph"), "utf8"),
  providerCredentialPresent: Boolean(process.env.OPENAI_API_KEY),
  vaultCliPathBytes: Buffer.byteLength(findExecutable("vault-cli"), "utf8"),
  vaultRootInherited: process.env.VAULT === expectedVaultRoot,
}));
`;
}

function readHostedContainerCodexShellEnvironmentProbe(stdout: string): {
  murphPathBytes: number;
  vaultCliPathBytes: number;
} {
  const record = readHostedContainerJsonObject(stdout, "Hosted Codex shell environment probe");
  const murphPathBytes = readHostedContainerPositiveNumber(
    record.murphPathBytes,
    "Hosted Codex shell environment probe.murphPathBytes",
  );
  const vaultCliPathBytes = readHostedContainerPositiveNumber(
    record.vaultCliPathBytes,
    "Hosted Codex shell environment probe.vaultCliPathBytes",
  );
  if (record.vaultRootInherited !== true) {
    throw new Error("Hosted Codex shell smoke did not inherit VAULT.");
  }
  if (record.providerCredentialPresent === true) {
    throw new Error("Hosted Codex shell smoke leaked provider credentials into command env.");
  }
  return {
    murphPathBytes,
    vaultCliPathBytes,
  };
}

function readHostedContainerCodexRpcMessage(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted Codex shell smoke RPC message must be an object.");
  }
  return value as Record<string, unknown>;
}

function readHostedContainerCodexCommandExecResult(
  value: unknown,
): HostedContainerCodexCommandExecResult {
  const record = readHostedContainerRecord(value, "Hosted Codex command result");
  const exitCode = record.exitCode;
  const stdout = record.stdout;
  const stderr = record.stderr;
  if (typeof exitCode !== "number" || !Number.isSafeInteger(exitCode)) {
    throw new TypeError("Hosted Codex command result.exitCode must be an integer.");
  }
  if (typeof stdout !== "string") {
    throw new TypeError("Hosted Codex command result.stdout must be a string.");
  }
  if (typeof stderr !== "string") {
    throw new TypeError("Hosted Codex command result.stderr must be a string.");
  }
  return {
    exitCode,
    stderr,
    stdout,
  };
}

function readHostedContainerJsonObject(
  value: string,
  label: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new SyntaxError(`${label} was not valid JSON.`);
  }
  return readHostedContainerRecord(parsed, label);
}

function readHostedContainerRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readHostedContainerPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive number.`);
  }
  return value;
}

function copyOptionalHostedContainerSmokeEnv(
  target: NodeJS.ProcessEnv,
  name: string,
): void {
  const value = process.env[name];
  if (typeof value === "string" && value.length > 0) {
    target[name] = value;
  }
}

export const hostedContainerHeavyRuntime: HostedContainerHeavyRuntimeCore = {
  buildLiveModelTurnSmokeSafeText: buildHostedContainerLiveModelTurnSmokeSafeText,
  deployLiveModelTurnSmokeModel: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
  async drainFatalRuntimeBestEffort(input) {
    await Promise.allSettled([
      drainHostedAssistantDeliveryControlPlaneWritesBestEffort(),
      drainHostedRuntimeLogWritesBestEffort(),
      drainHostedRuntimeDeferredUsageCompletionsBestEffort({
        closeActiveCaptures: true,
        timeoutMs: input.timeoutMs,
      }),
    ]);
  },
  async drainShutdownRuntimeBestEffort(input) {
    await drainHostedRuntimeDeferredUsageCompletionsBestEffort({
      timeoutMs: input.timeoutMs,
    });
  },
  runCodexShellSmoke: runHostedContainerCodexShellSmoke,
  runDirectR2PresignedPutSmoke: runHostedContainerDirectR2PresignedPutSmoke,
  runLiveModelTurnSmoke: runHostedContainerLiveModelTurnSmoke,
  runWorkspaceInvocation: runHostedWorkspaceInvocation,
};
