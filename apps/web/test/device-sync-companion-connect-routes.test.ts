import { deviceSyncError } from "@murphai/device-syncd/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedDeviceSyncAppCompletionProof,
  buildHostedDeviceSyncCallbackProof,
  readHostedDeviceSyncAppCompletionProofError,
} from "@/src/lib/device-sync/browser-callback-proof";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import type { HostedDeviceSyncSettingsUpstreamSource } from "@/src/lib/device-sync/settings-surface";

import { createRouteContext } from "./route-test-helpers";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  callbackRejection: vi.fn(),
  cap: vi.fn(),
  connectFailure: vi.fn(),
  consent: vi.fn(),
  disconnectConnectionSource: vi.fn(),
  grant: vi.fn(),
  handleConnectionCallback: vi.fn(),
  prepareConnectionStart: vi.fn(),
  queueConnectionManualReconcile: vi.fn(),
  session: vi.fn(),
  settings: vi.fn(),
  startConnection: vi.fn(),
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ hostedConsentGrant: { findUnique: mocks.grant } }) }));
vi.mock("@/src/lib/better-auth/config", () => ({ requireHostedBetterAuthConfig: () => ({}) }));
vi.mock("@/src/lib/better-auth/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/better-auth/session")>(),
  readHostedAuthSession: mocks.session,
}));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({ assertActiveHostedMemberAccessAllowed: mocks.access }));
vi.mock("@/src/lib/device-sync/settings-service", () => ({ buildHostedDeviceSyncSettingsResponse: mocks.settings }));
vi.mock("@/src/lib/device-sync/whoop-connect-capacity", () => ({ assertHostedWhoopConnectCapacityAvailable: mocks.cap }));
vi.mock("@/src/lib/device-sync/connect-failure-alert", () => ({
  reportHostedDeviceCallbackRejection: mocks.callbackRejection,
  reportHostedDeviceConnectFailure: mocks.connectFailure,
}));
vi.mock("@/src/lib/legal/consent", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/legal/consent")>(),
  assertHostedHistoricalLaunchConsentGranted: mocks.consent,
}));
vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService: () => ({
    disconnectConnectionSource: mocks.disconnectConnectionSource,
    handleConnectionCallback: mocks.handleConnectionCallback,
    prepareConnectionStart: mocks.prepareConnectionStart,
    queueConnectionManualReconcile: mocks.queueConnectionManualReconcile,
    startConnection: mocks.startConnection,
  }),
}));

import { GET as bridge } from "../app/api/device-sync/companion/connect-return/[app]/route";
import { POST as complete } from "../app/api/device-sync/companion/connect-sources/complete/route";
import { POST as disconnect } from "../app/api/device-sync/companion/connect-sources/[sourceId]/disconnect/route";
import { POST as start } from "../app/api/device-sync/companion/connect-sources/[sourceId]/start/route";
import { POST as sync } from "../app/api/device-sync/companion/connect-sources/[sourceId]/sync/route";

const BASE = "https://app.example.test/api/device-sync/companion";
const STATE = "callback_state_1234567890";
const member = { id: "synthetic-member", billingStatus: "active", suspendedAt: null };
const post = (path: string, body?: unknown, bearer = true) => new Request(`${BASE}/${path}`, {
  method: "POST",
  headers: { ...(bearer ? { authorization: `Bearer murph_auth_v1.${"a".repeat(32)}` } : {}), "content-type": "application/json" },
  ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
});
const forSource = (sourceId: string) => createRouteContext({ sourceId });
const upstream = (sourceProviderSlug: string, extra: Partial<HostedDeviceSyncSettingsUpstreamSource> = {}): HostedDeviceSyncSettingsUpstreamSource => ({
  sourceProviderSlug, providerLabel: sourceProviderSlug, resourceCount: 0, status: "connected", ...extra,
});
function settings(upstreamSources: HostedDeviceSyncSettingsUpstreamSource[], extra = {}) {
  mocks.settings.mockResolvedValue({ sources: [{ connectionId: "public-connection", provider: "junction", state: "active", upstreamSources, ...extra }] });
}
const appProof = (overrides: Partial<Parameters<typeof buildHostedDeviceSyncAppCompletionProof>[0]> = {}) =>
  buildHostedDeviceSyncAppCompletionProof({ memberId: member.id, provider: "junction", sessionId: "synthetic-session", state: STATE, ...overrides });
const completeBody = (overrides = {}) => ({
  provider: "junction", query: `murph_state=${STATE}&state=success&provider=oura`, completionProof: appProof(), ...overrides,
});
async function errorCode(response: Response) {
  return (await response.json()).error.code;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_REGION", "us");
  mocks.session.mockResolvedValue({ session: { member, sessionId: "synthetic-session", proof: {} } });
  mocks.grant.mockResolvedValue({ scope: "launch.health-data", status: "granted" });
  mocks.startConnection.mockResolvedValue({ authorizationUrl: "https://link.example.test/session", state: STATE });
  mocks.handleConnectionCallback.mockResolvedValue({});
  settings([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("start", () => {
  it("starts a web sign-in that returns to the named app bridge and gives the app a proof", async () => {
    const response = await start(post("connect-sources/oura/start", { appReturn: "ios-dev" }), forSource("oura"));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.json();
    expect(body).toEqual({ authorizationUrl: "https://link.example.test/session", provider: "junction", completionProof: expect.any(String) });
    expect(readHostedDeviceSyncAppCompletionProofError({
      completionProof: body.completionProof, memberId: member.id, provider: "junction", sessionId: "synthetic-session", state: STATE,
    })).toBeNull();
    expect(body.authorizationUrl + body.provider).not.toContain(body.completionProof);
    expect(mocks.startConnection).toHaveBeenCalledWith(member.id, "junction", null, {
      appReturn: "ios-dev", connectSourceId: "oura", connectTarget: "oura", sourceProviderSlug: "oura",
    });
    expect(mocks.prepareConnectionStart).toHaveBeenCalledWith(member.id, expect.objectContaining({ connectSourceId: "oura" }));
    expect(mocks.consent).toHaveBeenCalledWith(expect.objectContaining({ memberId: member.id }));
    expect(mocks.cap).toHaveBeenCalledWith(expect.objectContaining({ memberId: member.id }));
  });

  it.each([
    [{}], [{ appReturn: "website" }], [{ appReturn: "https://attacker.example.test/return" }],
    [{ appReturn: "toString" }], [{ appReturn: ["ios"] }],
  ])("accepts a return only by name from the closed set: %j", async body => {
    const response = await start(post("connect-sources/oura/start", body), forSource("oura"));
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("COMPANION_CONNECT_REQUEST_INVALID");
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });

  it("refuses a body past its bound", async () => {
    const response = await start(post("connect-sources/oura/start", { appReturn: "ios", padding: "x".repeat(2_000) }), forSource("oura"));
    expect(response.status).toBe(413);
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });

  it.each(["strava", "apple-health", "coros", "not-a-source"])("answers not configured for %s, which the app cannot start on the web", async id => {
    const response = await start(post(`connect-sources/${id}/start`, { appReturn: "ios" }), forSource(id));
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("HOSTED_DEVICE_CONNECT_SOURCE_NOT_CONFIGURED");
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });

  it("refuses without the health-data grant so the app raises its ask", async () => {
    mocks.grant.mockResolvedValue(null);
    mocks.consent.mockRejectedValue(hostedOnboardingError({ code: "HOSTED_CONSENT_REQUIRED", httpStatus: 403, message: "Consent." }));
    const response = await start(post("connect-sources/oura/start", { appReturn: "ios" }), forSource("oura"));
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("HOSTED_CONSENT_REQUIRED");
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });

  it("passes the WHOOP cap answer through", async () => {
    mocks.cap.mockRejectedValue(deviceSyncError({ code: "WHOOP_DIRECT_CONNECT_CAP_REACHED", httpStatus: 409, message: "Full.", retryable: false }));
    const response = await start(post("connect-sources/whoop/start", { appReturn: "ios" }), forSource("whoop"));
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("WHOOP_DIRECT_CONNECT_CAP_REACHED");
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });

  it("requires a signed-in member with access", async () => {
    expect((await start(post("connect-sources/oura/start", { appReturn: "ios" }, false), forSource("oura"))).status).toBe(401);
    mocks.access.mockRejectedValue(hostedOnboardingError({ code: "HOSTED_ACCESS_REQUIRED", httpStatus: 403, message: "Access." }));
    expect((await start(post("connect-sources/oura/start", { appReturn: "ios" }), forSource("oura"))).status).toBe(403);
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });
});

describe("complete", () => {
  it("finishes with the forwarded query and returns the list", async () => {
    settings([upstream("oura")]);
    const response = await complete(post("connect-sources/complete", completeBody()));
    expect(response.status).toBe(200);
    const [provider, options] = mocks.handleConnectionCallback.mock.calls[0];
    expect(provider).toBe("junction");
    expect(options.expectedOwnerId).toBe(member.id);
    expect(options.query.toString()).toBe(`murph_state=${STATE}&state=success&provider=oura`);
    const body = await response.json();
    expect(body.sources[0]).toMatchObject({ id: "oura", connection: { state: "connected", actions: ["sync", "remove"] } });
  });

  it.each([
    ["a proof for another member", () => appProof({ memberId: "other-member" })],
    ["a proof from another app session of the same member", () => appProof({ sessionId: "other-session" })],
    ["a proof for another state", () => appProof({ state: "different_state_12345678" })],
    ["a proof for another provider", () => appProof({ provider: "other" })],
    ["an expired proof", () => appProof({ now: new Date(Date.now() - 16 * 60_000) })],
    ["the website's cookie proof for the same member, session and state", () => {
      const { cookie } = buildHostedDeviceSyncCallbackProof({ memberId: member.id, provider: "junction", sessionId: "synthetic-session", state: STATE });
      return decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1, cookie.indexOf(";")));
    }],
    ["a malformed proof", () => "murph_device_sync_app_completion_v1.1.x"],
  ])("changes nothing for %s", async (_label, completionProof) => {
    const response = await complete(post("connect-sources/complete", completeBody({ completionProof: completionProof() })));
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("CALLBACK_PROOF_INVALID");
    expect(mocks.handleConnectionCallback).not.toHaveBeenCalled();
    expect(mocks.callbackRejection).toHaveBeenCalledWith(expect.objectContaining({ memberId: member.id, provider: "junction" }));
  });

  it("checks the proof before a provider error can discard the pending state", async () => {
    const query = `murph_state=${STATE}&state=error&error=access_denied`;
    const refused = await complete(post("connect-sources/complete", completeBody({ query, completionProof: appProof({ sessionId: "other-session" }) })));
    expect(await errorCode(refused)).toBe("CALLBACK_PROOF_INVALID");
    expect(mocks.handleConnectionCallback).not.toHaveBeenCalled();

    mocks.handleConnectionCallback.mockRejectedValue(deviceSyncError({ code: "JUNCTION_LINK_FAILED", httpStatus: 400, message: "Failed.", retryable: false }));
    const failed = await complete(post("connect-sources/complete", completeBody({ query })));
    expect(failed.status).toBe(400);
    expect(await errorCode(failed)).toBe("JUNCTION_LINK_FAILED");
    expect(mocks.connectFailure).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "JUNCTION_LINK_FAILED", memberId: member.id }));
  });

  it("answers a spent or expired state without claiming success or failure", async () => {
    mocks.handleConnectionCallback.mockRejectedValue(deviceSyncError({ code: "OAUTH_STATE_INVALID", httpStatus: 400, message: "Invalid.", retryable: false }));
    const response = await complete(post("connect-sources/complete", completeBody()));
    expect(await errorCode(response)).toBe("OAUTH_STATE_INVALID");
    expect(mocks.connectFailure).not.toHaveBeenCalled();
  });

  it.each([
    [{ provider: "Junction/../x" }], [{ provider: 7 }], [{ query: "" }], [{ query: "x".repeat(2_049) }],
    [{ completionProof: "" }], [{ completionProof: "x".repeat(257) }], [{ query: "state=success" }],
  ])("refuses a malformed request: %j", async overrides => {
    const response = await complete(post("connect-sources/complete", completeBody(overrides)));
    expect(response.status).toBe(400);
    expect(mocks.handleConnectionCallback).not.toHaveBeenCalled();
  });

  it("refuses a body past 4 KB and a signed-out caller", async () => {
    expect((await complete(post("connect-sources/complete", completeBody({ padding: "x".repeat(4_096) })))).status).toBe(413);
    expect((await complete(post("connect-sources/complete", completeBody(), false))).status).toBe(401);
    expect(mocks.handleConnectionCallback).not.toHaveBeenCalled();
  });
});

describe("disconnect", () => {
  it("stops the one source beside its siblings and returns the list", async () => {
    settings([upstream("oura"), upstream("whoop_v2"), upstream("apple_health_kit")]);
    const response = await disconnect(post("connect-sources/oura/disconnect"), forSource("oura"));
    expect(response.status).toBe(200);
    expect(mocks.disconnectConnectionSource).toHaveBeenCalledTimes(1);
    expect(mocks.disconnectConnectionSource).toHaveBeenCalledWith(member.id, "public-connection", "oura");
    expect((await response.json()).schemaVersion).toBe(1);
  });

  it.each([
    ["needs a reset that would disconnect the shared account", [upstream("garmin", { recoveryKind: "connection_reset" }), upstream("oura")], "garmin"],
    ["is a Fitbit migration ready to cut over", [upstream("fitbit"), upstream("google_health", { firstSeenAt: "2026-11-12T09:00:00.000Z", resourceCount: 1 })], "fitbit"],
    ["is a Fitbit migration awaiting sign-in", [upstream("fitbit")], "fitbit"],
  ] as const)("answers a conflict and changes nothing when the source %s", async (_label, upstreams, id) => {
    settings([...upstreams]);
    const response = await disconnect(post(`connect-sources/${id}/disconnect`), forSource(id));
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("COMPANION_CONNECT_REFRESH_REQUIRED");
    expect(mocks.disconnectConnectionSource).not.toHaveBeenCalled();
  });

  it.each(["whoop", "apple-health", "not-a-source"])("answers not found for %s, which this member cannot remove here", async id => {
    settings([upstream("oura"), upstream("apple_health_kit")]);
    const response = await disconnect(post(`connect-sources/${id}/disconnect`), forSource(id));
    expect(response.status).toBe(404);
    expect(mocks.disconnectConnectionSource).not.toHaveBeenCalled();
  });

  it("keeps the provider's not-finished answer", async () => {
    settings([upstream("oura")]);
    mocks.disconnectConnectionSource.mockRejectedValue(deviceSyncError({ code: "CONNECTION_SOURCE_DISCONNECT_FAILED", httpStatus: 502, message: "Not finished.", retryable: true }));
    const response = await disconnect(post("connect-sources/oura/disconnect"), forSource("oura"));
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("CONNECTION_SOURCE_DISCONNECT_FAILED");
  });

  it("works without product access or the health grant, but not signed out", async () => {
    settings([upstream("oura")]);
    mocks.access.mockRejectedValue(hostedOnboardingError({ code: "HOSTED_ACCESS_REQUIRED", httpStatus: 403, message: "Access." }));
    mocks.grant.mockResolvedValue({ scope: "launch.health-data", status: "revoked" });
    expect((await disconnect(post("connect-sources/oura/disconnect"), forSource("oura"))).status).toBe(200);
    expect(mocks.settings).toHaveBeenCalledWith({ member, toDisconnect: true });
    expect(mocks.disconnectConnectionSource).toHaveBeenCalledTimes(1);
    expect((await disconnect(post("connect-sources/oura/disconnect", undefined, false), forSource("oura"))).status).toBe(401);
  });
});

describe("sync", () => {
  it("queues one re-sync of the connected source's connection, bucketed to the minute", async () => {
    settings([upstream("oura")]);
    const response = await sync(post("connect-sources/oura/sync"), forSource("oura"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "queued" });
    const [memberId, connectionId, occurredAt] = mocks.queueConnectionManualReconcile.mock.calls[0];
    expect([memberId, connectionId]).toEqual([member.id, "public-connection"]);
    expect(new Date(occurredAt("2020-01-01T00:00:00.000Z")).getTime() % 60_000).toBe(0);
    expect(occurredAt("2999-01-01T00:00:30.000Z")).toBe("2999-01-01T00:00:30.000Z");
  });

  it("answers a conflict for a source that needs attention and not found for one that is not connected", async () => {
    settings([upstream("oura", { requiresReconnect: true })]);
    expect((await sync(post("connect-sources/oura/sync"), forSource("oura"))).status).toBe(409);
    expect((await sync(post("connect-sources/garmin/sync"), forSource("garmin"))).status).toBe(404);
    expect(mocks.queueConnectionManualReconcile).not.toHaveBeenCalled();
  });

  it("requires access", async () => {
    settings([upstream("oura")]);
    mocks.access.mockRejectedValue(hostedOnboardingError({ code: "HOSTED_ACCESS_REQUIRED", httpStatus: 403, message: "Access." }));
    expect((await sync(post("connect-sources/oura/sync"), forSource("oura"))).status).toBe(403);
    expect(mocks.queueConnectionManualReconcile).not.toHaveBeenCalled();
  });
});

describe("return bridge", () => {
  const get = (app: string, query = "") => bridge(
    new Request(`${BASE}/connect-return/${app}${query}`, { headers: { cookie: "session=ignored" } }),
    createRouteContext({ app }),
  );

  it.each([["ios", "ai.withmurph.app"], ["ios-dev", "ai.withmurph.app.dev"]])("sends %s to the app's own scheme with the provider's query", async (app, scheme) => {
    const query = `?murph_state=${STATE}&state=error&error_type=provider_credential_error&error=access_denied&isMobile=false&provider=oura`;
    const response = await get(app, query);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${scheme}://connect-return${query}`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("still returns to the app with no state, and drops a query past its bound", async () => {
    expect((await get("ios")).headers.get("location")).toBe("ai.withmurph.app://connect-return");
    expect((await get("ios", `?x=${"y".repeat(2_048)}`)).headers.get("location")).toBe("ai.withmurph.app://connect-return");
  });

  it.each(["website", "android", "toString", "ios%2F..%2Fx"])("is not found for %s", async app => {
    const response = await get(app);
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });

  it("reads no session, state or store", async () => {
    await get("ios", `?murph_state=${STATE}`);
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
  });
});
