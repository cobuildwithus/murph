import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedMcpConnection } from "@prisma/client";
const mocks = vi.hoisted(() => ({ row: null as HostedMcpConnection | null, fetch: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ hostedMcpConnection: {
  updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const row = mocks.row;
    if (!row) return { count: 0 };
    for (const key of ["generation", "revision", "tokenVersion", "refreshClaim"] as const) if (Object.hasOwn(where, key) && row[key] !== where[key]) return { count: 0 };
    if (typeof where.status === "string" && row.status !== where.status) return { count: 0 };
    if (typeof where.status === "object" && row.status === "off") return { count: 0 };
    if (where.member && row.memberId !== "member-a") return { count: 0 };
    for (const [key, value] of Object.entries(data)) {
      if (key === "tokenVersion") row.tokenVersion++;
      else Object.assign(row, { [key]: value });
    }
    return { count: 1 };
  },
} }) }));
vi.mock("../src/lib/hosted-onboarding/member-access", () => ({ activeHostedPersonAccessWhere: () => ({ suspendedAt: null }) }));
vi.mock("../src/lib/custom-connections/secrets", () => ({ openConnectionSecret: async (_member: string, _id: string, _generation: number, _field: string, value: string) => JSON.parse(value),
  sealConnectionSecret: async (_member: string, _id: string, _generation: number, _field: string, value: unknown) => JSON.stringify(value) }));
vi.mock("../src/lib/custom-connections/guarded-fetch", async (original) => ({ ...await original<typeof import("../src/lib/custom-connections/guarded-fetch")>(), guardedConnectionFetch: mocks.fetch }));
import { connectionAccessToken } from "../src/lib/custom-connections/upstream";
const issuer = "https://login.example.com";
const credentials = { discovery: { authorizationServerUrl: issuer, resourceMetadata: { resource: "https://notes.example.com/mcp", authorization_servers: [issuer] },
  authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`, code_challenge_methods_supported: ["S256"], response_types_supported: ["code"], authorization_response_iss_parameter_supported: true } },
  client: { client_id: "synthetic-client", issuer }, tokens: { access_token: "old-access", refresh_token: "rotation-0", token_type: "Bearer", issuer }, expiresAt: 0 };
function row(): HostedMcpConnection {
  return { id: "cc_synthetic", memberId: "member-a", slug: "notes", name: "Notes", serverUrl: "https://notes.example.com/mcp", status: "on", auth: "oauth", generation: 1,
    revision: 0, tools: [], catalog: "catalog", credentialsEncrypted: JSON.stringify(credentials), tokenVersion: 0, refreshClaim: null, refreshExpiresAt: null, createdAt: new Date(), lastUsedAt: null };
}
beforeEach(() => { mocks.row = row(); });
afterEach(() => vi.resetAllMocks());
describe("refresh claim before provider rotation", () => {
  it("rotates exactly once for concurrent calls sharing version zero", async () => {
    mocks.fetch.mockImplementation(async () => { await Promise.resolve(); return Response.json({ access_token: "new-access", refresh_token: "rotation-1", token_type: "Bearer", expires_in: 3600 }); });
    const snapshot = row();
    const results = await Promise.allSettled([connectionAccessToken(snapshot), connectionAccessToken(snapshot), connectionAccessToken(snapshot)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.row?.tokenVersion).toBe(1);
    expect(await connectionAccessToken({ ...mocks.row! })).toBe("new-access");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["replacement", "response_loss"])("does not use an uncommitted token after %s", async (kind) => {
    mocks.fetch.mockImplementation(async () => {
      if (kind === "replacement") mocks.row!.generation++;
      if (kind === "response_loss") throw new Error("bounded transport failure");
      return Response.json({ access_token: "uncommitted-access", refresh_token: "rotation-1", token_type: "Bearer", expires_in: 3600 });
    });
    await expect(connectionAccessToken(row())).rejects.toThrow();
    expect(mocks.row?.tokenVersion).toBe(0);
    expect(mocks.row?.credentialsEncrypted).not.toContain("uncommitted-access");
    if (kind === "replacement") expect(mocks.row?.generation).toBe(2);
    if (kind === "response_loss") expect(mocks.row?.status).toBe("needs_sign_in");
  });
  it.each(["turned_off", "tools_changed"])("keeps a rotated token when Settings changes during the refresh (%s)", async (kind) => {
    mocks.fetch.mockImplementation(async () => {
      if (kind === "turned_off") { mocks.row!.status = "off"; mocks.row!.revision++; }
      if (kind === "tools_changed") mocks.row!.revision++;
      return Response.json({ access_token: "rotated-access", refresh_token: "rotation-1", token_type: "Bearer", expires_in: 3600 });
    });
    expect(await connectionAccessToken(row())).toBe("rotated-access");
    expect(mocks.row?.tokenVersion).toBe(1);
    expect(mocks.row?.status).toBe(kind === "turned_off" ? "off" : "on");
  });
  it.each([429, 500, 503])("sends a refresh token once when the provider answers %s, then needs sign-in", async (status) => {
    mocks.fetch.mockImplementation(async () => new Response("unavailable", { status }));
    await expect(connectionAccessToken(row())).rejects.toThrow();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.row?.status).toBe("needs_sign_in");
  });
  it("requires sign-in after an expired abandoned claim without another rotation", async () => {
    mocks.row!.refreshClaim = "abandoned"; mocks.row!.refreshExpiresAt = new Date(0);
    await expect(connectionAccessToken({ ...mocks.row! })).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.row?.status).toBe("needs_sign_in");
  });
});
