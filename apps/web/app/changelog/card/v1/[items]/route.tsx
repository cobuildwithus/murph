import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";

import {
  parseChangelogCardItemSegment,
  resolveChangelogCardItems,
  type PublishedChangelogItem,
} from "@/src/lib/changelog";

import {
  dmSans400FontPath,
  fraunces400FontPath,
  fraunces600FontPath,
  logoSvgPath,
} from "../../../../font-files";

export const dynamic = "force-dynamic";

const SIZE = { width: 1200, height: 630 };
const COLOR = {
  background: "#F4EEE1",
  border: "rgba(120,110,86,0.18)",
  feature: "#52672D",
  foreground: "#2C322F",
  heroBg: "#3A4A1E",
  heroAccent: "#D8C28C",
  heroBody: "rgba(244,238,225,0.78)",
  heroForeground: "#F4EEE1",
  improvement: "#8A6038",
  muted: "#726B5E",
  panel: "rgba(255,253,249,0.62)",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ items: string }> },
): Promise<Response> {
  const { items: segment } = await context.params;
  const ids = parseChangelogCardItemSegment(segment);
  const items = ids ? resolveChangelogCardItems(ids) : null;
  if (!items?.length) {
    return new Response("Not found.", { status: 404 });
  }

  const [fraunces400, fraunces600, dmSans400, logoBuffer] = await Promise.all([
    readFile(fraunces400FontPath).then(toArrayBuffer),
    readFile(fraunces600FontPath).then(toArrayBuffer),
    readFile(dmSans400FontPath).then(toArrayBuffer),
    readFile(logoSvgPath),
  ]);
  const logoDataUri = `data:image/svg+xml;base64,${logoBuffer.toString("base64")}`;

  const image = new ImageResponse(<DigestCard items={items} logoDataUri={logoDataUri} />, {
    ...SIZE,
    fonts: [
      { name: "Fraunces", data: fraunces400, weight: 400 },
      { name: "Fraunces", data: fraunces600, weight: 600 },
      { name: "DM Sans", data: dmSans400, weight: 400 },
    ],
  });
  return await toStaticPngResponse(image);
}

function DigestCard({
  items,
  logoDataUri,
}: {
  items: readonly PublishedChangelogItem[];
  logoDataUri: string;
}) {
  const [hero, ...rest] = items;
  if (!hero) {
    return null;
  }
  const publishedOn = hero.publishedOn;

  return (
    <div
      style={{
        backgroundColor: COLOR.background,
        backgroundImage:
          "radial-gradient(circle at top right, rgba(196,168,130,0.18), transparent 55%)",
        color: COLOR.foreground,
        display: "flex",
        flexDirection: "column",
        fontFamily: "DM Sans",
        height: "100%",
        padding: "40px 56px 36px",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            color: COLOR.muted,
            display: "flex",
            fontSize: 13,
            letterSpacing: 1.4,
            textTransform: "uppercase",
          }}
        >
          {formatCardDate(publishedOn)}
        </div>
        <img
          src={logoDataUri}
          alt="Murph"
          width={108}
          height={24}
          style={{ display: "flex" }}
        />
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: "Fraunces",
          fontSize: 64,
          fontWeight: 600,
          letterSpacing: -1.2,
          lineHeight: 0.98,
          marginTop: 20,
        }}
      >
        What&rsquo;s new with Murph
      </div>

      <HeroPanel item={hero} />

      {rest.length > 0 ? <AlsoNew items={rest} /> : null}

      <div
        style={{
          color: COLOR.muted,
          display: "flex",
          fontSize: 16,
          justifyContent: "space-between",
          marginTop: "auto",
          paddingTop: 14,
        }}
      >
        <span style={{ display: "flex" }}>Reply with one you want to try.</span>
        <span style={{ display: "flex" }}>withmurph.ai/changelog</span>
      </div>
    </div>
  );
}

function HeroPanel({ item }: { item: PublishedChangelogItem }) {
  const kindLabel = item.kind === "feature" ? "FEATURE" : "IMPROVEMENT";
  return (
    <div
      style={{
        backgroundColor: COLOR.heroBg,
        backgroundImage:
          "radial-gradient(circle at top right, rgba(216,194,140,0.18), transparent 60%)",
        borderRadius: 24,
        boxShadow: "0 18px 38px -22px rgba(58,74,30,0.6)",
        color: COLOR.heroForeground,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        marginTop: 22,
        overflow: "hidden",
        padding: "26px 32px 28px",
      }}
    >
      <div
        style={{
          color: COLOR.heroAccent,
          display: "flex",
          fontSize: 13,
          letterSpacing: 1.6,
        }}
      >
        {kindLabel}
      </div>
      <div
        style={{
          display: "flex",
          fontFamily: "Fraunces",
          fontSize: 38,
          fontWeight: 600,
          letterSpacing: -0.5,
          lineHeight: 1.05,
        }}
      >
        {formatDigestTitle(item.title, 68)}
      </div>
      <div
        style={{
          color: COLOR.heroBody,
          display: "flex",
          fontSize: 17,
          lineHeight: 1.4,
          maxWidth: 980,
        }}
      >
        {formatDigestTitle(item.summary, 150)}
      </div>
    </div>
  );
}

function AlsoNew({ items }: { items: readonly PublishedChangelogItem[] }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        marginTop: 22,
      }}
    >
      <div
        style={{
          color: COLOR.muted,
          display: "flex",
          fontSize: 12,
          letterSpacing: 1.4,
          textTransform: "uppercase",
        }}
      >
        Also new
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {items.slice(0, 4).map((item) => {
          const accent =
            item.kind === "feature" ? COLOR.feature : COLOR.improvement;
          return (
            <div
              key={item.id}
              style={{
                alignItems: "baseline",
                display: "flex",
                gap: 14,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  backgroundColor: accent,
                  borderRadius: 999,
                  display: "flex",
                  flexShrink: 0,
                  height: 7,
                  transform: "translateY(-2px)",
                  width: 7,
                }}
              />
              <span
                style={{
                  display: "flex",
                  fontFamily: "Fraunces",
                  fontSize: 21,
                  fontWeight: 600,
                  lineHeight: 1.15,
                }}
              >
                {formatDigestTitle(item.title, 56)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function formatDigestTitle(title: string, maxChars: number): string {
  // Fraunces 600 ships without the U+002B "+" glyph and the renderer falls back
  // to a hyphen — strip it for the OG card surface only.
  const safe = title.replace(/\+/g, "");
  if (safe.length <= maxChars) {
    return safe;
  }
  return `${safe.slice(0, maxChars - 3).trimEnd()}...`;
}

async function toStaticPngResponse(image: Response): Promise<Response> {
  const body = await image.arrayBuffer();
  const headers = new Headers(image.headers);
  headers.set(
    "Cache-Control",
    "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
  );
  headers.set("Content-Disposition", 'inline; filename="murph-changelog-digest.png"');
  headers.set("Content-Length", String(body.byteLength));
  headers.set("Content-Type", "image/png");
  return new Response(body, {
    headers,
    status: image.status,
    statusText: image.statusText,
  });
}

function formatCardDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}
