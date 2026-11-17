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

const INVITE_URL = "https://www.withmurph.ai/g/tok_synthetic";

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
      appUrl: "ai.withmurph.app://invite/synthetic", inviteUrl: INVITE_URL, onComputer: false, preview: OPEN,
    }))).toMatchSnapshot("pair page");
    expect(renderToStaticMarkup(createElement(GameInviteShareCard, { preview: OPEN })))
      .toMatchSnapshot("pair share card");
    const capable = { ...OPEN, maxPlayers: 2 as const, alreadyIn: { count: 0, firstNames: [], avatarUrl: null } };
    expect(renderToStaticMarkup(createElement(GameInviteView, {
      appUrl: "ai.withmurph.app://invite/synthetic", inviteUrl: INVITE_URL, onComputer: false, preview: capable,
    }))).toBe(renderToStaticMarkup(createElement(GameInviteView, {
      appUrl: "ai.withmurph.app://invite/synthetic", inviteUrl: INVITE_URL, onComputer: false, preview: OPEN,
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
    const render = (preview: GameInvitePreview) => renderToStaticMarkup(createElement(GameInviteView, { appUrl: "ai.withmurph.app://invite/synthetic", inviteUrl: INVITE_URL, onComputer: false, preview }));
    expect(render(OPEN)).toContain("Prove it with a photo.");
    expect(render(OPEN)).toContain("Weekdays for a week. Starts once you say yes.");
    expect(render(OPEN)).not.toContain("paste it in Murph");
    // Free choice requires nothing, so the card says nothing about it.
    expect(render({ ...OPEN, terms: { ...OPEN.terms, checkInKind: "any" } })).not.toContain("Prove it");
    expect(render({ ...OPEN, terms: { ...OPEN.terms, checkInKind: "heart_rate" } })).toContain("Prove it with heart rate from a wearable.");
  });

  it("shows the invitee's task first, as You, and never a private name", () => {
    const html = renderToStaticMarkup(createElement(GameInviteView, { appUrl: "ai.withmurph.app://invite/synthetic", inviteUrl: INVITE_URL, onComputer: false, preview: OPEN }));
    expect(html).toContain("Leo challenged you.");
    expect(html.indexOf("10 min abs")).toBeLessThan(html.indexOf("100 pushups"));
    expect(html.indexOf(">You<")).toBeLessThan(html.indexOf("10 min abs"));
    expect(html).toContain("For the winner");
    expect(html).toContain("Breakfast in bed");
  });

  it("puts that link on the page's Open it link", () => {
    const appUrl = gameInviteAppUrl("tok_1", { MURPH_GAME_APP_URL_SCHEME: "ai.withmurph.app.dev" });
    const html = renderToStaticMarkup(createElement(GameInviteView, { appUrl, inviteUrl: INVITE_URL, onComputer: false, preview: OPEN }));
    expect(html).toContain('href="ai.withmurph.app.dev://invite/tok_1"');
    expect(html).toContain("Already have Murph?");
    expect(html).not.toContain("murphv2://");
    expect(html).not.toContain("Copy link");
    // A closed invite offers no app link.
    expect(renderToStaticMarkup(createElement(GameInviteView, { appUrl, inviteUrl: INVITE_URL, onComputer: false, preview: { status: "used" } }))).not.toContain(appUrl);
  });

  it("leads with Get the app, the App Store, for a phone without the app", () => {
    const appStore = 'href="https://apps.apple.com/us/app/murph-ai/id6786145859"';
    const html = renderToStaticMarkup(createElement(GameInviteView, { appUrl: "ai.withmurph.app://invite/synthetic", inviteUrl: INVITE_URL, onComputer: false, preview: OPEN }));
    expect(html).toContain(appStore);
    expect(html).toContain("Get the app");
    expect(html.indexOf(appStore)).toBeLessThan(html.indexOf("Already have Murph?"));
    expect(renderToStaticMarkup(createElement(GameInviteView, { appUrl: "ai.withmurph.app://invite/synthetic", inviteUrl: INVITE_URL, onComputer: false, preview: { status: "used" } }))).not.toContain(appStore);
  });

  it("gives a computer a code for the invite's own link in place of the buttons, and only while the invite is open", () => {
    const render = (inviteUrl: string, preview: GameInvitePreview | null, onComputer = true) => renderToStaticMarkup(createElement(GameInviteView, { appUrl: "ai.withmurph.app://invite/synthetic", inviteUrl, onComputer, preview }));
    const html = render(INVITE_URL, OPEN);
    expect(html).toContain("Scan to play.");
    expect(html).toContain("Point your phone&#x27;s camera here.");
    expect(html).not.toContain("Get the app");
    expect(html).not.toContain("Already have Murph?");
    // The code is drawn into the page itself, from the link it was given and nothing else.
    const code = (markup: string) => /<div[^>]*role="img"[^>]*>(<svg.*?<\/svg>)<\/div>/u.exec(markup)?.[1];
    expect(code(html)).toBeDefined();
    expect(code(render(INVITE_URL, OPEN))).toBe(code(html));
    expect(code(render("https://www.withmurph.ai/g/tok_other", OPEN))).not.toBe(code(html));
    expect(html).not.toContain(INVITE_URL);
    for (const closed of [{ status: "used" }, { status: "expired" }, null] satisfies Array<GameInvitePreview | null>) {
      expect(render(INVITE_URL, closed)).not.toContain("Scan to play.");
      expect(code(render(INVITE_URL, closed))).toBeUndefined();
    }
  });

  it("decides by device, not width: an iPhone or iPad keeps both buttons and never gets the code", () => {
    const html = renderToStaticMarkup(createElement(GameInviteView, { appUrl: "ai.withmurph.app://invite/synthetic", inviteUrl: INVITE_URL, onComputer: false, preview: OPEN }));
    expect(html).toContain("Get the app");
    expect(html).toContain("Already have Murph?");
    expect(html).not.toContain("Scan to play.");
    // No width rule hides a working button or shows the code.
    expect(html).not.toMatch(/@5xl:hidden|hidden[^"]*@5xl:flex/u);
  });

  it("puts a dare on the loser's pink slip", () => {
    if (OPEN.status !== "open") throw new Error("Expected open fixture");
    const html = renderToStaticMarkup(createElement(GameInviteView, {
      appUrl: "ai.withmurph.app://invite/synthetic", inviteUrl: INVITE_URL, onComputer: false,
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
  const html = renderToStaticMarkup(createElement(GameInviteView, { appUrl: "ai.withmurph.app://invite/synthetic", inviteUrl: INVITE_URL, onComputer: false, preview }));
  expect(html).toContain(title);
  expect(html).toContain(detail);
  expect(html).not.toContain("Get the app");
  expect(html).not.toContain("Already have Murph?");
});
