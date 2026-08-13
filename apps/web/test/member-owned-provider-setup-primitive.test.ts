import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { parseHostedRuntimeProviderSetupToolRequest } from "@murphai/hosted-execution/provider-setup";

import {
  STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
  buildMemberOwnedProviderApplicationMarker,
  buildMemberOwnedProviderSetupBrowserContract,
  listMemberOwnedProviderSetupRegistrations,
} from "@/src/lib/device-sync/provider-setup/registry";
import {
  buildBlindOwnedApplicationDeleteCode,
  buildBlindProviderCredentialCaptureCode,
} from "@/src/lib/device-sync/provider-setup/service";
import {
  toMemberOwnedProviderSetupView,
  type MemberOwnedProviderSetupRecord,
} from "@/src/lib/device-sync/provider-setup/types";

const MEMBER_ID = "member_synthetic";

const SETUP: MemberOwnedProviderSetupRecord = {
  active: true,
  browserRunId: null,
  completedAt: null,
  connectSourceId: "strava",
  connectTarget: "strava",
  createdAt: new Date("2026-08-11T12:00:00.000Z"),
  id: "dps_synthetic",
  memberId: MEMBER_ID,
  provider: "strava",
  providerApplicationId: null,
  providerApplicationRevision: null,
  sourceProviderSlug: null,
  status: "pending",
  updatedAt: new Date("2026-08-11T12:00:00.000Z"),
  version: 1,
};

describe("member-owned provider setup contract", () => {
  it("keeps Strava declarative and derives the browser contract from shared OAuth metadata", () => {
    const registrations = listMemberOwnedProviderSetupRegistrations();
    const contract = buildMemberOwnedProviderSetupBrowserContract({
      env: { HOSTED_WEB_BASE_URL: "https://web.example.test" },
      memberId: MEMBER_ID,
      provider: "strava",
    });

    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      browser: {
        applicationCategory: "Other",
        applicationWebsite: "https://withmurph.ai",
        developerPortalUrl: "https://www.strava.com/settings/api",
      },
      coordinates: {
        connectSourceId: "strava",
        connectTarget: "strava",
        provider: "strava",
      },
    });
    expect(contract).toMatchObject({
      application: {
        callbackUrl: "https://web.example.test/api/device-sync/oauth/strava/callback",
        category: "Other",
        readOnlyScopes: ["activity:read"],
        website: "https://withmurph.ai",
      },
      developerPortalUrl: "https://www.strava.com/settings/api",
      provider: "strava",
    });
    expect(contract.guidance.join(" ")).toMatch(/live page/iu);
    expect(contract.guidance.join(" ")).toMatch(/trusted browser boundary/iu);
    expect(contract.guidance.join(" ")).not.toMatch(/input\[|button\.|data-testid|xpath/iu);
  });

  it("uses a stable opaque ownership marker without exposing the member id", () => {
    const first = buildMemberOwnedProviderApplicationMarker({
      memberId: MEMBER_ID,
      provider: "strava",
    });
    const second = buildMemberOwnedProviderApplicationMarker({
      memberId: MEMBER_ID,
      provider: "strava",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^Murph Private Sync [a-f0-9]{12}$/u);
    expect(first).not.toContain(MEMBER_ID);
  });

  it("accepts only the runtime selector handoff and rejects credential-shaped tool input", () => {
    const parsed = parseHostedRuntimeProviderSetupToolRequest({
      action: "capture",
      applicationRootSelector: "form[data-owned-application]",
      clientIdSelector: "[data-client-id]",
      clientSecretSelector: "[data-client-secret]",
      ownershipMarkerSelector: "input[name=application_name]",
      provider: "strava",
      revealSecretSelector: null,
      runId: "hcr_synthetic",
      setupId: "dps_synthetic",
      submitSelector: "button[type=submit]",
    });

    expect(parsed.action).toBe("capture");
    expect(() => parseHostedRuntimeProviderSetupToolRequest({
      ...parsed,
      clientSecret: randomUUID(),
    })).toThrow();
    expect(() => parseHostedRuntimeProviderSetupToolRequest({
      ...parsed,
      selectorProgram: "await page.locator('provider-specific').click()",
    })).toThrow();
  });

  it("keeps final capture and deletion generic, exact, and blind", () => {
    const capture = buildBlindProviderCredentialCaptureCode({
      applicationRootSelector: "form[data-owned-application]",
      clientIdSelector: "#runtime-client-id",
      clientSecretSelector: "#runtime-client-secret",
      marker: "Murph Private Sync fixture",
      ownershipMarkerSelector: "#runtime-marker",
      revealSecretSelector: "#runtime-reveal",
      safeLandingUrl: "https://provider.example.test/apps",
      submitSelector: "#runtime-submit",
    });
    const deletion = buildBlindOwnedApplicationDeleteCode({
      applicationRootSelector: "section[data-owned-application]",
      completionSelector: "#runtime-complete",
      confirmSelector: "#runtime-confirm",
      deleteSelector: "#runtime-delete",
      marker: "Murph Private Sync fixture",
      ownershipMarkerSelector: "#runtime-marker",
      safeLandingUrl: "https://provider.example.test/apps",
    });

    expect(capture).toContain("return { clientId, clientSecret }");
    expect(capture).toContain("provider application ownership marker mismatch");
    expect(capture).toContain("https://provider.example.test/apps");
    expect(capture).not.toMatch(/strava/iu);
    expect(deletion).toContain("provider application ownership marker mismatch");
    expect(deletion).toContain('return { kind: "deleted" }');
    expect(deletion).not.toMatch(/strava/iu);
  });

  it("projects only member-facing actions from the reduced durable lifecycle", () => {
    expect(toMemberOwnedProviderSetupView(
      SETUP,
      STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    ).action).toBe("authorize");
    expect(toMemberOwnedProviderSetupView(
      { ...SETUP, status: "authorized" },
      STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    ).action).toBe("none");
    expect(toMemberOwnedProviderSetupView(
      {
        ...SETUP,
        providerApplicationId: "dpa_synthetic",
        providerApplicationRevision: 1,
        status: "oauth_ready",
      },
      STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    ).action).toBe("continue_oauth");
    expect(toMemberOwnedProviderSetupView(
      { ...SETUP, status: "disconnect_first" },
      STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    ).action).toBe("disconnect_first");
  });
});
