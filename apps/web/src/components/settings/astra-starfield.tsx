"use client";

import { useEffect, useRef } from "react";

import styles from "./assistant-model-artwork.module.css";

// Fixed positions keep the sky consistent across server rendering and hydration.
const STARS = Array.from({ length: 112 }, (_, index) => ({
  x: 2 + ((index * 61.8034) % 96),
  y: 4 + ((index * 37.719 + 23) % 92),
  depth: index % 8 === 0 ? 2 : index % 3 === 0 ? 1 : 0,
}));

export function AstraStarfield() {
  const fieldRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const field = fieldRef.current;
    const card = field?.closest("label");
    if (!field || !card) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stars = Array.from(field.children) as HTMLElement[];
    let frame = 0;

    function reset() {
      if (frame) cancelAnimationFrame(frame);
      for (const star of stars) star.style.translate = "0px 0px";
    }

    function disturb(event: PointerEvent) {
      if (motion.matches || event.pointerType === "touch") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = field!.getBoundingClientRect();
        const cursorX = event.clientX - bounds.left;
        const cursorY = event.clientY - bounds.top;
        stars.forEach((star, index) => {
          const { x, y, depth } = STARS[index]!;
          const dx = (x / 100) * bounds.width - cursorX;
          const dy = (y / 100) * bounds.height - cursorY;
          const distance = Math.hypot(dx, dy);
          const force = -Math.min(distance * 0.65,
            Math.max(0, 1 - distance / 90) ** 2 * (12 + depth * 7));
          const angle = distance < 1 ? index * 2.4 : Math.atan2(dy, dx);
          star.style.translate = `${Math.cos(angle) * force}px ${Math.sin(angle) * force}px`;
        });
      });
    }

    card.addEventListener("pointermove", disturb);
    card.addEventListener("pointerleave", reset);
    card.addEventListener("pointercancel", reset);
    motion.addEventListener("change", reset);
    return () => {
      reset();
      card.removeEventListener("pointermove", disturb);
      card.removeEventListener("pointerleave", reset);
      card.removeEventListener("pointercancel", reset);
      motion.removeEventListener("change", reset);
    };
  }, []);

  return (
    <span className={styles.stars} ref={fieldRef}>
      {STARS.map(({ x, y, depth }, index) => (
        <span
          key={index}
          className={styles.star}
          data-depth={depth}
          style={{
            left: `${x}%`,
            top: `${y}%`,
            opacity: x < 43 && y < 62 ? 0.2 : 1,
          }}
        >
          <span
            className={styles.starlight}
            style={{ animationDelay: `${-(index % 17)}s` }}
          />
        </span>
      ))}
    </span>
  );
}
