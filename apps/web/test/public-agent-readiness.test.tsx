import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { describe, it } from "vitest";

import { GET as getLlmsText } from "../app/llms.txt/route";
import { PublicTrustPageContent } from "../src/components/public/public-trust-page";
import {
  acceptsMarkdown,
  MURPH_AGENT_CONTENT_VARY,
  MURPH_AGENT_GUIDE_MARKDOWN,
  MURPH_ORGANIZATION_STRUCTURED_DATA,
  MURPH_SOFTWARE_APPLICATION_STRUCTURED_DATA,
  serializeStructuredData,
} from "../src/lib/public-agent-content";
import {
  ABOUT_MURPH_CONTENT,
  CONTACT_MURPH_CONTENT,
} from "../src/lib/public-trust-pages";
import { proxy } from "../proxy";

describe("public agent content", () => {
  it("negotiates a substantive Markdown homepage with cache-safe variants", async () => {
    const response = proxy(new NextRequest("https://example.test/", {
      headers: {
        Accept: "text/html, text/markdown; q=0.9",
      },
    }));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
    assert.equal(response.headers.get("vary"), MURPH_AGENT_CONTENT_VARY);
    assert.equal(await response.text(), MURPH_AGENT_GUIDE_MARKDOWN);
    assert.match(MURPH_AGENT_GUIDE_MARKDOWN, /^## When to use Murph$/mu);
    assert.match(MURPH_AGENT_GUIDE_MARKDOWN, /^## Who Murph is for$/mu);
    assert.ok(MURPH_AGENT_GUIDE_MARKDOWN.length > 1_500);
  });

  it("keeps HTML requests on the page renderer while varying on Accept", () => {
    const response = proxy(new NextRequest("https://example.test/", {
      headers: {
        Accept: "text/html",
      },
    }));

    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(response.headers.get("vary"), MURPH_AGENT_CONTENT_VARY);
  });

  it("does not turn non-read homepage methods into Markdown responses", () => {
    const response = proxy(new NextRequest("https://example.test/", {
      headers: {
        Accept: "text/markdown",
      },
      method: "POST",
    }));

    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(response.headers.get("content-type"), null);
  });

  it("rejects disabled Markdown media ranges and accepts case-insensitive ones", () => {
    assert.equal(acceptsMarkdown("text/markdown; q=0"), false);
    assert.equal(acceptsMarkdown("TEXT/MARKDOWN;Q=1"), true);
    assert.equal(acceptsMarkdown("text/html, application/xhtml+xml"), false);
  });

  it("publishes llms.txt as the same Markdown guide", async () => {
    const response = getLlmsText();

    assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
    assert.equal(response.headers.get("vary"), MURPH_AGENT_CONTENT_VARY);
    assert.equal(await response.text(), MURPH_AGENT_GUIDE_MARKDOWN);
  });

  it("publishes truthful Organization and SoftwareApplication identities", () => {
    assert.equal(MURPH_ORGANIZATION_STRUCTURED_DATA["@type"], "Organization");
    assert.equal(
      MURPH_ORGANIZATION_STRUCTURED_DATA.contactPoint.contactType,
      "customer support",
    );
    assert.equal(
      MURPH_SOFTWARE_APPLICATION_STRUCTURED_DATA["@type"],
      "SoftwareApplication",
    );
    assert.equal(MURPH_SOFTWARE_APPLICATION_STRUCTURED_DATA.offers.price, "0");
    assert.equal("telephone" in MURPH_ORGANIZATION_STRUCTURED_DATA, false);
    assert.equal(
      MURPH_ORGANIZATION_STRUCTURED_DATA.address["@type"],
      "PostalAddress",
    );
    assert.equal(
      MURPH_ORGANIZATION_STRUCTURED_DATA.address.addressCountry,
      "US",
    );
  });

  it("escapes structured data before embedding it in HTML", () => {
    assert.equal(
      serializeStructuredData({ value: "</script>" }),
      '{"value":"\\u003c/script>"}',
    );
  });
});

describe("public trust pages", () => {
  it.each([
    ["about", ABOUT_MURPH_CONTENT],
    ["contact", CONTACT_MURPH_CONTENT],
  ] as const)("renders the %s page with an H1, H2 structure, and substantive copy", (_name, content) => {
    const markup = renderToStaticMarkup(
      createElement(PublicTrustPageContent, { content }),
    );
    const readableText = markup.replaceAll(/<[^>]+>/gu, " ").replaceAll(/\s+/gu, " ").trim();

    assert.equal((markup.match(/<h1\b/gu) ?? []).length, 1);
    assert.equal((markup.match(/<h2\b/gu) ?? []).length, content.sections.length);
    assert.ok(readableText.length > 500);
  });
});
