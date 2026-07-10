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
  logoSvgPath,
} from "./font-files";

export const alt = MURPH_DEFAULT_OPEN_GRAPH_IMAGE.alt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#2d3436";
const GREEN = "#5a6e32";
const MUTED = "#736a58";
const RING = "rgba(196, 168, 130, 0.25)";

// Mirrors the homepage hero: floating health-topic labels on the open side of
// the canvas, clear of the headline column and the chat panel.
const FLOATERS: ReadonlyArray<{
  text: string;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}> = [
  { text: "Dentist", top: 64, left: 330 },
  { text: "Omega-3", top: 150, left: 84 },
  { text: "Daily walk", bottom: 64, left: 84 },
  { text: "Sleep quality", bottom: 96, left: 350 },
];

const STANDINGS = [
  { name: "Theo", steps: "41,204 steps", fill: 292 },
  { name: "You", steps: "38,977 steps", fill: 262 },
  { name: "Maya", steps: "36,412 steps", fill: 233 },
];

export default async function OGImage() {
  const [fraunces400Data, fraunces600Data, dmSans400Data, logoBuffer] =
    await Promise.all([
      readFile(fraunces400FontPath).then(toArrayBuffer),
      readFile(fraunces600FontPath).then(toArrayBuffer),
      readFile(dmSans400FontPath).then(toArrayBuffer),
      readFile(logoSvgPath),
    ]);
  const logoDataUri = `data:image/svg+xml;base64,${logoBuffer.toString("base64")}`;

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
          overflow: "hidden",
          background:
            "radial-gradient(circle at 85% 10%, #ece3d1 0%, #f5f0e8 55%)",
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
              fontSize: 16,
              letterSpacing: "0.18em",
              color: "rgba(196, 168, 130, 0.8)",
              whiteSpace: "nowrap",
            }}
          >
            {text.toUpperCase()}
          </div>
        ))}

        {/* Logo */}
        <img
          src={logoDataUri}
          alt=""
          width={170}
          height={38}
          style={{ position: "absolute", top: 56, left: 64, display: "flex" }}
        />

        {/* Headline */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 64,
            width: 500,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            fontFamily: "Fraunces",
            fontWeight: 600,
            fontSize: 58,
            lineHeight: 1.12,
            letterSpacing: "-0.04em",
          }}
        >
          <div style={{ color: "#1a1a1a" }}>{MURPH_TAGLINE_LINE_1}</div>
          <div style={{ color: GREEN, marginTop: 8 }}>
            {MURPH_TAGLINE_LINE_2}
          </div>
        </div>

        {/* Group-chat panel, bleeding off the bottom edge */}
        <div
          style={{
            position: "absolute",
            top: 88,
            right: 56,
            width: 440,
            height: 600,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            padding: "26px 26px 0",
            backgroundColor: "#faf6ee",
            borderRadius: 28,
            border: `1px solid ${RING}`,
            boxShadow: "0 30px 60px -20px rgba(45, 52, 54, 0.28)",
          }}
        >
          {/* Header: avatars + group label */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex" }}>
              {[
                { initial: "T", bg: "#c9a06b" },
                { initial: "M", bg: "#8ba173" },
                { initial: "S", bg: "#b8845f" },
              ].map((avatar, i) => (
                <div
                  key={avatar.initial}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    backgroundColor: avatar.bg,
                    border: "2px solid #faf6ee",
                    marginLeft: i === 0 ? 0 : -9,
                    color: "#fff",
                    fontFamily: "DM Sans",
                    fontSize: 14,
                  }}
                >
                  {avatar.initial}
                </div>
              ))}
            </div>
            <div
              style={{
                fontFamily: "DM Sans",
                fontSize: 15,
                color: MUTED,
              }}
            >
              Walk challenge · 4 people
            </div>
          </div>

          {/* Outgoing kickoff bubble */}
          <div
            style={{
              alignSelf: "flex-end",
              maxWidth: 310,
              padding: "12px 16px",
              backgroundColor: GREEN,
              borderRadius: 20,
              color: "#fff",
              fontFamily: "DM Sans",
              fontSize: 18,
              lineHeight: 1.35,
            }}
          >
            walk challenge starts tomorrow. loser buys steak dinner
          </div>

          {/* Murph reply */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div
              style={{
                paddingLeft: 6,
                fontFamily: "DM Sans",
                fontSize: 13,
                letterSpacing: "0.08em",
                color: MUTED,
              }}
            >
              MURPH
            </div>
            <div
              style={{
                alignSelf: "flex-start",
                maxWidth: 330,
                padding: "12px 16px",
                backgroundColor: "#fff",
                borderRadius: 20,
                border: `1px solid ${RING}`,
                color: INK,
                fontFamily: "DM Sans",
                fontSize: 18,
                lineHeight: 1.35,
              }}
            >
              Baselines are set from everyone&rsquo;s wearables. I keep score,
              standings drop daily.
            </div>
          </div>

        </div>

        {/* Standings card overlapping the chat panel */}
        <div
          style={{
            position: "absolute",
            left: 640,
            top: 392,
            width: 372,
            display: "flex",
            flexDirection: "column",
            padding: "18px 22px 20px",
            backgroundColor: "#fff",
            borderRadius: 22,
            border: `1px solid ${RING}`,
            boxShadow: "0 24px 48px -16px rgba(45, 52, 54, 0.3)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div
              style={{
                fontFamily: "DM Sans",
                fontSize: 13,
                letterSpacing: "0.14em",
                color: GREEN,
              }}
            >
              WALK CHALLENGE · DAY 5
            </div>
            <div
              style={{
                padding: "3px 10px",
                borderRadius: 999,
                backgroundColor: "rgba(90, 110, 50, 0.14)",
                fontFamily: "DM Sans",
                fontSize: 12,
                letterSpacing: "0.1em",
                color: "#3d5028",
              }}
            >
              LIVE
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              marginTop: 16,
            }}
          >
            {STANDINGS.map((row, i) => (
              <div
                key={row.name}
                style={{ display: "flex", flexDirection: "column", gap: 6 }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "Fraunces",
                      fontWeight: 600,
                      fontSize: 17,
                      color: INK,
                    }}
                  >
                    {row.name}
                  </div>
                  <div
                    style={{
                      fontFamily: "DM Sans",
                      fontSize: 14,
                      color: MUTED,
                    }}
                  >
                    {row.steps}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    width: 328,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: "#ece4d4",
                  }}
                >
                  <div
                    style={{
                      width: row.fill,
                      height: 7,
                      borderRadius: 4,
                      backgroundColor: i === 0 ? GREEN : "#c4a882",
                    }}
                  />
                </div>
              </div>
            ))}
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
