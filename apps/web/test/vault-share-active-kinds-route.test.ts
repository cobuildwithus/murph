import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getPrisma: vi.fn(),
	isHostedRuntimeInactiveAccessError: vi.fn((error: unknown) => (
		typeof error === "object"
		&& error !== null
		&& "code" in error
		&& error.code === "HOSTED_RUNTIME_MAILBOX_USER_INACTIVE"
	)),
	readDeliverableHostedVaultShareProjectionKinds: vi.fn(),
	requireHostedCloudflareCallbackRequest: vi.fn(),
	requireHostedRuntimeActiveAccess: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
	requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
	isHostedRuntimeInactiveAccessError: mocks.isHostedRuntimeInactiveAccessError,
	requireHostedRuntimeActiveAccess: mocks.requireHostedRuntimeActiveAccess,
}));

vi.mock("@/src/lib/hosted-mailbox/vault-share-store", () => ({
	readDeliverableHostedVaultShareProjectionKinds:
		mocks.readDeliverableHostedVaultShareProjectionKinds,
}));

vi.mock("@/src/lib/prisma", () => ({
	getPrisma: mocks.getPrisma,
}));

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

type ActiveKindsRouteModule =
	typeof import("../app/api/internal/hosted-runtime/vault-share/active-kinds/route");

let activeKindsRoute: ActiveKindsRouteModule;

function buildRequest(): Request {
	return new Request("https://web.test/api/internal/hosted-runtime/vault-share/active-kinds", {
		method: "GET",
	});
}

describe("vault-share active-kinds route", () => {
	beforeAll(async () => {
		activeKindsRoute = await import(
			"../app/api/internal/hosted-runtime/vault-share/active-kinds/route"
		);
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getPrisma.mockReturnValue({ kind: "prisma" });
		mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_grantor");
		mocks.requireHostedRuntimeActiveAccess.mockResolvedValue(undefined);
		mocks.readDeliverableHostedVaultShareProjectionKinds.mockResolvedValue([
			"activity-days.v0",
			"profile-name.v0",
		]);
	});

	it("returns web-derived projection kinds for the active grantor runtime", async () => {
		const request = buildRequest();
		const response = await activeKindsRoute.GET(request);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			projectionKinds: ["activity-days.v0", "profile-name.v0"],
		});
		expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(request, {
			maxBodyBytes: 0,
		});
		expect(mocks.requireHostedRuntimeActiveAccess).toHaveBeenCalledWith("member_grantor", {
			prisma: { kind: "prisma" },
		});
		expect(mocks.readDeliverableHostedVaultShareProjectionKinds).toHaveBeenCalledWith({
			grantorMemberId: "member_grantor",
			prisma: { kind: "prisma" },
		});
	});

	it("returns no projection kinds for an inactive grantor runtime", async () => {
		mocks.requireHostedRuntimeActiveAccess.mockRejectedValue(hostedOnboardingError({
			code: "HOSTED_RUNTIME_MAILBOX_USER_INACTIVE",
			httpStatus: 403,
			message: "Hosted runtime mailbox access is not active.",
		}));

		const response = await activeKindsRoute.GET(buildRequest());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ projectionKinds: [] });
		expect(mocks.readDeliverableHostedVaultShareProjectionKinds).not.toHaveBeenCalled();
	});
});
