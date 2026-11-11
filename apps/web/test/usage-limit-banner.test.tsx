import assert from "node:assert/strict";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

vi.mock("next/link", () => ({
  default(props: {
    children?: ReactNode;
    className?: string;
    href: string;
  }) {
    return createElement(
      "a",
      {
        className: props.className,
        href: props.href,
      },
      props.children,
    );
  },
}));

test("Family usage exhaustion always links to the existing add-usage flow", async () => {
  const { UsageLimitBanner } = await import(
    "@/src/components/home/usage-limit-banner"
  );

  const markup = renderToStaticMarkup(createElement(UsageLimitBanner, {
    noticeCode: "family_usage_limit_reached",
    now: new Date("2026-08-07T19:49:52.000Z"),
    resetAt: new Date("2026-09-04T19:49:52.000Z"),
  }));

  assert.match(markup, />Add usage</u);
  assert.match(
    markup,
    /href="\/settings\?addUsage=true#subscription"/u,
  );
  assert.match(
    markup,
    /Murph is paused until more usage is added or your allowance resets\./u,
  );
  assert.doesNotMatch(markup, /Other Family members have separate allowances/u);
});

test("an explicit Family recommendation takes precedence over the recovery fallback", async () => {
  const { UsageLimitBanner } = await import(
    "@/src/components/home/usage-limit-banner"
  );

  const markup = renderToStaticMarkup(createElement(UsageLimitBanner, {
    noticeCode: "family_usage_limit_reached",
    recommendedAction: {
      kind: "change_plan",
      label: "Review plan",
      targetPlanCode: "launch_monthly",
      url: "https://example.test/settings#subscription",
    },
  }));

  assert.match(markup, />Review plan</u);
  assert.match(
    markup,
    /href="https:\/\/example\.test\/settings#subscription"/u,
  );
  assert.doesNotMatch(markup, />Add usage</u);
});
