import { describe, expect, it, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  handleHostedRunnerInternalOutbound,
  handleHostedRunnerLinqOutbound,
  handleHostedRunnerMapboxOutbound,
  handleHostedRunnerOpenAiOutbound,
  handleHostedRunnerOpenInternetOutbound,
  handleHostedRunnerTelegramOutbound,
  handleHostedRunnerWhatsAppOutbound,
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
  HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS,
  HOSTED_RUNNER_OUTBOUND_BY_HOST,
  hostedRunnerIntercept,
} from "../src/runner-egress-intercept.ts";
import {
  HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH,
} from "../src/runner-effects-contract.ts";
import {
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../src/runner-outbound/headers.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "../src/runner-outbound.ts";
import {
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.ts";

const WRITE_FENCE_HEADERS = {
  [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "attempt_1",
  [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "7",
  [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: "4",
} as const;
const BOUND_USER_WRITE_FENCE_HEADERS = {
  ...WRITE_FENCE_HEADERS,
  [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
} as const;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("hostedRunnerIntercept", () => {
  it("maps default provider and internal hosts to Cloudflare per-host outbound handlers", () => {
    expect(hostedRunnerIntercept).toBe(handleHostedRunnerOpenInternetOutbound);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST[HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.openAi])
      .toBe(handleHostedRunnerOpenAiOutbound);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST[HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.mapbox])
      .toBe(handleHostedRunnerMapboxOutbound);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST[HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.linq])
      .toBe(handleHostedRunnerLinqOutbound);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST[HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.telegram])
      .toBe(handleHostedRunnerTelegramOutbound);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST[HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.whatsApp])
      .toBe(handleHostedRunnerWhatsAppOutbound);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST[HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.webControlPlane])
      .toBe(handleHostedRunnerInternalOutbound);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST["unexpected.example.test"]).toBeUndefined();
  });

  it("preserves runtime write-fence headers for internal intercepted requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ok: true,
      result: {
        file_id: "telegram_file_123",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request(`http://results.worker${HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH}`, {
        body: JSON.stringify({
          fileId: "telegram_file_123",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
          [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "7",
          "x-hosted-runtime-workspace-version": "42",
        },
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "42",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects internal virtual-host requests without a runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("http://web-control.worker/internal/hosted-runtime/mailbox-payload/decode", {
        headers: {
          [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
        },
        method: "POST",
      }),
      createInterceptEnv({}),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes internal web-control workspace reads without a top-level write-fence check", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      fetchedAt: "2026-05-12T00:00:00.000Z",
      workspace: null,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => {
      throw new Error("workspace reads should be owned by the web-control handler");
    });

    const response = await hostedRunnerIntercept(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_PATH}`, {
        headers: {
          [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
        },
        method: "GET",
      }),
      createInterceptEnv({ validateRuntimeWriteFence }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          boundUserIdHeaderPresent: true,
          containerIdPresent: true,
          hostKind: "web_control_plane",
          method: "GET",
          operation: "workspace_read",
          runtimeAuthorityHeadersPresent: false,
        }),
        message: "Hosted runner internal outbound request received.",
        phase: "wake.running",
      }),
    );
  });

  it("logs unexpected internal outbound methods with a fixed method vocabulary", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_PATH}`, {
        headers: {
          [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
        },
        method: "SECRET123",
      }),
      createInterceptEnv({}),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          method: "other",
          operation: "web_control_blocked",
        }),
        message: "Hosted runner internal outbound request received.",
        phase: "wake.running",
      }),
    );
    expect(JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls)).not.toContain(
      "SECRET123",
    );
  });

  it("injects OpenAI authorization with a valid runtime write fence and strips authority headers", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          cookie: "session=user-supplied-cookie",
          "openai-organization": "org_user_supplied",
          "openai-project": "proj_user_supplied",
          "proxy-authorization": "Bearer user-supplied-proxy-token",
          "x-api-key": "user-supplied-api-key",
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.openai.com/v1/responses");
    expect(forwarded.headers.get("authorization")).toBe("Bearer openai-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
    expect(forwarded.headers.has("cookie")).toBe(false);
    expect(forwarded.headers.has("openai-organization")).toBe(false);
    expect(forwarded.headers.has("openai-project")).toBe(false);
    expect(forwarded.headers.has("proxy-authorization")).toBe(false);
    expect(forwarded.headers.has("x-api-key")).toBe(false);
  });

  it("rejects OpenAI credential injection without a valid runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        headers: {
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects OpenAI credential injection outside the canonical HTTPS origin", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    for (const url of [
      "http://api.openai.com/v1/responses",
      "https://api.openai.com:444/v1/responses",
    ]) {
      const response = await hostedRunnerIntercept(
        new Request(url, {
          headers: {
            ...BOUND_USER_WRITE_FENCE_HEADERS,
            authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
          },
          method: "POST",
        }),
        createInterceptEnv({
          OPENAI_API_KEY: "openai-worker-secret",
          validateRuntimeWriteFence,
        }),
        { containerId: "opaque-container-id" },
      );

      expect(response.status).toBe(403);
    }
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects OpenAI provider egress without the sentinel bearer token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        headers: WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows the observed OpenAI models read path", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/models", {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "GET",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.openai.com/v1/models");
    const authorization = forwarded.headers.get("authorization");
    expect(authorization?.startsWith("Bearer ")).toBe(true);
    expect(authorization?.slice("Bearer ".length)).toBe("openai-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
  });

  it("injects OpenAI authorization for Codex auto-compaction requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses/compact", {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.openai.com/v1/responses/compact");
    expect(forwarded.headers.get("authorization")).toBe("Bearer openai-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("rejects OpenAI paths outside the explicit hosted runner policy", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/chat/completions", {
        body: JSON.stringify({ messages: [] }),
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...WRITE_FENCE_HEADERS,
        },
        method: "POST",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects wrong OpenAI methods on otherwise allowed paths", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        headers: WRITE_FENCE_HEADERS,
        method: "GET",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("injects Mapbox access tokens only for allowed read-only GET path families without a runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request(
        `https://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4?access_token=${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        {
          headers: {
            authorization: "Bearer user-supplied-mapbox-token",
            cookie: "session=user-supplied-cookie",
            "proxy-authorization": "Bearer user-supplied-proxy-token",
            "x-api-key": "user-supplied-api-key",
          },
          method: "GET",
        },
      ),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    const forwarded = readForwardedRequest(fetchMock);
    const forwardedUrl = new URL(forwarded.url);
    expect(forwardedUrl.origin).toBe("https://api.mapbox.com");
    expect(forwardedUrl.pathname).toBe("/directions/v5/mapbox/walking/1,2;3,4");
    expect(forwardedUrl.searchParams.get("access_token")).toBe("mapbox-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
    expect(forwarded.headers.has("authorization")).toBe(false);
    expect(forwarded.headers.has("cookie")).toBe(false);
    expect(forwarded.headers.has("proxy-authorization")).toBe(false);
    expect(forwarded.headers.has("x-api-key")).toBe(false);
  });

  it("still requires the Mapbox sentinel before injecting the Worker token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request(
        "https://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4?access_token=user-token",
        {
          method: "GET",
        },
      ),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Mapbox token injection outside the canonical HTTPS origin", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    for (const url of [
      `http://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4?access_token=${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
      `https://api.mapbox.com:444/directions/v5/mapbox/walking/1,2;3,4?access_token=${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
    ]) {
      const response = await hostedRunnerIntercept(
        new Request(url, {
          headers: BOUND_USER_WRITE_FENCE_HEADERS,
          method: "GET",
        }),
        createInterceptEnv({
          MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
          validateRuntimeWriteFence,
        }),
        { containerId: "opaque-container-id" },
      );

      expect(response.status).toBe(403);
    }
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Mapbox provider egress without the sentinel query parameter", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4", {
        headers: WRITE_FENCE_HEADERS,
        method: "GET",
      }),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Mapbox provider egress outside the explicit allowed path prefixes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request(
        `https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        {
          method: "GET",
        },
      ),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-GET Mapbox requests on otherwise allowed path families", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4", {
        body: JSON.stringify({ coordinates: [] }),
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...WRITE_FENCE_HEADERS,
        },
        method: "POST",
      }),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("strips runtime authority headers and sensitive path metadata from open-internet passthrough egress", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://unexpected.example.test/path/member_123/private-token", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({}),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://unexpected.example.test/path/member_123/private-token");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: {
          host: "unexpected.example.test",
          method: "POST",
          policy: "open_internet_passthrough",
          userIdPresent: true,
        },
        message: "Hosted runner open-internet passthrough forwarded outbound request.",
      }),
    );
    expect(JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls)).not.toContain(
      "member_123",
    );
  });

  it("requires the active write fence before injecting Linq credentials for sends", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.headers.get("authorization")).toBe("Bearer linq-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("requires the active write fence before injecting Linq credentials for reads", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      phone_numbers: [],
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/phone_numbers", {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "GET",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.linqapp.com/api/partner/v3/phone_numbers");
    expect(forwarded.headers.get("authorization")).toBe("Bearer linq-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("honors configured Linq base URL pathname prefixes before validating allowed suffixes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://linq.example.test/custom/tenant/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "https://linq.example.test/custom/tenant/v3/",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://linq.example.test/custom/tenant/v3/chats/chat_1/messages");
    expect(forwarded.headers.get("authorization")).toBe("Bearer linq-worker-secret");
  });

  it("rejects default Linq provider host egress while a custom Linq base is configured", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "https://linq.example.test/custom/tenant/v3",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Linq provider egress without the sentinel bearer token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Linq credential injection on a nonconfigured port for the same provider host", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://linq.example.test:444/custom/tenant/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "https://linq.example.test/custom/tenant/v3",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid configured Linq HTTP base hosts instead of passing them through", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("http://linq.example.com/custom/tenant/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "http://linq.example.com/custom/tenant/v3",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid configured Linq HTTP base hosts across trailing-dot variants", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("http://linq.example.com/custom/tenant/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "http://linq.example.com./custom/tenant/v3",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Linq provider egress for paths outside the configured base URL prefix", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://linq.example.test/api/partner/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "https://linq.example.test/custom/tenant/v3",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Linq writes without a valid runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/chats/chat_1/messages", {
        headers: {
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Linq reads without a valid runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/phone_numbers", {
        headers: {
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "GET",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Telegram token rewriting outside the configured provider origin", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    for (const url of [
      "http://api.telegram.org/bot__cloudflare_injected__/sendMessage",
      "https://api.telegram.org:444/bot__cloudflare_injected__/sendMessage",
    ]) {
      const response = await hostedRunnerIntercept(
        new Request(url, {
          headers: BOUND_USER_WRITE_FENCE_HEADERS,
          method: "POST",
        }),
        createInterceptEnv({
          TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
          validateRuntimeWriteFence,
        }),
        { containerId: "opaque-container-id" },
      );

      expect(response.status).toBe(403);
    }
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows explicitly configured local HTTP Telegram origins", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("http://127.0.0.1:4011/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_API_BASE_URL: "http://127.0.0.1:4011",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("http://127.0.0.1:4011/bottelegram-worker-secret/sendMessage");
  });

  it("treats the hosted-local container host alias as the configured provider origin", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("http://host.docker.internal:4011/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "host.docker.internal",
        TELEGRAM_API_BASE_URL: "http://127.0.0.1:4011",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("http://127.0.0.1:4011/bottelegram-worker-secret/sendMessage");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("rejects invalid configured Telegram HTTP base hosts instead of passing them through", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("http://telegram.example.com/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_API_BASE_URL: "http://telegram.example.com",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honors configured Telegram base URL pathname prefixes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://telegram.example.test/proxy/tenant/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_API_BASE_URL: "https://telegram.example.test/proxy/tenant/",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe(
      "https://telegram.example.test/proxy/tenant/bottelegram-worker-secret/sendMessage",
    );
  });

  it("rejects Telegram provider egress outside the configured base URL prefix", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://telegram.example.test/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_API_BASE_URL: "https://telegram.example.test/proxy/tenant",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rewrites Telegram sentinel tokens before upstream fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/bot__cloudflare_injected__/sendMessage", {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: "Bearer user-supplied-telegram-token",
          cookie: "session=user-supplied-cookie",
          "proxy-authorization": "Bearer user-supplied-proxy-token",
          "x-api-key": "user-supplied-api-key",
        },
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.telegram.org/bottelegram-worker-secret/sendMessage");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
    expect(forwarded.headers.has("authorization")).toBe(false);
    expect(forwarded.headers.has("cookie")).toBe(false);
    expect(forwarded.headers.has("proxy-authorization")).toBe(false);
    expect(forwarded.headers.has("x-api-key")).toBe(false);
  });

  it("maps default Telegram provider host egress to the configured upstream base", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_API_BASE_URL: "https://telegram.example.test",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://telegram.example.test/bottelegram-worker-secret/sendMessage");
  });

  it("requires the active write fence before rewriting Telegram getFile", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/bot__cloudflare_injected__/getFile?file_id=file_1", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "GET",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe(
      "https://api.telegram.org/bottelegram-worker-secret/getFile?file_id=file_1",
    );
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("rejects Telegram provider egress without the sentinel bot token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/botuser_supplied_token/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores malformed Linq base URL config while classifying Telegram egress", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "https://[",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.telegram.org/bottelegram-worker-secret/sendMessage");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("rejects Telegram getFile without a valid runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/bot__cloudflare_injected__/getFile?file_id=file_1", {
        method: "GET",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rewrites WhatsApp sentinel phone ids only for numeric graph versions", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://graph.facebook.com/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence: async () => true,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://graph.facebook.com/v25.0/phone_123/messages");
    expect(forwarded.headers.get("authorization")?.startsWith("Bearer ")).toBe(true);
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("rejects WhatsApp provider egress without the sentinel phone id", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://graph.facebook.com/v25.0/phone_123/messages", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects WhatsApp credential injection without an active runtime fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://graph.facebook.com/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({}),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects WhatsApp credential injection outside the configured provider origin", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    for (const url of [
      "http://graph.facebook.com/v25.0/__cloudflare_injected__/messages",
      "https://graph.facebook.com:444/v25.0/__cloudflare_injected__/messages",
    ]) {
      const response = await hostedRunnerIntercept(
        new Request(url, {
          headers: BOUND_USER_WRITE_FENCE_HEADERS,
          method: "POST",
        }),
        createInterceptEnv({
          WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
          WHATSAPP_PHONE_NUMBER_ID: "phone_123",
          validateRuntimeWriteFence,
        }),
        { containerId: "opaque-container-id" },
      );

      expect(response.status).toBe(403);
    }
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows explicitly configured local HTTP WhatsApp origins", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("http://127.0.0.1:4012/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_API_BASE_URL: "http://127.0.0.1:4012",
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence: async () => true,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("http://127.0.0.1:4012/v25.0/phone_123/messages");
  });

  it("rejects invalid configured WhatsApp HTTP base hosts instead of passing them through", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("http://whatsapp.example.com/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_API_BASE_URL: "http://whatsapp.example.com",
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps default WhatsApp provider host egress to the configured upstream base", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://graph.facebook.com/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_API_BASE_URL: "https://whatsapp.example.test",
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://whatsapp.example.test/v25.0/phone_123/messages");
  });

  it("honors configured WhatsApp base URL pathname prefixes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://whatsapp.example.test/meta/proxy/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_API_BASE_URL: "https://whatsapp.example.test/meta/proxy/",
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://whatsapp.example.test/meta/proxy/v25.0/phone_123/messages");
  });

  it("rejects WhatsApp provider egress outside the configured base URL prefix", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://whatsapp.example.test/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_API_BASE_URL: "https://whatsapp.example.test/meta/proxy",
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects WhatsApp provider egress for malformed graph versions", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://graph.facebook.com/vbeta/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence: async () => true,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function createInterceptEnv(input: {
  HOSTED_EXECUTION_RUNNER_HOST_ALIAS?: string;
  LINQ_API_BASE_URL?: string;
  LINQ_API_TOKEN?: string;
  MAPBOX_ACCESS_TOKEN?: string;
  OPENAI_API_KEY?: string;
  TELEGRAM_API_BASE_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  WHATSAPP_API_BASE_URL?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  validateRuntimeWriteFence?: (input: {
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion?: string | null;
  }) => Promise<boolean>;
}): RunnerOutboundEnvironmentSource {
  return {
    ...createHostedExecutionTestEnv(),
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    HOSTED_EXECUTION_RUNNER_HOST_ALIAS: input.HOSTED_EXECUTION_RUNNER_HOST_ALIAS,
    LINQ_API_BASE_URL: input.LINQ_API_BASE_URL,
    LINQ_API_TOKEN: input.LINQ_API_TOKEN,
    MAPBOX_ACCESS_TOKEN: input.MAPBOX_ACCESS_TOKEN,
    OPENAI_API_KEY: input.OPENAI_API_KEY,
    TELEGRAM_API_BASE_URL: input.TELEGRAM_API_BASE_URL,
    TELEGRAM_BOT_TOKEN: input.TELEGRAM_BOT_TOKEN,
    WHATSAPP_API_BASE_URL: input.WHATSAPP_API_BASE_URL,
    WHATSAPP_ACCESS_TOKEN: input.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: input.WHATSAPP_PHONE_NUMBER_ID,
    USER_RUNNER: {
      getByName: () => ({
        validateRuntimeWriteFence: input.validateRuntimeWriteFence ?? (async () => false),
      }),
    },
  };
}

function readForwardedRequest(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): Request {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const request = fetchMock.mock.calls[0]?.[0];
  expect(request).toBeInstanceOf(Request);
  return request as Request;
}
