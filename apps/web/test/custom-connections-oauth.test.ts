import { describe, expect, it, vi } from "vitest";
import { auth, type OAuthDiscoveryState } from "@modelcontextprotocol/client";
import { ConnectionOAuthProvider, completeConnectionAuthorization, validateDiscovery, type PendingAuthorization } from "../src/lib/custom-connections/oauth";

vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "8.8.8.8", family: 4 }] }));

const resource = "https://notes.example.com/mcp";
const issuer = "https://login.example.com";
function discovery(metadataDocument = false): OAuthDiscoveryState {
  return { authorizationServerUrl: issuer, resourceMetadata: { resource, authorization_servers: [issuer], scopes_supported: ["notes.read"] },
    authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`, code_challenge_methods_supported: ["S256"], response_types_supported: ["code"],
      authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: metadataDocument,
      scopes_supported: ["notes.read", "offline_access"] } };
}
function fakeFetch(state: OAuthDiscoveryState) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const destination = String(url);
    if (destination.includes("oauth-protected-resource")) return Response.json(state.resourceMetadata);
    if (destination.includes("oauth-authorization-server")) return Response.json(state.authorizationServerMetadata);
    if (destination === `${issuer}/register`) return Response.json({ client_id: "synthetic-client", redirect_uris: ["https://www.withmurph.ai/api/settings/custom-connections/callback/cc_synthetic"], token_endpoint_auth_method: "none" });
    if (destination === `${issuer}/token`) {
      expect(new URLSearchParams(String(init?.body)).get("resource")).toBe(resource);
      return Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", token_type: "Bearer", expires_in: 3600 });
    }
    return new Response(null, { status: 404 });
  });
}
describe("SDK-backed connection OAuth", () => {
  it.each([false, true])("completes PKCE with metadata document=%s and frozen endpoints", async (document) => {
    const state = discovery(document); const fetch = fakeFetch(state);
    let pending: PendingAuthorization | undefined;
    const start = new ConnectionOAuthProvider("cc_synthetic", resource, { fetch, redirect: async (_state, value) => { pending = value; } });
    expect(await auth(start, { serverUrl: resource, fetchFn: start.fetch })).toBe("REDIRECT");
    expect(start.authorizationUrl?.searchParams.get("code_challenge_method")).toBe("S256");
    expect(start.authorizationUrl?.searchParams.get("scope")).toBe("notes.read");
    expect(start.authorizationUrl?.searchParams.get("redirect_uri")).toContain("/callback/cc_synthetic");
    expect(start.authorizationUrl?.searchParams.get("client_id")).toBe(document ? "https://www.withmurph.ai/oauth/mcp-client/cc_synthetic" : "synthetic-client");
    const save = vi.fn();
    const callbackFetch = fakeFetch(discovery());
    const callback = new ConnectionOAuthProvider("cc_synthetic", resource, { pending, fetch: callbackFetch, saveTokens: save });
    expect(await completeConnectionAuthorization(callback, "synthetic-code", issuer)).toBe("AUTHORIZED");
    expect(callbackFetch.mock.calls.map(([url]) => String(url))).toEqual([`${issuer}/token`]);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, "https://other.example.com"])("rejects missing or wrong response issuer %s before token exchange", async (iss) => {
    const fetch = fakeFetch(discovery());
    const provider = new ConnectionOAuthProvider("cc_synthetic", resource, { pending: { discovery: discovery(), verifier: "synthetic-verifier", client: { client_id: "synthetic-client", issuer } }, fetch, saveTokens: vi.fn() });
    await expect(completeConnectionAuthorization(provider, "synthetic-code", iss)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("validates a supplied issuer even when response issuer support is not advertised", async () => {
    const state = discovery(); state.authorizationServerMetadata!.authorization_response_iss_parameter_supported = false;
    const fetch = fakeFetch(state);
    const provider = new ConnectionOAuthProvider("cc_synthetic", resource, { pending: { discovery: state, verifier: "synthetic-verifier", client: { client_id: "synthetic-client", issuer } }, fetch, saveTokens: vi.fn() });
    await expect(completeConnectionAuthorization(provider, "synthetic-code", "https://other.example.com")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses missing resource metadata, PKCE, issuer mismatch and unsupported registration", () => {
    for (const change of [
      (state: OAuthDiscoveryState) => { state.resourceMetadata = undefined; },
      (state: OAuthDiscoveryState) => { state.authorizationServerMetadata!.code_challenge_methods_supported = undefined; },
      (state: OAuthDiscoveryState) => { state.authorizationServerMetadata!.issuer = "https://other.example.com"; },
      (state: OAuthDiscoveryState) => { state.authorizationServerMetadata!.registration_endpoint = undefined; },
    ]) { const state = discovery(); change(state); expect(() => validateDiscovery(state, resource)).toThrow(); }
  });
  it("refuses token endpoint substitution and credential-bearing discovery", async () => {
    const fetch = fakeFetch(discovery());
    const provider = new ConnectionOAuthProvider("cc_synthetic", resource, { credentials: { discovery: discovery() }, fetch });
    await expect(provider.fetch("https://other.example.com/token", { method: "POST", body: "code=synthetic-code" })).rejects.toThrow();
    await expect(provider.fetch(`${issuer}/.well-known/oauth-authorization-server`, { headers: { authorization: "Bearer synthetic-access" } })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("aborts on failed persistence and sanitizes provider errors before SDK parsing", async () => {
    const provider = new ConnectionOAuthProvider("cc_synthetic", resource, {
      pending: { discovery: discovery(), verifier: "synthetic-verifier", client: { client_id: "synthetic-client", issuer } },
      fetch: fakeFetch(discovery()), saveTokens: async () => { throw new Error("save failed"); },
    });
    await expect(completeConnectionAuthorization(provider, "synthetic-code", issuer)).rejects.toThrow();
    expect(provider.tokens()).toBeUndefined();
    const errors = new ConnectionOAuthProvider("cc_synthetic", resource, { credentials: { discovery: discovery() },
      fetch: async () => Response.json({ error: "server_error", error_description: "synthetic-secret" }, { status: 500 }) });
    expect(await (await errors.fetch(`${issuer}/token`, { method: "POST", body: "refresh_token=synthetic" })).text()).not.toContain("synthetic-secret");
  });
});
