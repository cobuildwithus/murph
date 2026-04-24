import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildHostedDeviceSyncSettingsResponse: vi.fn(),
  HostedDeviceSyncSettingsClient: vi.fn((props: {
    authenticated: boolean;
    initialLoadError: { code: string | null; message: string } | null;
    initialResponse: { sources: unknown[] } | null;
  }) =>
    React.createElement(
      "div",
      {
        "data-authenticated": String(props.authenticated),
        "data-error": props.initialLoadError?.message ?? "",
        "data-error-code": props.initialLoadError?.code ?? "",
        "data-source-count": String(props.initialResponse?.sources.length ?? 0),
      },
      "Hosted device sync settings client",
    )),
}));

vi.mock("@/src/lib/device-sync/settings-service", () => ({
  buildHostedDeviceSyncSettingsResponse: mocks.buildHostedDeviceSyncSettingsResponse,
}));

vi.mock("@/src/components/settings/hosted-device-sync-settings-client", () => ({
  HostedDeviceSyncSettingsClient: mocks.HostedDeviceSyncSettingsClient,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test("HostedDeviceSyncSettings server-prefetches sources only for active hosted members", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValue({
    generatedAt: "2026-04-10T00:00:00.000Z",
    ok: true,
    sources: [
      {
        provider: "oura",
      },
    ],
  });

  const { HostedDeviceSyncSettings } = await import("@/src/components/settings/hosted-device-sync-settings");
  const markup = renderToStaticMarkup(await HostedDeviceSyncSettings({
    authenticated: true,
    member: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
  }));

  expect(mocks.buildHostedDeviceSyncSettingsResponse).toHaveBeenCalledWith({
    member: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
  });
  assert.match(markup, /data-source-count="1"/);
  assert.match(markup, /data-error=""/);
});

test("HostedDeviceSyncSettings keeps blocked members on a user-safe error without prefetching", async () => {
  const { hostedOnboardingError } = await import("@/src/lib/hosted-onboarding/errors");
  mocks.buildHostedDeviceSyncSettingsResponse.mockRejectedValue(hostedOnboardingError({
    code: "HOSTED_ACCESS_REQUIRED",
    httpStatus: 403,
    message: "Your subscription is canceled. Open billing to resume access.",
  }));

  const { HostedDeviceSyncSettings } = await import("@/src/components/settings/hosted-device-sync-settings");
  const markup = renderToStaticMarkup(await HostedDeviceSyncSettings({
    authenticated: true,
    member: {
      billingStatus: "canceled",
      id: "member_123",
      suspendedAt: null,
    },
  }));

  expect(mocks.buildHostedDeviceSyncSettingsResponse).toHaveBeenCalledWith({
    member: {
      billingStatus: "canceled",
      id: "member_123",
      suspendedAt: null,
    },
  });
  assert.match(markup, /Your subscription is canceled\. Open billing to resume access\./);
  assert.match(markup, /data-error-code="HOSTED_ACCESS_REQUIRED"/);
  assert.match(markup, /data-source-count="0"/);
});

test("HostedDeviceSyncSettings falls back to a generic message when server prefetch throws", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockRejectedValue(new Error("DEVICE_SYNC_PUBLIC_BASE_URL missing"));

  const { HostedDeviceSyncSettings } = await import("@/src/components/settings/hosted-device-sync-settings");
  const markup = renderToStaticMarkup(await HostedDeviceSyncSettings({
    authenticated: true,
    member: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
  }));

  assert.match(markup, /Could not load your data sources right now\./);
  assert.doesNotMatch(markup, /DEVICE_SYNC_PUBLIC_BASE_URL/);
  assert.match(markup, /data-source-count="0"/);
});
