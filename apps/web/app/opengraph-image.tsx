import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import {
  MURPH_DEFAULT_OPEN_GRAPH_IMAGE,
  MURPH_TAGLINE_LINE_1,
  MURPH_TAGLINE_LINE_2,
} from "../src/lib/site-metadata";
import {
  dmSans400FontPath,
  fraunces400FontPath,
  fraunces600FontPath,
} from "./font-files";

export const alt = MURPH_DEFAULT_OPEN_GRAPH_IMAGE.alt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Mirrors the homepage hero: floating health-topic labels around the edges,
// clear of the logo lockup (top-left) and the centered headline block.
const FLOATERS: ReadonlyArray<{
  text: string;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}> = [
  { text: "Dentist", top: 56, left: 350 },
  { text: "Competition", top: 100, left: 630 },
  { text: "LDL cholesterol", top: 60, right: 64 },
  { text: "Mammogram", top: 168, right: 120 },
  { text: "Omega-3", top: 150, left: 96 },
  { text: "Doctor recap", top: 330, right: 56 },
  { text: "Bone density", top: 452, right: 96 },
  { text: "Daily walk", bottom: 64, left: 96 },
  { text: "Sleep quality", bottom: 92, left: 420 },
  { text: "Blood pressure", bottom: 60, left: 730 },
];

export default async function OGImage() {
  const [fraunces400Data, fraunces600Data, dmSans400Data] = await Promise.all([
    readFile(fraunces400FontPath).then(toArrayBuffer),
    readFile(fraunces600FontPath).then(toArrayBuffer),
    readFile(dmSans400FontPath).then(toArrayBuffer),
  ]);

  const fonts: { name: string; data: ArrayBuffer; weight: 400 | 600 }[] = [];
  fonts.push({ name: "Fraunces", data: fraunces400Data, weight: 400 });
  fonts.push({ name: "Fraunces", data: fraunces600Data, weight: 600 });
  fonts.push({ name: "DM Sans", data: dmSans400Data, weight: 400 });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: "#f5f0e8",
        }}
      >
        {/* Floating health-topic labels. Satori crashes on style keys set to
            undefined, so spread only the offsets each floater defines. */}
        {FLOATERS.map(({ text, ...offsets }) => (
          <div
            key={text}
            style={{
              position: "absolute",
              ...offsets,
              fontFamily: "DM Sans",
              fontWeight: 400,
              fontSize: 17,
              letterSpacing: "0.18em",
              color: "rgba(196, 168, 130, 0.75)",
              whiteSpace: "nowrap",
            }}
          >
            {text.toUpperCase()}
          </div>
        ))}

        {/* Logo lockup */}
        <div
          style={{
            position: "absolute",
            top: 48,
            left: 64,
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <DotGrid />
          <div
            style={{
              fontFamily: "Fraunces",
              fontWeight: 600,
              fontSize: 40,
              lineHeight: 1,
              letterSpacing: "-0.03em",
              color: "#1a1a1a",
            }}
          >
            murph
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 80,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            fontFamily: "Fraunces",
            fontWeight: 600,
            fontSize: 68,
            lineHeight: 1.1,
            letterSpacing: "-0.04em",
          }}
        >
          <div style={{ color: "#1a1a1a" }}>{MURPH_TAGLINE_LINE_1}</div>
          <div style={{ color: "#5a6e32", marginTop: 10 }}>
            {MURPH_TAGLINE_LINE_2}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts,
    }
  );
}

function toArrayBuffer(buffer: Buffer) {
  return Uint8Array.from(buffer).buffer;
}

function DotGrid() {
  const rows = [
    { sizes: [4, 4, 5, 5, 4, 4], y: 0 },
    { sizes: [4, 4, 7, 7, 4, 4], y: 9 },
    { sizes: [4, 5, 8, 9, 5, 4], y: 20 },
    { sizes: [4, 4, 5, 5, 4, 4], y: 33 },
  ];

  const dotColor = (size: number) => {
    if (size <= 4) return { bg: "#5C6B4F", opacity: 0.35 };
    if (size <= 5) return { bg: "#C4956A", opacity: 0.55 };
    if (size <= 7) return { bg: "#A07A4E", opacity: 1 };
    return { bg: "#C4956A", opacity: 1 };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {rows.map((row, ri) => (
        <div key={ri} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {row.sizes.map((s, ci) => {
            const c = dotColor(s);
            return (
              <div
                key={ci}
                style={{
                  width: s,
                  height: s,
                  borderRadius: "50%",
                  backgroundColor: c.bg,
                  opacity: c.opacity,
                  flexShrink: 0,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
