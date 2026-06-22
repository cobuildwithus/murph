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
  improvement: "#8A6038",
  muted: "#726B5E",
  panel: "rgba(255,253,249,0.62)",
};
const COMPACT_ITEM_COUNT = 5;

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
  const columns = buildDigestColumns(rest);
  const compact = rest.length >= 4;
  const publishedOn = hero.publishedOn;
  const headline = buildHeadline(items);

  return (
    <div
      style={{
        backgroundColor: COLOR.background,
        color: COLOR.foreground,
        display: "flex",
        flexDirection: "column",
        fontFamily: "DM Sans",
        height: "100%",
        padding: "44px 62px 42px",
        width: "100%",
      }}
    >
      <div style={{ alignItems: "flex-start", display: "flex", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              color: COLOR.muted,
              display: "flex",
              fontSize: 15,
              letterSpacing: 1.2,
              textTransform: "uppercase",
            }}
          >
            New in Murph · {formatCardDate(publishedOn)}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Fraunces",
              fontSize: 52,
              fontWeight: 600,
              lineHeight: 1.04,
              marginTop: 12,
            }}
          >
            {headline}
          </div>
        </div>
        <MurphWordmark />
      </div>

      <HeroItem item={hero} />

      {rest.length > 0 ? (
        <div style={{ display: "flex", flexGrow: 1, gap: 18, marginTop: 18 }}>
          {columns.map((column, columnIndex) => (
            <div
              key={columnIndex}
              style={{
                display: "flex",
                flexBasis: 0,
                flexDirection: "column",
                flexGrow: 1,
                gap: compact ? 8 : 10,
              }}
            >
              {column.items.map((item) => (
                <DigestItem key={item.id} compact={compact} item={item} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexGrow: 1 }} />
      )}

      <div
        style={{
          borderTop: `1px solid ${COLOR.border}`,
          color: COLOR.muted,
          display: "flex",
          fontSize: 16,
          justifyContent: "space-between",
          marginTop: 22,
          paddingTop: 14,
        }}
      >
        <span style={{ display: "flex" }}>Reply with one you want to try.</span>
        <span style={{ display: "flex" }}>withmurph.ai/changelog</span>
      </div>
    </div>
  );
}

function HeroItem({ item }: { item: PublishedChangelogItem }) {
  const accent = item.kind === "feature" ? COLOR.feature : COLOR.improvement;
  const kindLabel = item.kind === "feature" ? "FEATURE" : "IMPROVEMENT";
  return (
    <div
      style={{
        alignItems: "flex-start",
        backgroundColor: COLOR.panel,
        border: `1px solid ${COLOR.border}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 18,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        marginTop: 24,
        padding: "18px 22px",
      }}
    >
      <div
        style={{
          color: accent,
          display: "flex",
          fontSize: 13,
          letterSpacing: 1.4,
        }}
      >
        {kindLabel}
      </div>
      <div
        style={{
          display: "flex",
          fontFamily: "Fraunces",
          fontSize: 30,
          fontWeight: 600,
          lineHeight: 1.1,
        }}
      >
        {formatDigestTitle(item.title, 60)}
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
    return `${featureCount} new ${featureCount === 1 ? "feature" : "features"}.`;
  }
  if (improvementCount > 0 && featureCount === 0) {
    return `${improvementCount} ${improvementCount === 1 ? "improvement" : "improvements"}.`;
  }
  return `${items.length} updates worth a try.`;
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

function DigestItem({
  compact,
  item,
}: {
  compact: boolean;
  item: PublishedChangelogItem;
}) {
  const accent = item.kind === "feature" ? COLOR.feature : COLOR.improvement;
  const title = formatDigestTitle(item.title, compact ? 54 : 68);
  return (
    <div
      style={{
        alignItems: "flex-start",
        backgroundColor: COLOR.panel,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 16,
        display: "flex",
        gap: 14,
        minHeight: compact ? 78 : 96,
        overflow: "hidden",
        padding: compact ? "12px 16px" : "15px 20px",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          alignSelf: "stretch",
          backgroundColor: accent,
          borderRadius: 999,
          display: "flex",
          flexShrink: 0,
          width: 3,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            color: accent,
            display: "flex",
            fontSize: 13,
            letterSpacing: 1.3,
            textTransform: "uppercase",
          }}
        >
          {item.kind}
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontSize: compact ? 21 : 24,
            fontWeight: 600,
            lineHeight: compact ? 1.08 : 1.12,
            marginTop: 3,
          }}
        >
          {title}
        </div>
      </div>
    </div>
  );
}

function buildDigestColumns(items: readonly PublishedChangelogItem[]): Array<{
  items: readonly PublishedChangelogItem[];
  ordinalOffset: number;
}> {
  if (items.length <= 3) {
    return [{ items, ordinalOffset: 0 }];
  }

  const splitAt = Math.ceil(items.length / 2);
  return [
    { items: items.slice(0, splitAt), ordinalOffset: 0 },
    { items: items.slice(splitAt), ordinalOffset: splitAt },
  ];
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
