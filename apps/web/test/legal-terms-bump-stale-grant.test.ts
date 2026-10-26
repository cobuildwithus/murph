import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A member who agreed before the games Terms: the exact launch grants most
// production members hold, recorded against the previous document versions.
// Everything here runs the real consent registry against those rows; only the
// database, sign-in and downstream work are stubbed.
const MEMBER_ID = "member_pre_bump";
const PRE_BUMP_LEGAL_VERSIONS = {
  "health-ai-safety-disclosure": "2026-07-23",
  "privacy-policy": "2026-07-23",
  "terms-of-service": "2026-07-23",
};
const PRE_BUMP_HEALTH_DATA_VERSIONS = {
  "consumer-health-data-notice": "2026-07-23",
};

function grantRow(scope: string, documentVersionsJson: Record<string, string>) {
  const at = new Date("2026-08-01T12:00:00.000Z");
  return {
    createdAt: at,
    documentVersionsJson,
    grantedAt: at,
    lastEventId: `hbce_${scope}`,
    memberId: MEMBER_ID,
    revokedAt: null,
    scope,
    source: "homepage-auth-dialog",
    status: "granted",
    updatedAt: at,
  };
}

const mocks = vi.hoisted(() => {
  const grants: Array<Record<string, unknown>> = [];
  const prisma = {
    hostedConsentGrant: {
      findMany: vi.fn(async () => grants),
      findUnique: vi.fn(async (input: {
        where: { memberId_scope: { scope: string } };
      }) => grants.find((grant) => grant.scope === input.where.memberId_scope.scope) ?? null),
    },
  };
  return {
    assertActiveHostedMemberAccessAllowed: vi.fn(async () => undefined),
    grants,
    ingestCompanionMealPhoto: vi.fn(async () => ({ accepted: true })),
    prisma,
    readCompanionDeviceSyncStatus: vi.fn(async () => ({ ok: true, sources: [] })),
    readHostedWorkspace: vi.fn(async () => null),
    replaceHostedAddressBookProjection: vi.fn(),
  };
});

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => mocks.prisma,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireActiveHostedMemberAuthFromBearerToken: vi.fn(async () => ({
    member: { id: MEMBER_ID },
  })),
  requireHostedMemberAuthFromBearerToken: vi.fn(async () => ({
    member: { id: MEMBER_ID },
  })),
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/member-access")>()),
  assertActiveHostedMemberAccessAllowed: mocks.assertActiveHostedMemberAccessAllowed,
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: () => ({ store: {} }),
}));

vi.mock("@/src/lib/device-sync/companion", () => ({
  readCompanionDeviceSyncStatus: mocks.readCompanionDeviceSyncStatus,
  readCompanionStatusSourceProviderSlug: () => null,
}));

vi.mock("@/src/lib/device-sync/meal-photo-capture", () => ({
  assertCurrentManualMealPhotoUploadAuthorityTx: vi.fn(async () => undefined),
  readAndValidateManualMealPhotoUpload: vi.fn(async () => ({ captureId: "capture_1" })),
}));

vi.mock("@/src/lib/device-sync/meal-photo-ingestion", () => ({
  ingestCompanionMealPhoto: mocks.ingestCompanionMealPhoto,
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  readHostedWorkspace: mocks.readHostedWorkspace,
}));

vi.mock("@/src/lib/hosted-address-book/projection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-address-book/projection")>()),
  replaceHostedAddressBookProjection: mocks.replaceHostedAddressBookProjection,
}));

import {
  assertHostedHistoricalLaunchConsentGranted,
  assertHostedLaunchRequiredConsentGranted,
  buildCurrentHostedConsentDocumentVersions,
  hasHostedHistoricalLaunchConsent,
  parseHostedConsentAcceptRequest,
  readHostedConsentStatus,
  readHostedHealthDataConsentState,
} from "@/src/lib/legal/consent";

function bearerRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://www.withmurph.ai${path}`, {
    ...init,
    headers: { authorization: "Bearer test-token", ...init.headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.grants.splice(
    0,
    mocks.grants.length,
    grantRow("launch.legal", PRE_BUMP_LEGAL_VERSIONS),
    grantRow("launch.health-data", PRE_BUMP_HEALTH_DATA_VERSIONS),
  );
});

describe("a pre-bump launch.legal grant after the games Terms", () => {
  it("is stale only for the Terms and Privacy Policy, and health-data consent stays current", async () => {
    const status = await readHostedConsentStatus({
      memberId: MEMBER_ID,
      prisma: mocks.prisma as never,
    });

    const legal = status.scopes.find((scope) => scope.scope === "launch.legal");
    expect(legal?.granted).toBe(false);
    expect(legal?.missingDocuments.map((document) => document.id)).toEqual([
      "terms-of-service",
      "privacy-policy",
    ]);
    expect(status.scopes.find((scope) => scope.scope === "launch.health-data")).toMatchObject({
      current: true,
      granted: true,
    });
    expect(status.launchScopes.map((scope) => [scope.scope, scope.granted])).toEqual([
      ["launch.legal", false],
      ["launch.health-data", true],
    ]);
    expect(hasHostedHistoricalLaunchConsent(status)).toBe(true);
    await expect(readHostedHealthDataConsentState({
      memberId: MEMBER_ID,
      prisma: mocks.prisma as never,
    })).resolves.toBe("granted");
  });

  it("passes the historical gate and asks the current-version gate for launch.legal alone", async () => {
    await expect(assertHostedHistoricalLaunchConsentGranted({
      memberId: MEMBER_ID,
      prisma: mocks.prisma as never,
    })).resolves.toBeUndefined();

    await expect(assertHostedLaunchRequiredConsentGranted({
      memberId: MEMBER_ID,
      prisma: mocks.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_CONSENT_REQUIRED",
      details: { missingScopes: ["launch.legal"] },
      httpStatus: 403,
    });
  });

  it("refuses a client that still holds the old versions, then accepts the current ones", () => {
    expect(() => parseHostedConsentAcceptRequest({
      acceptedDocumentVersions: PRE_BUMP_LEGAL_VERSIONS,
      scope: "launch.legal",
    })).toThrow(expect.objectContaining({
      code: "CONSENT_DOCUMENT_VERSIONS_STALE",
      details: {
        missingOrStaleDocumentIds: ["terms-of-service", "privacy-policy"],
        scope: "launch.legal",
      },
      httpStatus: 409,
    }));

    const current = buildCurrentHostedConsentDocumentVersions("launch.legal");
    expect(current).toEqual({
      "health-ai-safety-disclosure": "2026-07-23",
      "privacy-policy": "2026-10-26",
      "terms-of-service": "2026-10-26",
    });
    expect(buildCurrentHostedConsentDocumentVersions("launch.health-data"))
      .toEqual(PRE_BUMP_HEALTH_DATA_VERSIONS);
    expect(parseHostedConsentAcceptRequest({
      acceptedDocumentVersions: current,
      scope: "launch.legal",
    }).acceptedDocumentVersions).toEqual(current);
  });
});

describe("companion routes with a pre-bump launch.legal grant", () => {
  it("keeps device sync status working", async () => {
    const route = await import("../app/api/device-sync/companion/status/route");
    const response = await route.GET(bearerRequest("/api/device-sync/companion/status"));

    expect(response.status).toBe(200);
    expect(mocks.readCompanionDeviceSyncStatus).toHaveBeenCalledOnce();
  });

  it("still refuses device sync status to a member with no launch grant at all", async () => {
    mocks.grants.splice(0, mocks.grants.length);
    const route = await import("../app/api/device-sync/companion/status/route");
    const response = await route.GET(bearerRequest("/api/device-sync/companion/status"));

    expect(response.status).toBe(403);
    expect(mocks.readCompanionDeviceSyncStatus).not.toHaveBeenCalled();
  });

  it("keeps meal photo uploads working", async () => {
    const route = await import("../app/api/device-sync/companion/meal-photos/route");
    const response = await route.POST(bearerRequest("/api/device-sync/companion/meal-photos", {
      body: "{}",
      method: "POST",
    }));

    expect(response.status).toBe(202);
    expect(mocks.ingestCompanionMealPhoto).toHaveBeenCalledOnce();
  });

  it("answers the Journal with the existing consent error the app turns into its Agree step", async () => {
    const route = await import("../app/api/device-sync/companion/journal/route");
    const response = await route.GET(bearerRequest("/api/device-sync/companion/journal"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "HOSTED_CONSENT_REQUIRED" },
    });
    expect(mocks.readHostedWorkspace).not.toHaveBeenCalled();
  });

  it("answers a Friendly Names upload with the same consent error before reading the body", async () => {
    const route = await import("../app/api/device-sync/companion/address-book/route");
    const response = await route.PUT(bearerRequest("/api/device-sync/companion/address-book", {
      body: "{}",
      method: "PUT",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "HOSTED_CONSENT_REQUIRED" },
    });
    expect(mocks.replaceHostedAddressBookProjection).not.toHaveBeenCalled();
  });
});
