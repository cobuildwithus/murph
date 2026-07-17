import { describe, expect, it, vi } from "vitest";

vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor() {
      super(new Uint8Array([137, 80, 78, 71]), {
        headers: { "content-type": "image/png" },
        status: 200,
      });
    }
  },
}));

import { GET as getChangelogFeed } from "../app/api/changelog/route";
import { GET as getChangelogCard } from "../app/changelog/card/v1/[items]/route";
import {
  CHANGELOG_FEED_SCHEMA,
  buildChangelogCardPath,
  buildChangelogItemPath,
  listPublishedChangelogItems,
} from "../src/lib/changelog";

describe("changelog routes", () => {
  it("publishes every item from the two newest editions with canonical links", async () => {
    const response = await getChangelogFeed(
      new Request(
        "https://join.example.test/api/changelog?from=2026-07-15&to=2026-07-17",
      ),
    );
    const body = await response.json();
    const items = body.items as Array<{
      id: string;
      publishedOn: string;
      url: string;
    }>;

    expect(response.status).toBe(200);
    expect(items).toHaveLength(26);
    expect(items.map((item) => item.publishedOn)).toEqual([
      ...Array.from({ length: 13 }, () => "2026-07-16"),
      ...Array.from({ length: 13 }, () => "2026-07-15"),
    ]);
    expect(items.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "sleep-support-that-stays",
        "conversation-subscription-actions",
        "usage-top-ups",
        "group-owned-murph-style",
        "context-aware-follow-through",
        "murph-safe-product-search",
        "scheduled-replies-keep-context",
        "onboarding-asks-before-it-prescribes",
        "whoop-apple-health-fallback",
        "phone-calls-in-plan-usage",
        "less-repeated-work-behind-everyday-screens",
        "home-experiment-history-compact",
        "biomarker-pages-restored",
        "affirmative-reactions-as-replies",
        "reaction-first-group-permissions",
        "family-member-plan-management",
        "leave-a-group-yourself",
        "exercise-library-250-more-visual-guides",
        "fresh-messages-stay-foreground",
        "pulse-trial-two-weeks",
        "replies-read-like-texting",
        "model-settings-refresh",
        "experiment-cards-honest-colors",
        "voice-previews-pick-the-voice",
        "signup-and-email-linking-fixes",
        "billing-settings-handoff",
      ]),
    );
    for (const item of items) {
      const itemUrl = new URL(item.url);
      expect(`${itemUrl.pathname}${itemUrl.search}${itemUrl.hash}`).toBe(
        buildChangelogItemPath(item.id),
      );
    }
  });

  it("returns a bounded feed with canonical links for an explicit window", async () => {
    const response = await getChangelogFeed(
      new Request(
        "https://join.example.test/api/changelog?from=2026-06-01&to=2026-07-01&featureLimit=1&improvementLimit=1",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(body).toMatchObject({
      schema: CHANGELOG_FEED_SCHEMA,
      window: {
        from: "2026-06-01",
        to: "2026-07-01",
      },
      links: {
        digestCardTemplate: expect.stringContaining("/changelog/card/v1/{ids}.png"),
        fullChangelog: expect.stringContaining("/changelog"),
      },
    });
    expect(body.items.filter((item: { kind: string }) => item.kind === "feature")).toHaveLength(1);
    expect(body.items.filter((item: { kind: string }) => item.kind === "improvement")).toHaveLength(1);
    const itemUrl = new URL(body.items[0].url);
    expect(`${itemUrl.pathname}${itemUrl.search}${itemUrl.hash}`).toBe(
      buildChangelogItemPath(body.items[0].id),
    );
  });

  it("rejects invalid feed windows and over-limit day windows", async () => {
    for (const url of [
      "https://join.example.test/api/changelog?from=2026-06-01",
      "https://join.example.test/api/changelog?from=2026-07-01&to=2026-06-01",
      "https://join.example.test/api/changelog?days=156",
    ]) {
      const response = await getChangelogFeed(new Request(url));
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INVALID_CHANGELOG_QUERY" },
      });
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("renders a png card for valid item ids and 404s invalid ids", async () => {
    const ids = listPublishedChangelogItems().slice(0, 2).map((item) => item.id);
    const validSegment = buildChangelogCardPath(ids).split("/").at(-1);
    expect(validSegment).toBeTruthy();

    const response = await getChangelogCard(
      new Request(`https://join.example.test/changelog/card/v1/${validSegment}`),
      { params: Promise.resolve({ items: validSegment ?? "" }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("s-maxage=86400");

    const notFound = await getChangelogCard(
      new Request("https://join.example.test/changelog/card/v1/not-real.png"),
      { params: Promise.resolve({ items: "not-real.png" }) },
    );
    expect(notFound.status).toBe(404);
  });
});
