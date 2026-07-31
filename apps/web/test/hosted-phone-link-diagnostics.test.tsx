import { createElement, useEffect, useMemo } from "react";
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
    expect(mocks.reportHostedPhoneLinkDiagnostic).toHaveBeenCalledTimes(5);
  });

  const diagnostics = mocks.reportHostedPhoneLinkDiagnostic.mock.calls.map(
    ([diagnostic]) => diagnostic,
  );
  expect(diagnostics.map((diagnostic) => diagnostic.event)).toEqual([
    "surface_loaded",
    "provider_started",
    "provider_cancelled",
    "provider_started",
    "provider_succeeded",
  ]);
  expect(new Set(diagnostics.map((diagnostic) => diagnostic.attemptId)).size).toBe(3);
  expect(diagnostics[1]?.attemptId).toBe(diagnostics[2]?.attemptId);
  expect(diagnostics[3]?.attemptId).toBe(diagnostics[4]?.attemptId);
  expect(diagnostics[1]?.attemptId).not.toBe(diagnostics[3]?.attemptId);
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
      event: "provider_succeeded",
      operation: "update",
      surface: "settings",
    }),
  ]));
  expect(JSON.stringify(diagnostics)).not.toContain("phoneNumber");
  expect(JSON.stringify(diagnostics)).not.toContain("providerUserId");
});

test("reports a session mismatch before a provider attempt exists", async () => {
  const { cleanup } = await renderClientComponent(
    createElement(BlockedPhoneLinkDiagnosticHarness),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(mocks.reportHostedPhoneLinkDiagnostic).toHaveBeenCalledTimes(2);
  });

  const diagnostics = mocks.reportHostedPhoneLinkDiagnostic.mock.calls.map(
    ([diagnostic]) => diagnostic,
  );
  expect(diagnostics.map((diagnostic) => diagnostic.event)).toEqual([
    "surface_loaded",
    "surface_blocked",
  ]);
  expect(diagnostics[0]?.attemptId).toBe(diagnostics[1]?.attemptId);
  expect(diagnostics[1]).toEqual(expect.objectContaining({
    clientState: "server_session_mismatch",
    operation: "link",
    surface: "settings",
  }));
});

function PhoneLinkDiagnosticHarness() {
  const createAttemptReporter = useHostedPhoneLinkDiagnostics({
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
  const firstAttempt = useMemo(
    () => createAttemptReporter("link"),
    [createAttemptReporter],
  );
  const secondAttempt = useMemo(
    () => createAttemptReporter("update"),
    [createAttemptReporter],
  );

  useEffect(() => {
    firstAttempt("provider_started");
    firstAttempt("provider_cancelled", { detailCode: "exited_link_flow" });
    secondAttempt("provider_started");
    secondAttempt("provider_succeeded");
  }, [firstAttempt, secondAttempt]);

  return null;
}

function BlockedPhoneLinkDiagnosticHarness() {
  useHostedPhoneLinkDiagnostics({
    appAuthenticated: true,
    clientUserMatchesExpected: true,
    clientUserPresent: true,
    expectedUserPresent: true,
    operation: "link",
    privyAuthenticated: true,
    privyReady: true,
    serverSessionMatches: false,
    showLinkForm: true,
    surface: "settings",
  });

  return null;
}
