import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import FarewellPage, { metadata } from "@/app/farewell/page";

describe("account deletion farewell page", () => {
  test("renders the public completed-deletion destination", async () => {
    const markup = renderToStaticMarkup(await FarewellPage({
      searchParams: Promise.resolve({}),
    }));

    assert.match(markup, /Farewell for now\./u);
    assert.match(markup, /Your Murph account and live data have been deleted\./u);
    assert.match(markup, /If you ever decide to come back, we&#x27;ll be here\./u);
    assert.match(markup, /href="\/"/u);
    assert.doesNotMatch(markup, /Clearing this browser session/u);
    expect(metadata.robots).toEqual({ follow: false, index: false });
  });

  test("keeps background cleanup clear without requiring another action", async () => {
    const markup = renderToStaticMarkup(await FarewellPage({
      searchParams: Promise.resolve({ cleanup: "pending" }),
    }));

    assert.match(markup, /technical cleanup in the background/u);
    assert.match(markup, /no action is needed/u);
  });
});
