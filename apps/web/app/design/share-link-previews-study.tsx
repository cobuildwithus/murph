"use client";

import { ConnectShareCard } from "@/app/(dashboard)/connect/connect-share-card";
import { SettingsShareCard } from "@/app/(dashboard)/settings/settings-share-card";
import { GroupFundShareCard } from "@/app/groups/fund/[joinCode]/group-fund-share-card";
import { ReferralShareCard } from "@/app/r/[referralCode]/referral-share-card";

import { ScaledSharePreview } from "./scaled-share-preview";

import "./share-preview-fonts.css";

const PREVIEWS = [
  {
    frameId: "referral",
    route: "/r/[referralCode]",
    note:
      "The referral link members text friends. The recipient has no Murph "
      + "conversation yet, so the card frames the invite around the brand "
      + "line instead of speaking as Murph.",
    card: <ReferralShareCard logoDataUri="/logo.svg" />,
  },
  {
    frameId: "connect",
    route: "/connect",
    note:
      "Murph texts this link for first-time device connects and reconnects; "
      + "the copy stays true for both flows.",
    card: <ConnectShareCard logoDataUri="/logo.svg" />,
  },
  {
    frameId: "group-fund",
    route: "/groups/fund/[joinCode]",
    note:
      "Dropped into group chats next to the group join card, so it keeps the "
      + "same group eyebrow.",
    card: <GroupFundShareCard logoDataUri="/logo.svg" />,
  },
  {
    frameId: "settings",
    route: "/settings",
    note:
      "Billing and usage nudges deep-link here; the card names the real "
      + "settings sections instead of the homepage pitch.",
    card: <SettingsShareCard logoDataUri="/logo.svg" />,
  },
] as const;

export function ShareLinkPreviewsStudy() {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-4 sm:p-8"
      data-design-component="share-link-previews"
    >
      <div className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Static link unfurls
        </p>
        <h3 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
          Share link previews
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          The 1200x630 OpenGraph cards behind links Murph or members send:
          referral invites, device connect nudges, group sponsorship, and
          settings. Each study renders the exact production card component,
          so the previews cannot drift. None of the cards imitates a tappable
          control, and none exposes member details: link previews are fetched
          without authentication.
        </p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        {PREVIEWS.map((preview) => (
          <div key={preview.frameId} className="flex flex-col gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {preview.route}
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              {preview.note}
            </p>
            {/* Only the rendered preview is inert; captions stay reachable. */}
            <div className="mt-auto" inert>
              <ScaledSharePreview frameId={preview.frameId}>
                {preview.card}
              </ScaledSharePreview>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
