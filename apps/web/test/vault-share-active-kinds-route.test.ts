import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getPrisma: vi.fn(),
	isHostedRuntimeInactiveAccessError: vi.fn((error: unknown) => (
		typeof error === "object"
		&& error !== null
		&& "code" in error
		&& error.code === "HOSTED_RUNTIME_MAILBOX_USER_INACTIVE"
	)),
	readDeliverableHostedVaultShareProjectionScopeGenerations: vi.fn(),
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

vi.mock("@/src/lib/hosted-vault-share/projection-store", () => ({
	readDeliverableHostedVaultShareProjectionScopeGenerations:
		mocks.readDeliverableHostedVaultShareProjectionScopeGenerations,
}));

vi.mock("@/src/lib/prisma", () => ({
	getPrisma: mocks.getPrisma,
}));

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
	buildHostedVaultShareActivityMinutesProjectionScope,
	buildHostedVaultShareActivityDistanceProjectionScope,
	buildHostedVaultShareActivitySessionCountProjectionScope,
	buildHostedVaultShareProjectionScopeKey,
	HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_PARAM,
	HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_VERSION,
	hostedVaultShareProjectionKindToScope,
} from "@murphai/hosted-execution/vault-share";

const ACTIVITY_SCOPE = hostedVaultShareProjectionKindToScope("activity-days.v0");
const DEEP_SLEEP_SCOPE = hostedVaultShareProjectionKindToScope("deep-sleep-days.v0");
const REM_SLEEP_SCOPE = hostedVaultShareProjectionKindToScope("rem-sleep-days.v0");
const WORKOUTS_SCOPE = hostedVaultShareProjectionKindToScope(
	"workouts.v0",
);
const RUNNING_MINUTES_SCOPE = buildHostedVaultShareActivityMinutesProjectionScope({
	activityKind: "running",
});
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

function generationToken(index: number): string {
	return String.fromCharCode("a".charCodeAt(0) + index).repeat(43);
}

function projectionWork(
	...projectionScopes: Array<Parameters<typeof buildHostedVaultShareProjectionScopeKey>[0]>
) {
	return {
		generations: projectionScopes.map((projectionScope, index) => ({
			generationToken: generationToken(index),
			hasUnmaterializedShare: false,
			projectionScope,
		})),
		hasDeferredProjectionWork: false,
	};
}

function buildRequest(search = ""): Request {
	return new Request(`https://web.test/api/internal/hosted-runtime/vault-share/active-kinds${search}`, {
		method: "GET",
	});
}

function supportedScopeSearch(...scopes: Parameters<typeof buildHostedVaultShareProjectionScopeKey>[0][]): string {
	const params = new URLSearchParams();
	for (const scope of scopes) {
		params.append("supportedProjectionScope", buildHostedVaultShareProjectionScopeKey(scope));
	}
	return `?${params.toString()}`;
}

function withDeferredWorkCapability(search = ""): string {
	const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
	params.set(
		HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_PARAM,
		HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_VERSION,
	);
	return `?${params.toString()}`;
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
		mocks.readDeliverableHostedVaultShareProjectionScopeGenerations.mockResolvedValue(
			projectionWork(ACTIVITY_SCOPE, PROFILE_SCOPE),
		);
	});

	it("returns web-derived projection scopes for the active grantor runtime", async () => {
		const request = buildRequest();
		const response = await activeKindsRoute.GET(request);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			generationTokensByProjectionScopeKey: {
				[buildHostedVaultShareProjectionScopeKey(ACTIVITY_SCOPE)]: generationToken(0),
				[buildHostedVaultShareProjectionScopeKey(PROFILE_SCOPE)]: generationToken(1),
			},
			hasDeferredProjectionWork: false,
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
		expect(mocks.readDeliverableHostedVaultShareProjectionScopeGenerations).toHaveBeenCalledWith({
			grantorMemberId: "member_grantor",
			prisma: { kind: "prisma" },
		});
	});

	it("filters new selector scopes from old runners that do not declare support", async () => {
		mocks.readDeliverableHostedVaultShareProjectionScopeGenerations.mockResolvedValue(projectionWork(
			ACTIVITY_SCOPE,
			RUNNING_MINUTES_SCOPE,
			RUNNING_DISTANCE_SCOPE,
			RUNNING_SESSION_COUNT_SCOPE,
		));

		const response = await activeKindsRoute.GET(buildRequest());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			generationTokensByProjectionScopeKey: {
				[buildHostedVaultShareProjectionScopeKey(ACTIVITY_SCOPE)]: generationToken(0),
				[buildHostedVaultShareProjectionScopeKey(RUNNING_MINUTES_SCOPE)]: generationToken(1),
			},
			hasDeferredProjectionWork: false,
			projectionKinds: [
				"activity-days.v0",
				"activity-minutes-days.v1",
			],
			projectionScopes: [
				ACTIVITY_SCOPE,
				RUNNING_MINUTES_SCOPE,
			].sort((left, right) =>
				buildHostedVaultShareProjectionScopeKey(left)
					.localeCompare(buildHostedVaultShareProjectionScopeKey(right))
			),
		});
	});

	it("filters new fixed challenge scopes from omitted-capability runners", async () => {
		mocks.readDeliverableHostedVaultShareProjectionScopeGenerations.mockResolvedValue(projectionWork(
			ACTIVITY_SCOPE,
			DEEP_SLEEP_SCOPE,
			REM_SLEEP_SCOPE,
			WORKOUTS_SCOPE,
		));

		const response = await activeKindsRoute.GET(buildRequest());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			generationTokensByProjectionScopeKey: {
				[buildHostedVaultShareProjectionScopeKey(ACTIVITY_SCOPE)]: generationToken(0),
			},
			hasDeferredProjectionWork: false,
			projectionKinds: ["activity-days.v0"],
			projectionScopes: [ACTIVITY_SCOPE],
		});
	});

	it("returns new fixed challenge scopes only to runners declaring exact support", async () => {
		mocks.readDeliverableHostedVaultShareProjectionScopeGenerations.mockResolvedValue(projectionWork(
			ACTIVITY_SCOPE,
			DEEP_SLEEP_SCOPE,
			REM_SLEEP_SCOPE,
			WORKOUTS_SCOPE,
		));

		const response = await activeKindsRoute.GET(buildRequest(
			supportedScopeSearch(
				ACTIVITY_SCOPE,
				DEEP_SLEEP_SCOPE,
				REM_SLEEP_SCOPE,
				WORKOUTS_SCOPE,
			),
		));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			generationTokensByProjectionScopeKey: Object.fromEntries([
				ACTIVITY_SCOPE,
				DEEP_SLEEP_SCOPE,
				REM_SLEEP_SCOPE,
				WORKOUTS_SCOPE,
			].map((scope, index) => [
				buildHostedVaultShareProjectionScopeKey(scope),
				generationToken(index),
			])),
			hasDeferredProjectionWork: false,
			projectionKinds: [
				"activity-days.v0",
				"deep-sleep-days.v0",
				"rem-sleep-days.v0",
				"workouts.v0",
			],
			projectionScopes: [
				ACTIVITY_SCOPE,
				DEEP_SLEEP_SCOPE,
				REM_SLEEP_SCOPE,
				WORKOUTS_SCOPE,
			].sort((left, right) =>
				buildHostedVaultShareProjectionScopeKey(left)
					.localeCompare(buildHostedVaultShareProjectionScopeKey(right))
			),
		});
	});

	it("returns new selector scopes to runners that declare support", async () => {
		mocks.readDeliverableHostedVaultShareProjectionScopeGenerations.mockResolvedValue(projectionWork(
			ACTIVITY_SCOPE,
			RUNNING_DISTANCE_SCOPE,
			RUNNING_SESSION_COUNT_SCOPE,
		));

		const response = await activeKindsRoute.GET(buildRequest(
			supportedScopeSearch(
				ACTIVITY_SCOPE,
				RUNNING_DISTANCE_SCOPE,
				RUNNING_SESSION_COUNT_SCOPE,
			),
		));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			generationTokensByProjectionScopeKey: Object.fromEntries([
				ACTIVITY_SCOPE,
				RUNNING_DISTANCE_SCOPE,
				RUNNING_SESSION_COUNT_SCOPE,
			].map((scope, index) => [
				buildHostedVaultShareProjectionScopeKey(scope),
				generationToken(index),
			])),
			hasDeferredProjectionWork: false,
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

	it("does not fall back to defaults when exact support scopes are unknown", async () => {
		mocks.readDeliverableHostedVaultShareProjectionScopeGenerations.mockResolvedValue(
			projectionWork(ACTIVITY_SCOPE),
		);

		const response = await activeKindsRoute.GET(buildRequest(
			"?supportedProjectionScope=future-kind.v1.activityKind.running",
		));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			generationTokensByProjectionScopeKey: {},
			hasDeferredProjectionWork: false,
			projectionKinds: [],
			projectionScopes: [],
		});
	});

	it("does not treat retired kind support params as legacy no-param runners", async () => {
		mocks.readDeliverableHostedVaultShareProjectionScopeGenerations.mockResolvedValue(
			projectionWork(ACTIVITY_SCOPE),
		);

		const response = await activeKindsRoute.GET(buildRequest(
			"?supportedProjectionKind=future-kind.v1",
		));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			generationTokensByProjectionScopeKey: {},
			hasDeferredProjectionWork: false,
			projectionKinds: [],
			projectionScopes: [],
		});
	});

	it("retains the obligation when approved work is temporarily inactive", async () => {
		mocks.readDeliverableHostedVaultShareProjectionScopeGenerations.mockResolvedValue({
			generations: [],
			hasDeferredProjectionWork: true,
		});

		const response = await activeKindsRoute.GET(buildRequest(
			withDeferredWorkCapability(),
		));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			generationTokensByProjectionScopeKey: {},
			hasDeferredProjectionWork: true,
			projectionKinds: [],
			projectionScopes: [],
		});
	});

	it("defers a null-snapshot scope that the current runner cannot project", async () => {
		mocks.readDeliverableHostedVaultShareProjectionScopeGenerations.mockResolvedValue({
			generations: [{
				generationToken: generationToken(0),
				hasUnmaterializedShare: true,
				projectionScope: ACTIVITY_SCOPE,
			}],
			hasDeferredProjectionWork: false,
		});

		const response = await activeKindsRoute.GET(buildRequest(
			withDeferredWorkCapability(
				"?supportedProjectionScope=future-kind.v1.activityKind.running",
			),
		));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			generationTokensByProjectionScopeKey: {},
			hasDeferredProjectionWork: true,
			projectionKinds: [],
			projectionScopes: [],
		});
	});

	it("keeps deferred work retryable for a previous runner during Web-first rollout", async () => {
		mocks.readDeliverableHostedVaultShareProjectionScopeGenerations.mockResolvedValue({
			generations: [],
			hasDeferredProjectionWork: true,
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			const response = await activeKindsRoute.GET(buildRequest());

			expect(response.status).toBe(503);
			expect(await response.json()).toEqual({
				error: expect.objectContaining({
					code: "HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_REQUIRED",
					retryable: true,
				}),
			});
		} finally {
			consoleError.mockRestore();
		}
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
			hasDeferredProjectionWork: false,
			projectionKinds: [],
			projectionScopes: [],
		});
		expect(mocks.readDeliverableHostedVaultShareProjectionScopeGenerations).not.toHaveBeenCalled();
	});
});
