import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";
import { startCodexAppServerRealtime, stopWarmCodexAppServer } from "@murphai/assistant-engine/assistant-codex";
import { hostedRunnerIntercept } from "../src/runner-egress-intercept.ts";
import { createHostedProviderEgressCredential } from "../src/hosted-provider-egress-credential.ts";
import type { RunnerOutboundEnvironmentSource } from "../src/runner-outbound.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { createPostgresTestOwner, mockPostgresOwnerCommand, settledNativeRuntime } from "./postgres-owner-fixtures.ts";
import { nativeLiveRequest } from "./fixtures/native-live-request.ts";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function readCreation(response: Response) {
  const value: unknown = await response.json();
  expect(value).toMatchObject({ session: { id: expect.any(String) }, transport: { sdp: expect.any(String) } });
  return value as { session: { id: string }; transport: { sdp: string } };
}

async function fixture() {
  let owner = createPostgresTestOwner();
  const env: RunnerOutboundEnvironmentSource = {
    ...createHostedExecutionTestEnv(), BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET: "synthetic-live-signing-key",
    OPENAI_API_KEY: "synthetic-worker-key", RUNNER_CONTAINER: { getByName: () => settledNativeRuntime },
  };
  const authorize = mockPostgresOwnerCommand(async ({ userId, command }) => {
    if (userId !== owner.userId) return { cutover: "postgres", status: "stale", owner: null };
    if (command.operation === "authorize_provider" && (owner.phase !== "active" && owner.phase !== "starting")) {
      return { cutover: "postgres", status: "stale", owner: null };
    }
    return { cutover: "postgres", status: command.operation === "reconcile" ? "observed" : "authorized", owner };
  });
  const credential = await createHostedProviderEgressCredential({
    providerKind: "openai", userId: owner.userId, runnerContainerName: owner.runnerContainerName!, source: env,
  });
  const upstream = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return url.pathname.endsWith("/attach") ? new Response("synthetic-upgrade") : Response.json({
      session: { id: "live_synthetic" }, transport: { type: "webrtc", sdp: "v=0\r\nsynthetic-answer" },
    }, { status: 201 });
  });
  vi.stubGlobal("fetch", upstream);
  const send = (path: string, init: RequestInit) => hostedRunnerIntercept(new Request(`https://api.openai.com${path}`, {
    ...init, headers: { authorization: `Bearer ${credential}`, ...init.headers },
  }), env, { containerId: "synthetic-container" });
  const create = (body: unknown = nativeLiveRequest()) => send("/v1/live/sessions", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const attach = (reference: string, overrideCredential = credential) => send(`/v1/live/sessions/${reference}/attach`, {
    headers: { authorization: `Bearer ${overrideCredential}`, connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" },
  });
  return { env, credential, upstream, create, attach, send, authorize,
    change: (patch: Partial<typeof owner>) => { owner = { ...owner, ...patch }; },
  };
}

describe("native public Live egress", () => {
  it("creates once, binds its resource to the runtime, and restores the opaque upstream id on attach", async () => {
    const h = await fixture();
    const response = await h.create();
    expect(response.status).toBe(201);
    const created = await readCreation(response);
    expect(created.session.id).toMatch(/^ml1\./u);
    expect(created.transport.sdp).toBe("v=0\r\nsynthetic-answer");
    const creation = h.upstream.mock.calls[0]![0] as Request;
    expect(await creation.json()).toEqual(nativeLiveRequest());
    expect(creation.headers.get("authorization")).toBe("Bearer synthetic-worker-key");
    expect(creation.redirect).toBe("manual");
    expect((await h.attach(created.session.id)).status).toBe(200);
    const attachment = h.upstream.mock.calls[1]![0] as Request;
    expect(attachment.url).toBe("https://api.openai.com/v1/live/sessions/live_synthetic/attach");
    expect(attachment.headers.get("authorization")).toBe("Bearer synthetic-worker-key");
    expect(attachment.redirect).toBe("manual");
    expect(h.upstream).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])("reports upstream authorization failure %s through the existing monitor", async (status) => {
    const h = await fixture();
    const created = await readCreation(await h.create());
    const reportFailure = vi.fn(async (_report: { observedAtMs: number; status: 401 | 403 }) => ({ accepted: true as const }));
    h.env.OPENAI_AUTHORIZATION_ALERT_MONITOR = { getByName: () => ({ reportFailure }) };
    h.upstream.mockImplementation(async () => new Response("denied", { status }));
    expect((await h.create()).status).toBe(status);
    expect((await h.attach(created.session.id)).status).toBe(status);
    expect(reportFailure).toHaveBeenCalledTimes(2);
    expect(reportFailure).toHaveBeenCalledWith({ observedAtMs: expect.any(Number), status });
  });

  it("rejects raw credentials, queries, and non-WebSocket attachments without provider effects", async () => {
    const h = await fixture();
    const created = await readCreation(await h.create());
    const body = JSON.stringify(nativeLiveRequest());
    expect((await h.send("/v1/live/sessions", { method: "POST", body, headers: { authorization: "Bearer synthetic-raw-key" } })).status).toBe(403);
    expect((await h.send("/v1/live/sessions?override=true", { method: "POST", body })).status).toBe(403);
    expect((await h.send(`/v1/live/sessions/${created.session.id}/attach`, {})).status).toBe(403);
    expect((await h.send(`/v1/live/sessions/${created.session.id}/attach?override=true`, {
      headers: { connection: "Upgrade", upgrade: "websocket" },
    })).status).toBe(403);
    expect(h.upstream).toHaveBeenCalledTimes(1);
  });

  it.each([
    { attemptId: "replacement" }, { generation: "8" }, { runnerContainerName: "replacement" }, { phase: "idle" as const },
  ])("rejects attachment after owner replacement or release: %j", async (patch) => {
    const h = await fixture();
    const created = await readCreation(await h.create());
    h.change(patch);
    expect((await h.attach(created.session.id)).status).toBe(403);
    expect(h.upstream).toHaveBeenCalledTimes(1);
  });

  it("permits native attachment for closure after revocation and during exact-owner retirement", async () => {
    const h = await fixture();
    const created = await readCreation(await h.create());
    h.change({ platformAiUsageAllowed: false });
    expect((await h.attach(created.session.id)).status).toBe(200);
    expect((await h.create()).status).toBe(402);
    h.change({ phase: "retiring" });
    expect((await h.attach(created.session.id)).status).toBe(200);
    expect((await h.create()).status).toBe(403);
    expect(h.upstream).toHaveBeenCalledTimes(3);
  });

  it("rejects raw, modified, and another member's references", async () => {
    const h = await fixture();
    const created = await readCreation(await h.create());
    for (const reference of ["live_synthetic", `${created.session.id}changed`]) {
      expect((await h.attach(reference)).status).toBe(403);
    }
    h.change({ userId: "another-member" });
    const otherCredential = await createHostedProviderEgressCredential({
      providerKind: "openai", userId: "another-member", runnerContainerName: "member_123--v-test", source: h.env,
    });
    expect((await h.attach(created.session.id, otherCredential)).status).toBe(403);
    expect(h.upstream).toHaveBeenCalledTimes(1);
  });

  it.each(["session.instructions.append", "session.commentary.append", "session.update", "session.start"])(
    "rejects browser authority for %s before provider creation", async (event) => {
      const h = await fixture();
      const body = nativeLiveRequest();
      body.session.client.data_channel.allowed_client_events.push(event);
      expect((await h.create(body)).status).toBe(400);
      expect(h.upstream).not.toHaveBeenCalled();
    },
  );

  it("rejects alternate delegation, model, oversized and malformed requests without upstream effects", async () => {
    const h = await fixture();
    const body = nativeLiveRequest();
    expect((await h.create({ ...body, session: { ...body.session, delegation: { type: "responses" } } })).status).toBe(400);
    expect((await h.create({ ...body, session: { ...body.session, model: "other-model" } })).status).toBe(400);
    expect((await h.create({ ...body, transport: { type: "webrtc", sdp: "v=0" + "x".repeat(130 * 1024) } })).status).toBe(413);
    const invalid = await h.send("/v1/live/sessions", { method: "POST", body: "private-invalid-offer" });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain("private-invalid-offer");
    expect(h.upstream).not.toHaveBeenCalled();
  });

  it("does not retry an ambiguous provider creation", async () => {
    const h = await fixture();
    h.upstream.mockResolvedValueOnce(new Response("invalid private response", { status: 201 }));
    const result = await h.create();
    expect(result.status).toBe(502);
    expect(await result.text()).toBe("Live creation outcome unconfirmed.");
    expect(h.upstream).toHaveBeenCalledTimes(1);
  });
});

it.skipIf(!process.env.MURPH_TEST_CODEX_COMMAND).each([false, true])(
  "packaged native Live traverses scoped egress and confirms closure (cancel during creation: %s)",
  { timeout: 60_000 }, async (cancelDuringCreation) => {
    const h = await fixture();
    const root = await mkdtemp(path.join(tmpdir(), "murph-live-egress-"));
    await mkdir(path.join(root, "codex"));
    const abort = new AbortController();
    const usage: number[] = [];
    let providerClosed = false;
    let releaseCreation!: () => void;
    let observedCreation!: () => void;
    const creationSeen = new Promise<void>((resolve) => { observedCreation = resolve; });
    const creationGate = new Promise<void>((resolve) => { releaseCreation = resolve; });
    h.upstream.mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith("/attach")) return new Response("synthetic-upgrade");
      observedCreation();
      if (cancelDuringCreation) await creationGate;
      return Response.json({ session: { id: "live_synthetic" }, transport: { type: "webrtc", sdp: "v=0\r\nsynthetic-answer" } }, { status: 201 });
    });
    async function intercepted(request: IncomingMessage) {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      return hostedRunnerIntercept(new Request(`https://api.openai.com${request.url}`, {
        method: request.method, headers, ...(body ? { body } : {}),
      }), h.env, { containerId: "synthetic-container" });
    }
    const server = createServer((request, response) => {
      void intercepted(request).then(async (result) => {
        response.writeHead(result.status, { "content-type": "application/json" }).end(await result.text());
      }).catch(() => response.writeHead(500).end());
    });
    const sockets = new WebSocketServer({ noServer: true });
    server.on("upgrade", (request, socket, head) => {
      void intercepted(request).then((result) => {
        if (!result.ok) { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
        sockets.handleUpgrade(request, socket, head, (client) => {
          client.send(JSON.stringify({ type: "session.started", session: { id: "live_synthetic" } }));
          client.on("message", (data) => {
            if (JSON.parse(String(data)).type !== "session.close") return;
            providerClosed = true;
            client.send(JSON.stringify({ type: "session.closed", reason: "close_requested",
              session: { id: "live_synthetic" }, usage: { seconds: 12 } }));
          });
        });
      }).catch(() => socket.destroy());
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Synthetic listener unavailable.");
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    try {
      const starting = startCodexAppServerRealtime({
        codexCommand: process.env.MURPH_TEST_CODEX_COMMAND, codexHome: path.join(root, "codex"), workingDirectory: root,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LIVE_TEST_CREDENTIAL: h.credential },
        configOverrides: [
          'model_provider="live-test"', 'model_providers.live-test.name="Synthetic"',
          `model_providers.live-test.base_url="${baseUrl}"`, 'model_providers.live-test.env_key="LIVE_TEST_CREDENTIAL"',
          'model_providers.live-test.wire_api="responses"', 'model_providers.live-test.requires_openai_auth=false',
          `experimental_realtime_ws_base_url="${baseUrl}"`, `experimental_realtime_webrtc_call_base_url="${baseUrl}"`,
        ],
        model: "gpt-5.6-terra", modelProvider: "live-test", sessionId: "call-synthetic",
        sdp: "v=0\r\nsynthetic-offer", prompt: "Delegate requests to the backing assistant.",
        signal: abort.signal, onInput: () => {}, onUsage: (seconds) => usage.push(seconds),
      });
      // Observe rejection immediately while cancellation waits for provider creation.
      const result = starting.then((voice) => ({ voice }), (error: unknown) => ({ error }));
      await creationSeen;
      if (cancelDuringCreation) {
        h.change({ phase: "retiring", platformAiUsageAllowed: false });
        abort.abort(new Error("Synthetic cancellation."));
        releaseCreation();
      }
      const completed = await result;
      if (cancelDuringCreation) expect(completed).toHaveProperty("error");
      else {
        if (!("voice" in completed)) throw new Error("Native attachment failed.");
        expect(completed.voice.sdp).toBe("v=0\r\nsynthetic-answer");
        expect(await completed.voice.close()).toEqual({ providerConfirmed: true, providerSessionId: "live_synthetic", seconds: 12 });
      }
      await vi.waitFor(() => expect(providerClosed).toBe(true));
      expect(usage).toContain(12);
      expect(h.upstream.mock.calls.map(([request]) => new URL((request as Request).url).pathname))
        .toEqual(["/v1/live/sessions", "/v1/live/sessions/live_synthetic/attach"]);
    } finally {
      releaseCreation();
      await stopWarmCodexAppServer();
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
);
