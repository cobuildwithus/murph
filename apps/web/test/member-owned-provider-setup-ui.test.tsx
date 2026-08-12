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

type TestSetupView = Omit<MemberOwnedProviderSetupView, "setupId">;

function renderSetup(
  setup: TestSetupView | null,
  connected = false,
): string {
  const resolvedSetup: MemberOwnedProviderSetupView | null = setup
    ? { setupId: "dps_synthetic", ...setup }
    : null;
  return renderToStaticMarkup(createElement(MemberOwnedProviderSetup, {
    connected,
    onAction: vi.fn(),
    onCancel: vi.fn(),
    pending: resolvedSetup?.status === "working",
    presentation: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    setup: resolvedSetup,
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
    ["canceling", "none", "Canceling safely"],
    ["inspection_required", "retry", "Safe recovery"],
    ["oauth_ready", "continue_oauth", "Continue with Strava"],
    ["oauth_in_progress", "continue_oauth", "Consent in progress"],
    ["repair_required", "retry", "Repair available"],
    ["retryable_failure", "retry", "Progress saved"],
    ["disconnect_first", "disconnect_first", "Disconnect first"],
    ["provider_conflict", "retry", "Protected provider app"],
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

  it("does not claim a legacy connection uses the member-owned application", () => {
    const markup = renderSetup(null, true);

    expect(markup).toContain("Disconnect the current Strava connection");
    expect(markup).not.toContain(
      "Strava is connected through your private provider application.",
    );
  });

  it("renders prerequisite continuation and cancellation as real buttons", () => {
    const markup = renderSetup({
      action: "continue_provider",
      applicationRevision: null,
      connected: false,
      message: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION.messages.provider_prerequisite,
      provider: "strava",
      status: "provider_prerequisite",
      updatedAt: UPDATED_AT,
    });

    expect(markup).toMatch(
      /<button[^>]+type="button"[^>]*aria-label="Cancel setup for Strava"[^>]*>Cancel setup<\/button>/u,
    );
    expect(markup).toMatch(
      /<button[^>]+type="button"[^>]*aria-label="Continue in Strava for Strava"[^>]*>Continue in Strava<\/button>/u,
    );
  });

  it("leaves disconnect-first action ownership to the enclosing SourceCard", () => {
    const markup = renderSetup({
      action: "disconnect_first",
      applicationRevision: 4,
      connected: false,
      message: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION.messages.disconnect_first,
      provider: "strava",
      status: "disconnect_first",
      updatedAt: UPDATED_AT,
    });

    expect(markup).toContain("Disconnect the current Strava connection");
    expect(markup).not.toContain("<button");
  });

  it("renders as a flat content group without nested card chrome", () => {
    const markup = renderSetup({
      action: "start",
      applicationRevision: null,
      connected: false,
      message: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION.messages.pending,
      provider: "strava",
      status: "pending",
      updatedAt: UPDATED_AT,
    });
    const wrapper = markup.match(
      /<div data-member-owned-provider-setup="true" class="([^"]+)"/u,
    );

    expect(wrapper?.[1]).toBe("flex w-full flex-col gap-3");
    expect(wrapper?.[1]).not.toMatch(/(?:^|\s)(?:border|rounded|bg-|p-)/u);
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
    expect(sectionMarkup).toContain("Cancel setup");
    expect(sectionMarkup).toContain("Ambiguous create recovery");
    expect(sectionMarkup).toContain("Disconnect first");
    expect(sectionMarkup).not.toMatch(/<input\b/iu);
    expect(sectionMarkup).not.toMatch(/client[ -]?(?:id|secret)/iu);
  });
});
