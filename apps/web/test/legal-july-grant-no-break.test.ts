import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A member who agreed before the games Terms: the exact launch grants most
// production members hold, recorded against the July documents. Publishing the
// October Terms and Privacy Policy must leave them working everywhere except
// the game's own Terms gate. Everything here runs the real consent registry
// against those rows; only the database, sign-in and downstream work are
// stubbed.
const MEMBER_ID = "member_pre_bump";
const JULY_LEGAL_VERSIONS = {
  "health-ai-safety-disclosure": "2026-07-23",
  "privacy-policy": "2026-07-23",
  "terms-of-service": "2026-07-23",
};
const JULY_HEALTH_DATA_VERSIONS = {
  "consumer-health-data-notice": "2026-07-23",
};
const APRIL_LEGAL_VERSIONS = {
  "health-ai-safety-disclosure": "2026-04-29",
  "privacy-policy": "2026-06-24",
  "terms-of-service": "2026-04-29",
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
    replaceHostedAddressBookProjection: vi.fn(async () => ({ ok: true })),
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

import { requireCurrentTermsFor } from "@/src/lib/game/http/auth";
import {
  assertHostedHistoricalLaunchConsentGranted,
  assertHostedLaunchRequiredConsentGranted,
  buildCurrentHostedConsentDocumentVersions,
  hasHostedConsentAtPublishedVersions,
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

function holdGrants(legal: Record<string, string>, healthData = JULY_HEALTH_DATA_VERSIONS) {
  mocks.grants.splice(
    0,
    mocks.grants.length,
    grantRow("launch.legal", legal),
    grantRow("launch.health-data", healthData),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  holdGrants(JULY_LEGAL_VERSIONS);
});

describe("a July launch.legal grant after the games Terms are published", () => {
  it("stays current for every scope, so nothing asks the member again", async () => {
    const status = await readHostedConsentStatus({
      memberId: MEMBER_ID,
      prisma: mocks.prisma as never,
    });

    // The dashboard layout, auth responses, join pages and the iOS app all
    // read `launchGranted`; it stays true, so no dialog or Agree step opens.
    expect(status.launchGranted).toBe(true);
    expect(status.launchScopes.map((scope) => [scope.scope, scope.granted])).toEqual([
      ["launch.legal", true],
      ["launch.health-data", true],
    ]);
    const legal = status.scopes.find((scope) => scope.scope === "launch.legal");
    expect(legal).toMatchObject({ current: true, granted: true, missingDocuments: [] });
    // The documents shown and recorded from now on are the published ones.
    expect(legal?.documents.map((document) => [document.id, document.version])).toEqual([
      ["terms-of-service", "2026-10-26"],
      ["privacy-policy", "2026-10-26"],
      ["health-ai-safety-disclosure", "2026-07-23"],
    ]);
    expect(legal && hasHostedConsentAtPublishedVersions(legal)).toBe(false);
    await expect(readHostedHealthDataConsentState({
      memberId: MEMBER_ID,
      prisma: mocks.prisma as never,
    })).resolves.toBe("granted");
  });

  it("passes both the historical and the current-version gates", async () => {
    await expect(assertHostedHistoricalLaunchConsentGranted({
      memberId: MEMBER_ID,
      prisma: mocks.prisma as never,
    })).resolves.toBeUndefined();
    // Journal, Friendly Names uploads and label reads, Messages mini-app
    // enrollment, clinical records, checkout, vault export and web group joins
    // all use this gate.
    await expect(assertHostedLaunchRequiredConsentGranted({
      memberId: MEMBER_ID,
      prisma: mocks.prisma as never,
    })).resolves.toBeUndefined();
  });

  it("still asks a member whose grant predates the minimum", async () => {
    holdGrants(APRIL_LEGAL_VERSIONS);
    await expect(assertHostedLaunchRequiredConsentGranted({
      memberId: MEMBER_ID,
      prisma: mocks.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_CONSENT_REQUIRED",
      details: { missingScopes: ["launch.legal"] },
      httpStatus: 403,
    });
  });

  it("records the published versions for anyone agreeing from now on", () => {
    const current = buildCurrentHostedConsentDocumentVersions("launch.legal");
    expect(current).toEqual({
      "health-ai-safety-disclosure": "2026-07-23",
      "privacy-policy": "2026-10-26",
      "terms-of-service": "2026-10-26",
    });
    expect(parseHostedConsentAcceptRequest({
      acceptedDocumentVersions: current,
      scope: "launch.legal",
    }).acceptedDocumentVersions).toEqual(current);
    expect(() => parseHostedConsentAcceptRequest({
      acceptedDocumentVersions: JULY_LEGAL_VERSIONS,
      scope: "launch.legal",
    })).toThrow(expect.objectContaining({
      code: "CONSENT_DOCUMENT_VERSIONS_STALE",
      httpStatus: 409,
    }));
  });
});

describe("companion routes with a July launch.legal grant", () => {
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

  it("serves the Journal, so the app opens no consent recovery and pauses nothing", async () => {
    const route = await import("../app/api/device-sync/companion/journal/route");
    const response = await route.GET(bearerRequest("/api/device-sync/companion/journal"));

    expect(response.status).toBe(200);
    expect(mocks.readHostedWorkspace).toHaveBeenCalledOnce();
  });

  it("accepts a Friendly Names upload", async () => {
    const route = await import("../app/api/device-sync/companion/address-book/route");
    const response = await route.PUT(bearerRequest("/api/device-sync/companion/address-book", {
      body: JSON.stringify({
        baseRevision: 0,
        contacts: [{ advisoryName: "Alex R.", phoneNumber: "+12125550100" }],
        mutationId: "4f5150c8-a9bc-42d3-b975-a289481a3140",
        schemaVersion: 1,
      }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    }));

    expect(response.status).toBe(200);
    expect(mocks.replaceHostedAddressBookProjection).toHaveBeenCalledOnce();
  });

  it("reports launch consent as granted to the app's consent route", async () => {
    const route = await import("../app/api/device-sync/companion/legal-consent/route");
    const response = await route.GET(bearerRequest("/api/device-sync/companion/legal-consent"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ launchGranted: true });
  });
});

describe("the game's Terms gate with a July launch.legal grant", () => {
  it("changes nothing while the flag is off", async () => {
    await expect(requireCurrentTermsFor(MEMBER_ID, { type: "post" }, {})).resolves.toBeUndefined();
    expect(mocks.prisma.hostedConsentGrant.findMany).not.toHaveBeenCalled();
  });

  it("asks for the published Terms when the flag is on, and passes once they are recorded", async () => {
    const env = { MURPH_GAME_REQUIRE_CURRENT_TERMS: "true" };
    await expect(requireCurrentTermsFor(MEMBER_ID, { type: "post" }, env)).rejects.toMatchObject({
      code: "TERMS_REQUIRED",
      details: {
        documents: [
          expect.objectContaining({ id: "terms-of-service", version: "2026-10-26" }),
          expect.objectContaining({ id: "privacy-policy", version: "2026-10-26" }),
          expect.objectContaining({ id: "health-ai-safety-disclosure", version: "2026-07-23" }),
        ],
        scope: "launch.legal",
      },
      httpStatus: 403,
    });

    holdGrants(buildCurrentHostedConsentDocumentVersions("launch.legal"));
    await expect(requireCurrentTermsFor(MEMBER_ID, { type: "post" }, env)).resolves.toBeUndefined();
  });
});
