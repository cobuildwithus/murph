import { createElement, useEffect } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useHostedPhoneLinkDiagnostics } from "@/src/components/settings/hosted-phone-link-diagnostics";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  reportHostedPhoneLinkDiagnostic: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth-support", () => ({
  reportHostedPhoneLinkDiagnostic: mocks.reportHostedPhoneLinkDiagnostic,
}));

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await cleanupRender?.();
  cleanupRender = null;
});

test("correlates surface and lifecycle events without identity metadata", async () => {
  const { cleanup } = await renderClientComponent(
    createElement(PhoneLinkDiagnosticHarness),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(mocks.reportHostedPhoneLinkDiagnostic).toHaveBeenCalledTimes(3);
  });

  const diagnostics = mocks.reportHostedPhoneLinkDiagnostic.mock.calls.map(
    ([diagnostic]) => diagnostic,
  );
  expect(diagnostics.map((diagnostic) => diagnostic.event)).toEqual([
    "surface_loaded",
    "provider_started",
    "sync_succeeded",
  ]);
  expect(new Set(diagnostics.map((diagnostic) => diagnostic.attemptId)).size).toBe(1);
  expect(diagnostics[0]?.attemptId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  expect(diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({
      clientState: "eligible",
      operation: "link",
      surface: "settings",
    }),
    expect.objectContaining({
      event: "sync_succeeded",
      operation: "update",
      surface: "settings",
    }),
  ]));
  expect(JSON.stringify(diagnostics)).not.toContain("phoneNumber");
  expect(JSON.stringify(diagnostics)).not.toContain("providerUserId");
});

function PhoneLinkDiagnosticHarness() {
  const report = useHostedPhoneLinkDiagnostics({
    appAuthenticated: true,
    clientUserMatchesExpected: true,
    clientUserPresent: true,
    expectedUserPresent: true,
    operation: "link",
    privyAuthenticated: true,
    privyReady: true,
    serverSessionMatches: true,
    showLinkForm: true,
    surface: "settings",
  });

  useEffect(() => {
    report("provider_started");
    report("sync_succeeded", { operation: "update" });
  }, [report]);

  return null;
}
