import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

test("join invite loading route renders invite-specific fallback copy", async () => {
  const { default: JoinInviteLoading } = await import("../app/join/[inviteCode]/loading");

  const markup = renderToStaticMarkup(<JoinInviteLoading />);

  assert.match(markup, /Loading invite/);
});

test("share loading route renders share-specific fallback copy", async () => {
  const { default: HostedShareLoading } = await import("../app/share/[shareCode]/loading");

  const markup = renderToStaticMarkup(<HostedShareLoading />);

  assert.match(markup, /Loading share/);
});
