import type { ComponentProps, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ userAgent: "" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": request.userAgent }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error(`redirect:${to}`); },
}));
vi.mock("next/image", () => ({
  default: (props: ComponentProps<"img"> & { priority?: boolean }) => {
    const { priority, ...img } = props;
    return createElement("img", { ...img, "data-priority": priority ? "true" : undefined });
  },
}));
vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(element: ReactNode, options: ResponseInit) {
      super(renderToStaticMarkup(element), options);
    }
  },
}));

const { default: ConnectLinkPage, generateMetadata } = await import("@/app/connect/[source]/page");
const { default: ConnectLinkOGImage } = await import("@/app/connect/[source]/opengraph-image");
const { connectSourceAppUrl } = await import("@/src/lib/game/app-links");

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
// An iPad asking for the desktop site, held sideways: a Mac user agent that still says Mobile.
const WIDE_IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const APP_STORE = 'href="https://apps.apple.com/us/app/murph-ai/id6786145859"';

const page = (source: string) => ConnectLinkPage({ params: Promise.resolve({ source }) });
const render = async (source: string) => renderToStaticMarkup(await page(source));
const code = (markup: string) => /<div[^>]*role="img"[^>]*>(<svg.*?<\/svg>)<\/div>/u.exec(markup)?.[1];

beforeEach(() => { request.userAgent = IPHONE; });

describe("the connect link page", () => {
  it.each([IPHONE, WIDE_IPAD])("offers the app and a way into it on an iPhone or iPad, wide or not", async (userAgent) => {
    request.userAgent = userAgent;
    const html = await render("apple-health");
    expect(html).toContain("Connect Apple Health in Murph.");
    expect(html).toContain("It&#x27;s an iPhone app. Get it, then tap the link in your text again.");
    expect(html).toContain("Get the app");
    expect(html).toContain(APP_STORE);
    expect(html).toContain('href="ai.withmurph.app://connect/apple-health"');
    expect(html.indexOf(APP_STORE)).toBeLessThan(html.indexOf("Already have Murph?"));
    expect(html).not.toContain("Scan to connect.");
    expect(code(html)).toBeUndefined();
    // Width never hides a working button.
    expect(html).not.toMatch(/@5xl:hidden|hidden[^"]*@5xl:flex/u);
  });

  it("shows a computer a code for the same link, with a small App Store line", async () => {
    request.userAgent = MAC;
    const html = await render("apple-health");
    expect(html).toContain("Connect Apple Health in Murph.");
    expect(html).toContain("Scan to connect.");
    expect(html).toContain("Your phone opens Murph on the Apple Health step.");
    expect(code(html)).toBeDefined();
    expect(html).toContain("Get it on the App Store");
    expect(html).toContain(APP_STORE);
    expect(html).not.toContain("Get the app");
    expect(html).not.toContain("Already have Murph?");
    expect(html).not.toContain("ai.withmurph.app://");
    // The code carries this source's link and nothing else.
    expect(code(await render("coros"))).not.toBe(code(html));
  });

  it("names a wearable that comes in through Apple Health, with its own logo", async () => {
    const html = await render("coros");
    expect(html).toContain("Connect COROS in Murph.");
    expect(html).toContain("/brand-logos/connect/coros.png");
    expect(html).toContain('href="ai.withmurph.app://connect/coros"');
  });

  it("sends a source that signs in on its own website to the website's connect page", async () => {
    await expect(page("oura")).rejects.toThrow("redirect:/connect#oura");
    await expect(page("whoop")).rejects.toThrow("redirect:/connect#whoop");
  });

  it.each(["not-a-source", "strava", "dexcom", "google-fit", "mobvoi-health", "../settings"])(
    "sends an unknown or paused source (%s) to the website's connect page",
    async (source) => {
      await expect(page(source)).rejects.toThrow("redirect:/connect");
      expect(await generateMetadata({ params: Promise.resolve({ source }) })).toEqual({ robots: { index: false, follow: false } });
    },
  );

  it("titles the link preview and points it at the route's own image", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ source: "apple-health" }) });
    expect(metadata).toMatchObject({
      title: "Connect Apple Health to Murph",
      robots: { index: false, follow: false },
      referrer: "no-referrer",
      openGraph: { images: [{ url: "/connect/apple-health/opengraph-image", alt: "Connect Apple Health to Murph" }] },
    });
  });

  it("draws the preview from the Murph icon and the source's own icon", async () => {
    const image = await ConnectLinkOGImage({ params: Promise.resolve({ source: "coros" }) });
    const html = await image.text();
    expect(html.match(/<img/gu)).toHaveLength(2);
    expect(html.match(/src="data:image\/png;base64,/gu)).toHaveLength(2);
    expect(html).toContain("#F5F0E8");
    const appleHealth = await (await ConnectLinkOGImage({ params: Promise.resolve({ source: "apple-health" }) })).text();
    expect(appleHealth).not.toBe(html);
    expect((await ConnectLinkOGImage({ params: Promise.resolve({ source: "oura" }) })).status).toBe(404);
  });

  it("opens the Murph app by default, or the configured scheme", () => {
    expect(connectSourceAppUrl("apple-health", {})).toBe("ai.withmurph.app://connect/apple-health");
    expect(connectSourceAppUrl("coros", { MURPH_GAME_APP_URL_SCHEME: "ai.withmurph.app.dev" })).toBe("ai.withmurph.app.dev://connect/coros");
  });
});
