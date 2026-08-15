"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { ApproveShareCard } from "@/app/approve/[approvalId]/approve-share-card";

import "./approve-share-preview-study.css";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const MAX_SCALE = 0.6;

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
        <ScaledSharePreview />
      </div>
    </div>
  );
}

function ScaledSharePreview() {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    const updateScale = () => {
      const contentWidth = Math.max(0, frame.clientWidth - 2);
      setScale(Math.min(MAX_SCALE, contentWidth / OG_WIDTH));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      className="relative overflow-clip rounded-xl border border-border"
      data-share-preview-frame="approve"
      data-render-scale={scale.toFixed(4)}
      style={{
        width: "100%",
        maxWidth: OG_WIDTH * MAX_SCALE,
        height: OG_HEIGHT * scale + 2,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: OG_WIDTH,
          height: OG_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <ApproveShareCard logoDataUri="/logo.svg" />
      </div>
    </div>
  );
}
