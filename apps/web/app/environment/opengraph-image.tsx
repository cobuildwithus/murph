import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";

import {
  dmSans400FontPath,
  fraunces400FontPath,
  fraunces600FontPath,
  logoSvgPath,
} from "../font-files";

export const alt = "Map your environment with Murph";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CATEGORY_LABELS = [
  "Sleep",
  "Air & water",
  "Light",
  "Recovery",
  "Workspace",
] as const;

export default async function OGImage() {
  const [fraunces400Data, fraunces600Data, dmSans400Data, logoData] =
    await Promise.all([
      readFile(fraunces400FontPath).then(toArrayBuffer),
      readFile(fraunces600FontPath).then(toArrayBuffer),
      readFile(dmSans400FontPath).then(toArrayBuffer),
      readFile(logoSvgPath),
    ]);
  const logoDataUri = `data:image/svg+xml;base64,${logoData.toString(
    "base64",
  )}`;

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
            "radial-gradient(circle at 90% 0%, #e7ddc8 0%, #f0e9db 42%, #f5f0e8 76%)",
          color: "#1f2422",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            opacity: 0.24,
            backgroundImage:
              "radial-gradient(circle, #a07a4e 2px, transparent 2px)",
            backgroundSize: "28px 28px",
          }}
        />
        <img
          src={logoDataUri}
          alt=""
          width={152}
          height={34}
          style={{ position: "absolute", top: 56, left: 72, display: "flex" }}
        />

        <div
          style={{
            position: "absolute",
            top: 145,
            left: 72,
            width: 710,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontFamily: "Fraunces",
              fontWeight: 600,
              fontSize: 64,
              lineHeight: 1.04,
              letterSpacing: "-0.035em",
            }}
          >
            A healthier home starts with knowing it.
          </div>
          <div
            style={{
              marginTop: 22,
              width: 650,
              fontFamily: "DM Sans",
              fontSize: 22,
              lineHeight: 1.45,
              color: "#736a58",
            }}
          >
            Murph maps the conditions where you sleep, breathe and work, then
            finds practical improvements that fit your life.
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: 72,
            top: 118,
            width: 290,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {CATEGORY_LABELS.map((label, index) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                border: "1px solid rgba(90,110,50,0.2)",
                borderRadius: 18,
                background: "rgba(255,252,246,0.84)",
                padding: "14px 18px",
                fontFamily: "DM Sans",
                fontSize: 19,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 34,
                  height: 34,
                  borderRadius: 11,
                  background: "#e4e6d5",
                  color: "#5a6e32",
                  fontFamily: "Fraunces",
                  fontWeight: 600,
                }}
              >
                {index + 1}
              </div>
              {label}
            </div>
          ))}
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 44,
            left: 72,
            display: "flex",
            fontFamily: "DM Sans",
            fontSize: 18,
            color: "#5a6e32",
          }}
        >
          withmurph.ai
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Fraunces", data: fraunces400Data, weight: 400 },
        { name: "Fraunces", data: fraunces600Data, weight: 600 },
        { name: "DM Sans", data: dmSans400Data, weight: 400 },
      ],
    },
  );
}

function toArrayBuffer(buffer: Buffer) {
  return Uint8Array.from(buffer).buffer;
}
