import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  assertHostedHistoricalLaunchConsentGranted,
  buildCurrentHostedConsentDocumentVersions,
  buildHostedConsentStatus,
  hasHostedHistoricalLaunchConsent,
  parseHostedConsentAcceptRequest,
  parseHostedConsentRevokeRequest,
  recordHostedLaunchConsentDecline,
  resolveHostedHealthDataConsentState,
  type HostedConsentGrantSnapshot,
} from "@/src/lib/legal/consent";

describe("hosted legal consent registry", () => {
  it("requires the current launch legal document versions", () => {
    const legalVersions = buildCurrentHostedConsentDocumentVersions(
      "launch.legal",
    );
    expect(legalVersions).toEqual({
      "health-ai-safety-disclosure": "2026-07-23",
      "privacy-policy": "2026-07-23",
      "terms-of-service": "2026-07-23",
    });
    expect(parseHostedConsentAcceptRequest({
      acceptedDocumentVersions: legalVersions,
      scope: "launch.legal",
      source: "  hosted   onboarding  ",
    })).toEqual({
      acceptedDocumentVersions: legalVersions,
      scope: "launch.legal",
      source: "hosted onboarding",
    });

    const healthDataVersions = buildCurrentHostedConsentDocumentVersions(
      "launch.health-data",
    );
    expect(healthDataVersions).toEqual({
      "consumer-health-data-notice": "2026-07-23",
    });
    expect(parseHostedConsentAcceptRequest({
      acceptedDocumentVersions: healthDataVersions,
      scope: "launch.health-data",
    })).toEqual({
      acceptedDocumentVersions: healthDataVersions,
      scope: "launch.health-data",
      source: "hosted-web",
    });
  });

  it("rejects stale or missing accepted document versions", () => {
    const acceptedDocumentVersions = {
      ...buildCurrentHostedConsentDocumentVersions("feature.health-ai"),
      "health-ai-safety-disclosure": "2026-01-01",
    };

    expect(() => parseHostedConsentAcceptRequest({
      acceptedDocumentVersions,
      scope: "feature.health-ai",
    })).toThrowError(HostedOnboardingError);

    try {
      parseHostedConsentAcceptRequest({
        acceptedDocumentVersions,
        scope: "feature.health-ai",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(HostedOnboardingError);
      expect((error as HostedOnboardingError).code).toBe(
        "CONSENT_DOCUMENT_VERSIONS_STALE",
      );
      expect((error as HostedOnboardingError).httpStatus).toBe(409);
    }
  });

  it("rejects accepted document versions outside the requested scope", () => {
    const acceptedDocumentVersions = {
      ...buildCurrentHostedConsentDocumentVersions("feature.health-ai"),
      "terms-of-service": "2026-07-23",
    };

    expect(() => parseHostedConsentAcceptRequest({
      acceptedDocumentVersions,
      scope: "feature.health-ai",
    })).toThrowError(HostedOnboardingError);

    try {
      parseHostedConsentAcceptRequest({
        acceptedDocumentVersions,
        scope: "feature.health-ai",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(HostedOnboardingError);
      expect((error as HostedOnboardingError).code).toBe(
        "CONSENT_DOCUMENT_VERSIONS_INVALID",
      );
      expect((error as HostedOnboardingError).httpStatus).toBe(400);
    }
  });

  it("keeps legal acceptance immutable and permits health-data withdrawal", () => {
    expect(() => parseHostedConsentRevokeRequest({
      scope: "launch.legal",
    })).toThrowError(HostedOnboardingError);

    expect(parseHostedConsentRevokeRequest({
      scope: "launch.health-data",
      source: "settings",
    })).toEqual({
      scope: "launch.health-data",
      source: "settings",
    });

    expect(parseHostedConsentRevokeRequest({
      scope: "feature.connected-health-source",
      source: "settings",
    })).toEqual({
      scope: "feature.connected-health-source",
      source: "settings",
    });
  });

  it("distinguishes explicit withdrawal from a missing legacy grant", () => {
    expect(resolveHostedHealthDataConsentState([])).toBe("missing");
    expect(resolveHostedHealthDataConsentState([{
      scope: "launch.health-data",
      status: "granted",
    }])).toBe("granted");
    expect(resolveHostedHealthDataConsentState([{
      scope: "launch.health-data",
      status: "revoked",
    }])).toBe("revoked");
    expect(resolveHostedHealthDataConsentState([{
      scope: "launch.health-data",
      status: "unexpected",
    }])).toBe("missing");
  });

  it("records pending launch scopes as idempotent privacy-safe decline events", async () => {
    const createdBatches: unknown[] = [];
    const createMany = vi.fn().mockImplementation(async (input: unknown) => {
      createdBatches.push(input);
      return { count: 2 };
    });
    const tx = {
      hostedConsentEvent: { createMany },
      hostedConsentGrant: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as Parameters<typeof recordHostedLaunchConsentDecline>[0]["prisma"];
    const input = {
      memberId: "member_1",
      prisma,
      sessionId: "session_1",
      source: "homepage-auth-dialog",
    };

    await expect(recordHostedLaunchConsentDecline({
      ...input,
      now: new Date("2026-07-30T17:00:00.000Z"),
    })).resolves.toEqual([
      "launch.legal",
      "launch.health-data",
    ]);
    await expect(recordHostedLaunchConsentDecline({
      ...input,
      now: new Date("2026-07-30T17:05:00.000Z"),
    })).resolves.toEqual([
      "launch.legal",
      "launch.health-data",
    ]);

    expect(createdBatches).toHaveLength(2);
    const firstBatch = createdBatches[0] as {
      data: Array<Record<string, unknown>>;
      skipDuplicates: boolean;
    };
    const secondBatch = createdBatches[1] as typeof firstBatch;
    expect(firstBatch.skipDuplicates).toBe(true);
    expect(firstBatch.data).toEqual([
      {
        action: "declined",
        createdAt: new Date("2026-07-30T17:00:00.000Z"),
        documentVersionsJson: {
          "health-ai-safety-disclosure": "2026-07-23",
          "privacy-policy": "2026-07-23",
          "terms-of-service": "2026-07-23",
        },
        id: expect.stringMatching(/^hbce_[A-Za-z0-9_-]{24}$/u),
        memberId: "member_1",
        scope: "launch.legal",
        source: "homepage-auth-dialog",
      },
      {
        action: "declined",
        createdAt: new Date("2026-07-30T17:00:00.000Z"),
        documentVersionsJson: {
          "consumer-health-data-notice": "2026-07-23",
        },
        id: expect.stringMatching(/^hbce_[A-Za-z0-9_-]{24}$/u),
        memberId: "member_1",
        scope: "launch.health-data",
        source: "homepage-auth-dialog",
      },
    ]);
    expect(secondBatch.data.map((event) => event.id)).toEqual(
      firstBatch.data.map((event) => event.id),
    );
    expect(secondBatch.data.map((event) => event.createdAt)).toEqual([
      new Date("2026-07-30T17:05:00.000Z"),
      new Date("2026-07-30T17:05:00.000Z"),
    ]);
    expect(firstBatch.data.every((event) => !("metadataJson" in event))).toBe(true);
  });

  it("does not record a decline for a launch scope that is already granted", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      hostedConsentEvent: { createMany },
      hostedConsentGrant: {
        findMany: vi.fn().mockResolvedValue([
          {
            createdAt: new Date("2026-07-30T16:00:00.000Z"),
            documentVersionsJson: buildCurrentHostedConsentDocumentVersions("launch.legal"),
            grantedAt: new Date("2026-07-30T16:00:00.000Z"),
            lastEventId: "hbce_accepted",
            memberId: "member_1",
            revokedAt: null,
            scope: "launch.legal",
            source: "homepage-auth-dialog",
            status: "granted",
            updatedAt: new Date("2026-07-30T16:00:00.000Z"),
          },
        ]),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as Parameters<typeof recordHostedLaunchConsentDecline>[0]["prisma"];

    await expect(recordHostedLaunchConsentDecline({
      memberId: "member_1",
      now: new Date("2026-07-30T17:00:00.000Z"),
      prisma,
      sessionId: "session_1",
      source: "homepage-auth-dialog",
    })).resolves.toEqual(["launch.health-data"]);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          action: "declined",
          documentVersionsJson: {
            "consumer-health-data-notice": "2026-07-23",
          },
          scope: "launch.health-data",
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("marks stale grants as not currently granted", () => {
    const legalGrant: HostedConsentGrantSnapshot = {
      documentVersions: {
        "privacy-policy": "2026-07-23",
        "terms-of-service": "2026-07-23",
      },
      grantedAt: "2026-04-29T00:00:00.000Z",
      lastEventId: "hbce_test_legal",
      revokedAt: null,
      scope: "launch.legal",
      source: "hosted onboarding",
      status: "granted",
      updatedAt: "2026-04-29T00:00:00.000Z",
    };
    const healthDataGrant: HostedConsentGrantSnapshot = {
      documentVersions: {
        "consumer-health-data-notice": "2026-07-23",
      },
      grantedAt: "2026-04-29T00:00:00.000Z",
      lastEventId: "hbce_test_health",
      revokedAt: null,
      scope: "launch.health-data",
      source: "hosted onboarding",
      status: "granted",
      updatedAt: "2026-04-29T00:00:00.000Z",
    };
    const status = buildHostedConsentStatus({
      grants: [legalGrant, healthDataGrant],
      now: new Date("2026-04-29T01:00:00.000Z"),
    });

    const legalLaunchScope = status.launchScopes.find((s) => s.scope === "launch.legal");
    expect(legalLaunchScope?.granted).toBe(false);
    expect(legalLaunchScope?.missingDocuments.map((d) => d.id)).toEqual([
      "health-ai-safety-disclosure",
    ]);
    expect(status.launchGranted).toBe(false);

    expect(status.scopes.find((scope) => scope.scope === "launch.legal")).toMatchObject({
      current: false,
      granted: false,
    });
  });

  it("requires existing members on the previous document set to re-accept", () => {
    const status = buildHostedConsentStatus({
      grants: [
        {
          documentVersions: {
            "health-ai-safety-disclosure": "2026-04-29",
            "privacy-policy": "2026-06-24",
            "terms-of-service": "2026-04-29",
          },
          grantedAt: "2026-06-24T00:00:00.000Z",
          lastEventId: "hbce_previous_legal",
          revokedAt: null,
          scope: "launch.legal",
          source: "hosted onboarding",
          status: "granted",
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
        {
          documentVersions: {
            "consumer-health-data-notice": "2026-04-29",
          },
          grantedAt: "2026-04-29T00:00:00.000Z",
          lastEventId: "hbce_previous_health",
          revokedAt: null,
          scope: "launch.health-data",
          source: "hosted onboarding",
          status: "granted",
          updatedAt: "2026-04-29T00:00:00.000Z",
        },
      ],
      now: new Date("2026-07-23T12:00:00.000Z"),
    });

    expect(status.launchGranted).toBe(false);
    expect(hasHostedHistoricalLaunchConsent(status)).toBe(true);
    expect(status.launchScopes).toEqual([
      {
        granted: false,
        missingDocuments: expect.arrayContaining([
          expect.objectContaining({ id: "terms-of-service" }),
          expect.objectContaining({ id: "privacy-policy" }),
          expect.objectContaining({ id: "health-ai-safety-disclosure" }),
        ]),
        scope: "launch.legal",
      },
      {
        granted: false,
        missingDocuments: [
          expect.objectContaining({ id: "consumer-health-data-notice" }),
        ],
        scope: "launch.health-data",
      },
    ]);
  });

  it("distinguishes historical launch authorization from absent or partial consent", () => {
    const legalGrant = createHistoricalLaunchGrant("launch.legal", {
      "health-ai-safety-disclosure": "2026-04-29",
      "privacy-policy": "2026-06-24",
      "terms-of-service": "2026-04-29",
    });
    const healthDataGrant = createHistoricalLaunchGrant("launch.health-data", {
      "consumer-health-data-notice": "2026-04-29",
    });
    const now = new Date("2026-07-23T12:00:00.000Z");

    expect(hasHostedHistoricalLaunchConsent(buildHostedConsentStatus({
      grants: [],
      now,
    }))).toBe(false);
    expect(hasHostedHistoricalLaunchConsent(buildHostedConsentStatus({
      grants: [legalGrant],
      now,
    }))).toBe(false);
    expect(hasHostedHistoricalLaunchConsent(buildHostedConsentStatus({
      grants: [healthDataGrant],
      now,
    }))).toBe(false);
    expect(hasHostedHistoricalLaunchConsent(buildHostedConsentStatus({
      grants: [legalGrant, healthDataGrant],
      now,
    }))).toBe(true);
    expect(hasHostedHistoricalLaunchConsent(buildHostedConsentStatus({
      grants: [
        createHistoricalLaunchGrant(
          "launch.legal",
          buildCurrentHostedConsentDocumentVersions("launch.legal"),
        ),
        createHistoricalLaunchGrant(
          "launch.health-data",
          buildCurrentHostedConsentDocumentVersions("launch.health-data"),
        ),
      ],
      now,
    }))).toBe(true);
  });

  it("uses surface-neutral copy when historical launch consent is missing", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      hostedConsentGrant: { findMany },
    } as unknown as Parameters<
      typeof assertHostedHistoricalLaunchConsentGranted
    >[0]["prisma"];

    await expect(assertHostedHistoricalLaunchConsentGranted({
      memberId: "member_1",
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_CONSENT_REQUIRED",
      details: {
        missingScopes: ["launch.legal", "launch.health-data"],
      },
      httpStatus: 403,
      message: "Accept the Murph legal consent before continuing.",
    });
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ scope: "asc" }],
      where: { memberId: "member_1" },
    });
  });

  it("keeps current launch consent valid when a historical removed scope exists", () => {
    const status = buildHostedConsentStatus({
      grants: [
        {
          documentVersions: buildCurrentHostedConsentDocumentVersions("launch.legal"),
          grantedAt: "2026-06-24T00:00:00.000Z",
          lastEventId: "hbce_launch_legal",
          revokedAt: null,
          scope: "launch.legal",
          source: "hosted onboarding",
          status: "granted",
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
        {
          documentVersions: buildCurrentHostedConsentDocumentVersions("launch.health-data"),
          grantedAt: "2026-06-24T00:00:00.000Z",
          lastEventId: "hbce_launch_health",
          revokedAt: null,
          scope: "launch.health-data",
          source: "hosted onboarding",
          status: "granted",
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
        {
          documentVersions: {
            "consumer-health-data-notice": "2026-04-29",
            "privacy-policy": "2026-06-24",
            "terms-of-service": "2026-04-29",
          },
          grantedAt: "2026-06-24T00:00:00.000Z",
          lastEventId: "hbce_removed_scope",
          revokedAt: null,
          scope: "feature.whatsapp-messaging",
          source: "whatsapp",
          status: "granted",
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
      ],
      now: new Date("2026-07-14T00:00:00.000Z"),
    });

    expect(status.launchGranted).toBe(true);
    expect(status.launchScopes.every((scope) => scope.granted)).toBe(true);
    expect(status.scopes.map((scope) => scope.scope)).not.toContain("feature.whatsapp-messaging");
    expect(() => parseHostedConsentAcceptRequest({
      acceptedDocumentVersions: {},
      scope: "feature.whatsapp-messaging",
    })).toThrowError(HostedOnboardingError);
  });
});

function createHistoricalLaunchGrant(
  scope: "launch.health-data" | "launch.legal",
  documentVersions: Record<string, string>,
): HostedConsentGrantSnapshot {
  return {
    documentVersions,
    grantedAt: "2026-04-29T00:00:00.000Z",
    lastEventId: `hbce_${scope.replace(".", "_")}`,
    revokedAt: null,
    scope,
    source: "hosted onboarding",
    status: "granted",
    updatedAt: "2026-04-29T00:00:00.000Z",
  };
}
