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

const INK = "#1f2422";
const GREEN = "#5a6e32";
const MUTED = "#736a58";
const HAIRLINE = "rgba(196, 168, 130, 0.35)";

const STANDINGS = [
  { name: "Theo", steps: "41,204 steps", fill: 296, leader: true },
  { name: "You", steps: "38,977 steps", fill: 265, leader: false },
  { name: "Maya", steps: "36,412 steps", fill: 236, leader: false },
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
            "radial-gradient(circle at 90% 0%, #e7ddc8 0%, #f0e9db 40%, #f5f0e8 70%)",
        }}
      >
        {/* Logo */}
        <img
          src={logoDataUri}
          alt=""
          width={152}
          height={34}
          style={{ position: "absolute", top: 64, left: 72, display: "flex" }}
        />

        {/* Headline + supporting line */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 72,
            width: 600,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontFamily: "Fraunces",
              fontWeight: 400,
              fontSize: 42,
              lineHeight: 1.3,
              letterSpacing: "-0.02em",
            }}
          >
            <div style={{ color: INK }}>{MURPH_TAGLINE_LINE_1}</div>
            <div style={{ color: GREEN }}>{MURPH_TAGLINE_LINE_2}</div>
          </div>
          <div
            style={{
              marginTop: 26,
              maxWidth: 400,
              fontFamily: "DM Sans",
              fontSize: 19,
              lineHeight: 1.5,
              color: MUTED,
            }}
          >
            Murph reads your data and keeps score in your group chat.
          </div>
        </div>

        {/* Group-chat panel, bleeding off the bottom edge */}
        <div
          style={{
            position: "absolute",
            top: 84,
            right: 64,
            width: 424,
            height: 620,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            padding: "24px 24px 0",
            backgroundColor: "rgba(255, 255, 255, 0.45)",
            borderRadius: 22,
            border: `1px solid ${HAIRLINE}`,
            boxShadow: "0 32px 64px -28px rgba(45, 52, 54, 0.25)",
          }}
        >
          <div
            style={{
              fontFamily: "DM Sans",
              fontSize: 13,
              letterSpacing: "0.14em",
              color: MUTED,
            }}
          >
            WALK CHALLENGE · 4 PEOPLE
          </div>

          {/* Outgoing kickoff bubble */}
          <div
            style={{
              alignSelf: "flex-end",
              maxWidth: 300,
              padding: "11px 15px",
              backgroundColor: GREEN,
              borderRadius: 16,
              color: "rgba(255, 255, 255, 0.96)",
              fontFamily: "DM Sans",
              fontSize: 17,
              lineHeight: 1.4,
            }}
          >
            walk challenge starts tomorrow. loser buys steak dinner
          </div>

          {/* Murph reply */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                paddingLeft: 4,
                fontFamily: "DM Sans",
                fontSize: 12,
                letterSpacing: "0.12em",
                color: MUTED,
              }}
            >
              MURPH
            </div>
            <div
              style={{
                alignSelf: "flex-start",
                maxWidth: 320,
                padding: "11px 15px",
                backgroundColor: "rgba(255, 255, 255, 0.85)",
                borderRadius: 16,
                border: `1px solid ${HAIRLINE}`,
                color: INK,
                fontFamily: "DM Sans",
                fontSize: 17,
                lineHeight: 1.4,
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
            left: 648,
            top: 396,
            width: 376,
            display: "flex",
            flexDirection: "column",
            padding: "20px 24px 22px",
            backgroundColor: "rgba(255, 255, 255, 0.94)",
            borderRadius: 18,
            border: `1px solid ${HAIRLINE}`,
            boxShadow: "0 28px 56px -22px rgba(45, 52, 54, 0.3)",
          }}
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
                fontFamily: "DM Sans",
                fontSize: 12,
                letterSpacing: "0.16em",
                color: MUTED,
              }}
            >
              STANDINGS · DAY 5
            </div>
            <div
              style={{
                fontFamily: "DM Sans",
                fontSize: 12,
                letterSpacing: "0.1em",
                color: MUTED,
              }}
            >
              2 DAYS LEFT
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 13,
              marginTop: 18,
            }}
          >
            {STANDINGS.map((row) => (
              <div
                key={row.name}
                style={{ display: "flex", flexDirection: "column", gap: 7 }}
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
                      fontSize: 16,
                      color: INK,
                    }}
                  >
                    {row.name}
                  </div>
                  <div
                    style={{
                      fontFamily: "DM Sans",
                      fontSize: 13,
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
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: "rgba(196, 168, 130, 0.25)",
                  }}
                >
                  <div
                    style={{
                      width: row.fill,
                      height: 5,
                      borderRadius: 3,
                      backgroundColor: row.leader
                        ? GREEN
                        : "rgba(196, 168, 130, 0.75)",
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
