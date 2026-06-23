import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";

import {
  CHANGELOG_PREVIEW_CARD_ITEMS,
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
// Canonical Murph tokens (see DESIGN.md).
const COLOR = {
  background: "#f5f0e8",
  foreground: "#2d3436",
  muted: "#736a58",
  sage: "#7a8c6e",
};
const TITLE_MAX_CHARS = 60;
const SUMMARY_MAX_CHARS = 115;

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
  const visible = items.slice(0, CHANGELOG_PREVIEW_CARD_ITEMS);
  const [first] = visible;
  if (!first) {
    return null;
  }

  return (
    <div
      style={{
        backgroundColor: COLOR.background,
        backgroundImage:
          "radial-gradient(circle at top right, rgba(196,168,130,0.14), transparent 55%)",
        color: COLOR.foreground,
        display: "flex",
        flexDirection: "column",
        fontFamily: "DM Sans",
        height: "100%",
        // Extra inset so iMessage's bubble-corner crop never eats the content.
        padding: "66px 92px 80px",
        position: "relative",
        width: "100%",
      }}
    >
      {/* Right-edge sage disc — quiet dawn behind the page. */}
      <div
        style={{
          backgroundColor: "rgba(122,140,110,0.11)",
          borderRadius: 999,
          display: "flex",
          height: 560,
          position: "absolute",
          right: -280,
          top: 40,
          width: 560,
        }}
      />
      {/* Bottom flourish — a hand-drawn sage wave, feathered at the ends.
          Lifted into the iMessage-safe area so the bubble crop doesn't eat it. */}
      <img
        src={bottomFlourishDataUri()}
        alt=""
        width={1200}
        height={56}
        style={{
          bottom: 44,
          display: "flex",
          left: 0,
          position: "absolute",
        }}
      />
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
            fontSize: 14,
            letterSpacing: 1.6,
            textTransform: "uppercase",
          }}
        >
          {formatCardDate(first.publishedOn)}
        </div>
        <img
          src={logoDataUri}
          alt="Murph"
          width={132}
          height={29}
          style={{ display: "flex" }}
        />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          marginTop: 28,
        }}
      >
        {visible.map((item) => (
          <div
            key={item.id}
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: "Fraunces",
                fontSize: 36,
                fontWeight: 600,
                letterSpacing: -0.6,
                lineHeight: 1.04,
              }}
            >
              {formatDigestTitle(item.title, TITLE_MAX_CHARS)}
            </div>
            <div
              style={{
                color: COLOR.muted,
                display: "flex",
                fontSize: 18,
                lineHeight: 1.35,
              }}
            >
              {formatDigestTitle(item.summary, SUMMARY_MAX_CHARS)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function bottomFlourishDataUri(): string {
  // A single flowing sage line: gentle waves toward the middle, two trailing
  // curls on the right, fade-mask at both ends so it dissolves into the cream.
  const d =
    "M 0 32 Q 80 18 160 32 T 320 32 T 480 32 T 640 32 Q 720 18 800 32 " +
    "q 30 16 60 -2 q 28 -16 56 4 q 26 14 52 -6 q 22 -14 44 2 T 1200 32";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 56" fill="none">
    <defs>
      <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="rgba(122,140,110,0)"/>
        <stop offset="0.12" stop-color="rgba(122,140,110,0.72)"/>
        <stop offset="0.88" stop-color="rgba(122,140,110,0.72)"/>
        <stop offset="1" stop-color="rgba(122,140,110,0)"/>
      </linearGradient>
    </defs>
    <path d="${d}" stroke="url(#fade)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function formatDigestTitle(title: string, maxChars: number): string {
  // Fraunces 600 ships without the U+002B "+" glyph and the renderer falls back
  // to a hyphen — strip it for the OG card surface only.
  const safe = title.replace(/\+/g, "");
  if (safe.length <= maxChars) {
    return safe;
  }
  const sliced = safe.slice(0, maxChars - 1);
  const lastSpace = sliced.lastIndexOf(" ");
  const cut = lastSpace > maxChars * 0.6 ? sliced.slice(0, lastSpace) : sliced;
  return `${cut.replace(/[\s,;:—-]+$/u, "")}…`;
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
