import type { ComponentProps } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GameInviteView } from "@/app/g/[token]/game-invite-view";
import { GameInviteShareCard } from "@/app/g/[token]/invite-share-card";
import { gameInviteAppUrl } from "@/src/lib/game/access";
import type { GameInvitePreview } from "@/src/lib/game/contract";

vi.mock("next/image", () => ({
  default: (props: ComponentProps<"img"> & { priority?: boolean }) => {
    const { priority, ...img } = props;
    return createElement("img", { ...img, "data-priority": priority ? "true" : undefined });
  },
}));

const OPEN: GameInvitePreview = {
  expiresAt: "2026-10-23T15:00:00.000Z",
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

describe("weekly game invite link", () => {
  it("preserves the pair page and share card byte for byte", () => {
    expect(renderToStaticMarkup(createElement(GameInviteView, {
      appUrl: "ai.withmurph.app://invite/synthetic", preview: OPEN,
    }))).toMatchSnapshot("pair page");
    expect(renderToStaticMarkup(createElement(GameInviteShareCard, { preview: OPEN })))
      .toMatchSnapshot("pair share card");
    const capable = { ...OPEN, maxPlayers: 2 as const, alreadyIn: { count: 0, firstNames: [], avatarUrl: null } };
    expect(renderToStaticMarkup(createElement(GameInviteView, {
      appUrl: "ai.withmurph.app://invite/synthetic", preview: capable,
    }))).toBe(renderToStaticMarkup(createElement(GameInviteView, {
      appUrl: "ai.withmurph.app://invite/synthetic", preview: OPEN,
    })));
    expect(renderToStaticMarkup(createElement(GameInviteShareCard, { preview: capable })))
      .toBe(renderToStaticMarkup(createElement(GameInviteShareCard, { preview: OPEN })));
  });

  it("opens the Murph app by default, or the configured scheme", () => {
    expect(gameInviteAppUrl("tok_1", {})).toBe("ai.withmurph.app://invite/tok_1");
    expect(gameInviteAppUrl("tok_1", { MURPH_GAME_APP_URL_SCHEME: " ai.withmurph.app.dev " }))
      .toBe("ai.withmurph.app.dev://invite/tok_1");
    // A blank or malformed setting falls back to the Murph app's own scheme.
    expect(gameInviteAppUrl("tok_1", { MURPH_GAME_APP_URL_SCHEME: "" })).toBe("ai.withmurph.app://invite/tok_1");
    expect(gameInviteAppUrl("tok_1", { MURPH_GAME_APP_URL_SCHEME: "javascript:alert(1)//" }))
      .toBe("ai.withmurph.app://invite/tok_1");
    expect(gameInviteAppUrl("a/b c", {})).toBe("ai.withmurph.app://invite/a%2Fb%20c");
  });

  it("discloses a required check-in before acceptance, including legacy photos", () => {
    if (OPEN.status !== "open") throw new Error("Expected open fixture");
    const render = (preview: GameInvitePreview) => renderToStaticMarkup(createElement(GameInviteView, { appUrl: "ai.withmurph.app://invite/synthetic", preview }));
    expect(render(OPEN)).toContain("Prove it with a photo.");
    expect(render(OPEN)).toContain("Weekdays for a week. Starts once you say yes.");
    expect(render(OPEN)).not.toContain("paste it in Murph");
    // Free choice requires nothing, so the card says nothing about it.
    expect(render({ ...OPEN, terms: { ...OPEN.terms, checkInKind: "any" } })).not.toContain("Prove it");
    expect(render({ ...OPEN, terms: { ...OPEN.terms, checkInKind: "heart_rate" } })).toContain("Prove it with heart rate from a wearable.");
  });

  it("shows the invitee's task first, as You, and never a private name", () => {
    const html = renderToStaticMarkup(createElement(GameInviteView, { appUrl: "ai.withmurph.app://invite/synthetic", preview: OPEN }));
    expect(html).toContain("Leo challenged you.");
    expect(html.indexOf("10 min abs")).toBeLessThan(html.indexOf("100 pushups"));
    expect(html.indexOf(">You<")).toBeLessThan(html.indexOf("10 min abs"));
    expect(html).toContain("For the winner");
    expect(html).toContain("Breakfast in bed");
  });

  it("puts that link on the page's Open it link", () => {
    const appUrl = gameInviteAppUrl("tok_1", { MURPH_GAME_APP_URL_SCHEME: "ai.withmurph.app.dev" });
    const html = renderToStaticMarkup(createElement(GameInviteView, { appUrl, preview: OPEN }));
    expect(html).toContain('href="ai.withmurph.app.dev://invite/tok_1"');
    expect(html).toContain("Already have Murph?");
    expect(html).not.toContain("murphv2://");
    expect(html).not.toContain("Copy link");
    // A closed invite offers no app link.
    expect(renderToStaticMarkup(createElement(GameInviteView, { appUrl, preview: { status: "used" } }))).not.toContain(appUrl);
  });

  it("leads with Get the app, the App Store, for a phone without the app", () => {
    const appStore = 'href="https://apps.apple.com/us/app/murph-ai/id6786145859"';
    const html = renderToStaticMarkup(createElement(GameInviteView, { appUrl: "ai.withmurph.app://invite/synthetic", preview: OPEN }));
    expect(html).toContain(appStore);
    expect(html).toContain("Get the app");
    expect(html.indexOf(appStore)).toBeLessThan(html.indexOf("Already have Murph?"));
    expect(renderToStaticMarkup(createElement(GameInviteView, { appUrl: "ai.withmurph.app://invite/synthetic", preview: { status: "used" } }))).not.toContain(appStore);
  });

  it("puts a dare on the loser's pink slip", () => {
    if (OPEN.status !== "open") throw new Error("Expected open fixture");
    const html = renderToStaticMarkup(createElement(GameInviteView, {
      appUrl: "ai.withmurph.app://invite/synthetic",
      preview: { ...OPEN, terms: { ...OPEN.terms, stakes: [{ item: "sing at karaoke", key: "gsk_dare", kind: "dare" }] } },
    }));
    expect(html).toContain("The loser has to");
    expect(html).toContain("sing at karaoke");
    expect(html).not.toContain("For the winner");
  });
});

it.each([
  [{ status: "used" }, "This link is used up.", "Someone already shook on it. Ask for a new one."],
  [{ status: "expired", reason: "cancelled" }, "This invite was called off.", "Ask for a new one."],
  [{ status: "expired" }, "This invite ran out.", "It wasn&#x27;t shaken on in time. Ask for a new one."],
  [null, "This link isn&#x27;t available.", "Check the link, or ask for a new one."],
] satisfies Array<[GameInvitePreview | null, string, string]>)("explains the closed invite cause in the app's words", (preview, title, detail) => {
  const html = renderToStaticMarkup(createElement(GameInviteView, { appUrl: "ai.withmurph.app://invite/synthetic", preview }));
  expect(html).toContain(title);
  expect(html).toContain(detail);
  expect(html).not.toContain("Get the app");
  expect(html).not.toContain("Already have Murph?");
});
