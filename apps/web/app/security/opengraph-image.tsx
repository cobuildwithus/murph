import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";

import {
  dmSans400FontPath,
  fraunces400FontPath,
  fraunces600FontPath,
} from "../font-files";

export const alt = "Murph Security. How Murph protects health data.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const HEADLINE_STYLE = {
  fontFamily: "Fraunces",
  fontWeight: 600 as const,
  fontSize: 116,
  lineHeight: 0.98,
  letterSpacing: "-0.035em",
};

export default async function SecurityOGImage() {
  const [fraunces400Data, fraunces600Data, dmSans400Data] = await Promise.all([
    readFile(fraunces400FontPath).then(toArrayBuffer),
    readFile(fraunces600FontPath).then(toArrayBuffer),
    readFile(dmSans400FontPath).then(toArrayBuffer),
  ]);

  const fonts: { name: string; data: ArrayBuffer; weight: 400 | 600 }[] = [
    { name: "Fraunces", data: fraunces400Data, weight: 400 },
    { name: "Fraunces", data: fraunces600Data, weight: 600 },
    { name: "DM Sans", data: dmSans400Data, weight: 400 },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#2a2520",
          padding: 72,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 1,
              backgroundColor: "rgba(196,168,130,0.6)",
            }}
          />
          <div
            style={{
              fontFamily: "DM Sans",
              fontSize: 18,
              letterSpacing: "0.2em",
              color: "#c4a882",
              textTransform: "uppercase",
            }}
          >
            Security
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ ...HEADLINE_STYLE, color: "#f5f0e8" }}>
            Protecting
          </div>
          <div style={{ display: "flex" }}>
            <span style={{ ...HEADLINE_STYLE, color: "#c4a882" }}>health</span>
            <span style={{ ...HEADLINE_STYLE, color: "#f5f0e8" }}>
              &nbsp;data.
            </span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <DotGrid />
            <div
              style={{
                fontFamily: "Fraunces",
                fontWeight: 600,
                fontSize: 48,
                lineHeight: 1,
                letterSpacing: "-0.03em",
                color: "#f5f0e8",
              }}
            >
              murph
            </div>
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "DM Sans",
              fontSize: 18,
              letterSpacing: "0.16em",
              color: "rgba(245,240,232,0.5)",
              textTransform: "uppercase",
            }}
          >
            Encrypted &middot; Never for sale
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
        <div
          key={ri}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
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
