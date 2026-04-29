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
    const acceptedDocumentVersions = buildCurrentHostedConsentDocumentVersions(
      "launch.required",
    );

    expect(acceptedDocumentVersions).toEqual({
      "consumer-health-data-notice": "2026-04-29",
      "health-ai-safety-disclosure": "2026-04-29",
      "privacy-policy": "2026-04-29",
      "terms-of-service": "2026-04-29",
    });
    expect(parseHostedConsentAcceptRequest({
      acceptedDocumentVersions,
      scope: "launch.required",
      source: "  hosted   onboarding  ",
    })).toEqual({
      acceptedDocumentVersions,
      scope: "launch.required",
      source: "hosted onboarding",
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

  it("keeps launch-required consent non-revocable", () => {
    expect(() => parseHostedConsentRevokeRequest({
      scope: "launch.required",
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
    const grant: HostedConsentGrantSnapshot = {
      documentVersions: {
        "consumer-health-data-notice": "2026-04-29",
        "privacy-policy": "2026-04-29",
        "terms-of-service": "2026-04-29",
      },
      grantedAt: "2026-04-29T00:00:00.000Z",
      lastEventId: "hbce_test",
      revokedAt: null,
      scope: "launch.required",
      source: "hosted onboarding",
      status: "granted",
      updatedAt: "2026-04-29T00:00:00.000Z",
    };
    const status = buildHostedConsentStatus({
      grants: [grant],
      now: new Date("2026-04-29T01:00:00.000Z"),
    });

    expect(status.launchRequired.granted).toBe(false);
    expect(status.launchRequired.missingDocuments.map((document) => document.id)).toEqual([
      "health-ai-safety-disclosure",
    ]);
    expect(status.scopes.find((scope) => scope.scope === "launch.required")).toMatchObject({
      current: false,
      granted: false,
    });
  });
});
