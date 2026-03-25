import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 56,
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #334155 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            width: "fit-content",
            borderRadius: 999,
            background: "rgba(255,255,255,0.12)",
            padding: "14px 22px",
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          Healthy Bob hosted invite
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 88, fontWeight: 800, lineHeight: 1, letterSpacing: -4 }}>
            Create your passkey.
          </div>
          <div style={{ fontSize: 44, lineHeight: 1.35, color: "rgba(226,232,240,1)" }}>
            Finish Apple Pay. Start hosted Healthy Bob.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, color: "rgba(191,219,254,1)" }}>
          <span>Phone-bound onboarding</span>
          <span>Healthy Bob</span>
        </div>
      </div>
    ),
    size,
  );
}
