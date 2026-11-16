import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedMcpConnection, HostedMcpPendingAuthorization } from "@prisma/client";
import type { HostedAppSession } from "../src/lib/hosted-onboarding/app-session";
const mocks = vi.hoisted(() => ({ pending: null as HostedMcpPendingAuthorization | null, row: null as HostedMcpConnection | null,
  fetch: vi.fn(), session: vi.fn(), saveCatalog: vi.fn() }));
vi.mock("../src/lib/hosted-onboarding/app-session", () => ({ assertHostedAppSessionCurrentTx: mocks.session }));
vi.mock("../src/lib/hosted-onboarding/member-access", () => ({ activeHostedPersonAccessWhere: () => ({ suspendedAt: null }) }));
vi.mock("../src/lib/custom-connections/store", () => ({
  readConnection: async () => mocks.row, connectionWhere: (memberId: string) => ({ memberId }), projectConnection: (row: unknown) => row, saveCatalog: mocks.saveCatalog,
  nameConnection: async () => undefined,
}));
vi.mock("../src/lib/custom-connections/upstream", () => ({ listConnectionTools: async () => [], describeConnection: async () => ({ tools: [], serverName: undefined }), readCredentials: async () => undefined }));
vi.mock("../src/lib/custom-connections/secrets", () => ({ openConnectionSecret: async (_member: string, _id: string, _generation: number, _field: string, value: string) => JSON.parse(value),
  sealConnectionSecret: async (_member: string, _id: string, _generation: number, _field: string, value: unknown) => JSON.stringify(value) }));
vi.mock("../src/lib/custom-connections/guarded-fetch", async (original) => ({ ...await original<typeof import("../src/lib/custom-connections/guarded-fetch")>(), guardedConnectionFetch: mocks.fetch }));
vi.mock("../src/lib/prisma", () => {
  const store = {
    hostedMcpPendingAuthorization: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const pending = mocks.pending;
        if (!pending) return null;
        for (const key of ["connectionId", "memberId", "sessionBinding", "stateHash", "generation"] as const) if (pending[key] !== where[key]) return null;
        if (pending.expiresAt <= new Date()) return null;
        return pending;
      },
      deleteMany: async () => { const count = mocks.pending ? 1 : 0; mocks.pending = null; return { count }; },
    },
    hostedMcpConnection: { updateMany: async () => { mocks.row!.status = "off"; return { count: 1 }; } },
  };
  return { getPrisma: () => ({ ...store, $transaction: async (operation: (tx: typeof store) => Promise<unknown>) => operation(store) }) };
});
import { finishConnectionSignIn } from "../src/lib/custom-connections/service";
import { digest } from "../src/lib/custom-connections/catalog";

const issuer = "https://login.example.com";
const session = { member: { id: "member-a" }, sessionId: "browser-session", authProof: {} } as HostedAppSession;
const request = (state = "synthetic-state") => new Request(`https://www.withmurph.ai/api/settings/custom-connections/callback/cc_synthetic?state=${state}&code=synthetic-code&iss=${encodeURIComponent(issuer)}`);
beforeEach(() => {
  mocks.row = { id: "cc_synthetic", memberId: "member-a", slug: "notes", name: "Notes", serverUrl: "https://notes.example.com/mcp", status: "needs_sign_in", auth: "oauth", generation: 1, revision: 0, tools: [], catalog: "catalog", credentialsEncrypted: null, tokenVersion: 0, refreshClaim: null, refreshExpiresAt: null, createdAt: new Date(), lastUsedAt: null };
  mocks.pending = { connectionId: "cc_synthetic", memberId: "member-a", sessionBinding: digest("browser-session"), generation: 1, stateHash: digest("synthetic-state"), expiresAt: new Date(Date.now() + 60_000),
    payloadEncrypted: JSON.stringify({ verifier: "synthetic-verifier", client: { client_id: "synthetic-client", issuer }, discovery: {
      authorizationServerUrl: issuer, resourceMetadata: { resource: "https://notes.example.com/mcp", authorization_servers: [issuer] },
      authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`, code_challenge_methods_supported: ["S256"], response_types_supported: ["code"] },
    } }) };
  mocks.fetch.mockResolvedValue(Response.json({ access_token: "synthetic-access", token_type: "Bearer" }));
});
afterEach(() => vi.resetAllMocks());
describe("pending browser authorization consumption", () => {
  it("consumes state once before exchange; replay never reaches the provider", async () => {
    await finishConnectionSignIn(request(), session, "cc_synthetic");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await expect(finishConnectionSignIn(request(), session, "cc_synthetic")).rejects.toThrow();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["expired", "wrong_session", "wrong_member", "wrong_state", "stale_generation", "revoked_session"])("rejects %s before exchanging the code", async (kind) => {
    if (kind === "expired") mocks.pending!.expiresAt = new Date(0);
    if (kind === "wrong_session") mocks.pending!.sessionBinding = digest("another-session");
    if (kind === "wrong_member") mocks.pending!.memberId = "member-b";
    if (kind === "stale_generation") mocks.row!.generation = 2;
    if (kind === "revoked_session") mocks.session.mockRejectedValue(new Error("session revoked"));
    await expect(finishConnectionSignIn(request(kind === "wrong_state" ? "another-state" : undefined), session, "cc_synthetic")).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
