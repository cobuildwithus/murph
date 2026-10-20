import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameInvitePreview } from "@/src/lib/game/contract";

const mocks = vi.hoisted(() => ({ readInvitePreview: vi.fn() }));

vi.mock("@/src/lib/game/service", () => ({ readInvitePreview: mocks.readInvitePreview }));

const { generateMetadata } = await import("@/app/g/[token]/page");

const OPEN: GameInvitePreview = {
  expiresAt: "2026-10-26T15:00:00.000Z",
  inviteeFirstName: "Ava",
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

  it("previews an open invite as the challenge, with its own card", async () => {
    const metadata = await metadataFor(OPEN);
    const image = { alt: "Leo challenged you", height: 630, type: "image/png", url: "/g/tok_1/opengraph-image", width: 1200 };
    expect(metadata.title).toBe("Leo challenged you");
    expect(metadata.description).toBe("Winner of the week gets Breakfast in bed.");
    expect(metadata.openGraph).toMatchObject({
      description: "Winner of the week gets Breakfast in bed.",
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
    ["missing or turned off", null],
  ])("names nobody for a %s invite", async (_label, preview) => {
    const metadata = await metadataFor(preview);
    expect(metadata.title).toBe("This invite isn't available");
    expect(metadata.description).toBe("Ask for a new link.");
    expect(metadata.openGraph).toMatchObject({ title: "This invite isn't available" });
    expect(metadata.robots).toEqual({ follow: false, index: false });
    // Nothing from any invite reaches a closed link's preview.
    expect(JSON.stringify(metadata)).not.toMatch(/Leo|Ava|pushups|abs|Breakfast/u);
  });
});
