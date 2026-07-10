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

// Palette lifted from the homepage hero phone mock.
const INK = "#2d3436";
const GREEN = "#5a6e32";
const MUTED = "#736a58";
const CREAM = "#f5f0e8";
const MEMBER_BUBBLE = "#ece7dc";

const STANDINGS = [
  { name: "Theo", steps: "41,204", fill: 264, leader: true },
  { name: "You", steps: "38,977", fill: 236, leader: false },
  { name: "Maya", steps: "36,412", fill: 210, leader: false },
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
        {/* Dot-grid texture echoing the logo motif, quieted behind the text.
            Drawn as elements: satori does not tile background gradients. */}
        <div
          style={{
            position: "absolute",
            top: -8,
            left: -8,
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          {Array.from({ length: 24 }, (_, rowIndex) => (
            <div key={rowIndex} style={{ display: "flex", gap: 24 }}>
              {Array.from({ length: 44 }, (_, colIndex) => (
                <div
                  key={colIndex}
                  style={{
                    width: 3.5,
                    height: 3.5,
                    borderRadius: "50%",
                    backgroundColor: "rgba(160, 122, 78, 0.32)",
                  }}
                />
              ))}
            </div>
          ))}
        </div>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background:
              "radial-gradient(circle at 30% 42%, rgba(245, 240, 232, 0.9) 0%, rgba(245, 240, 232, 0.55) 38%, rgba(245, 240, 232, 0) 68%)",
          }}
        />
        {/* Warm corner tone, bottom-left */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background:
              "radial-gradient(circle at 5% 100%, rgba(224, 210, 183, 0.6) 0%, rgba(224, 210, 183, 0) 45%)",
          }}
        />

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
            width: 660,
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
              fontSize: 51,
              lineHeight: 1.25,
              letterSpacing: "-0.03em",
            }}
          >
            <div style={{ color: "#1f2422" }}>{MURPH_TAGLINE_LINE_1}</div>
            <div style={{ color: GREEN }}>{MURPH_TAGLINE_LINE_2}</div>
          </div>
          <div
            style={{
              marginTop: 28,
              maxWidth: 460,
              fontFamily: "DM Sans",
              fontSize: 21,
              lineHeight: 1.5,
              color: MUTED,
            }}
          >
            Murph figures out what actually works and keeps score in your
            group chat.
          </div>
        </div>

        {/* Goal pills anchoring the bottom-left */}
        <div
          style={{
            position: "absolute",
            bottom: 64,
            left: 72,
            display: "flex",
            gap: 12,
          }}
        >
          {["Get stronger", "Fix your sleep", "Lower cholesterol"].map(
            (goal) => (
              <div
                key={goal}
                style={{
                  padding: "9px 18px",
                  borderRadius: 999,
                  border: "1px solid rgba(160, 122, 78, 0.35)",
                  backgroundColor: "rgba(255, 255, 255, 0.45)",
                  fontFamily: "DM Sans",
                  fontSize: 13,
                  letterSpacing: "0.14em",
                  color: MUTED,
                }}
              >
                {goal.toUpperCase()}
              </div>
            ),
          )}
        </div>

        {/* Phone mock, bleeding off the bottom edge (mirrors the homepage
            hero's PhoneShell) */}
        <div
          style={{
            position: "absolute",
            top: 64,
            right: 80,
            width: 348,
            height: 640,
            display: "flex",
            padding: 4,
            backgroundColor: "#0a0a0a",
            borderRadius: 44,
            boxShadow: "0 30px 80px -20px rgba(0, 0, 0, 0.5)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              height: "100%",
              overflow: "hidden",
              borderRadius: 40,
              backgroundColor: CREAM,
            }}
          >
            {/* Status bar */}
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 24px 6px",
              }}
            >
              <div
                style={{ fontFamily: "DM Sans", fontSize: 14, color: INK }}
              >
                9:41
              </div>
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: 8,
                  width: 92,
                  height: 24,
                  marginLeft: -46,
                  borderRadius: 999,
                  backgroundColor: "#0a0a0a",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 1.5 }}>
                  {[4, 6, 8, 10].map((barHeight) => (
                    <div
                      key={barHeight}
                      style={{
                        width: 3,
                        height: barHeight,
                        borderRadius: 1,
                        backgroundColor: INK,
                      }}
                    />
                  ))}
                </div>
                <div
                  style={{
                    display: "flex",
                    width: 24,
                    height: 12,
                    padding: 2,
                    borderRadius: 4,
                    border: `1px solid ${INK}`,
                  }}
                >
                  <div
                    style={{
                      width: 13,
                      height: 6,
                      borderRadius: 1.5,
                      backgroundColor: INK,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Chat header: avatar cluster + group label */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                paddingBottom: 10,
                borderBottom: "1px solid rgba(196, 168, 130, 0.3)",
              }}
            >
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
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      backgroundColor: avatar.bg,
                      border: `2px solid ${CREAM}`,
                      marginLeft: i === 0 ? 0 : -10,
                      color: "#fff",
                      fontFamily: "DM Sans",
                      fontSize: 15,
                    }}
                  >
                    {avatar.initial}
                  </div>
                ))}
              </div>
              <div
                style={{ fontFamily: "DM Sans", fontSize: 12, color: MUTED }}
              >
                4 People ›
              </div>
            </div>

            {/* Messages */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "14px 14px 0",
              }}
            >
              {/* Outgoing kickoff */}
              <div
                style={{
                  alignSelf: "flex-end",
                  maxWidth: 250,
                  padding: "8px 14px",
                  backgroundColor: GREEN,
                  borderRadius: 17,
                  color: "#fff",
                  fontFamily: "DM Sans",
                  fontSize: 15,
                  lineHeight: 1.4,
                }}
              >
                walk challenge starts tomorrow. loser buys steak dinner
              </div>

              {/* Murph reply */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div
                  style={{
                    paddingLeft: 12,
                    fontFamily: "DM Sans",
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    color: MUTED,
                  }}
                >
                  Murph
                </div>
                <div
                  style={{
                    alignSelf: "flex-start",
                    maxWidth: 262,
                    padding: "8px 14px",
                    backgroundColor: "#fff",
                    borderRadius: 17,
                    color: INK,
                    fontFamily: "DM Sans",
                    fontSize: 15,
                    lineHeight: 1.4,
                  }}
                >
                  Baselines are set from everyone&rsquo;s wearables. I keep
                  score, standings drop daily.
                </div>
              </div>

              {/* Theo banter */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div
                  style={{
                    paddingLeft: 12,
                    fontFamily: "DM Sans",
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    color: MUTED,
                  }}
                >
                  Theo
                </div>
                <div
                  style={{
                    alignSelf: "flex-start",
                    padding: "8px 14px",
                    backgroundColor: MEMBER_BUBBLE,
                    borderRadius: 17,
                    color: INK,
                    fontFamily: "DM Sans",
                    fontSize: 15,
                    lineHeight: 1.4,
                  }}
                >
                  day 5 and i&rsquo;m still winning btw
                </div>
              </div>

              {/* Murph standings card (in-chat, like the hero's weekly card) */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div
                  style={{
                    paddingLeft: 12,
                    fontFamily: "DM Sans",
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    color: MUTED,
                  }}
                >
                  Murph
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    padding: "12px 14px 14px",
                    backgroundColor: "#fff",
                    borderRadius: 17,
                    border: "1px solid rgba(196, 168, 130, 0.25)",
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
                        fontSize: 10,
                        letterSpacing: "0.14em",
                        color: GREEN,
                      }}
                    >
                      WALK CHALLENGE · DAY 5
                    </div>
                    <div
                      style={{
                        fontFamily: "DM Sans",
                        fontSize: 10,
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
                      gap: 10,
                      marginTop: 12,
                    }}
                  >
                    {STANDINGS.map((row) => (
                      <div
                        key={row.name}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 5,
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
                              fontFamily: "Fraunces",
                              fontWeight: 600,
                              fontSize: 13,
                              color: INK,
                            }}
                          >
                            {row.name}
                          </div>
                          <div
                            style={{
                              fontFamily: "DM Sans",
                              fontSize: 11,
                              color: MUTED,
                            }}
                          >
                            {`${row.steps} steps`}
                          </div>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            width: 264,
                            height: 4,
                            borderRadius: 2,
                            backgroundColor: "rgba(196, 168, 130, 0.25)",
                          }}
                        >
                          <div
                            style={{
                              width: row.fill,
                              height: 4,
                              borderRadius: 2,
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
