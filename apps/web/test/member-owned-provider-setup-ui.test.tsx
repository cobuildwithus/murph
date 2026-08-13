import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SourceCard } from "@/app/(dashboard)/connect/connect-source-card";
import type { ConnectSource } from "@/app/(dashboard)/connect/connect-page-types";
import { MemberOwnedProviderSetup } from "@/src/components/device-sync/member-owned-provider-setup";
import { STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION } from "@/src/lib/device-sync/provider-setup/registry";
import type { MemberOwnedProviderSetupView } from "@/src/lib/device-sync/provider-setup/types";

const UPDATED_AT = "2026-08-11T12:00:00.000Z";

function renderSetup(setup: MemberOwnedProviderSetupView | null): string {
  return renderToStaticMarkup(createElement(MemberOwnedProviderSetup, {
    connected: setup?.connected ?? false,
    onAction: vi.fn(),
    onCancel: vi.fn(),
    pending: false,
    presentation: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    setup,
  }));
}

describe("member-owned provider setup UI", () => {
  it("discloses provider prerequisites before setup begins", () => {
    const markup = renderSetup(setupView("pending", "authorize"));

    expect(markup).toContain("Ready to set up");
    expect(markup).toContain("Strava may require developer access");
    expect(markup).toMatch(/<button[^>]*>Continue<\/button>/u);
    expect(markup).not.toMatch(/<input\b/iu);
    expect(markup).not.toMatch(/client[ -]?(?:id|secret)/iu);
  });

  it("offers safe Continue and Cancel actions in the exact connect-intent disclosure", () => {
    const markup = renderSourceCard({
      memberOwnedConnectIntentDisclosure: {
        onCancel: vi.fn(),
        onContinue: vi.fn(),
      },
      source: stravaSource(setupView("pending", "authorize")),
    });

    expect(markup).toContain("Review before setup");
    expect(markup).toContain("no provider work starts before you continue");
    expect(markup).toMatch(/<button[^>]*>Cancel<\/button>/u);
    expect(markup).toMatch(/<button[^>]*>Continue<\/button>/u);
  });

  it("keeps durable in-progress setup cancelable without exposing browser internals", () => {
    for (const status of ["authorized", "browser_setup", "capturing", "canceling"] as const) {
      const markup = renderSetup(setupView(status, "none"));
      expect(markup).toContain("Cancel setup");
      expect(markup).not.toMatch(/handoff|runId|selector|playwright/iu);
      expect(markup).not.toMatch(/<input\b/iu);
    }
  });

  it("leaves disconnect-first ownership to the enclosing source card", () => {
    const setup = setupView("disconnect_first", "disconnect_first", 3);
    const componentMarkup = renderSetup(setup);
    const cardMarkup = renderSourceCard({
      source: {
        ...stravaSource(setup),
        connected: true,
        disconnectConnectionId: "connection_synthetic",
      },
    });

    expect(componentMarkup).not.toContain("<button");
    const disconnectActions = cardMarkup.match(
      /<button[^>]*aria-label="Disconnect Strava first"[^>]*>[\s\S]*?Disconnect Strava first[\s\S]*?<\/button>/gu,
    ) ?? [];
    expect(disconnectActions).toHaveLength(1);
  });

  it("stays flattened inside the existing source card", () => {
    const markup = renderSetup(setupView("authorized", "none"));
    const wrapper = markup.match(
      /<div data-member-owned-provider-setup="true" class="([^"]+)"/u,
    );

    expect(wrapper?.[1]).toBe("flex w-full flex-col gap-3");
    expect(wrapper?.[1]).not.toMatch(/(?:^|\s)(?:border|rounded|bg-|p-)/u);
  });
});

function renderSourceCard(input: {
  memberOwnedConnectIntentDisclosure?: {
    onCancel: () => void;
    onContinue: () => void;
  };
  source: ConnectSource;
}): string {
  return renderToStaticMarkup(createElement(SourceCard, {
    authenticated: true,
    errorMessage: null,
    memberOwnedConnectIntentDisclosure: input.memberOwnedConnectIntentDisclosure,
    onCancelSetup: async () => undefined,
    onDisconnectTargetChange: vi.fn(),
    onStartConnection: async () => undefined,
    pending: false,
    pendingDisconnect: false,
    source: input.source,
  }));
}

function stravaSource(setup: MemberOwnedProviderSetupView): ConnectSource {
  return {
    connectTarget: "strava",
    description: "Runs, rides, workouts, and activity history.",
    id: "strava",
    logo: {
      className: "h-8 w-24",
      height: 32,
      src: "/brand-logos/connect/strava.svg",
      width: 128,
    },
    memberOwnedSetup: setup,
    memberOwnedSetupPresentation: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    memberOwnedSetupProvider: "strava",
    name: "Strava",
  };
}

function setupView(
  status: MemberOwnedProviderSetupView["status"],
  action: MemberOwnedProviderSetupView["action"],
  applicationRevision: number | null = null,
): MemberOwnedProviderSetupView {
  return {
    action,
    applicationRevision,
    connected: status === "connected",
    message: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION.messages[status],
    provider: "strava",
    setupId: "dps_synthetic",
    status,
    updatedAt: UPDATED_AT,
  };
}
