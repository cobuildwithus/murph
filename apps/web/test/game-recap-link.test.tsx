import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Importing or reading the game database is forbidden on this public surface.
vi.mock("@/src/lib/prisma", () => { throw new Error("Public recap must not import the database"); });
vi.mock("@/src/lib/hosted-growth/signup-referral", () => { throw new Error("Recap must not load referrals"); });
vi.mock("@/src/lib/game/service", () => { throw new Error("Public recap must not import game reads"); });

import GameRecapPage, { generateMetadata } from "@/app/recap/[gameId]/page";
import { gameRecapAppUrl } from "@/src/lib/game/app-links";
import { gameRecapMessage } from "@/src/lib/game/recap-message";
import { hostedGameToolResponseSchema } from "@murphai/hosted-execution/runtime-control";

const requestHeaders = vi.hoisted(() => ({ userAgent: "" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": requestHeaders.userAgent }) }));
const iphoneUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const id = "game_synthetic";
beforeEach(() => { requestHeaders.userAgent = iphoneUa; });
afterEach(() => vi.unstubAllEnvs());

describe("public recap handoff", () => {
  it("renders the same generic page for any valid ID without reading a game", async () => {
    const recapMetadata = await generateMetadata({ params: Promise.resolve({ gameId: id }), searchParams: Promise.resolve({}) });
    vi.stubEnv("MURPH_GAME_APP_URL_SCHEME", "ai.withmurph.app.dev");
    const html = renderToStaticMarkup(await GameRecapPage({ params: Promise.resolve({ gameId: id }) }));
    expect(html).toContain("Your week, in pictures.");
    expect(html).toContain("Your recap is in Murph.");
    expect(html).toContain("Admit two");
    expect(html).toContain("The Recap");
    expect(html).toContain(`href="ai.withmurph.app.dev://recap/${id}"`);
    expect(html).toContain("Open in Murph");
    expect(html).toContain('href="https://apps.apple.com/us/app/murph-ai/id6786145859"');
    expect(html).toContain("Get it on the App Store");
    const unknown = renderToStaticMarkup(await GameRecapPage({ params: Promise.resolve({ gameId: "unknown_game" }) }));
    expect(unknown).toBe(html.replaceAll(id, "unknown_game"));
    expect(recapMetadata).toMatchObject({
      title: "Watch your recap in Murph", description: "Who won, who owes, and the best of it.",
      robots: { index: false, follow: false }, referrer: "no-referrer",
      openGraph: {
        title: "Watch your recap in Murph",
        description: "Who won, who owes, and the best of it.",
        type: "website",
        images: [{ url: "/recap-preview.png", width: 1200, height: 630, alt: "Murph recap", type: "image/png" }],
      },
      twitter: {
        card: "summary_large_image",
        title: "Watch your recap in Murph",
        description: "Who won, who owes, and the best of it.",
        images: [{ url: "/recap-preview.png", width: 1200, height: 630, alt: "Murph recap", type: "image/png" }],
      },
    });
    expect(JSON.stringify(recapMetadata)).not.toContain(id);
  });

  it.each([
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Mobile Safari/537.36",
    "",
  ])("renders the desktop QR handoff for UA %s", async (userAgent) => {
    requestHeaders.userAgent = userAgent;
    const html = renderToStaticMarkup(await GameRecapPage({ params: Promise.resolve({ gameId: id }) }));
    const { document } = parseHTML(html);
    expect(document.querySelector("h1")?.textContent).toBe("Your week, in pictures.");
    expect([...document.querySelectorAll("p")].map((p) => p.textContent)).toContain("Scan the ticket with your iPhone camera to watch it in Murph.");
    expect(document.querySelector('[role="img"] svg')).not.toBeNull();
    expect(html).toContain("No Murph yet?");
    expect(html).toContain("Get it on the App Store");
    expect(html).toContain('<svg');
    expect(html).toContain('fill="white"');
    expect(html).toContain('fill="black"');
    expect(html).not.toContain("Open in Murph");
    expect(html).not.toContain("ai.withmurph.app://");
  });

  it.each([
    iphoneUa,
    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) Mobile/15E148",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  ])("preserves the Apple mobile handoff for UA %s", async (userAgent) => {
    requestHeaders.userAgent = userAgent;
    const html = renderToStaticMarkup(await GameRecapPage({ params: Promise.resolve({ gameId: id }) }));
    expect(html).toContain("Open in Murph");
    expect(html).toContain(`href="ai.withmurph.app://recap/${id}"`);
    expect(html).not.toContain("<svg");
    expect(html).toContain("Your recap is in Murph.");
    expect(html).not.toContain("Scan the ticket");
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
