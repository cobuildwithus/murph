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

  const [fraunces400, fraunces600, dmSans400] = await Promise.all([
    readFile(fraunces400FontPath).then(toArrayBuffer),
    readFile(fraunces600FontPath).then(toArrayBuffer),
    readFile(dmSans400FontPath).then(toArrayBuffer),
  ]);

  const image = new ImageResponse(<DigestCard items={items} />, {
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
}: {
  items: readonly PublishedChangelogItem[];
}) {
  const [hero, ...rest] = items;
  if (!hero) {
    return null;
  }
  const publishedOn = hero.publishedOn;
  const headline = buildHeadline(items);
  const breakdown = buildBreakdown(items);

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
          Issue · {formatCardDate(publishedOn)}
        </div>
        <MurphWordmark />
      </div>

      <div
        style={{
          alignItems: "flex-end",
          display: "flex",
          gap: 14,
          marginTop: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontSize: 80,
            fontWeight: 600,
            letterSpacing: -1.5,
            lineHeight: 0.95,
          }}
        >
          {headline}
        </div>
        <div
          style={{
            color: COLOR.muted,
            display: "flex",
            fontSize: 14,
            letterSpacing: 0.9,
            paddingBottom: 12,
            textTransform: "uppercase",
          }}
        >
          {breakdown}
        </div>
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

function buildHeadline(items: readonly PublishedChangelogItem[]): string {
  const featureCount = items.filter((item) => item.kind === "feature").length;
  const improvementCount = items.length - featureCount;
  if (items.length === 1) {
    return items[0]!.kind === "feature" ? "New feature." : "Worth a look.";
  }
  if (featureCount > 0 && improvementCount === 0) {
    return "New features.";
  }
  if (improvementCount > 0 && featureCount === 0) {
    return "Under the hood.";
  }
  return "Shipped.";
}

function buildBreakdown(items: readonly PublishedChangelogItem[]): string {
  const featureCount = items.filter((item) => item.kind === "feature").length;
  const improvementCount = items.length - featureCount;
  const parts: string[] = [];
  if (featureCount > 0) {
    parts.push(`${featureCount} ${featureCount === 1 ? "feature" : "features"}`);
  }
  if (improvementCount > 0) {
    parts.push(
      `${improvementCount} ${improvementCount === 1 ? "improvement" : "improvements"}`,
    );
  }
  return parts.join(" · ");
}

function MurphWordmark() {
  return (
    <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {[0, 1, 2].map((row) => (
          <div key={row} style={{ display: "flex", gap: 3 }}>
            {[0, 1, 2].map((column) => (
              <span
                key={column}
                style={{
                  backgroundColor: row === 1 && column === 1 ? COLOR.feature : "#C4A882",
                  borderRadius: 999,
                  display: "flex",
                  height: 4,
                  width: 4,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <span
        style={{
          color: COLOR.foreground,
          display: "flex",
          fontFamily: "Fraunces",
          fontSize: 25,
          fontWeight: 600,
        }}
      >
        murph
      </span>
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
