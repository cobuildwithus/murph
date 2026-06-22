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
  const columns = buildDigestColumns(items);
  const compact = items.length >= COMPACT_ITEM_COUNT;
  const publishedOn = items[0]?.publishedOn ?? "";

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
              textTransform: "uppercase",
            }}
          >
            New in Murph · {formatCardDate(publishedOn)}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Fraunces",
              fontSize: 48,
              fontWeight: 600,
              lineHeight: 1.05,
              marginTop: 10,
            }}
          >
            Picked for you.
          </div>
        </div>
        <MurphWordmark />
      </div>

      <div style={{ display: "flex", flexGrow: 1, gap: 20, marginTop: 28 }}>
        {columns.map((column, columnIndex) => (
          <div
            key={columnIndex}
            style={{
              display: "flex",
              flexBasis: 0,
              flexDirection: "column",
              flexGrow: 1,
              gap: compact ? 10 : 12,
            }}
          >
            {column.items.map((item, index) => (
              <DigestItem
                key={item.id}
                compact={compact}
                item={item}
                ordinal={column.ordinalOffset + index + 1}
              />
            ))}
          </div>
        ))}
      </div>

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
  ordinal,
}: {
  compact: boolean;
  item: PublishedChangelogItem;
  ordinal: number;
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
        gap: compact ? 13 : 16,
        minHeight: compact ? 78 : 96,
        overflow: "hidden",
        padding: compact ? "12px 15px" : "15px 18px",
      }}
    >
      <div
        style={{
          alignItems: "center",
          border: `1px solid ${accent}`,
          borderRadius: 999,
          color: accent,
          display: "flex",
          flexShrink: 0,
          fontSize: 14,
          height: 28,
          justifyContent: "center",
          width: 28,
        }}
      >
        {ordinal}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            color: accent,
            display: "flex",
            fontSize: 13,
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
  if (title.length <= maxChars) {
    return title;
  }
  return `${title.slice(0, maxChars - 3).trimEnd()}...`;
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
