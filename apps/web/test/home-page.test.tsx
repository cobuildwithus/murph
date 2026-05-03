import assert from "node:assert/strict";

import {
  cloneElement,
  createElement,
  isValidElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  hasActiveHostedDeviceSyncConnectionForMember: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default(props: {
    children?: ReactNode;
    className?: string;
    href: string;
    "data-slot"?: string;
  }) {
    return createElement(
      "a",
      {
        className: props.className,
        "data-slot": props["data-slot"],
        href: props.href,
      },
      props.children,
    );
  },
}));

vi.mock("@/src/components/ui/auth-button", () => ({
  AuthButton(props: {
    children?: ReactNode;
    className?: string;
    render?: ReactNode;
  }) {
    if (
      isValidElement<{
        children?: ReactNode;
        className?: string;
        "data-slot"?: string;
      }>(props.render)
    ) {
      return cloneElement(
        props.render,
        {
          className: props.className,
          "data-slot": "auth-button",
        },
        props.children,
      );
    }

    return createElement(
      "button",
      {
        className: props.className,
        "data-slot": "auth-button",
        type: "button",
      },
      props.children,
    );
  },
}));

vi.mock("@/src/components/home/feature-highlights", () => ({
  FeatureHighlights() {
    return createElement("div", null, "Feature highlights");
  },
}));

vi.mock("@/src/components/home/upload-labs-action", () => ({
  UploadLabsActionFallback(props: { isPrimary?: boolean }) {
    return createElement(
      "button",
      {
        "data-upload-primary": String(props.isPrimary ?? false),
        disabled: true,
        type: "button",
      },
      "Sync labs",
    );
  },
  UploadLabsMurphContactAction(props: { isPrimary?: boolean }) {
    return createElement(
      "a",
      {
        "data-upload-primary": String(props.isPrimary ?? false),
        href: "sms:+15550100001",
      },
      "Sync labs",
    );
  },
}));

vi.mock("@/src/lib/device-sync/settings-service", () => ({
  hasActiveHostedDeviceSyncConnectionForMember:
    mocks.hasActiveHostedDeviceSyncConnectionForMember,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

const ACTIVE_MEMBER = {
  billingStatus: "active",
  id: "member_home_active",
  suspendedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

test("Dashboard HomePage hides the connect-devices step for active wearable connections", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: ACTIVE_MEMBER,
    session: null,
  });
  mocks.hasActiveHostedDeviceSyncConnectionForMember.mockResolvedValue(true);

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.doesNotMatch(markup, /Connect devices/);
  assert.match(markup, /data-upload-primary="true"[^>]*>Sync labs/);
  assert.match(markup, /Sync labs/);
  assert.match(markup, /View experiments/);
  expect(mocks.hasActiveHostedDeviceSyncConnectionForMember).toHaveBeenCalledWith({
    member: ACTIVE_MEMBER,
  });
});

test("Dashboard HomePage keeps the connect-devices step without an active connection", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: ACTIVE_MEMBER,
    session: null,
  });
  mocks.hasActiveHostedDeviceSyncConnectionForMember.mockResolvedValue(false);

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /data-slot="auth-button"[^>]*>Connect devices/);
});

test("Dashboard HomePage keeps the connect-devices step when device state is unavailable", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: ACTIVE_MEMBER,
    session: null,
  });
  mocks.hasActiveHostedDeviceSyncConnectionForMember.mockRejectedValue(
    new Error("device sync unavailable"),
  );

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /data-slot="auth-button"[^>]*>Connect devices/);
});
