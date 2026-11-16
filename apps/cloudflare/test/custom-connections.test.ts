import { afterEach, describe, expect, it, vi } from "vitest";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { handleHostedRunnerCustomConnectionsOutbound, CUSTOM_CONNECTIONS_MAX_REQUEST_BYTES } from "../src/runner-custom-connections.ts";
import { HOSTED_RUNNER_OUTBOUND_BY_HOST, handleHostedRunnerOpenInternetOutbound } from "../src/runner-egress-intercept.ts";
import { CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES } from "../src/internal-hosts.ts";
import type { RunnerOutboundEnvironmentSource } from "../src/runner-outbound/shared.ts";
import { createCloudflareHostedPublicInternetFetch } from "../src/runtime-platform/public-internet-fetch.ts";
import { createHostedWebCustomConnectionsPort } from "../src/runtime-platform/custom-connections-port.ts";
import { HOSTED_RUNNER_WEB_CONTROL_ROUTES, readHostedRunnerWebControlPolicy } from "../src/runner-outbound/shared-web-control-policy.ts";
import { readHostedExecutionRuntimeAuthority } from "@murphai/hosted-execution/auth";

const entry = { id: "cc_notes", slug: "notes", generation: 3, catalog: "a".repeat(43) };
const relayUrl = `http://connections.worker/v1/${entry.id}/3/${entry.catalog}/mcp`;
const caller = { containerId: "container-test", className: "RunnerContainer" };
function environment(retiring = false): RunnerOutboundEnvironmentSource {
  return {
    ...createHostedExecutionTestEnv({ HOSTED_WEB_BASE_URL: "https://web.example.test" }),
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    RUNNER_CONTAINER: {
      idFromString: (id: string) => id,
      get: () => ({ readProviderAuthority: async () => ({
        userId: "member-test", attemptId: "attempt-test", generation: "7", workspaceVersion: "4",
        platformAiUsageAllowed: true, settlementPending: false, retiring,
      }) }),
    } as RunnerOutboundEnvironmentSource["RUNNER_CONTAINER"],
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("custom connection relay", () => {
  it("is internal, routes through both dispatch paths, and signs only native authority", async () => {
    expect(CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has("connections.worker")).toBe(true);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST["connections.worker"]).toBe(handleHostedRunnerCustomConnectionsOutbound);
    const forwarded = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(new URL(request.url).pathname).toBe(`/api/internal/custom-connections/cc_notes/3/${entry.catalog}/mcp`);
      expect(readHostedExecutionRuntimeAuthority(new URL(request.url), request.headers)).toMatchObject({ attemptId: "attempt-test", generation: "7" });
      expect(request.headers.get("x-hosted-execution-user-id")).toBe("member-test");
      expect(request.headers.get("x-hosted-execution-signature")).toBeTruthy();
      for (const name of ["authorization", "cookie", "mcp-session-id", "x-untrusted"]) expect(request.headers.has(name)).toBe(false);
      expect(await request.text()).toBe('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
      return new Response('{"result":{}}', { headers: {
        "content-type": "application/json", "set-cookie": "secret", "www-authenticate": "secret", "location": "https://notes.example.com", "mcp-session-id": "secret",
      } });
    });
    vi.stubGlobal("fetch", forwarded);
    const response = await handleHostedRunnerOpenInternetOutbound(new Request(relayUrl, {
      method: "POST", body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      headers: { authorization: "forged", cookie: "forged", "mcp-session-id": "forged", "x-untrusted": "forged",
        "x-hosted-runner-bound-user-id": "other-member", "x-hosted-runtime-attempt-id": "forged", "x-hosted-runtime-lease-generation": "99" },
    }), environment(), caller);
    expect(response.status).toBe(200);
    expect([...response.headers.keys()]).toEqual(["content-type"]);
    expect(await response.text()).toBe('{"result":{}}');
    expect(forwarded).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { ...caller, className: "Untrusted" }])("refuses missing native authority despite forged headers", async (coordinates) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const response = await handleHostedRunnerCustomConnectionsOutbound(new Request(relayUrl, { method: "POST", headers: {
      "x-hosted-runner-bound-user-id": "member-test", "x-hosted-runtime-attempt-id": "attempt-test", "x-hosted-runtime-lease-generation": "7",
    } }), environment(), coordinates);
    expect(response.status).toBe(403); expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses retiring authority", async () => {
    expect((await handleHostedRunnerCustomConnectionsOutbound(new Request(relayUrl, { method: "POST" }), environment(true), caller)).status).toBe(403);
  });
  it.each(["GET", "DELETE", "PUT"])("refuses %s", async method => {
    expect((await handleHostedRunnerCustomConnectionsOutbound(new Request(relayUrl, { method }), environment(), caller)).status).toBe(405);
  });
  it("bounds actual body bytes without trusting content-length", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const response = await handleHostedRunnerCustomConnectionsOutbound(new Request(relayUrl, {
      method: "POST", body: "x".repeat(CUSTOM_CONNECTIONS_MAX_REQUEST_BYTES + 1), headers: { "content-length": "1" },
    }), environment(), caller);
    expect(response.status).toBe(413); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not expose transport exceptions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("secret-shaped-upstream-token"); }));
    const response = await handleHostedRunnerCustomConnectionsOutbound(new Request(relayUrl, { method: "POST" }), environment(), caller);
    expect(response.status).toBe(502); expect(await response.text()).toBe("Connection unavailable");
  });
});

describe("public fetch internal destinations", () => {
  it.each([...CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES])("rejects %s initially and after a redirect", async host => {
    const fetch = vi.fn(async () => new Response(null, { status: 307, headers: { location: `http://${host.toUpperCase()}./secret` } }));
    const publicFetch = createCloudflareHostedPublicInternetFetch(fetch);
    await expect(publicFetch(`http://${host}/secret`)).rejects.toThrow("destination");
    expect(fetch).not.toHaveBeenCalled();
    await expect(publicFetch("https://notes.example.com", { method: "POST", body: "{}" })).rejects.toThrow("destination");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("checks later hops and strips authority and cross-origin credentials", async () => {
    const requests: Request[] = [];
    const publicFetch = createCloudflareHostedPublicInternetFetch(async input => {
      const request = new Request(input); requests.push(request);
      return new Response(null, { status: 302, headers: { location: requests.length === 1 ? "https://other.example.com/path" : relayUrl } });
    });
    await expect(publicFetch("https://notes.example.com", { method: "POST", body: "{}", headers: {
      authorization: "secret", "x-hosted-runtime-attempt-id": "secret", "x-hosted-runner-bound-user-id": "secret",
    } })).rejects.toThrow("destination");
    expect(requests.map(request => request.method)).toEqual(["POST", "GET"]);
    expect(requests.every(request => !request.headers.has("x-hosted-runtime-attempt-id") && !request.headers.has("x-hosted-runner-bound-user-id"))).toBe(true);
    expect(requests[1]!.headers.has("authorization")).toBe(false);
  });
  it.each([307, 308])("preserves POST bodies on a public %s redirect", async status => {
    const bodies: string[] = [];
    const publicFetch = createCloudflareHostedPublicInternetFetch(async input => {
      const request = new Request(input);
      expect(request.method).toBe("POST");
      bodies.push(await request.text());
      return bodies.length === 1
        ? new Response(null, { status, headers: { location: "/next" } })
        : Response.json({ ok: true });
    });
    expect((await publicFetch("https://notes.example.com", { method: "POST", body: "synthetic" })).status).toBe(200);
    expect(bodies).toEqual(["synthetic", "synthetic"]);
  });
  it.each(["manual", "error"] as const)("still rejects internal redirect targets in %s mode", async redirect => {
    const publicFetch = createCloudflareHostedPublicInternetFetch(async () => new Response(null, { status: 302, headers: { location: relayUrl } }));
    await expect(publicFetch("https://notes.example.com", { redirect })).rejects.toThrow("destination");
  });
  it("bounds redirect loops", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "/loop" } }));
    await expect(createCloudflareHostedPublicInternetFetch(fetch)("https://notes.example.com")).rejects.toThrow("redirect rejected");
    expect(fetch).toHaveBeenCalledTimes(21);
  });
});

describe("wake-local manifest", () => {
  function port(fetchImpl: typeof fetch) {
    return createHostedWebCustomConnectionsPort({ boundUserId: "member-test", fetchImpl, timeoutMs: 1000, transport: { mode: "proxy" } });
  }
  it("uses an allowlisted POST with no body and memoizes concurrent reads", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST"); expect(init?.body).toBeUndefined();
      return Response.json({ connections: [entry] });
    });
    const manifest = port(fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect(readHostedRunnerWebControlPolicy({ method: "POST", path: HOSTED_RUNNER_WEB_CONTROL_ROUTES.customConnectionsManifest.path }).allowed).toBe(true);
    expect(await Promise.all([manifest.readManifest(), manifest.readManifest()])).toEqual([[entry], [entry]]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await port(fetch).readManifest(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("treats old-Web 404 as empty", async () => {
    expect(await port(async () => new Response("Not found", { status: 404 })).readManifest()).toEqual([]);
  });
  it.each([{ connections: [{ ...entry, url: "https://notes.example.com" }] }, { connections: [entry, entry] }, { connections: [{ ...entry, slug: "unsafe.name" }] }])("mounts nothing for a malformed manifest", async body => {
    expect(await port(async () => Response.json(body)).readManifest()).toEqual([]);
  });
  it("mounts nothing, rather than failing the reply, when Web errors or is slow", async () => {
    expect(await port(async () => new Response("unavailable", { status: 503 })).readManifest()).toEqual([]);
    expect(await port(async () => { throw new TypeError("network"); }).readManifest()).toEqual([]);
    const slow = port((async (_input: RequestInfo | URL, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as typeof fetch);
    expect(await slow.readManifest()).toEqual([]);
  });
});
