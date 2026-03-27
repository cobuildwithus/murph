"use client";

import { useState } from "react";

import type { HostedSharePageData } from "@/src/lib/hosted-share/service";

interface ShareLinkClientProps {
  initialData: HostedSharePageData;
  shareCode: string;
}

export function ShareLinkClient({ initialData, shareCode }: ShareLinkClientProps) {
  const [data, setData] = useState(initialData);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"accept" | null>(null);

  const summary = data.share
    ? [
        data.share.preview.counts.foods ? `${data.share.preview.counts.foods} foods` : null,
        data.share.preview.counts.protocols ? `${data.share.preview.counts.protocols} protocols` : null,
        data.share.preview.counts.recipes ? `${data.share.preview.counts.recipes} recipes` : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" · ")
    : null;

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
    <section className="mx-auto w-full max-w-2xl space-y-5 rounded-3xl bg-white p-6 shadow-sm md:p-8">
      <div className="space-y-3">
        <span className="inline-block rounded-full bg-green-50 px-3.5 py-1.5 text-sm font-semibold text-green-700">
          Murph share link
        </span>
        <h1 className="text-4xl font-bold leading-none tracking-tight text-stone-900 md:text-5xl">
          {resolveTitle(data)}
        </h1>
        <p className="leading-relaxed text-stone-500">
          {resolveSubtitle(data)}
        </p>
      </div>

      {data.share ? (
        <section className="space-y-2.5 rounded-xl border border-stone-200/60 bg-stone-50/60 p-4">
          <strong className="text-lg text-stone-900">{data.share.preview.title}</strong>
          {summary ? <p className="text-sm text-stone-500">{summary}</p> : null}
          {data.share.preview.foodTitles.length > 0 ? (
            <p className="text-sm text-stone-600">Foods: {data.share.preview.foodTitles.join(", ")}</p>
          ) : null}
          {data.share.preview.protocolTitles.length > 0 ? (
            <p className="text-sm text-stone-600">Protocols: {data.share.preview.protocolTitles.join(", ")}</p>
          ) : null}
          {data.share.preview.recipeTitles.length > 0 ? (
            <p className="text-sm text-stone-600">Recipes: {data.share.preview.recipeTitles.join(", ")}</p>
          ) : null}
          {data.share.preview.logMealAfterImport ? (
            <p className="text-sm text-green-600">
              This link also logs the smoothie after import.
            </p>
          ) : null}
        </section>
      ) : null}

      {errorMessage ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-snug text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {data.stage === "ready" && data.share && !data.share.consumed ? (
        <button
          type="button"
          onClick={handleAccept}
          disabled={pendingAction !== null}
          className="rounded-full bg-green-700 px-6 py-3 font-bold text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendingAction === "accept" ? "Adding to your vault..." : "Add to my vault"}
        </button>
      ) : null}

      {data.stage === "signin" ? (
        data.inviteCode ? (
          <a
            href={`/join/${encodeURIComponent(data.inviteCode)}?share=${encodeURIComponent(shareCode)}`}
            className="inline-flex rounded-full bg-green-700 px-6 py-3 font-bold text-white no-underline transition-colors hover:bg-green-800"
          >
            Verify your phone and checkout
          </a>
        ) : (
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-600">
            Sign in on this device after your hosted account is active, then open the link again to import the bundle.
          </div>
        )
      ) : null}

      {data.stage === "consumed" && data.share?.acceptedByCurrentMember ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm leading-relaxed text-green-700">
          The shared bundle is already in your hosted vault.
        </div>
      ) : null}

      {data.stage === "invalid" ? (
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-600">
          That share link is not valid.
        </div>
      ) : null}
      {data.stage === "expired" ? (
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-600">
          That share link has expired.
        </div>
      ) : null}
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
      return "Ask for a fresh Murph share link.";
    case "expired":
      return "Ask for a fresh Murph share link.";
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
