import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  readSafeMemberOwnedProviderHandoffUrl,
} from "../app/(dashboard)/connect/connect-page-helpers";
import {
  MemberOwnedProviderSetupComponentStudy,
  MemberOwnedProviderSetupFlowStudy,
} from "@/app/design/member-owned-provider-setup-study";
import { MemberOwnedProviderSetup } from "@/src/components/device-sync/member-owned-provider-setup";
import { STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION } from "@/src/lib/device-sync/provider-setup/presentation";
import type { MemberOwnedProviderSetupView } from "@/src/lib/device-sync/provider-setup/types";

const UPDATED_AT = "2026-08-11T12:00:00.000Z";

function renderSetup(
  setup: MemberOwnedProviderSetupView | null,
  connected = false,
): string {
  return renderToStaticMarkup(createElement(MemberOwnedProviderSetup, {
    connected,
    onAction: vi.fn(),
    pending: setup?.status === "working",
    presentation: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    setup,
  }));
}

describe("member-owned provider setup UI", () => {
  it("accepts only same-origin hosted-computer handoffs", () => {
    expect(readSafeMemberOwnedProviderHandoffUrl(
      "/computer/handoff/synthetic-handoff",
      "https://web.example.test",
    )).toBe("https://web.example.test/computer/handoff/synthetic-handoff");
    expect(readSafeMemberOwnedProviderHandoffUrl(
      "https://attacker.example/computer/handoff/synthetic-handoff",
      "https://web.example.test",
    )).toBeNull();
    expect(readSafeMemberOwnedProviderHandoffUrl(
      "https://web.example.test/settings",
      "https://web.example.test",
    )).toBeNull();
  });

  it.each([
    ["pending", "start", "Set up Strava"],
    ["working", "none", "Murph is working"],
    ["waiting_for_user", "continue_sign_in", "Continue sign-in"],
    ["provider_prerequisite", "continue_provider", "Continue in Strava"],
    ["inspection_required", "retry", "Safe recovery"],
    ["oauth_ready", "continue_oauth", "Continue with Strava"],
    ["oauth_in_progress", "continue_oauth", "Consent in progress"],
    ["repair_required", "retry", "Repair available"],
    ["retryable_failure", "retry", "Progress saved"],
    ["disconnect_first", "disconnect_first", "Disconnect first"],
    ["provider_conflict", "none", "Protected provider app"],
  ] as const)("renders truthful %s state", (status, action, expected) => {
    const markup = renderSetup({
      action,
      applicationRevision: status === "pending" || status === "working" ? null : 4,
      connected: false,
      message: `Synthetic ${status} status without credentials.`,
      provider: "strava",
      status,
      updatedAt: UPDATED_AT,
    });

    expect(markup).toContain(expected);
    expect(markup).not.toMatch(/<input\b/iu);
    expect(markup).not.toMatch(/client[ -]?(?:id|secret)/iu);
    expect(markup).not.toContain("synthetic-client-secret-not-a-credential");
  });

  it("renders connected state without credential fields or setup actions", () => {
    const markup = renderSetup({
      action: "none",
      applicationRevision: 4,
      connected: true,
      message: "Synthetic connected status.",
      provider: "strava",
      status: "connected",
      updatedAt: UPDATED_AT,
    }, true);

    expect(markup).toContain("Strava is connected through your private provider application.");
    expect(markup).toContain("Private application revision 4");
    expect(markup).not.toContain("<button");
    expect(markup).not.toMatch(/<input\b/iu);
  });

  it("uses the production component for inert component and section studies", () => {
    const componentMarkup = renderToStaticMarkup(
      createElement(MemberOwnedProviderSetupComponentStudy),
    );
    const sectionMarkup = renderToStaticMarkup(
      createElement(MemberOwnedProviderSetupFlowStudy),
    );

    expect(componentMarkup).toContain("Murph is working");
    expect(sectionMarkup).toContain("member-owned-provider-setup-flow");
    expect(sectionMarkup).toContain("Provider sign-in or challenge");
    expect(sectionMarkup).toContain("Provider prerequisite");
    expect(sectionMarkup).toContain("Ambiguous create recovery");
    expect(sectionMarkup).toContain("Disconnect first");
    expect(sectionMarkup).not.toMatch(/<input\b/iu);
    expect(sectionMarkup).not.toMatch(/client[ -]?(?:id|secret)/iu);
  });
});
