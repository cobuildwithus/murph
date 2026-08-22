"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const MAX_SCALE = 0.6;

/**
 * Renders a production 1200x630 share card scaled to the catalog column,
 * using the same ResizeObserver pattern as the iMessage card studies.
 */
export function ScaledSharePreview({
  frameId,
  children,
}: {
  frameId: string;
  children: ReactNode;
}) {
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
      data-share-preview-frame={frameId}
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
        {children}
      </div>
    </div>
  );
}
