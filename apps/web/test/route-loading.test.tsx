import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

test("share loading route renders share-specific fallback copy", async () => {
  const { default: HostedShareLoading } = await import("../app/share/[shareCode]/loading");

  const markup = renderToStaticMarkup(<HostedShareLoading />);

  assert.match(markup, /Loading share/);
});
