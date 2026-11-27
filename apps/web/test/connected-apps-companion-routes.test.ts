import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as list } from "../app/api/connected-apps/companion/apps/route";
import { POST as start } from "../app/api/connected-apps/companion/apps/[appId]/start/route";
import { POST as disconnect } from "../app/api/connected-apps/companion/accounts/[accountId]/disconnect/route";
import { getHostedConnectedAppsWritePolicy, readHostedConnectedAppsConfig } from "@/src/lib/connected-apps/config";
import { presentCompanionConnectedApps } from "@/src/lib/connected-apps/companion-catalog";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  access: vi.fn(), active: vi.fn(), completions: vi.fn(), group: vi.fn(), session: vi.fn(),
}));
vi.mock("@/src/lib/better-auth/config", () => ({ requireHostedBetterAuthConfig: () => ({}) }));
vi.mock("@/src/lib/better-auth/session", () => ({ readHostedAuthSession: mocks.session }));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed: mocks.access,
  isHostedThreadContainerMember: mocks.group,
  readActiveHostedMemberAccess: mocks.active,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({ hostedConnectedAppConnectIntent: { findMany: mocks.completions } }),
}));

const bearer = { authorization: `Bearer murph_auth_v1.${"b".repeat(32)}` };
const memberId = "member_asteroid";
const origin = "https://companion.example.test/api/connected-apps/companion";
type RouteHeaders = HeadersInit;
const get = (headers: RouteHeaders = bearer) => list(new Request(`${origin}/apps`, { headers }));
function begin(appId: string, appReturn: string, headers: RouteHeaders = bearer) {
  return start(new Request(`${origin}/apps/${appId}/start`, {
    method: "POST", headers, body: JSON.stringify({ appReturn }),
  }), { params: Promise.resolve({ appId }) });
}
function remove(accountId: string, headers: RouteHeaders = bearer) {
  return disconnect(new Request(`${origin}/accounts/${accountId}/disconnect`, { method: "POST", headers }),
    { params: Promise.resolve({ accountId }) });
}

function account(id: string, toolkit: string, alias: string | null, createdAt: string, owner = memberId) {
  return { id, user_id: owner, status: "ACTIVE", toolkit: { slug: toolkit }, alias, created_at: createdAt, word_id: "mint-orbit" };
}

function provider({ accountStatus = "ACTIVE", revokeStatus = 200 } = {}) {
  const items = [
    account("ca_later", "gmail", "Archive", "2026-06-01"),
    account("ca_legacy", "paper_stack", null, "2026-07-01"),
    account("ca_older", "gmail", null, "2026-04-01"),
    account("ca_elsewhere", "gmail", null, "2026-02-01", "member_satellite"),
  ];
  const legacy = items[1]!;
  legacy.status = accountStatus;
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit) => {
    const url = new URL(input);
    const query = url.searchParams;
    if (url.pathname === "/api/v3.1/connected_accounts") {
      expect(query.getAll("user_ids")).toEqual([memberId]);
      expect(query.get("account_type")).toBe("PRIVATE");
      expect(query.has("toolkit_slugs")).toBe(false);
      const id = query.get("connected_account_ids");
      calls.push(id ? `lookup ${id}` : "inventory");
      if (!id) expect(query.getAll("statuses")).toEqual(["ACTIVE"]);
      // Simulate a provider that accepts but ignores the user_ids filter.
      const visible = items.filter(a => (!id || id === a.id)
        && (!query.has("statuses") || a.status === query.get("statuses")));
      return Response.json({ items: visible, next_cursor: null });
    }
    if (init.method === "DELETE") {
      expect(url.pathname).toBe("/api/v3.1/connected_accounts/ca_legacy");
      calls.push("delete ca_legacy");
      items.splice(items.indexOf(legacy), 1);
      return Response.json({});
    }
    expect(init.method).toBe("POST");
    expect(url.pathname).toBe("/api/v3.1/connected_accounts/ca_legacy/revoke");
    calls.push("revoke ca_legacy");
    if (revokeStatus !== 200) return Response.json({}, { status: revokeStatus });
    legacy.status = "REVOKED";
    return Response.json({});
  });
  return calls;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("COMPOSIO_API_KEY", "synthetic-key");
  vi.stubEnv("COMPOSIO_CONNECTED_APP_TOOLKITS", "notion,gmail");
  vi.stubEnv("COMPOSIO_MAX_ACCOUNTS_PER_TOOLKIT", "2");
  mocks.session.mockResolvedValue({ session: { member: { id: memberId, billingStatus: "canceled" } } });
  mocks.completions.mockResolvedValue([{ connectedAccountId: "ca_later", completedAt: new Date("2026-06-02") }]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("companion personal connected apps", () => {
  const routes = [
    ["inventory", get],
    ["start", (headers: RouteHeaders) => begin("gmail", "ios", headers)],
    ["disconnect", (headers: RouteHeaders) => remove("ca_legacy", headers)],
  ] as const;
  it.each(routes)("%s requires a bearer and rejects cookies", async (_name, run) => {
    const credentials: RouteHeaders[] = [{}, { cookie: "murph-auth-session=fixture" }, { ...bearer, cookie: "murph-auth-session=fixture" }];
    for (const headers of credentials) {
      const response = await run(headers);
      expect(response.status).toBe(401);
    }
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each(routes)("%s refuses group containers before provider access", async (_name, run) => {
    const calls = provider();
    mocks.group.mockResolvedValue(true);
    const response = await run(bearer);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("CONNECTED_APPS_PERSONAL_MEMBER_REQUIRED");
    expect(calls).toEqual([]);
  });
  it("lists owned active accounts oldest first and includes removable legacy toolkits", async () => {
    provider();
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ schemaVersion: 1, apps: [
      { id: "notion", name: "Notion", kind: "Notes", detail: "Murph can read your pages.",
        logoPath: "/brand-logos/connect/notion-app.png", canAdd: true, accounts: [] },
      { id: "gmail", name: "Gmail", kind: "Email", detail: "Murph can read your email and send one when you ask.",
        logoPath: "/brand-logos/connect/gmail-app.png", canAdd: false, accounts: [
          { id: "ca_older", name: null, connectedAt: null },
          { id: "ca_later", name: "Archive", connectedAt: "2026-06-02T00:00:00.000Z" },
        ] },
      { id: "paper_stack", name: "Paper Stack", kind: null, detail: null, logoPath: null, canAdd: false,
        accounts: [{ id: "ca_legacy", name: null, connectedAt: null }] },
    ] });
    expect(mocks.completions).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ memberId }) }));
    expect(mocks.access).toHaveBeenCalledOnce();
  });
  it("checks access for start, rejects unconfigured apps and accepts only known return builds", async () => {
    expect((await begin("paper_stack", "ios")).status).toBe(404);
    expect((await begin("gmail", "https://elsewhere.example.test")).status).toBe(400);
    mocks.access.mockRejectedValue(hostedOnboardingError({ code: "HOSTED_ACCESS_REQUIRED", httpStatus: 403, message: "Access required." }));
    expect((await begin("gmail", "ios")).status).toBe(403);
    expect((await get()).status).toBe(403);
  });
  it("returns 404 without revoking when the provider returns the requested ID with another owner", async () => {
    const calls = provider();
    const response = await remove("ca_elsewhere");
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("CONNECTED_APPS_ACCOUNT_NOT_FOUND");
    expect(calls).toEqual(["lookup ca_elsewhere"]);
  });
  it.each(["ca_missing", "Archive", "mint-orbit", "CA_LEGACY"])("refuses non-owned or inexact ID %s", async id => {
    const calls = provider();
    expect((await remove(id)).status).toBe(404);
    expect(calls).toEqual([`lookup ${id}`]);
  });
  it("revokes the exact owned account and reads fresh inventory with lapsed access", async () => {
    mocks.access.mockRejectedValue(new Error("Product admission unavailable"));
    mocks.active.mockResolvedValue(false);
    const calls = provider();
    const response = await remove("ca_legacy");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.schemaVersion).toBe(1);
    expect(result.apps.map((app: { id: string }) => app.id)).toEqual(["notion", "gmail"]);
    expect(calls).toEqual(["lookup ca_legacy", "revoke ca_legacy", "inventory"]);
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.active).not.toHaveBeenCalled();
  });
  it.each([400, 409])("deletes the account after revoke HTTP %i and refreshes the list", async revokeStatus => {
    const calls = provider({ revokeStatus });
    const response = await remove("ca_legacy");
    expect(response.status).toBe(200);
    expect((await response.json()).apps.map((app: { id: string }) => app.id)).toEqual(["notion", "gmail"]);
    expect(calls).toEqual(["lookup ca_legacy", "revoke ca_legacy", "delete ca_legacy", "inventory"]);
  });
  it("deletes an inactive owned account directly", async () => {
    const calls = provider({ accountStatus: "EXPIRED" });
    expect((await remove("ca_legacy")).status).toBe(200);
    expect(calls).toEqual(["lookup ca_legacy", "delete ca_legacy", "inventory"]);
  });
  it("propagates revoke 5xx without deleting or listing accounts", async () => {
    const calls = provider({ revokeStatus: 502 });
    const response = await remove("ca_legacy");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("CONNECTED_APPS_PROVIDER_UNAVAILABLE");
    expect(body).not.toHaveProperty("apps");
    expect(calls).toEqual(["lookup ca_legacy", "revoke ca_legacy"]);
  });
  it("backs every catalog write promise with the matching toolkit policy and ships each logo", () => {
    const rows = presentCompanionConnectedApps(readHostedConnectedAppsConfig({ COMPOSIO_API_KEY: "test" }), []).apps;
    const policies = ["GMAIL_SEND_EMAIL", "OUTLOOK_SEND_EMAIL", "GOOGLECALENDAR_CREATE_EVENT", "OUTLOOK_CALENDAR_CREATE_EVENT"]
      .map(getHostedConnectedAppsWritePolicy);
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(row.logoPath).toMatch(/^\/brand-logos\/connect\/[A-Za-z0-9._-]+\.png$/);
      expect(existsSync(new URL(`../public${row.logoPath}`, import.meta.url))).toBe(true);
      expect(row.detail?.includes("send")).toBe(policies.some(p => p?.toolkit === row.id && p.kind === "email"));
      expect(row.detail?.includes("add")).toBe(policies.some(p => p?.toolkit === row.id && p.kind === "calendar-event"));
    }
  });
});
