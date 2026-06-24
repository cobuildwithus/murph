import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  buildCurrentHostedConsentDocumentVersions,
  buildHostedConsentStatus,
  parseHostedConsentAcceptRequest,
  parseHostedConsentRevokeRequest,
  type HostedConsentGrantSnapshot,
} from "@/src/lib/legal/consent";

describe("hosted legal consent registry", () => {
  it("requires the current launch legal document versions", () => {
    const legalVersions = buildCurrentHostedConsentDocumentVersions(
      "launch.legal",
    );
    expect(legalVersions).toEqual({
      "health-ai-safety-disclosure": "2026-04-29",
      "privacy-policy": "2026-06-24",
      "terms-of-service": "2026-04-29",
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
      "consumer-health-data-notice": "2026-04-29",
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
      "terms-of-service": "2026-04-29",
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

  it("keeps launch consent scopes non-revocable", () => {
    expect(() => parseHostedConsentRevokeRequest({
      scope: "launch.legal",
    })).toThrowError(HostedOnboardingError);

    expect(() => parseHostedConsentRevokeRequest({
      scope: "launch.health-data",
    })).toThrowError(HostedOnboardingError);

    expect(parseHostedConsentRevokeRequest({
      scope: "feature.connected-health-source",
      source: "settings",
    })).toEqual({
      scope: "feature.connected-health-source",
      source: "settings",
    });
  });

  it("marks stale grants as not currently granted", () => {
    const legalGrant: HostedConsentGrantSnapshot = {
      documentVersions: {
        "privacy-policy": "2026-06-24",
        "terms-of-service": "2026-04-29",
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
        "consumer-health-data-notice": "2026-04-29",
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
});
