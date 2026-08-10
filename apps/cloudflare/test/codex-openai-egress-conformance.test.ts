import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { executeCodexAppServerTurn } from "@murphai/assistant-engine/assistant-codex";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hostedRunnerIntercept,
} from "../src/runner-egress-intercept.ts";
import {
  createHostedProviderEgressCredential,
} from "../src/hosted-provider-egress-credential.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "../src/runner-outbound.ts";
import type {
  WorkerProviderEgressCredentialValidationResult,
} from "../src/worker-contracts.ts";
import {
  PINNED_CODEX_OPENAI_EGRESS_INVENTORY,
  type PinnedCodexOpenAiEgressRoute,
} from "./fixtures/codex-openai-egress-routes.ts";
import {
  discoverCodexBinaryRouteCandidates,
} from "./helpers/codex-binary-route-inventory.ts";
import {
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.ts";

const PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET =
  "codex-route-conformance-signing-secret";
const RUNNER_CONTAINER_NAME = "member_123--v-version_1";
const TEST_USER_ID = "member_123";
const SCRIPTED_MODEL = "gpt-5.6-terra";
const SCRIPTED_PROVIDER_ENV = "MURPH_CODEX_ROUTE_CONFORMANCE_KEY";
const TEST_TIMEOUT_MS = 90_000;
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("pinned Codex OpenAI egress conformance", () => {
  it("couples the reviewed route inventory to every shipped Codex version owner", async () => {
    const assistantPackage = JSON.parse(await readFile(
      path.join(repoRoot, "packages/assistant-engine/package.json"),
      "utf8",
    )) as {
      devDependencies?: Record<string, string>;
    };
    const baseDockerfile = await readFile(
      path.join(repoRoot, "Dockerfile.cloudflare-hosted-runner-base"),
      "utf8",
    );
    const workspace = await readFile(
      path.join(repoRoot, "pnpm-workspace.yaml"),
      "utf8",
    );
    const installedPackage = JSON.parse(await readFile(
      path.join(
        repoRoot,
        "packages/assistant-engine/node_modules/@openai/codex/package.json",
      ),
      "utf8",
    )) as { version?: string };
    const expectedVersion = PINNED_CODEX_OPENAI_EGRESS_INVENTORY.version;

    expect(assistantPackage.devDependencies?.["@openai/codex"])
      .toBe(expectedVersion);
    expect(installedPackage.version).toBe(expectedVersion);
    expect(baseDockerfile).toContain(`ARG CODEX_CLI_VERSION=${expectedVersion}`);
    expect(workspace).toContain(`'@openai/codex@${expectedVersion}||`);
    expect(PINNED_CODEX_OPENAI_EGRESS_INVENTORY.upstreamTag)
      .toBe(`rust-v${expectedVersion}`);
    expect(PINNED_CODEX_OPENAI_EGRESS_INVENTORY.upstreamCommit)
      .toMatch(/^[0-9a-f]{40}$/u);
  });

  it("keeps every route disposition unique and tied to reviewed source provenance", () => {
    const reviewedSources = new Set<string>(
      PINNED_CODEX_OPENAI_EGRESS_INVENTORY.reviewedSources,
    );
    const routeKeys = PINNED_CODEX_OPENAI_EGRESS_INVENTORY.routes.map((route) =>
      `${route.method} ${route.pathname} ${route.transport}`
    );

    expect(new Set(routeKeys).size).toBe(routeKeys.length);
    for (const route of PINNED_CODEX_OPENAI_EGRESS_INVENTORY.routes) {
      expect(reviewedSources.has(route.source), route.feature).toBe(true);
    }
    for (const route of PINNED_CODEX_OPENAI_EGRESS_INVENTORY.chatGptAuthOnlyRoutes) {
      expect(reviewedSources.has(route.source), route.feature).toBe(true);
    }
    expect(PINNED_CODEX_OPENAI_EGRESS_INVENTORY.routes
      .filter((route) => route.pathname.startsWith("/v1/images/"))
      .map((route) => route.owner))
      .toEqual(["murph", "murph"]);
  });

  it("requires an explicit disposition for every installed Codex binary route candidate", async () => {
    const binary = await readFile(resolveInstalledCodexBinary());
    const discovered = discoverCodexBinaryRouteCandidates(binary);
    const classified = new Set<string>([
      ...PINNED_CODEX_OPENAI_EGRESS_INVENTORY.routes.map((route) =>
        route.pathname === "/v1/live/rtc_route_contract"
          ? "/v1/live"
          : route.pathname
      ),
      ...PINNED_CODEX_OPENAI_EGRESS_INVENTORY.nonProviderBinaryCandidates
        .map((entry) => entry.candidate),
    ]);

    expect(discovered.length).toBeGreaterThan(0);
    expect(discovered).toContain("/v1/alpha/search");
    expect(discovered).toContain("/v1/responses");
    expect(discovered.filter((candidate) => !classified.has(candidate)))
      .toEqual([]);
  });

  it("retains an unknown full route as an unclassified scanner candidate", () => {
    const discovered = discoverCodexBinaryRouteCandidates(Buffer.from([
      ...Buffer.from("prefix/v1/future_route/items"),
      0,
      ...Buffer.from("suffix"),
    ]));

    expect(discovered).toContain("/v1/future_route/items");
  });

  it("keeps every reviewed route aligned with the production Worker decision", async () => {
    const credential = await createTestProviderEgressCredential();
    const validateRuntimeProviderEgressCredential = vi.fn(
      createProviderCredentialValidationResult,
    );
    const env = createOpenAiInterceptEnv({
      validateRuntimeProviderEgressCredential,
    });
    const upstreamFetch = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", upstreamFetch);

    for (const route of PINNED_CODEX_OPENAI_EGRESS_INVENTORY.routes) {
      const upstreamCallsBefore = upstreamFetch.mock.calls.length;
      const validationsBefore = validateRuntimeProviderEgressCredential.mock.calls.length;
      const response = await hostedRunnerIntercept(
        createInventoryRequest(route, credential),
        env,
        { containerId: "opaque-container-id" },
      );

      if (route.disposition === "blocked") {
        expect(response.status, `${route.method} ${route.pathname}`).toBe(403);
        expect(upstreamFetch.mock.calls.length, route.feature)
          .toBe(upstreamCallsBefore);
        expect(validateRuntimeProviderEgressCredential.mock.calls.length, route.feature)
          .toBe(validationsBefore);
        continue;
      }

      expect(response.status, `${route.method} ${route.pathname}`).toBe(200);
      expect(upstreamFetch.mock.calls.length, route.feature)
        .toBe(upstreamCallsBefore + 1);
      expect(validateRuntimeProviderEgressCredential.mock.calls.length, route.feature)
        .toBe(validationsBefore + 1);
      const forwarded = upstreamFetch.mock.calls.at(-1)?.[0];
      expect(forwarded, route.feature).toBeInstanceOf(Request);
      const forwardedRequest = forwarded as Request;
      expect(new URL(forwardedRequest.url).pathname).toBe(route.pathname);
      expect(forwardedRequest.headers.get("authorization"))
        .toBe("Bearer openai-worker-secret");
    }
  });

  it("does not treat the reviewed Responses websocket route as ordinary GET egress", async () => {
    const credential = await createTestProviderEgressCredential();
    const validateRuntimeProviderEgressCredential = vi.fn(
      createProviderCredentialValidationResult,
    );
    const upstreamFetch = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        headers: { authorization: `Bearer ${credential}` },
        method: "GET",
      }),
      createOpenAiInterceptEnv({ validateRuntimeProviderEgressCredential }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeProviderEgressCredential).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("drives real pinned Codex responses and web search through the production Worker", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const temporaryRoot = await mkdtemp(
      path.join(resolveVitestTempRoot(), "codex-route-conformance-"),
    );
    const codexHome = path.join(temporaryRoot, "codex-home");
    const workingDirectory = path.join(temporaryRoot, "workspace");
    const credential = await createTestProviderEgressCredential();
    const forwardedRequests: Array<{
      body: string;
      headers: Headers;
      method: string;
      url: string;
    }> = [];
    let responsesRequestCount = 0;
    const upstreamFetch = vi.fn<typeof fetch>(async (input, init) => {
      const request = input instanceof Request
        ? input.clone()
        : new Request(input, init);
      forwardedRequests.push({
        body: await request.clone().text(),
        headers: new Headers(request.headers),
        method: request.method,
        url: request.url,
      });
      const pathname = new URL(request.url).pathname;

      if (pathname === "/v1/alpha/search") {
        return Response.json({
          encrypted_output: null,
          output: "Synthetic route-conformance search result.",
          results: [],
        });
      }
      if (pathname === "/v1/responses") {
        responsesRequestCount += 1;
        return responsesRequestCount === 1
          ? createScriptedResponsesSse({
              arguments: JSON.stringify({
                search_query: [{ q: "synthetic route conformance" }],
              }),
              call_id: "call_route_conformance_search",
              id: "function_route_conformance_search",
              name: "run",
              namespace: "web",
              status: "completed",
              type: "function_call",
            }, "resp_route_conformance_search")
          : createScriptedResponsesSse({
              content: [{
                annotations: [],
                text: "CODEX_ROUTE_CONFORMANCE_OK",
                type: "output_text",
              }],
              id: "message_route_conformance_done",
              role: "assistant",
              status: "completed",
              type: "message",
            }, "resp_route_conformance_done");
      }
      return new Response(`Unexpected upstream route ${request.method} ${pathname}`, {
        status: 500,
      });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    try {
      await Promise.all([
        mkdir(codexHome, { recursive: true }),
        mkdir(workingDirectory, { recursive: true }),
      ]);
      const bridge = await startCodexWorkerBridge({
        env: createOpenAiInterceptEnv({
          validateRuntimeProviderEgressCredential: async (input) =>
            createProviderCredentialValidationResult(input),
        }),
      });
      try {
        await writeFile(
          path.join(codexHome, "config.toml"),
          buildCodexRouteConformanceConfig(bridge.baseUrl),
          { encoding: "utf8", mode: 0o600 },
        );
        const result = await executeCodexAppServerTurn({
          baseInstructions: "Use the available web search tool when requested.",
          codexCommand: resolveCodexCommand(),
          codexHome,
          dynamicTools: [],
          env: {
            [SCRIPTED_PROVIDER_ENV]: credential,
            HOME: process.env.HOME,
            PATH: process.env.PATH,
            TMPDIR: process.env.TMPDIR,
          },
          model: SCRIPTED_MODEL,
          modelProvider: "route-conformance",
          processLifetime: "one-shot",
          prompt: "Search for the synthetic route-conformance result, then answer.",
          reasoningEffort: "low",
          sandbox: "workspace-write",
          workingDirectory,
        });

        expect(result.finalMessage).toBe("CODEX_ROUTE_CONFORMANCE_OK");
        expect(forwardedRequests.map((request) => ({
          method: request.method,
          pathname: new URL(request.url).pathname,
        }))).toEqual([
          { method: "POST", pathname: "/v1/responses" },
          { method: "POST", pathname: "/v1/alpha/search" },
          { method: "POST", pathname: "/v1/responses" },
        ]);
        for (const request of forwardedRequests) {
          expect(request.headers.get("authorization"))
            .toBe("Bearer openai-worker-secret");
        }
        const searchRequest = forwardedRequests.find((request) =>
          new URL(request.url).pathname === "/v1/alpha/search"
        );
        expect(searchRequest).toBeDefined();
        expect(JSON.parse(searchRequest?.body ?? "{}"))
          .toMatchObject({
            commands: {
              search_query: [{ q: "synthetic route conformance" }],
            },
            model: SCRIPTED_MODEL,
            settings: {
              allowed_callers: ["direct"],
            },
          });
      } finally {
        await bridge.close();
      }
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });
});

function resolveVitestTempRoot(): string {
  const root = process.env.MURPH_VITEST_TEMP_ROOT?.trim();
  if (!root) {
    throw new Error("Codex route conformance requires the marked Vitest temp root.");
  }
  return root;
}

function resolveInstalledCodexBinary(): string {
  const target = resolveCodexTarget();
  const platformPackage = `@openai/codex-${target.packageSuffix}`;
  const requireFromCodex = createRequire(
    path.join(repoRoot, "packages/assistant-engine/node_modules/@openai/codex/package.json"),
  );
  const platformPackageJson = requireFromCodex.resolve(`${platformPackage}/package.json`);
  return path.join(
    path.dirname(platformPackageJson),
    "vendor",
    target.triple,
    "bin",
    process.platform === "win32" ? "codex.exe" : "codex",
  );
}

function resolveCodexCommand(): string {
  return path.join(
    repoRoot,
    "packages/assistant-engine/node_modules/.bin",
    process.platform === "win32" ? "codex.cmd" : "codex",
  );
}

function resolveCodexTarget(): { packageSuffix: string; triple: string } {
  const key = `${process.platform}-${process.arch}`;
  const targets: Record<string, { packageSuffix: string; triple: string }> = {
    "darwin-arm64": {
      packageSuffix: "darwin-arm64",
      triple: "aarch64-apple-darwin",
    },
    "darwin-x64": {
      packageSuffix: "darwin-x64",
      triple: "x86_64-apple-darwin",
    },
    "linux-arm64": {
      packageSuffix: "linux-arm64",
      triple: "aarch64-unknown-linux-musl",
    },
    "linux-x64": {
      packageSuffix: "linux-x64",
      triple: "x86_64-unknown-linux-musl",
    },
    "win32-arm64": {
      packageSuffix: "win32-arm64",
      triple: "aarch64-pc-windows-msvc",
    },
    "win32-x64": {
      packageSuffix: "win32-x64",
      triple: "x86_64-pc-windows-msvc",
    },
  };
  const target = targets[key];
  if (!target) {
    throw new Error(`Unsupported Codex conformance test platform ${key}.`);
  }
  return target;
}

function createInventoryRequest(
  route: PinnedCodexOpenAiEgressRoute,
  credential: string,
): Request {
  const headers = new Headers({
    authorization: `Bearer ${credential}`,
  });
  if (route.transport === "websocket") {
    headers.set("connection", "Upgrade");
    headers.set("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==");
    headers.set("sec-websocket-version", "13");
    headers.set("upgrade", "websocket");
  }
  const body = buildInventoryRequestBody(route, headers);
  return new Request(`https://api.openai.com${route.pathname}`, {
    ...(body === undefined ? {} : { body }),
    headers,
    method: route.method,
  });
}

function buildInventoryRequestBody(
  route: PinnedCodexOpenAiEgressRoute,
  headers: Headers,
): BodyInit | undefined {
  if (route.method !== "POST") {
    return undefined;
  }
  if (route.pathname === "/v1/images/edits") {
    const form = new FormData();
    form.set("model", "gpt-image-2");
    form.set("prompt", "Synthetic route contract image edit.");
    form.set("image", new Blob([new Uint8Array([1, 2, 3])], {
      type: "image/png",
    }), "contract.png");
    return form;
  }
  headers.set("content-type", "application/json");
  return JSON.stringify({
    input: "synthetic route contract",
    model: SCRIPTED_MODEL,
    stream: true,
  });
}

async function createTestProviderEgressCredential(): Promise<string> {
  return await createHostedProviderEgressCredential({
    providerKind: "openai",
    runnerContainerName: RUNNER_CONTAINER_NAME,
    source: {
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET,
    },
    userId: TEST_USER_ID,
  });
}

function createProviderCredentialValidationResult(input: {
  userId: string;
}): WorkerProviderEgressCredentialValidationResult {
  return {
    attemptId: "attempt_codex_route_conformance",
    leaseGeneration: "7",
    owns: true,
    userId: input.userId,
    workspaceVersion: "4",
  };
}

function createOpenAiInterceptEnv(input: {
  validateRuntimeProviderEgressCredential: (input: {
    providerKind: string;
    runnerContainerName: string;
    userId: string;
  }) => Promise<WorkerProviderEgressCredentialValidationResult>
    | WorkerProviderEgressCredentialValidationResult;
}): RunnerOutboundEnvironmentSource {
  return {
    ...createHostedExecutionTestEnv(),
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
      PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET,
    OPENAI_API_KEY: "openai-worker-secret",
    USER_RUNNER: {
      getByName: () => ({
        validateRuntimeProviderEgressCredential: async (validationInput) =>
          await input.validateRuntimeProviderEgressCredential(validationInput),
        validateRuntimeProviderEgressToken: async () => ({ owns: false }),
        validateRuntimeWriteFence: async () => false,
      }),
    },
  };
}

async function startCodexWorkerBridge(input: {
  env: RunnerOutboundEnvironmentSource;
}): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    void forwardCodexRequestThroughWorker(request, response, input.env)
      .catch((error: unknown) => {
        response.statusCode = 500;
        response.end(error instanceof Error ? error.message : String(error));
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Codex route bridge did not bind a TCP port.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

async function forwardCodexRequestThroughWorker(
  request: IncomingMessage,
  response: ServerResponse,
  env: RunnerOutboundEnvironmentSource,
): Promise<void> {
  const body = await readIncomingBody(request);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (
      value === undefined
      || name === "connection"
      || name === "content-length"
      || name === "host"
      || name === "transfer-encoding"
    ) {
      continue;
    }
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const requestBody = body.byteLength === 0
    ? undefined
    : Uint8Array.from(body).buffer;
  const intercepted = await hostedRunnerIntercept(
    new Request(`https://api.openai.com${request.url ?? "/"}`, {
      ...(requestBody === undefined ? {} : { body: requestBody }),
      headers,
      method: request.method ?? "GET",
    }),
    env,
    { containerId: "opaque-container-id" },
  );
  response.statusCode = intercepted.status;
  intercepted.headers.forEach((value, name) => {
    if (name !== "content-length" && name !== "transfer-encoding") {
      response.setHeader(name, value);
    }
  });
  response.end(Buffer.from(await intercepted.arrayBuffer()));
}

async function readIncomingBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function buildCodexRouteConformanceConfig(baseUrl: string): string {
  return [
    `model = "${SCRIPTED_MODEL}"`,
    'model_provider = "route-conformance"',
    'model_reasoning_effort = "low"',
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    'web_search = "live"',
    'check_for_update_on_startup = false',
    '',
    '[history]',
    'persistence = "none"',
    '',
    '[features]',
    'standalone_web_search = true',
    '',
    '[model_providers.route-conformance]',
    'name = "Route conformance"',
    `base_url = "${baseUrl}"`,
    `env_key = "${SCRIPTED_PROVIDER_ENV}"`,
    'wire_api = "responses"',
    'requires_openai_auth = false',
    'supports_standalone_web_search = true',
    'supports_websockets = false',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join("\n");
}

function createScriptedResponsesSse(
  outputItem: Record<string, unknown>,
  responseId: string,
): Response {
  const usage = {
    input_tokens: 12,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 7,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 19,
  };
  const completedResponse = {
    created_at: Math.floor(Date.now() / 1_000),
    id: responseId,
    model: SCRIPTED_MODEL,
    output: [outputItem],
    status: "completed",
    usage,
  };
  const events = [
    ["response.created", {
      response: { ...completedResponse, output: [], status: "in_progress" },
      type: "response.created",
    }],
    ["response.output_item.added", {
      item: { ...outputItem, status: "in_progress" },
      output_index: 0,
      type: "response.output_item.added",
    }],
    ["response.output_item.done", {
      item: outputItem,
      output_index: 0,
      type: "response.output_item.done",
    }],
    ["response.completed", {
      response: completedResponse,
      type: "response.completed",
    }],
  ] as const;
  const body = events.map(([event, payload]) =>
    `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
  ).join("") + "data: [DONE]\n\n";
  return new Response(body, {
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream; charset=utf-8",
    },
  });
}
