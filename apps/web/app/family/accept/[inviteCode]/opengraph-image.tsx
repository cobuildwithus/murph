import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { dmSans400FontPath, fraunces600FontPath } from "../../../font-files";

export const alt = "You’re invited to Murph Family.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const EYEBROW = "MURPH FAMILY";
const HEADLINE = "You’re invited.";
const SUBTEXT = "Your own private health assistant, covered by someone you know.";

export default async function FamilyInviteOGImage() {
  const [heroData, fraunces600Data, dmSans400Data] = await Promise.all([
    readFile(join(process.cwd(), "public", "hero.jpg")).then(
      (buf) => `data:image/jpeg;base64,${buf.toString("base64")}`
    ),
    readFile(fraunces600FontPath).then(toArrayBuffer),
    readFile(dmSans400FontPath).then(toArrayBuffer),
  ]);

  const fonts: { name: string; data: ArrayBuffer; weight: 400 | 600 }[] = [
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
          position: "relative",
          backgroundColor: "#D9C39B",
        }}
      >
        {/* Hero background */}
        <img
          src={heroData}
          alt=""
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />

        {/* Dark gradient overlay */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background:
              "linear-gradient(180deg, rgba(26,31,22,0.15) 0%, rgba(26,31,22,0.58) 100%)",
          }}
        />

        {/* Bottom content bar */}
        <div
          style={{
            position: "absolute",
            left: 48,
            right: 48,
            bottom: 44,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          {/* Text block */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                fontFamily: "DM Sans",
                fontWeight: 400,
                fontSize: 20,
                lineHeight: 1,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "#DCC199",
              }}
            >
              {EYEBROW}
            </div>
            <div
              style={{
                fontFamily: "Fraunces",
                fontWeight: 600,
                fontSize: 82,
                lineHeight: 0.98,
                letterSpacing: "-0.04em",
                color: "#FAF8F4",
              }}
            >
              {HEADLINE}
            </div>
            <div
              style={{
                fontFamily: "DM Sans",
                fontWeight: 400,
                fontSize: 26,
                lineHeight: 1.4,
                color: "rgba(250,248,244,0.85)",
                maxWidth: 640,
              }}
            >
              {SUBTEXT}
            </div>
          </div>

          {/* Logo lockup */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <DotGrid />
            <div
              style={{
                fontFamily: "Fraunces",
                fontWeight: 600,
                fontSize: 48,
                lineHeight: 1,
                letterSpacing: "-0.03em",
                color: "#FAF8F4",
              }}
            >
              murph
            </div>
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
