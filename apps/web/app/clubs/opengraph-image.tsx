import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";

import {
  dmSans400FontPath,
  fraunces400FontPath,
  fraunces600FontPath,
} from "../font-files";

export const alt = "You run the club. Murph runs the challenge.";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

export default async function ClubOpenGraphImage() {
  const [fraunces400Data, fraunces600Data, dmSans400Data] = await Promise.all([
    readFile(fraunces400FontPath).then(toArrayBuffer),
    readFile(fraunces600FontPath).then(toArrayBuffer),
    readFile(dmSans400FontPath).then(toArrayBuffer),
  ]);
  const fonts: { data: ArrayBuffer; name: string; weight: 400 | 600 }[] = [
    { data: fraunces400Data, name: "Fraunces", weight: 400 },
    { data: fraunces600Data, name: "Fraunces", weight: 600 },
    { data: dmSans400Data, name: "DM Sans", weight: 400 },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          backgroundColor: "#2a2520",
          display: "flex",
          height: "100%",
          overflow: "hidden",
          padding: 68,
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: 670,
          }}
        >
          <div style={{ alignItems: "center", display: "flex", gap: 16 }}>
            <div
              style={{
                backgroundColor: "rgba(196,168,130,0.6)",
                height: 1,
                width: 54,
              }}
            />
            <div
              style={{
                color: "#c4a882",
                fontFamily: "DM Sans",
                fontSize: 18,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              Murph for clubs
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                color: "#f5f0e8",
                fontFamily: "Fraunces",
                fontSize: 90,
                fontWeight: 600,
                letterSpacing: "-0.045em",
                lineHeight: 0.98,
              }}
            >
              You run the club.
            </div>
            <div
              style={{
                color: "#c4a882",
                fontFamily: "Fraunces",
                fontSize: 90,
                fontStyle: "italic",
                fontWeight: 400,
                letterSpacing: "-0.045em",
                lineHeight: 0.98,
                marginTop: 10,
              }}
            >
              Murph runs the challenge.
            </div>
          </div>

          <div
            style={{
              alignItems: "center",
              color: "rgba(245,240,232,0.55)",
              display: "flex",
              fontFamily: "DM Sans",
              fontSize: 18,
              justifyContent: "space-between",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            <span>Run clubs · gyms · communities</span>
          </div>
        </div>

        <div
          style={{
            alignItems: "center",
            display: "flex",
            flex: 1,
            justifyContent: "flex-end",
          }}
        >
          <div
            style={{
              backgroundColor: "#fffcf6",
              borderRadius: 34,
              border: "1px solid rgba(196,168,130,0.35)",
              display: "flex",
              flexDirection: "column",
              padding: 34,
              transform: "rotate(1.5deg)",
              width: 350,
            }}
          >
            <div
              style={{
                color: "#5a6e32",
                display: "flex",
                fontFamily: "DM Sans",
                fontSize: 14,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
              }}
            >
              ATL moves together
            </div>
            <div
              style={{
                color: "#2d3436",
                display: "flex",
                fontFamily: "Fraunces",
                fontSize: 70,
                fontWeight: 600,
                letterSpacing: "-0.055em",
                lineHeight: 1,
                marginTop: 28,
              }}
            >
              6,842
            </div>
            <div
              style={{
                color: "#736a58",
                display: "flex",
                fontFamily: "DM Sans",
                fontSize: 18,
                marginTop: 8,
              }}
            >
              of 10,000 miles
            </div>
            <div
              style={{
                backgroundColor: "rgba(212,196,168,0.4)",
                borderRadius: 999,
                display: "flex",
                height: 14,
                marginTop: 30,
                overflow: "hidden",
                width: "100%",
              }}
            >
              <div
                style={{
                  backgroundColor: "#5a6e32",
                  borderRadius: 999,
                  display: "flex",
                  height: "100%",
                  width: "68.42%",
                }}
              />
            </div>
            <div
              style={{
                color: "#736a58",
                display: "flex",
                fontFamily: "DM Sans",
                fontSize: 15,
                justifyContent: "space-between",
                marginTop: 18,
              }}
            >
              <span>78 people</span>
              <span>12 days left</span>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts,
    },
  );
}

function toArrayBuffer(buffer: Buffer) {
  return Uint8Array.from(buffer).buffer;
}
