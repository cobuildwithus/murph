import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { resolveConnectSources } from "@/src/lib/device-sync/connect-sources";
import type { HostedDeviceSyncSettingsUpstreamSource } from "@/src/lib/device-sync/settings-surface";
import { buildAppleHealthRelaySetupGuide } from "@/src/lib/device-sync/apple-health-relay-setup-guide";
import { buildWhoopAppleHealthSetupGuide } from "@/src/lib/device-sync/whoop-apple-health-setup-guide";
import { buildZeppAppleHealthSetupGuide } from "@/src/lib/device-sync/zepp-apple-health-setup-guide";

const mocks = vi.hoisted(() => ({ session: vi.fn(), settings: vi.fn(), grant: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ hostedConsentGrant: { findUnique: mocks.grant } }) }));
vi.mock("@/src/lib/better-auth/config", () => ({ requireHostedBetterAuthConfig: () => ({}) }));
vi.mock("@/src/lib/better-auth/session", () => ({ readHostedAuthSession: mocks.session }));
vi.mock("@/src/lib/device-sync/settings-service", () => ({ buildHostedDeviceSyncSettingsResponse: mocks.settings }));
import { GET } from "../app/api/device-sync/companion/connect-sources/route";

const member = { id: "synthetic-member", billingStatus: "active", suspendedAt: null };
const request = (bearer = true, query = "") => new Request(`https://app.example.test/api/device-sync/companion/connect-sources${query}`, {
  headers: bearer ? { authorization: `Bearer murph_auth_v1.${"a".repeat(32)}` } : {},
});
const upstream = (sourceProviderSlug: string, extra: Partial<HostedDeviceSyncSettingsUpstreamSource> = {}): HostedDeviceSyncSettingsUpstreamSource => ({
  sourceProviderSlug, providerLabel: sourceProviderSlug, resourceCount: 0, status: "connected", ...extra,
});
function settings(upstreamSources: HostedDeviceSyncSettingsUpstreamSource[], extra = {}) {
  const sources = [{ connectionId: "synthetic-connection", provider: "junction", state: "active" as const, upstreamSources, ...extra }];
  mocks.settings.mockResolvedValue({ sources });
  return sources;
}
async function payload() {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MURPH_ANDROID_APP_ENABLED", "1");
  mocks.session.mockResolvedValue({ session: { member, sessionId: "synthetic-session", proof: {} } });
  mocks.grant.mockResolvedValue({ scope: "launch.health-data", status: "granted" });
  settings([]);
});
afterEach(() => vi.unstubAllEnvs());

it("returns the resolver's phone-startable list and shared relay copy without connections or actions", async () => {
  const body = await payload();
  expect(body.schemaVersion).toBe(1);
  expect(body.sources.map((row: { id: string }) => row.id)).toEqual(
    resolveConnectSources().filter(row => !["mobvoi-health", "dexcom"].includes(row.id)).map(row => row.id),
  );
  let relays = 0;
  for (const row of body.sources) {
    expect(Object.keys(row).sort()).toEqual(["id", "name", "logoPath", "path", ...(row.relay ? ["relay"] : []),
      ...(row.path === "apple_health_relay" ? [] : ["sourceProviderSlug"])].sort());
    expect(row.id).toBeTruthy();
    expect(row.name).toBeTruthy();
    // The app's own guard (murph-ios MurphCompanion/Core/APIClient.swift, fetchConnectLogo): no subfolders.
    expect(row.logoPath).toMatch(/^\/brand-logos\/connect\/[A-Za-z0-9._-]+\.png$/u);
    expect(existsSync(path.join(process.cwd(), "apps/web/public", row.logoPath))).toBe(true);
    expect(["apple_health", "apple_health_relay", "web"]).toContain(row.path);
    const source = resolveConnectSources().find(source => source.id === row.id)!;
    const guide = row.id === "whoop" ? buildWhoopAppleHealthSetupGuide()
      : source.setupGuideId === "zepp-apple-health" ? buildZeppAppleHealthSetupGuide()
        : source.setupGuideId ? buildAppleHealthRelaySetupGuide(source.setupGuideId) : null;
    if (guide) {
      expect(row.relay).toEqual({ stepTitle: guide.steps[1].title, stepDetail: guide.steps[1].detail });
      expect(row.path).toBe(row.id === "whoop" ? "web" : "apple_health_relay");
      relays++;
    }
  }
  expect(relays).toBe(7);
  expect(body.sources[0].path).toBe("apple_health");
  expect(await (await GET(request(true, "?ignored=value"))).json()).toEqual(body);
  expect(mocks.settings).toHaveBeenCalledWith({ member });
});

it("names each source's own status slug, and none for a wearable that comes in through Apple Health", async () => {
  const slugs = Object.fromEntries((await payload()).sources
    .map((row: { id: string; sourceProviderSlug?: string }) => [row.id, row.sourceProviderSlug]));
  expect(slugs).toMatchObject({
    "apple-health": "apple_health_kit", fitbit: "google_health", garmin: "garmin", oura: "oura", whoop: "whoop_v2",
  });
  expect(slugs.zepp).toBeUndefined();
});

it.each([null, "2026-11-12T09:41:00.000Z"])("returns source-specific arrival time %s", async lastDataAt => {
  settings([upstream("oura", { lastDataAt })]);
  const body = await payload();
  expect(body.sources[0]).toMatchObject({ id: "oura", connection: { state: "connected", lastDataAt } });
  expect(body.sources[1].connection).toBeUndefined();
});

it("offers Sync now and Remove only where each means this one source", async () => {
  settings([upstream("oura"), upstream("whoop_v2", { requiresReconnect: true }), upstream("garmin", { recoveryKind: "connection_reset" }), upstream("apple_health_kit")]);
  const actions = Object.fromEntries((await payload()).sources
    .filter((row: { connection?: unknown }) => row.connection)
    .map((row: { id: string; connection: { actions: string[] } }) => [row.id, row.connection.actions]));
  expect(actions).toEqual({ oura: ["sync", "remove"], whoop: ["remove"], garmin: [], "apple-health": [] });
});

it("keeps sibling arrival times separate", async () => {
  settings([upstream("oura"), upstream("whoop_v2", { lastDataAt: "2026-11-11T00:00:00.000Z" })]);
  const { sources } = await payload();
  expect(sources[0].connection.lastDataAt).toBeNull();
  expect(sources[1].connection.lastDataAt).toBe("2026-11-11T00:00:00.000Z");
});

it.each([["strava", "strava"], ["dexcom", "dexcom_v3"]])("keeps paused %s only while connected", async (id, slug) => {
  expect((await payload()).sources.map((row: { id: string }) => row.id)).not.toContain(id);
  settings([upstream(slug)]);
  expect((await payload()).sources[0]).toMatchObject({ id, connection: { state: "connected", lastDataAt: null } });
});

it.each([
  [{ recoveryKind: "connection_reset" as const }, "connection_reset"],
  [{ requiresReconnect: true }, "reconnect"],
])("prioritizes attention over connected sources and says why: %j", async (recovery, reason) => {
  settings([upstream("oura"), upstream("whoop_v2", recovery)]);
  const [attention, connected] = (await payload()).sources.slice(0, 2);
  expect(attention).toMatchObject({ id: "whoop", connection: { state: "needs_attention", reason } });
  expect(connected).toMatchObject({ id: "oura", connection: { state: "connected" } });
  expect(connected.connection).not.toHaveProperty("reason");
});

it("keeps an unfinished historical reset visible", async () => {
  settings([upstream("whoop_v2", { status: "disconnected" })], { state: "disconnected", historicalResetIncomplete: true });
  expect((await payload()).sources[0]).toMatchObject({
    id: "whoop", connection: { state: "needs_attention", reason: "reset_unfinished", lastDataAt: null },
  });
});

it.each(["authorization_required", "verifying_successor", "cutover_ready"])("projects Fitbit migration %s without changing resolver order", async state => {
  const lastDataAt = "2026-11-12T09:41:00.000Z";
  const successorAt = "2026-11-12T10:41:00.000Z";
  const sources = settings([upstream("fitbit", { lastDataAt }), ...(state === "authorization_required" ? [] : [upstream("google_health", {
    lastDataAt: successorAt, firstSeenAt: "2026-11-12T09:00:00.000Z", resourceCount: 1,
    ...(state === "cutover_ready" ? { fitbitMigrationCoverageReady: true, historicalBackfillComplete: true } : {}),
  })])]);
  const rows = (await payload()).sources;
  expect(rows.find((row: { id: string }) => row.id === "fitbit").connection).toEqual({
    state: state === "authorization_required" ? "needs_attention" : "connected",
    ...(state === "authorization_required" ? { reason: "fitbit_migration" } : {}),
    lastDataAt: state === "authorization_required" ? lastDataAt : successorAt,
    actions: [],
  });
  expect(rows.map((row: { id: string }) => row.id)).toEqual(resolveConnectSources(sources).filter(row => !["mobvoi-health", "dexcom"].includes(row.id)).map(row => row.id));
});

it.each([null, { scope: "launch.health-data", status: "revoked" }])("returns the unconnected list without a health grant: %j", async grant => {
  const empty = await payload();
  settings([upstream("oura")]);
  mocks.settings.mockClear();
  mocks.grant.mockResolvedValue(grant);
  expect(await payload()).toEqual(empty);
  expect(mocks.settings).not.toHaveBeenCalled();
});

it.each(["HOSTED_ACCESS_REQUIRED", "HOSTED_CONSENT_REQUIRED"])("returns the unconnected list for %s", async code => {
  const empty = await payload();
  mocks.settings.mockRejectedValue(hostedOnboardingError({ code, httpStatus: 403, message: "Unavailable." }));
  expect(await payload()).toEqual(empty);
});

it("preserves other failures and rejects missing bearer auth before reading settings", async () => {
  mocks.settings.mockRejectedValue(hostedOnboardingError({ code: "UNEXPECTED_FAILURE", httpStatus: 503, message: "Unavailable." }));
  expect((await GET(request())).status).toBe(503);
  mocks.settings.mockClear();
  const response = await GET(request(false));
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe("AUTH_REQUIRED");
  expect(mocks.settings).not.toHaveBeenCalled();
});
