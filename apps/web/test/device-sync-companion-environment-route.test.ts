import { beforeEach, expect, test, vi } from "vitest";
import { environmentClient } from "./fixtures/companion-environment";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), authority: vi.fn(), workspace: vi.fn(), decode: vi.fn(),
  session: vi.fn(), prepare: vi.fn(), after: vi.fn(),
}));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({ requireActivePrivyMemberAuthFromBearerToken: mocks.auth }));
vi.mock("@/src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock("@/src/lib/hosted-workspace/store", () => ({ readHostedBrowserVaultReplicaState: mocks.workspace }));
vi.mock("@/src/lib/browser-vault/loader", () => ({ decodeBrowserVaultCoreSession: mocks.decode }));
vi.mock("@/src/lib/browser-vault/homepage-preparation-worker", () => ({ prepareHomepageBrowserVaultBestEffort: mocks.prepare }));
vi.mock("@/src/lib/hosted-execution/control", () => ({ readHostedExecutionControlClientIfConfigured: () => ({ createBrowserVaultSession: mocks.session }) }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@murphai/hosted-execution/parsers", () => ({ parseHostedBrowserVaultReplicaRef: (value: unknown) => value }));
vi.mock("@murphai/hosted-execution", () => ({ assessBrowserVaultReplicaFreshness: () => ({ freshness: "stale", shouldRefresh: true }) }));

import { GET } from "../app/api/device-sync/companion/environment/route";
const request = () => new Request("https://example.test/api/device-sync/companion/environment?units=imperial");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ member: { id: "synthetic-member" } });
  mocks.authority.mockResolvedValue(undefined);
  mocks.workspace.mockResolvedValue({ browserVaultReplicaRef: { generatedAt: "2026-09-06T12:00:00.000Z" } });
  mocks.session.mockResolvedValue({ state: "ready" });
  mocks.decode.mockResolvedValue(environmentClient());
});

test("returns only the report with bearer admission, core-only demand and post-read authority", async () => {
  const req = request();
  const response = await GET(req);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.auth).toHaveBeenCalledWith(req, {});
  expect(mocks.session).toHaveBeenCalledWith(expect.objectContaining({ requestedShards: ["core"], userId: "synthetic-member" }));
  expect(mocks.decode).toHaveBeenCalledWith(expect.objectContaining({ expectedMemberId: "synthetic-member" }));
  expect(mocks.authority).toHaveBeenCalledTimes(2);
  const json = await response.json();
  expect(json.grade.letter).toBe("B");
  expect(json.freshness).toBe("stale");
  expect(JSON.stringify(json)).not.toContain("synthetic-member");
  expect(json).not.toHaveProperty("replicaKeyEnvelope");
});

test("does not treat a missing replica as an empty graded home", async () => {
  mocks.workspace.mockResolvedValue(null);
  const response = await GET(request());
  expect(await response.json()).toEqual({ schema: "murph.companion.environment.v1", state: "preparing" });
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.after).toHaveBeenCalledTimes(1);
});

test("denied auth never reads the workspace or private projection", async () => {
  mocks.auth.mockRejectedValue(hostedOnboardingError({ code: "AUTH_REQUIRED", message: "Sign in", httpStatus: 401 }));
  expect((await GET(request())).status).toBe(401);
  expect(mocks.workspace).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
});

test("withdrawal during the read prevents returning the report", async () => {
  mocks.authority.mockResolvedValueOnce(undefined).mockRejectedValueOnce(hostedOnboardingError({
    code: "CONSENT_REQUIRED", message: "Review consent", httpStatus: 403,
  }));
  const response = await GET(request());
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("categories");
});

test("decoder failures never expose private payload text", async () => {
  mocks.decode.mockRejectedValue(new Error("synthetic-private-note"));
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("synthetic-private-note");
});
