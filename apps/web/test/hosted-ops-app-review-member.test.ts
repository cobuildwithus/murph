import { HostedBillingStatus } from "@prisma/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  prepareHostedOpsAppReviewMember: vi.fn(),
  requireHostedOpsRequestAccess: vi.fn(),
}));

vi.mock("@/src/lib/hosted-ops/access", () => ({
  requireHostedOpsRequestAccess: mocks.requireHostedOpsRequestAccess,
}));

vi.mock("@/src/lib/hosted-ops/app-review-member", () => ({
  prepareHostedOpsAppReviewMember: mocks.prepareHostedOpsAppReviewMember,
}));

type RouteModule = typeof import("../app/api/ops/app-review-member/route");

let route: RouteModule;

describe("hosted ops App Review member route", () => {
  beforeAll(async () => {
    route = await import("../app/api/ops/app-review-member/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedOpsRequestAccess.mockResolvedValue({ member: { id: "member_ops" } });
    mocks.prepareHostedOpsAppReviewMember.mockResolvedValue({
      action: "dry-run",
      billingStatus: HostedBillingStatus.active,
      consentGranted: true,
      consentScopes: ["launch.legal", "launch.health-data"],
      member: "memb...1234",
      metadataSynced: true,
      principal: "email:t***@privy.io",
      privyUser: "priv...1234",
      suspended: false,
    });
  });

  it("runs a dry-run through the authenticated same-origin ops route", async () => {
    const request = new Request("https://join.example.test/api/ops/app-review-member", {
      body: JSON.stringify({
        email: "reviewer@example.test",
        mode: "dry-run",
      }),
      headers: {
        "Content-Type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    });

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedOpsRequestAccess).toHaveBeenCalledWith(request, {
      requireMutationOrigin: true,
    });
    expect(mocks.prepareHostedOpsAppReviewMember).toHaveBeenCalledWith({
      createPrivyUser: false,
      mode: "dry-run",
      principal: {
        kind: "email",
        value: "reviewer@example.test",
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      action: "dry-run",
      consentGranted: true,
      principal: "email:t***@privy.io",
    });
  });

  it("applies only when requested explicitly", async () => {
    mocks.prepareHostedOpsAppReviewMember.mockResolvedValueOnce({
      action: "applied",
      activated: true,
      billingStatus: HostedBillingStatus.active,
      consentGranted: true,
      consentScopes: ["launch.legal", "launch.health-data"],
      member: "memb...1234",
      metadataSynced: true,
      principal: "email:t***@privy.io",
      privyUser: "priv...1234",
      suspended: false,
    });

    const response = await route.POST(
      new Request("https://join.example.test/api/ops/app-review-member", {
        body: JSON.stringify({
          createPrivyUser: true,
          email: "reviewer@example.test",
          mode: "apply",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.prepareHostedOpsAppReviewMember).toHaveBeenCalledWith({
      createPrivyUser: true,
      mode: "apply",
      principal: {
        kind: "email",
        value: "reviewer@example.test",
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      action: "applied",
      activated: true,
      consentGranted: true,
    });
  });

  it("rejects invalid mode or ambiguous principals before provisioning", async () => {
    const invalidMode = await route.POST(
      new Request("https://join.example.test/api/ops/app-review-member", {
        body: JSON.stringify({
          email: "reviewer@example.test",
          mode: "delete",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(invalidMode.status).toBe(400);
    await expect(invalidMode.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_APP_REVIEW_MEMBER_MODE_INVALID",
      },
    });

    const ambiguousPrincipal = await route.POST(
      new Request("https://join.example.test/api/ops/app-review-member", {
        body: JSON.stringify({
          email: "reviewer@example.test",
          phone: "+15555550123",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(ambiguousPrincipal.status).toBe(400);
    expect(mocks.prepareHostedOpsAppReviewMember).not.toHaveBeenCalled();
    await expect(ambiguousPrincipal.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_APP_REVIEW_MEMBER_PRINCIPAL_REQUIRED",
      },
    });
  });

  it("rejects invalid createPrivyUser before provisioning", async () => {
    const response = await route.POST(
      new Request("https://join.example.test/api/ops/app-review-member", {
        body: JSON.stringify({
          createPrivyUser: "yes",
          email: "reviewer@example.test",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.prepareHostedOpsAppReviewMember).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_APP_REVIEW_MEMBER_CREATE_PRIVY_USER_INVALID",
      },
    });
  });

  it("requires apply mode and email principal before creating a Privy test user", async () => {
    const dryRun = await route.POST(
      new Request("https://join.example.test/api/ops/app-review-member", {
        body: JSON.stringify({
          createPrivyUser: true,
          email: "reviewer@example.test",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(dryRun.status).toBe(400);
    await expect(dryRun.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_APP_REVIEW_MEMBER_CREATE_PRIVY_USER_REQUIRES_APPLY",
      },
    });

    const phone = await route.POST(
      new Request("https://join.example.test/api/ops/app-review-member", {
        body: JSON.stringify({
          createPrivyUser: true,
          mode: "apply",
          phone: "+15555550123",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(phone.status).toBe(400);
    expect(mocks.prepareHostedOpsAppReviewMember).not.toHaveBeenCalled();
    await expect(phone.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_APP_REVIEW_MEMBER_CREATE_PRIVY_USER_EMAIL_REQUIRED",
      },
    });
  });

  it("does not provision when ops access fails", async () => {
    mocks.requireHostedOpsRequestAccess.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_OPS_ACCESS_DENIED",
        httpStatus: 404,
        message: "Hosted ops route was not found.",
      }),
    );

    const response = await route.POST(
      new Request("https://join.example.test/api/ops/app-review-member", {
        body: JSON.stringify({
          email: "reviewer@example.test",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.prepareHostedOpsAppReviewMember).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_ACCESS_DENIED",
      },
    });
  });
});
