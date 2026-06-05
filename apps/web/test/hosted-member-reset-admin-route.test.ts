import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runResetHostedMemberRuntimeCommand: vi.fn(),
  safeErrorMessage: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error)
  ),
}));

vi.mock("@/scripts/reset-hosted-member-runtime", () => ({
  runResetHostedMemberRuntimeCommand: mocks.runResetHostedMemberRuntimeCommand,
  safeErrorMessage: mocks.safeErrorMessage,
}));

describe("hosted member reset admin route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_MEMBER_RESET_ADMIN_ENABLED = "1";
    process.env.HOSTED_MEMBER_RESET_ADMIN_TOKEN = "test-admin-token";
    mocks.runResetHostedMemberRuntimeCommand.mockResolvedValue([
      {
        member: "sha256:member",
        mode: "dry-run",
        schema: "murph.hosted-member-runtime-reset-script.v1",
        step: "start",
        targets: {
          executionTargetFingerprint: "sha256:target",
        },
      },
      {
        member: "sha256:member",
        schema: "murph.hosted-member-runtime-reset-script.v1",
        step: "dry-run-complete",
      },
    ]);
  });

  afterEach(() => {
    delete process.env.HOSTED_MEMBER_RESET_ADMIN_ENABLED;
    delete process.env.HOSTED_MEMBER_RESET_ADMIN_TOKEN;
  });

  it("stays disabled unless the production env flag is set", async () => {
    delete process.env.HOSTED_MEMBER_RESET_ADMIN_ENABLED;
    const { POST } = await import("../app/api/internal/admin/hosted-member-reset/route");

    const response = await POST(buildRequest({
      memberId: "member_fixture",
      mode: "dry-run",
    }));

    expect(response.status).toBe(404);
    expect(mocks.runResetHostedMemberRuntimeCommand).not.toHaveBeenCalled();
  });

  it("runs dry-run with fixed production environment args after bearer auth", async () => {
    const { POST } = await import("../app/api/internal/admin/hosted-member-reset/route");

    const response = await POST(buildRequest({
      memberId: "member_fixture",
      mode: "dry-run",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      targetFingerprint: "sha256:target",
    });
    expect(mocks.runResetHostedMemberRuntimeCommand).toHaveBeenCalledWith([
      "--member-id",
      "member_fixture",
      "--environment",
      "production",
      "--dry-run",
    ]);
  });

  it("requires execute confirmations and unsuspendAfterReset before mutating", async () => {
    const { POST } = await import("../app/api/internal/admin/hosted-member-reset/route");

    const rejected = await POST(buildRequest({
      confirmEnvironment: "production",
      confirmMemberId: "member_fixture",
      confirmTargetFingerprint: "sha256:target",
      memberId: "member_fixture",
      mode: "execute",
    }));
    expect(rejected.status).toBe(400);
    expect(mocks.runResetHostedMemberRuntimeCommand).not.toHaveBeenCalled();

    const accepted = await POST(buildRequest({
      confirmEnvironment: "production",
      confirmMemberId: "member_fixture",
      confirmTargetFingerprint: "sha256:target",
      memberId: "member_fixture",
      mode: "execute",
      resumeSuspendedReset: true,
      unsuspendAfterReset: true,
    }));

    expect(accepted.status).toBe(200);
    expect(mocks.runResetHostedMemberRuntimeCommand).toHaveBeenCalledWith([
      "--member-id",
      "member_fixture",
      "--environment",
      "production",
      "--execute",
      "--confirm-member-id",
      "member_fixture",
      "--confirm-environment",
      "production",
      "--confirm-target-fingerprint",
      "sha256:target",
      "--unsuspend-after-reset",
      "--confirm-unsuspend-after-reset",
      "member_fixture",
      "--resume-suspended-reset",
    ]);
  });

  it("rejects missing bearer tokens", async () => {
    const { POST } = await import("../app/api/internal/admin/hosted-member-reset/route");
    const response = await POST(new Request("https://example.test", {
      body: JSON.stringify({
        memberId: "member_fixture",
        mode: "dry-run",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }));

    expect(response.status).toBe(401);
    expect(mocks.runResetHostedMemberRuntimeCommand).not.toHaveBeenCalled();
  });
});

function buildRequest(body: Record<string, unknown>): Request {
  return new Request("https://example.test", {
    body: JSON.stringify(body),
    headers: {
      authorization: "Bearer test-admin-token",
      "content-type": "application/json",
    },
    method: "POST",
  });
}
