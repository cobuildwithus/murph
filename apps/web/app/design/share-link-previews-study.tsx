"use client";

import { ConnectShareCard, CONNECT_OG_ALT } from "@/app/(dashboard)/connect/connect-share-card";
import { ApproveShareCard, APPROVE_OG_ALT } from "@/app/approve/[approvalId]/approve-share-card";
import { GroupFundShareCard, GROUP_FUND_OG_ALT } from "@/app/groups/fund/[joinCode]/group-fund-share-card";
import { ReferralShareCard, REFERRAL_OG_ALT } from "@/app/r/[referralCode]/referral-share-card";

import { ScaledSharePreview } from "./scaled-share-preview";

import "./share-preview-fonts.css";

const PREVIEWS = [
  {
    frameId: "approve",
    route: "/approve/[approvalId]",
    note:
      "The approval link unfurl. It lands inside a conversation with Murph, "
      + "right under the message that sent the link, so the headline speaks "
      + "as Murph and the request details never appear.",
    alt: APPROVE_OG_ALT,
    card: <ApproveShareCard logoDataUri="/logo.svg" />,
  },
  {
    frameId: "referral",
    route: "/r/[referralCode]",
    note:
      "The referral link members text friends. The recipient has no Murph "
      + "conversation yet, so the card frames the brand line instead of "
      + "speaking as Murph, and stays capability-neutral so it remains true "
      + "for expired links.",
    alt: REFERRAL_OG_ALT,
    card: <ReferralShareCard logoDataUri="/logo.svg" />,
  },
  {
    frameId: "connect",
    route: "/connect",
    note:
      "Murph texts this link for first-time device connects and reconnects; "
      + "the copy stays true for both flows.",
    alt: CONNECT_OG_ALT,
    card: <ConnectShareCard logoDataUri="/logo.svg" />,
  },
  {
    frameId: "group-fund",
    route: "/groups/fund/[joinCode]",
    note:
      "Dropped into group chats next to the group join card. Descriptive, "
      + "non-imperative copy: it names what the route is about rather than "
      + "promising this specific link is live.",
    alt: GROUP_FUND_OG_ALT,
    card: <GroupFundShareCard logoDataUri="/logo.svg" />,
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
          approvals, referral invites, device connect nudges, and group
          sponsorship. Biomarker and experiment pages ship the same frame
          with subject-specific headlines. Each study renders the exact
          production card component, so the previews cannot drift. None of
          the cards imitates a tappable control, none promises a capability
          the landing page has not yet verified, and none exposes member
          details: link previews are fetched without authentication. Card
          image routes live outside route groups: grouped metadata images get
          hash-suffixed URLs in production, which silently breaks the
          advertised link.
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
            {/* Only the rendered preview is inert; captions stay reachable.
                The shipped alt text below carries the card copy for
                assistive tech and pins the alt contract for reviewers. */}
            <div className="mt-auto" inert>
              <ScaledSharePreview frameId={preview.frameId}>
                {preview.card}
              </ScaledSharePreview>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Alt text: {preview.alt}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
