"use client";

import { ApproveShareCard } from "@/app/approve/[approvalId]/approve-share-card";

import { ScaledSharePreview } from "./scaled-share-preview";

import "./share-preview-fonts.css";

export function ApproveSharePreviewStudy() {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-4 sm:p-8"
      data-design-component="approve-share-preview"
    >
      <div className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Static link unfurl
        </p>
        <h3 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
          Approval link share preview
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          The 1200x630 OpenGraph card behind /approve links. It unfurls inside
          a conversation with Murph, right under the message that sent the
          link, so the headline speaks as Murph and nothing in the frame
          imitates a tappable control. The request details never appear: link
          previews are fetched without authentication, so the card stays
          generic.
        </p>
      </div>
      {/* Only the rendered preview is inert; the explanatory prose above
          stays reachable by assistive tech and find-in-page. */}
      <div inert>
        <ScaledSharePreview frameId="approve">
          <ApproveShareCard logoDataUri="/logo.svg" />
        </ScaledSharePreview>
      </div>
    </div>
  );
}
