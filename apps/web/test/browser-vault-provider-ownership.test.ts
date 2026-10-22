import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

test("the dashboard loading boundary announces progress and respects reduced motion", async () => {
  const { default: DashboardLoading } = await import("../app/(dashboard)/loading");
  const markup = renderToStaticMarkup(createElement(DashboardLoading));

  assert.match(markup, /aria-busy="true"/u);
  assert.match(markup, /aria-live="polite"/u);
  assert.match(markup, /role="status"/u);
  assert.match(markup, />Loading dashboard</u);
  assert.match(markup, /aria-hidden="true"/u);

  const animatedSkeletonCount = markup.match(/animate-pulse/gu)?.length ?? 0;
  const reducedMotionSkeletonCount =
    markup.match(/motion-reduce:animate-none/gu)?.length ?? 0;
  assert.ok(animatedSkeletonCount > 0);
  assert.equal(reducedMotionSkeletonCount, animatedSkeletonCount);
});
