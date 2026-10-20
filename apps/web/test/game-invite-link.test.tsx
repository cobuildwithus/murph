import type { ComponentProps } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GameInviteView } from "@/app/g/[token]/game-invite-view";
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

  it("puts that link on the page's Open in Murph button", () => {
    const appUrl = gameInviteAppUrl("tok_1", { MURPH_GAME_APP_URL_SCHEME: "ai.withmurph.app.dev" });
    const html = renderToStaticMarkup(createElement(GameInviteView, { appUrl, preview: OPEN }));
    expect(html).toContain('href="ai.withmurph.app.dev://invite/tok_1"');
    expect(html).toContain("Open in Murph");
    expect(html).not.toContain("murphv2://");
    // A closed invite offers no app link.
    expect(renderToStaticMarkup(createElement(GameInviteView, { appUrl, preview: { status: "used" } }))).not.toContain(appUrl);
  });
});
