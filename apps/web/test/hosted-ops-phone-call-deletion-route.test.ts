import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  deleteHostedLegacyPhoneCalls: vi.fn(),
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: mocks.requireActiveHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/phone-calls/legacy-private-content-deletion", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/phone-calls/legacy-private-content-deletion")>(),
  deleteHostedLegacyPhoneCalls: mocks.deleteHostedLegacyPhoneCalls,
}));

import { POST } from "../app/api/ops/phone-calls/legacy-plaintext/route";
import { parseHostedLegacyPhoneCallDeletionOptions } from "@/src/lib/phone-calls/legacy-private-content-deletion";

const originalAllowlist = process.env.HOSTED_OPS_MEMBER_IDS;
const base = "https://www.withmurph.ai";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", base);
  vi.stubEnv("HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS", "");
  process.env.HOSTED_OPS_MEMBER_IDS = "member_operator";
  mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({ member: { id: "member_operator" } });
  mocks.deleteHostedLegacyPhoneCalls.mockResolvedValue({
    mode: "dry-run", selectedRows: 0, providerRows: 0, deletedRows: 0, failedRows: 0, failureCode: null,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (originalAllowlist === undefined) delete process.env.HOSTED_OPS_MEMBER_IDS;
  else process.env.HOSTED_OPS_MEMBER_IDS = originalAllowlist;
});

function request(body: unknown, origin = base) {
  return new Request(`${base}/api/ops/phone-calls/legacy-plaintext`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("legacy phone-call Ops deletion boundary", () => {
  it("defaults an authenticated same-origin request to metadata-only dry run", async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.deleteHostedLegacyPhoneCalls).toHaveBeenCalledWith({
      options: { mode: "dry-run" }, signal: expect.any(AbortSignal),
    });
    expect(await response.json()).toMatchObject({
      selectedRows: 0, providerRows: 0, deletedRows: 0, failedRows: 0,
    });
  });

  it("rejects foreign origins before reading the active session", async () => {
    const response = await POST(request({}, "https://untrusted.example"));
    expect(response.status).toBe(403);
    expect(mocks.requireActiveHostedAppSessionFromRequest).not.toHaveBeenCalled();
    expect(mocks.deleteHostedLegacyPhoneCalls).not.toHaveBeenCalled();
  });

  it("hides the operation from a non-allowlisted member", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({ member: { id: "member_other" } });
    expect((await POST(request({}))).status).toBe(404);
    expect(mocks.deleteHostedLegacyPhoneCalls).not.toHaveBeenCalled();
  });

  it.each([
    { mode: "apply" }, { mode: "delete" }, { mode: null },
    { mode: "apply", expectedRows: -1 }, { mode: "apply", expectedRows: 1.5 },
    { mode: "apply", expectedRows: 9 }, { mode: "apply", expectedRows: "1" },
    { mode: "dry-run", memberId: "member_other" },
  ])("rejects invalid or broadened input %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.deleteHostedLegacyPhoneCalls).not.toHaveBeenCalled();
  });

  it("bounds the body and accepts an explicit expected selection", async () => {
    expect((await POST(request({ padding: "x".repeat(1025) }))).status).toBe(413);
    expect(mocks.deleteHostedLegacyPhoneCalls).not.toHaveBeenCalled();
    expect(parseHostedLegacyPhoneCallDeletionOptions({ mode: "apply", expectedRows: 2 }))
      .toEqual({ mode: "apply", expectedRows: 2 });
  });
});
