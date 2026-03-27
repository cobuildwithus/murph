"use client";

import { type CSSProperties, useMemo, useState } from "react";

import type { HostedSharePageData } from "@/src/lib/hosted-share/service";

interface ShareLinkClientProps {
  initialData: HostedSharePageData;
  shareCode: string;
}

export function ShareLinkClient({ initialData, shareCode }: ShareLinkClientProps) {
  const [data, setData] = useState(initialData);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"accept" | null>(null);

  const summary = useMemo(() => {
    if (!data.share) {
      return null;
    }

    const parts = [
      data.share.preview.counts.foods ? `${data.share.preview.counts.foods} foods` : null,
      data.share.preview.counts.protocols ? `${data.share.preview.counts.protocols} protocols` : null,
      data.share.preview.counts.recipes ? `${data.share.preview.counts.recipes} recipes` : null,
    ].filter((value): value is string => Boolean(value));

    return parts.join(" · ");
  }, [data.share]);

  async function handleAccept() {
    setErrorMessage(null);
    setPendingAction("accept");

    try {
      const response = await fetch(`/api/hosted-share/${encodeURIComponent(shareCode)}/accept`, {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = await response.json();

      if (!response.ok || !payload?.imported) {
        throw new Error(payload?.error?.message ?? "Could not import the shared bundle.");
      }

      setData((current) => ({
        ...current,
        share: current.share
          ? {
              ...current.share,
              acceptedByCurrentMember: true,
              consumed: true,
            }
          : current.share,
        stage: "consumed",
      }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section
      style={{
        width: "100%",
        maxWidth: "44rem",
        margin: "0 auto",
        borderRadius: "1.5rem",
        background: "rgba(255,255,255,0.94)",
        boxShadow: "0 20px 50px rgba(15, 23, 42, 0.12)",
        padding: "clamp(1.25rem, 4vw, 2rem)",
        display: "grid",
        gap: "1rem",
      }}
    >
      <div style={{ display: "grid", gap: "0.65rem" }}>
        <span
          style={{
            display: "inline-flex",
            width: "fit-content",
            borderRadius: "999px",
            background: "rgba(15, 23, 42, 0.08)",
            padding: "0.35rem 0.75rem",
            fontSize: "0.875rem",
            fontWeight: 600,
          }}
        >
          Healthy Bob share link
        </span>
        <h1 style={{ margin: 0, fontSize: "clamp(2rem, 6vw, 3rem)", lineHeight: 1, letterSpacing: "-0.04em" }}>
          {resolveTitle(data)}
        </h1>
        <p style={{ margin: 0, color: "rgb(51 65 85)", lineHeight: 1.6 }}>
          {resolveSubtitle(data)}
        </p>
      </div>

      {data.share ? (
        <section
          style={{
            borderRadius: "1rem",
            border: "1px solid rgba(148, 163, 184, 0.22)",
            background: "rgba(248,250,252,0.8)",
            padding: "1rem 1.05rem",
            display: "grid",
            gap: "0.65rem",
          }}
        >
          <strong style={{ fontSize: "1.1rem" }}>{data.share.preview.title}</strong>
          {summary ? <span style={{ color: "rgb(71 85 105)" }}>{summary}</span> : null}
          {data.share.preview.foodTitles.length > 0 ? (
            <span>Foods: {data.share.preview.foodTitles.join(", ")}</span>
          ) : null}
          {data.share.preview.protocolTitles.length > 0 ? (
            <span>Protocols: {data.share.preview.protocolTitles.join(", ")}</span>
          ) : null}
          {data.share.preview.recipeTitles.length > 0 ? (
            <span>Recipes: {data.share.preview.recipeTitles.join(", ")}</span>
          ) : null}
          {data.share.preview.logMealAfterImport ? (
            <span style={{ color: "rgb(2 132 199)" }}>
              This link also logs the smoothie after import.
            </span>
          ) : null}
        </section>
      ) : null}

      {errorMessage ? (
        <div
          style={{
            borderRadius: "1rem",
            border: "1px solid rgba(220, 38, 38, 0.16)",
            background: "rgba(254, 242, 242, 0.95)",
            color: "rgb(153 27 27)",
            padding: "0.9rem 1rem",
            lineHeight: 1.5,
          }}
        >
          {errorMessage}
        </div>
      ) : null}

      {data.stage === "ready" && data.share && !data.share.consumed ? (
        <button type="button" onClick={handleAccept} disabled={pendingAction !== null} style={primaryButtonStyle}>
          {pendingAction === "accept" ? "Adding to your vault..." : "Add to my vault"}
        </button>
      ) : null}

      {data.stage === "signin" ? (
        data.inviteCode ? (
          <a href={`/join/${encodeURIComponent(data.inviteCode)}?share=${encodeURIComponent(shareCode)}`} style={primaryLinkStyle}>
            Verify your phone and checkout
          </a>
        ) : (
          <div style={noticeStyle}>
            Sign in on this device after your hosted account is active, then open the link again to import the bundle.
          </div>
        )
      ) : null}

      {data.stage === "consumed" && data.share?.acceptedByCurrentMember ? (
        <div style={successNoticeStyle}>
          The shared bundle is already in your hosted vault.
        </div>
      ) : null}

      {data.stage === "invalid" ? <div style={noticeStyle}>That share link is not valid.</div> : null}
      {data.stage === "expired" ? <div style={noticeStyle}>That share link has expired.</div> : null}
    </section>
  );
}

function resolveTitle(data: HostedSharePageData): string {
  switch (data.stage) {
    case "invalid":
      return "That share link is not valid";
    case "expired":
      return "That share link expired";
    case "signin":
      return "Import a shared bundle";
    case "consumed":
      return "Bundle already imported";
    case "ready":
    default:
      return "Add this bundle to your vault";
  }
}

function resolveSubtitle(data: HostedSharePageData): string {
  switch (data.stage) {
    case "invalid":
      return "Ask for a fresh Healthy Bob share link.";
    case "expired":
      return "Ask for a fresh Healthy Bob share link.";
    case "signin":
      return data.inviteCode
        ? "This link will keep the shared smoothie bundle attached while you finish hosted setup."
        : "Finish hosted setup on this device, then return here to import the bundle.";
    case "consumed":
      return "This one-time bundle has already been added.";
    case "ready":
    default:
      return "This copies the food, its attached supplements/protocols, and any optional first meal log into your own hosted vault.";
  }
}

const primaryButtonStyle = {
  appearance: "none",
  border: 0,
  borderRadius: "999px",
  background: "linear-gradient(135deg, rgb(15 23 42), rgb(30 41 59))",
  color: "white",
  cursor: "pointer",
  fontSize: "1rem",
  fontWeight: 700,
  padding: "0.95rem 1.2rem",
} satisfies CSSProperties;

const primaryLinkStyle = {
  display: "inline-flex",
  width: "fit-content",
  borderRadius: "999px",
  background: "linear-gradient(135deg, rgb(15 23 42), rgb(30 41 59))",
  color: "white",
  fontWeight: 700,
  padding: "0.95rem 1.2rem",
  textDecoration: "none",
} satisfies CSSProperties;

const noticeStyle = {
  borderRadius: "1rem",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "rgba(248,250,252,0.8)",
  color: "rgb(51 65 85)",
  lineHeight: 1.6,
  padding: "1rem 1.05rem",
} satisfies CSSProperties;

const successNoticeStyle = {
  borderRadius: "1rem",
  border: "1px solid rgba(34, 197, 94, 0.18)",
  background: "rgba(240, 253, 244, 0.98)",
  color: "rgb(21 128 61)",
  lineHeight: 1.6,
  padding: "1rem 1.05rem",
} satisfies CSSProperties;
