"use client";

import { useEffect, useRef, type ReactNode } from "react";

// The study is inert. Forward only decorative motion; controls stay inactive.
export function ModelSettingsHoverPreview({ children }: { children: ReactNode }) {
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const artworks = previewRef.current?.querySelectorAll('[data-model-artwork="astra"]');
    if (!artworks) return;

    function forwardPointer(event: PointerEvent) {
      for (const artwork of artworks!) {
        const card = artwork.closest("label");
        if (!card) continue;
        const bounds = card.getBoundingClientRect();
        const inside = event.type === "pointermove" &&
          event.clientX >= bounds.left && event.clientX <= bounds.right &&
          event.clientY >= bounds.top && event.clientY <= bounds.bottom;
        card.dispatchEvent(new PointerEvent(inside ? "pointermove" : "pointerleave", {
          clientX: event.clientX,
          clientY: event.clientY,
          pointerType: event.pointerType,
        }));
      }
    }

    document.addEventListener("pointermove", forwardPointer);
    document.addEventListener("pointerleave", forwardPointer);
    return () => {
      document.removeEventListener("pointermove", forwardPointer);
      document.removeEventListener("pointerleave", forwardPointer);
    };
  }, []);

  return <div ref={previewRef} inert>{children}</div>;
}
