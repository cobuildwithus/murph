import assert from "node:assert/strict";

import { cloneElement, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  resolveHostedAiUsageGate: vi.fn(),
  routerRefresh: vi.fn(),
  shouldShowHomeDeviceSyncStep: vi.fn(),
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.routerRefresh,
  }),
}));

vi.mock("@/src/components/home/upload-labs-action", () => ({
  UploadLabsActionFallback: () =>
    createElement("button", { type: "button" }, "Sync fallback"),
  UploadLabsMurphContactAction: () =>
    createElement("button", { type: "button" }, "Sync"),
}));

vi.mock("@/src/components/ui/auth-button", () => ({
  AuthButton(props: {
    children?: ReactNode;
    className?: string;
    render?: ReactNode;
  }) {
    if (isValidElement<{ children?: ReactNode; className?: string; "data-slot"?: string }>(props.render)) {
      return cloneElement(
        props.render,
        {
          className: props.className,
          "data-slot": "auth-button",
        },
        props.children,
      );
    }

    return createElement("button", {
      className: props.className,
      "data-slot": "auth-button",
      type: "button",
    }, props.children);
  },
}));

vi.mock("@/src/lib/device-sync/home-onboarding", () => ({
  shouldShowHomeDeviceSyncStep: mocks.shouldShowHomeDeviceSyncStep,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

const MEMBER = {
  billingStatus: "active",
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
  id: "member_123",
  suspendedAt: null,
  updatedAt: new Date("2026-05-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-26T12:00:00.000Z"));
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: MEMBER,
    session: null,
  });
  mocks.shouldShowHomeDeviceSyncStep.mockResolvedValue(true);
  mocks.resolveHostedAiUsageGate.mockResolvedValue({
    allowed: true,
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    remainingUsdMicros: 4_000_000n,
    spentUsdMicros: 6_000_000n,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

test("HomePage hides the connect devices card when device sync is already active", async () => {
  mocks.shouldShowHomeDeviceSyncStep.mockResolvedValueOnce(false);

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /Welcome to Murph/);
  assert.doesNotMatch(markup, /Connect devices/);
  assert.doesNotMatch(markup, /href="\/connect"/);
  assert.match(markup, /Sync labs/);
  assert.match(markup, /Start an experiment/);
  assert.equal(mocks.shouldShowHomeDeviceSyncStep.mock.calls[0]?.[0]?.member, MEMBER);
  assert.equal(mocks.resolveHostedAiUsageGate.mock.calls[0]?.[0]?.memberId, MEMBER.id);
  assert.equal(
    mocks.resolveHostedAiUsageGate.mock.calls[0]?.[0]?.now.toISOString(),
    "2026-05-26T12:00:00.000Z",
  );
});

test("HomePage shows a usage-limit upgrade banner when assistant usage is exhausted", async () => {
  mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 10_000_000n,
    userNotice: {
      code: "pulse_upgrade_edge",
      message:
        "Hey, you've reached your usage limit for the month. Upgrade to Edge: https://withmurph.ai/home",
    },
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /hit this month/);
  assert.match(markup, /Resets in 6 days/);
  assert.match(markup, /Upgrade to Edge for more/);
  assert.match(markup, /type="button"/);
});

test("HomePage shows a monthly usage reset countdown when assistant usage is exhausted", async () => {
  mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    billingPlanCode: "launch_edge_monthly",
    limitUsdMicros: 25_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 25_000_000n,
    userNotice: {
      code: "edge_usage_limit_reached",
      message:
        "Hey, you've reached your usage limit for the month. Murph will resume when your included allowance resets: https://withmurph.ai/home",
    },
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /hit this month/);
  assert.match(markup, /Resets in 6 days/);
  assert.match(markup, /Murph will start replying again when your plan resets/);
});

test("HomePage shows Start Pulse directly when trial credits are exhausted", async () => {
  mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 4_500_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-05-08T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-05-08T00:00:00.000Z"),
    spentUsdMicros: 4_500_000n,
    userNotice: {
      code: "trial_usage_limit_reached",
      message: "Your trial credits are used up.",
    },
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /Your trial credits are used up/);
  assert.match(markup, /Start Pulse to keep Murph replying/);
  assert.doesNotMatch(markup, /Start your Pulse plan/);
  assert.doesNotMatch(markup, /href="\/settings"/);
});

test("HomePage shows non-limit denied usage notices without a reset countdown", async () => {
  mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 4_500_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-05-08T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "trial_expired_pending_billing",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-05-26T12:05:00.000Z"),
    spentUsdMicros: 4_500_000n,
    userNotice: {
      code: "trial_conversion_pending",
      message: "Your trial ended and billing is still pending.",
    },
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /Your trial just ended/);
  assert.match(markup, /Billing is still finishing up/);
  assert.doesNotMatch(markup, /Resets in/u);
});
