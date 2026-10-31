import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Importing or reading the game database is forbidden on this public surface.
vi.mock("@/src/lib/prisma", () => { throw new Error("Public recap must not import the database"); });
vi.mock("@/src/lib/hosted-growth/signup-referral", () => { throw new Error("Recap must not load referrals"); });
vi.mock("@/src/lib/game/service", () => { throw new Error("Public recap must not import game reads"); });

import GameRecapPage, { metadata as recapMetadata } from "@/app/recap/[gameId]/page";
import { gameRecapAppUrl } from "@/src/lib/game/app-links";
import { gameRecapMessage } from "@/src/lib/game/recap-message";
import { hostedGameToolResponseSchema } from "@murphai/hosted-execution/runtime-control";

const id = "game_synthetic";
afterEach(() => vi.unstubAllEnvs());

describe("public recap handoff", () => {
  it("renders the same generic page for any valid ID without reading a game", async () => {
    vi.stubEnv("MURPH_GAME_APP_URL_SCHEME", "ai.withmurph.app.dev");
    const html = renderToStaticMarkup(await GameRecapPage({ params: Promise.resolve({ gameId: id }) }));
    expect(html).toContain("Your recap is in Murph.");
    expect(html).toContain(`href="ai.withmurph.app.dev://recap/${id}"`);
    expect(html).toContain("Open in Murph");
    expect(html).toContain('href="https://apps.apple.com/us/app/murph-ai/id6786145859"');
    expect(html).toContain("Get it on the App Store");
    const unknown = renderToStaticMarkup(await GameRecapPage({ params: Promise.resolve({ gameId: "unknown_game" }) }));
    expect(unknown).toBe(html.replaceAll(id, "unknown_game"));
    expect(recapMetadata).toMatchObject({
      title: "Your recap is in Murph", description: "Open Murph to watch your recap.",
      robots: { index: false, follow: false }, referrer: "no-referrer",
      openGraph: { title: "Your recap is in Murph", type: "website", images: [expect.objectContaining({ url: "/opengraph-image" })] },
    });
    expect(JSON.stringify(recapMetadata)).not.toContain(id);
  });

  it.each(["short", "a".repeat(65), "game/other", "game?query", "game%2Fother", "game%", "game<script>"])("404s malformed ID %s", async (gameId) => {
    await expect(GameRecapPage({ params: Promise.resolve({ gameId }) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("uses the invite scheme source and safe fallback", () => {
    expect(gameRecapAppUrl(id, {})).toBe(`ai.withmurph.app://recap/${id}`);
    expect(gameRecapAppUrl(id, { MURPH_GAME_APP_URL_SCHEME: "javascript:bad" })).toBe(`ai.withmurph.app://recap/${id}`);
  });

  it("uses the canonical origin and preserves the sealed line exactly across replay", () => {
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://recaps.murph.test/");
    const chatLine = "x".repeat(160);
    const text = `${chatLine}\nWatch the recap: https://recaps.murph.test/recap/${id}`;
    expect(gameRecapMessage(id, chatLine)).toBe(text);
    expect(gameRecapMessage(id, chatLine)).toBe(text);
    const result = { action: "write_recap", result: { status: "ok", chatLine: text } };
    expect(hostedGameToolResponseSchema.parse(result)).toEqual(result);
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "");
    vi.stubEnv("HOSTED_WEB_BASE_URL", "https://fallback.murph.test");
    expect(gameRecapMessage(id, chatLine)).toContain("https://fallback.murph.test/recap/");
  });
});
