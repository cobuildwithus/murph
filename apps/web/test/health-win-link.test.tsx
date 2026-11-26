import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import WinLinkPage, { metadata } from "@/app/wins/[ref]/page";

vi.mock("@/src/lib/prisma", () => { throw new Error("Public win link imported the database"); });
vi.mock("@/src/lib/game/service", () => { throw new Error("Public win link imported game reads"); });
vi.mock("@/src/lib/health-wins/wins", () => { throw new Error("Public win link imported member wins"); });
vi.mock("next/headers", () => { throw new Error("Public win link requested caller context"); });

const page = (ref: string) => WinLinkPage({ params: Promise.resolve({ ref }) });
afterEach(() => vi.unstubAllEnvs());

describe("public win link", () => {
  it("renders the same generic handoff for any well-formed reference on any device", async () => {
    vi.stubEnv("MURPH_GAME_APP_URL_SCHEME", "");
    const ref = "aB_-".repeat(10) + "4zA";
    const markup = renderToStaticMarkup(await page(ref));
    const { document } = parseHTML(markup);
    expect(document.querySelector("h1")?.textContent).toBe("A new win in Murph");
    const links = [...document.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe("Open in Murph");
    expect(links[0]?.getAttribute("href")).toBe(`ai.withmurph.app://wins/${ref}`);

    const unknown = "z".repeat(43);
    expect(renderToStaticMarkup(await page(unknown))).toBe(markup.replaceAll(ref, unknown));
  });

  it("uses one static, value-free preview for every reference", () => {
    const preview = {
      title: "A new win in Murph",
      description: "Open it on your iPhone to share it.",
      images: [{ url: "/brand-logos/murph-logo-avatar-light.png", alt: "Murph" }],
    };
    expect(metadata).toMatchObject({
      referrer: "no-referrer",
      robots: { index: false, follow: false },
      openGraph: preview,
      twitter: preview,
    });
  });

  it.each(["", "a".repeat(42), "z".repeat(44), "x".repeat(42) + "/", "z".repeat(42) + "+"])(
    "rejects malformed win reference %j", async (value) => {
      await expect(page(value)).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    },
  );
});
