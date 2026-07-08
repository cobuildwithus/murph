import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getPrisma: vi.fn(),
	isHostedRuntimeInactiveAccessError: vi.fn((error: unknown) => (
		typeof error === "object"
		&& error !== null
		&& "code" in error
		&& error.code === "HOSTED_RUNTIME_MAILBOX_USER_INACTIVE"
	)),
	readDeliverableHostedVaultShareProjectionScopes: vi.fn(),
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
	readDeliverableHostedVaultShareProjectionScopes:
		mocks.readDeliverableHostedVaultShareProjectionScopes,
}));

vi.mock("@/src/lib/prisma", () => ({
	getPrisma: mocks.getPrisma,
}));

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
	buildHostedVaultShareActivityDistanceProjectionScope,
	buildHostedVaultShareActivitySessionCountProjectionScope,
	buildHostedVaultShareProjectionScopeKey,
	hostedVaultShareProjectionKindToScope,
} from "@murphai/hosted-execution/vault-share";

const ACTIVITY_SCOPE = hostedVaultShareProjectionKindToScope("activity-days.v0");
const RUNNING_DISTANCE_SCOPE = buildHostedVaultShareActivityDistanceProjectionScope({
	activityKind: "running",
});
const RUNNING_SESSION_COUNT_SCOPE = buildHostedVaultShareActivitySessionCountProjectionScope({
	activityKind: "running",
});
const PROFILE_SCOPE = hostedVaultShareProjectionKindToScope("profile-name.v0");

type ActiveKindsRouteModule =
	typeof import("../app/api/internal/hosted-runtime/vault-share/active-kinds/route");

let activeKindsRoute: ActiveKindsRouteModule;

function buildRequest(search = ""): Request {
	return new Request(`https://web.test/api/internal/hosted-runtime/vault-share/active-kinds${search}`, {
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
		mocks.readDeliverableHostedVaultShareProjectionScopes.mockResolvedValue([
			ACTIVITY_SCOPE,
			PROFILE_SCOPE,
		]);
	});

	it("returns web-derived projection scopes for the active grantor runtime", async () => {
		const request = buildRequest();
		const response = await activeKindsRoute.GET(request);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			projectionKinds: ["activity-days.v0", "profile-name.v0"],
			projectionScopes: [ACTIVITY_SCOPE, PROFILE_SCOPE].sort((left, right) =>
				buildHostedVaultShareProjectionScopeKey(left)
					.localeCompare(buildHostedVaultShareProjectionScopeKey(right))
			),
		});
		expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(request, {
			maxBodyBytes: 0,
		});
		expect(mocks.requireHostedRuntimeActiveAccess).toHaveBeenCalledWith("member_grantor", {
			prisma: { kind: "prisma" },
		});
		expect(mocks.readDeliverableHostedVaultShareProjectionScopes).toHaveBeenCalledWith({
			grantorMemberId: "member_grantor",
			prisma: { kind: "prisma" },
		});
	});

	it("filters new selector scopes from old runners that do not declare support", async () => {
		mocks.readDeliverableHostedVaultShareProjectionScopes.mockResolvedValue([
			ACTIVITY_SCOPE,
			RUNNING_DISTANCE_SCOPE,
			RUNNING_SESSION_COUNT_SCOPE,
		]);

		const response = await activeKindsRoute.GET(buildRequest());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			projectionKinds: ["activity-days.v0"],
			projectionScopes: [ACTIVITY_SCOPE],
		});
	});

	it("returns new selector scopes to runners that declare support", async () => {
		mocks.readDeliverableHostedVaultShareProjectionScopes.mockResolvedValue([
			ACTIVITY_SCOPE,
			RUNNING_DISTANCE_SCOPE,
			RUNNING_SESSION_COUNT_SCOPE,
		]);

		const response = await activeKindsRoute.GET(buildRequest(
			"?supportedProjectionKind=activity-days.v0"
				+ "&supportedProjectionKind=activity-distance-days.v1"
				+ "&supportedProjectionKind=activity-session-count-days.v1",
		));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			projectionKinds: [
				"activity-days.v0",
				"activity-distance-days.v1",
				"activity-session-count-days.v1",
			],
			projectionScopes: [
				ACTIVITY_SCOPE,
				RUNNING_DISTANCE_SCOPE,
				RUNNING_SESSION_COUNT_SCOPE,
			].sort((left, right) =>
				buildHostedVaultShareProjectionScopeKey(left)
					.localeCompare(buildHostedVaultShareProjectionScopeKey(right))
			),
		});
	});

	it("returns no projection scopes for an inactive grantor runtime", async () => {
		mocks.requireHostedRuntimeActiveAccess.mockRejectedValue(hostedOnboardingError({
			code: "HOSTED_RUNTIME_MAILBOX_USER_INACTIVE",
			httpStatus: 403,
			message: "Hosted runtime mailbox access is not active.",
		}));

		const response = await activeKindsRoute.GET(buildRequest());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			projectionKinds: [],
			projectionScopes: [],
		});
		expect(mocks.readDeliverableHostedVaultShareProjectionScopes).not.toHaveBeenCalled();
	});
});
