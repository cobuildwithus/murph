import { afterEach, expect, test, vi } from "vitest";
import { HOSTED_RUNTIME_OWNER_PATH } from "@murphai/hosted-execution/runtime-owner";
import { createPostgresTestOwner, forbiddenLegacyRuntime, settledNativeRuntime } from "../postgres-owner-fixtures.ts";
import { createHostedExecutionTestEnv } from "../hosted-execution-fixtures.ts";
import { hostedRunnerIntercept, HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL } from "../../src/runner-egress-intercept.ts";
import { HOSTED_RUNNER_BOUND_USER_ID_HEADER } from "../../src/runner-outbound/headers.ts";
import type { RunnerOutboundEnvironmentSource } from "../../src/runner-outbound.ts";

const sockets: WebSocket[] = [];
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
  vi.unstubAllGlobals();
});

async function openSocket(allowed: boolean | null, authorized = true) {
  const pair = new WebSocketPair();
  const provider = pair[1];
  provider.accept();
  sockets.push(provider);
  const upgraded = new Response(null, { status: 101, webSocket: pair[0] });
  const providerFetch = vi.fn(async () => upgraded);
  const access = vi.fn(async () => allowed === null
    ? new Response(null, { status: 503 })
    : Response.json({ allowed, reason: allowed ? "allowed" : "subscription_required" }));
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (target, init) => {
    const request = new Request(target, init);
    const url = new URL(request.url);
    if (url.pathname === HOSTED_RUNTIME_OWNER_PATH) return Response.json({
      cutover: "postgres", status: authorized ? "authorized" : "stale",
      owner: authorized ? createPostgresTestOwner() : null,
    });
    if (url.pathname.endsWith("/image-generation/access")) return access();
    if (url.hostname === "api.openai.com") return providerFetch();
    throw new Error("Unexpected synthetic upstream");
  }));
  const environment: RunnerOutboundEnvironmentSource = {
    ...createHostedExecutionTestEnv(),
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    OPENAI_API_KEY: "synthetic-provider-key",
    USER_RUNNER: forbiddenLegacyRuntime,
    RUNNER_CONTAINER: { getByName: () => settledNativeRuntime },
  };
  const response = await hostedRunnerIntercept(new Request("https://api.openai.com/v1/responses", {
    headers: {
      authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
      [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
      "x-hosted-runtime-attempt-id": "attempt_1",
      "x-hosted-runtime-lease-generation": "7",
      "x-hosted-runtime-workspace-version": "4",
      connection: "Upgrade", upgrade: "websocket",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13",
    },
  }), environment, { containerId: "member_123--v-test" });
  return { access, provider, providerFetch, response, upgraded };
}

function nextMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve) => socket.addEventListener("message", (event) => resolve(String(event.data)), { once: true }));
}

test("returns the exact unaccepted upgrade and preserves bidirectional warm socket traffic", async () => {
  const { access, provider, response, upgraded } = await openSocket(true);
  expect(response).toBe(upgraded);
  expect(response.webSocket).toBe(upgraded.webSocket);
  const client = response.webSocket!;
  client.accept();
  sockets.push(client);
  for (const turn of ["first", "second"]) {
    const received = nextMessage(provider);
    client.send(turn);
    expect(await received).toBe(turn);
    const reply = nextMessage(client);
    provider.send(`${turn} reply`);
    expect(await reply).toBe(`${turn} reply`);
  }
  expect(access).toHaveBeenCalledTimes(1);
  const closed = new Promise<number>((resolve) => client.addEventListener("close", (event) => resolve(event.code), { once: true }));
  provider.close(1012, "synthetic restart");
  expect(await closed).toBe(1012);
});

test.each([false, null])("declines denied or unavailable image access (%s) before provider spend", async (allowed) => {
  const { response, providerFetch } = await openSocket(allowed);
  expect(response.status).toBe(426);
  expect(providerFetch).not.toHaveBeenCalled();
});

test("denies a new connection after runtime authority is withdrawn", async () => {
  const { response, access, providerFetch } = await openSocket(true, false);
  expect(response.status).toBe(401);
  expect(access).not.toHaveBeenCalled();
  expect(providerFetch).not.toHaveBeenCalled();
});
