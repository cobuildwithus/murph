import assert from "node:assert/strict";

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, it } from "vitest";

import { config, proxy } from "../proxy";
import {
  MURPH_AGENT_CONTENT_VARY,
  MURPH_AGENT_GUIDE_MARKDOWN,
} from "../src/lib/public-agent-content";

function matchesProxy(request: NextRequest): boolean {
  return unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: request.url });
}

describe("referral path proxy", () => {
  it.each([
    "/refer%2F",
    "/refer%2f",
    "/refer%5C",
    "/refer%5c",
    "/refer%2Fchild",
    "/refer%5c/child",
    "/refer%2F%5C",
    "/_next/data/synthetic/refer%2F.json",
    "/refer%5c.rsc",
    "/refer%2f?next=%2Frefer&value=%5C",
  ])("selects and rejects %s before page routing", async (pathname) => {
    const request = new NextRequest(`https://example.test${pathname}`);
    assert.equal(matchesProxy(request), true);

    const response = proxy(request);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not Found");
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("x-middleware-next"), null);
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
    assert.equal(request.url, `https://example.test${pathname}`);
  });

  it.each([
    "/refer",
    "/refer/",
    "/refer?next=%2Frefer&value=%5C&literal=%252F&bad=%E0%A4%A",
    "/refer/?next=%2Frefer&value=%5c",
    "/refer-missing",
    "/refer-missing%2F",
    "/refer%252F",
    "/refer%255C",
    "/refer%20",
    "/refer/child",
    "/refer/%2F",
    "/referral%2F",
    "/Refer%2F",
    "/REFER%5C",
    "/refer%2C",
    "/refer%5F",
    "/refer.rsc",
    "/about?next=%2Frefer%5C",
    "/compare",
    "/llms.txt",
    "/unknown?next=%2F&value=%5C",
    "/api/internal/hosted-runtime/linq-egress/delivery?signature=synthetic%2F%5C",
    "/api/internal/synthetic%2Fpath?signature=synthetic%252F",
  ])("does not invoke the proxy for %s", (pathname) => {
    const request = new NextRequest(`https://example.test${pathname}`);
    assert.equal(matchesProxy(request), false);
    // Direct invocation also leaves the request intact; no decoding or rewrite.
    const response = proxy(request);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
    assert.equal(request.url, `https://example.test${pathname}`);
  });
});

describe("homepage proxy selection", () => {
  it.each(["GET", "HEAD"])("preserves negotiated Markdown for %s", async (method) => {
    const request = new NextRequest("https://example.test/?next=%2Frefer%5C", {
      method,
      headers: { Accept: "text/html, text/markdown; q=0.9" },
    });
    assert.equal(matchesProxy(request), true);

    const response = proxy(request);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
    assert.equal(response.headers.get("cache-control"),
      "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
    assert.equal(response.headers.get("vary"), MURPH_AGENT_CONTENT_VARY);
    assert.equal(await response.text(), method === "HEAD" ? "" : MURPH_AGENT_GUIDE_MARKDOWN);
  });

  it.each([
    ["GET", "text/html"],
    ["GET", "text/markdown; q=0"],
    ["POST", "text/markdown"],
  ])("preserves page handling for %s with %s", (method, accept) => {
    const request = new NextRequest("https://example.test/?next=%2Frefer%5C", {
      method,
      headers: { Accept: accept },
    });
    assert.equal(matchesProxy(request), true);

    const response = proxy(request);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(response.headers.get("content-type"), null);
    assert.equal(response.headers.get("vary"), MURPH_AGENT_CONTENT_VARY);
  });
});
