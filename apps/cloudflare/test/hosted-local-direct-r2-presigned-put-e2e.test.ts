import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";

import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";

const directR2PresignedPutDefaultBytes = 150 * 1024 * 1024;
const directR2PresignedPutTimeoutMs = 420_000;
const directR2PresignedPutPath =
  "/test-bucket/direct-r2-presigned-put-bypasses-worker-body-path";
const hostedRunnerOpenInternetPassthroughMessage =
  "Hosted runner open-internet passthrough forwarded outbound request.";
const hostedRunnerInternalOutboundMessage =
  "Hosted runner internal outbound request received.";
const userId = `member_direct_r2_${randomUUID()}`;
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let scenario: HostedLocalFullStackScenario | null = null;
let r2Stub: DirectR2PresignedPutStub | null = null;

interface DirectR2PresignedPutObservation {
  byteLength: number;
  contentLength: string | null;
  contentType: string | null;
  method: string;
  pathname: string;
  sha256: string;
}

interface DirectR2PresignedPutStub {
  cleanup(): Promise<void>;
  observation: Promise<DirectR2PresignedPutObservation>;
  server: ReturnType<typeof createHttpsServer>;
  tlsCaCertificatePem: string;
}

describe("hosted local direct R2 presigned PUT e2e", () => {
  beforeAll(async () => {
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        MURPH_DEV_SKIP_RUNNER_SMOKE: "1",
        MURPH_DEV_SKIP_WEB: "1",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-direct-r2-presigned-put-",
      requiredRunnerEnvProfile: "assistant",
      scenarioLabel: "Local hosted direct R2 presigned PUT e2e",
      streamLogs: streamDevLogs,
    });
    r2Stub = await startDirectR2PresignedPutStub(
      resolveContainerReachableHost(scenario.harness.workerRuntimeEnv ?? scenario.runtimeEnv),
    );
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await stopDirectR2PresignedPutStub(r2Stub?.server ?? null);
    await r2Stub?.cleanup();
    r2Stub = null;
  }, 120_000);

  it("direct_r2_presigned_put_bypasses_worker_body_path", async () => {
    const activeScenario = requireScenario();
    const activeStub = requireR2Stub();
    const byteLength = readDirectR2PresignedPutByteLength();
    const presignedPutUrl = buildDirectR2PresignedPutUrl({
      env: activeScenario.harness.workerRuntimeEnv ?? activeScenario.runtimeEnv,
      server: activeStub.server,
    });
    const logsBefore = readHostedLocalLogs(activeScenario);

    const result = await activeScenario.harness.requestJson<{
      directR2PresignedPut: {
        byteLength: number | null;
        ok: boolean;
        payloadSha256: string | null;
        status: number | null;
      } | null;
      ok: boolean;
    }>(
      `/__test/users/${encodeURIComponent(userId)}/direct-r2-presigned-put`,
      {
        body: JSON.stringify({
          byteLength,
          presignedPutUrl,
          tlsCaCertificatePem: activeStub.tlsCaCertificatePem,
        }),
        headers: {
          [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
        signal: AbortSignal.timeout(directR2PresignedPutTimeoutMs),
      },
    );
    const observation = await activeStub.observation;
    const logsAfter = readHostedLocalLogs(activeScenario);
    const newLogs = logsAfter.startsWith(logsBefore)
      ? logsAfter.slice(logsBefore.length)
      : logsAfter;

    expect(result.ok).toBe(true);
    expect(result.directR2PresignedPut).toMatchObject({
      byteLength,
      ok: true,
      status: 200,
    });
    expect(result.directR2PresignedPut?.payloadSha256).toBe(observation.sha256);
    expect(observation).toMatchObject({
      byteLength,
      contentLength: String(byteLength),
      contentType: "application/octet-stream",
      ifNoneMatch: "*",
      method: "PUT",
      pathname: directR2PresignedPutPath,
      signedHeaders: "content-type;host;if-none-match",
    });
    expect(newLogs).not.toContain(hostedRunnerOpenInternetPassthroughMessage);
    expect(newLogs).not.toContain("open_internet_passthrough");
    expect(newLogs).not.toContain(hostedRunnerInternalOutboundMessage);
  }, directR2PresignedPutTimeoutMs);
});

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not initialized.");
  }
  return scenario;
}

function requireR2Stub(): DirectR2PresignedPutStub {
  if (!r2Stub) {
    throw new Error("Direct R2 presigned PUT stub was not initialized.");
  }
  return r2Stub;
}

async function startDirectR2PresignedPutStub(
  containerReachableHost: string,
): Promise<DirectR2PresignedPutStub> {
  let resolveObservation: (value: DirectR2PresignedPutObservation) => void = () => {};
  let rejectObservation: (reason?: unknown) => void = () => {};
  const observation = new Promise<DirectR2PresignedPutObservation>((resolve, reject) => {
    resolveObservation = resolve;
    rejectObservation = reject;
  });
  const tls = await createDirectR2PresignedPutTlsMaterial(containerReachableHost);
  const server = createHttpsServer({
    cert: tls.certificatePem,
    key: tls.privateKeyPem,
  }, (request, response) => {
    void handleDirectR2PresignedPutStubRequest(request, response)
      .then(resolveObservation, rejectObservation);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    cleanup: async () => {
      await rm(tls.directory, { force: true, recursive: true });
    },
    observation,
    server,
    tlsCaCertificatePem: tls.certificatePem,
  };
}

async function createDirectR2PresignedPutTlsMaterial(
  containerReachableHost: string,
): Promise<{
  certificatePem: string;
  directory: string;
  privateKeyPem: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "murph-direct-r2-presigned-put-tls-"));
  const certificatePath = path.join(directory, "cert.pem");
  const privateKeyPath = path.join(directory, "key.pem");
  const result = spawnSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-keyout",
    privateKeyPath,
    "-out",
    certificatePath,
    "-subj",
    "/CN=direct-r2-presigned-put.local",
    "-addext",
    `subjectAltName=${buildDirectR2PresignedPutSubjectAltNames(containerReachableHost)}`,
  ], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    await rm(directory, { force: true, recursive: true });
    throw new Error("Failed to create direct R2 presigned PUT test certificate with openssl.");
  }

  return {
    certificatePem: await readFile(certificatePath, "utf8"),
    directory,
    privateKeyPem: await readFile(privateKeyPath, "utf8"),
  };
}

function buildDirectR2PresignedPutSubjectAltNames(host: string): string {
  const entries = new Set(["DNS:localhost", "IP:127.0.0.1"]);
  entries.add(/^\d+\.\d+\.\d+\.\d+$/u.test(host) ? `IP:${host}` : `DNS:${host}`);
  return [...entries].join(",");
}

async function handleDirectR2PresignedPutStubRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<DirectR2PresignedPutObservation> {
  const url = new URL(request.url ?? "/", "http://direct-r2-stub.local");
  if (request.method !== "PUT" || url.pathname !== directR2PresignedPutPath) {
    response.statusCode = 404;
    response.end("not found");
    throw new Error(`Unexpected direct R2 presigned PUT stub request: ${request.method ?? "GET"} ${url.pathname}`);
  }

  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    hash.update(buffer);
  }

  const result = {
    byteLength,
    contentLength: readSingleHeader(request.headers["content-length"]),
    contentType: readSingleHeader(request.headers["content-type"]),
    ifNoneMatch: readSingleHeader(request.headers["if-none-match"]),
    method: request.method,
    pathname: url.pathname,
    sha256: hash.digest("hex"),
    signedHeaders: url.searchParams.get("X-Amz-SignedHeaders"),
  };
  response.statusCode = 200;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end("ok");
  return result;
}

function buildDirectR2PresignedPutUrl(input: {
  env: NodeJS.ProcessEnv;
  server: ReturnType<typeof createHttpsServer>;
}): string {
  const host = resolveContainerReachableHost(input.env);
  const port = requireBoundTcpPort(input.server, "direct R2 presigned PUT stub");
  const url = new URL(`https://${host}:${port}${directR2PresignedPutPath}`);
  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", "direct-r2-test/20260519/auto/r2/aws4_request");
  url.searchParams.set("X-Amz-Date", "20260519T000000Z");
  url.searchParams.set("X-Amz-Expires", "300");
  url.searchParams.set("X-Amz-SignedHeaders", "content-type;host;if-none-match");
  url.searchParams.set("X-Amz-Signature", "direct-r2-test-signature");
  return url.href;
}

function resolveContainerReachableHost(env: NodeJS.ProcessEnv): string {
  const configured = env.HOSTED_EXECUTION_RUNNER_HOST_ALIAS?.trim();
  if (configured) {
    return configured;
  }
  if (process.platform !== "linux") {
    return "host.docker.internal";
  }
  const result = spawnSync("docker", [
    "network",
    "inspect",
    "bridge",
    "--format",
    "{{range .IPAM.Config}}{{.Gateway}}{{end}}",
  ], {
    encoding: "utf8",
  });
  const gateway = result.status === 0 ? result.stdout.trim() : "";
  if (gateway) {
    return gateway;
  }
  throw new Error(
    "Hosted local direct R2 test needs HOSTED_EXECUTION_RUNNER_HOST_ALIAS on this platform.",
  );
}

function readDirectR2PresignedPutByteLength(): number {
  const raw = process.env.MURPH_E2E_DIRECT_R2_PRESIGNED_PUT_BYTES?.trim();
  if (!raw) {
    return directR2PresignedPutDefaultBytes;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("MURPH_E2E_DIRECT_R2_PRESIGNED_PUT_BYTES must be a positive integer.");
  }
  return parsed;
}

function readHostedLocalLogs(activeScenario: HostedLocalFullStackScenario): string {
  return [
    activeScenario.harness.stdoutTail(2_000_000),
    activeScenario.harness.stderrTail(2_000_000),
  ].join("\n");
}

function requireBoundTcpPort(
  server: ReturnType<typeof createHttpsServer>,
  label: string,
): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error(`Expected the ${label} server to bind a TCP port.`);
  }

  return address.port;
}

async function stopDirectR2PresignedPutStub(
  server: ReturnType<typeof createHttpsServer> | null,
): Promise<void> {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

function readSingleHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === "string" ? value : null;
}
