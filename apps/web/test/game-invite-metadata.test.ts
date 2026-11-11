import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameInvitePreview } from "@/src/lib/game/contract";

const mocks = vi.hoisted(() => ({ readInvitePreview: vi.fn() }));

vi.mock("@/src/lib/game/service", () => ({ readInvitePreview: mocks.readInvitePreview }));
vi.mock("@/app/_og/og-shared", () => ({
  loadMurphHeroOgAssets: async () => ({ fonts: [] }),
  OG_CONTENT_TYPE: "image/png", OG_SIZE: { width: 1200, height: 630 },
}));
vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(element: ReactNode, options: ResponseInit) {
      super(renderToStaticMarkup(element), options);
    }
  },
}));

const { default: GameInvitePage, generateMetadata } = await import("@/app/g/[token]/page");
const { default: GameInviteOGImage } = await import("@/app/g/[token]/opengraph-image");

const OPEN: GameInvitePreview = {
  expiresAt: "2026-10-26T15:00:00.000Z",
  inviterFirstName: "Leo",
  startsOn: null,
  status: "open",
  terms: {
    fromDay: 0,
    n: 1,
    schedule: { days: [0, 1, 2, 3, 4] },
    stakes: [{ item: "Breakfast in bed", key: "gsk_breakfast", kind: "winner_gets" }],
    tasks: [{ seat: 0, text: "100 pushups" }, { seat: 1, text: "10 min abs" }],
  },
};

async function metadataFor(preview: GameInvitePreview | null, token = "tok_1") {
  mocks.readInvitePreview.mockResolvedValueOnce(preview);
  return generateMetadata({ params: Promise.resolve({ token }) });
}

describe("weekly game invite link preview", () => {
  beforeEach(() => mocks.readInvitePreview.mockReset());

  it("reads a group token as multiplayer in metadata, page and the OG image route", async () => {
    const group = {
      ...OPEN, maxPlayers: 10, group: { id: "synthetic-group", word: "family" }, lengthDays: 14,
      alreadyIn: { count: 2, firstNames: ["PRIVATE_NAME"], avatarUrl: "PRIVATE_AVATAR" },
      yourTask: "PRIVATE_YOUR_TASK", pendingLabel: "PRIVATE_PENDING", relationship: "PRIVATE_RELATIONSHIP",
      terms: { ...OPEN.terms, defaultTask: "A healthy meal", tasks: [{ seat: 0, text: "PRIVATE_OVERRIDE" }] },
    } satisfies GameInvitePreview & { pendingLabel: string; relationship: string };
    // Match service capability behavior: omitting true reproduces the original closed preview.
    mocks.readInvitePreview.mockImplementation(async (_token, multiplayer) => multiplayer ? group : null);
    const props = { params: Promise.resolve({ token: "group_token" }) };
    const title = "Leo started a family challenge";
    const metadata = await generateMetadata(props);
    expect(metadata.title).toBe(title);
    expect(metadata.openGraph).toMatchObject({
      title,
      description: "A healthy meal every weekday for two weeks. Winner gets Breakfast in bed.",
      images: [expect.objectContaining({ alt: title, url: "/g/group_token/opengraph-image" })],
    });
    const page = renderToStaticMarkup(await GameInvitePage(props));
    const image = await GameInviteOGImage(props);
    const card = await image.text();
    for (const html of [page, card]) {
      expect(html).toContain(title);
      expect(html).toContain("A healthy meal");
      expect(html).toContain("Breakfast in bed");
      expect(html).not.toMatch(/PRIVATE_|alreadyIn|pendingLabel|isn&#x27;t available|challenged you|—| - /u);
    }
    expect(page).toContain("Weekdays for 2 weeks.");
    expect(page).not.toContain("Everyone");
    expect(page).not.toContain("Artifact");
    expect(page).toContain('href="ai.withmurph.app://invite/group_token"');
    expect(image.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.readInvitePreview.mock.calls).toEqual(Array.from({ length: 3 }, () => ["group_token", true]));
  });

  it("previews an open invite as the challenge, with its own card", async () => {
    const metadata = await metadataFor(OPEN);
    const image = { alt: "Leo challenged you", height: 630, type: "image/png", url: "/g/tok_1/opengraph-image", width: 1200 };
    expect(metadata.title).toBe("Leo challenged you");
    expect(metadata.description).toBe("FOR THE WINNER: Breakfast in bed.");
    expect(metadata.openGraph).toMatchObject({
      description: "FOR THE WINNER: Breakfast in bed.",
      images: [image],
      title: "Leo challenged you",
    });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", images: [image], title: "Leo challenged you" });
    expect(metadata.robots).toEqual({ follow: false, index: false });
    expect(metadata.referrer).toBe("no-referrer");
  });

  it("describes a per-miss stake, and encodes the token in the card's address", async () => {
    const perMiss: GameInvitePreview = {
      ...OPEN,
      terms: { ...OPEN.terms, stakes: [{ item: "Coffee", key: "gsk_coffee", kind: "per_miss" }] },
    };
    const metadata = await metadataFor(perMiss, "a/b");
    expect(metadata.description).toBe("Every day you miss, you owe Coffee.");
    expect(metadata.openGraph?.images).toEqual([expect.objectContaining({ url: "/g/a%2Fb/opengraph-image" })]);
  });

  it.each<[string, GameInvitePreview | null]>([
    ["used", { status: "used" }],
    ["expired", { status: "expired" }],
    ["cancelled", { status: "expired", reason: "cancelled", inviterFirstName: "Leo" }],
    ["missing or turned off", null],
  ])("names nobody for a %s invite", async (_label, preview) => {
    const metadata = await metadataFor(preview);
    expect(metadata.title).toBe("This invite isn't available");
    expect(metadata.description).toBe("Ask for a new link.");
    expect(metadata.openGraph).toMatchObject({ title: "This invite isn't available" });
    expect(metadata.robots).toEqual({ follow: false, index: false });
    // Nothing from any invite reaches a closed link's preview.
    expect(JSON.stringify(metadata)).not.toMatch(/Leo|Babe|pushups|abs|Breakfast/u);
  });
});
