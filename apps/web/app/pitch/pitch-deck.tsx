"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DeckChrome, TONES, TOTAL } from "./_components/primitives";
import {
  AskSlide,
  BusinessModelSlide,
  CompetitionSlide,
  ExperimentSlide,
  InsightSlide,
  MoatSlide,
  ProblemSlide,
  ProductSlide,
  SpreadSlide,
  TeamSlide,
  TitleSlide,
  ValidationSlide,
  WhyNowSlide,
} from "./_components/slides";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Murph pitch deck — a full-viewport, snap-scrolling slide deck.
   Wedge: group-chat-native health challenges. Moat: the structured
   graph of what protocols actually work. Navigate with arrow keys,
   scroll, or the dot rail.

   This file is the shell: navigation, state, and slide order. Each
   slide is its own component in _components/slides.tsx; shared
   layout primitives and visual mocks live alongside it.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function PitchDeck() {
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);

  const goTo = useCallback((target: number) => {
    const clamped = Math.max(0, Math.min(TOTAL - 1, target));
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    document
      .getElementById(`pitch-slide-${clamped}`)
      ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  }, []);

  // Track the slide in view so the chrome can recolor.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number(entry.target.getAttribute("data-index") ?? "0");
          activeRef.current = index;
          setActive(index);
        }
      },
      // A thin band across the viewport center: whichever slide crosses it
      // is "active", regardless of how tall the slide is.
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    for (const el of document.querySelectorAll("[data-pitch-slide]")) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  // Keyboard navigation, deck-style.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const forward = ["ArrowDown", "ArrowRight", "PageDown", " "];
      const back = ["ArrowUp", "ArrowLeft", "PageUp"];
      if (forward.includes(event.key)) {
        event.preventDefault();
        goTo(activeRef.current + 1);
      } else if (back.includes(event.key)) {
        event.preventDefault();
        goTo(activeRef.current - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        goTo(0);
      } else if (event.key === "End") {
        event.preventDefault();
        goTo(TOTAL - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo]);

  const dark = TONES[active] === "dark";

  return (
    <main
      data-pitch-deck
      className="h-svh overflow-x-hidden overflow-y-auto overscroll-y-contain bg-[#f5f0e8] md:snap-y md:snap-mandatory"
    >
      <DeckChrome active={active} dark={dark} onJump={goTo} />

      <TitleSlide goTo={goTo} />
      <ProblemSlide />
      <InsightSlide />
      <WhyNowSlide />
      <ProductSlide />
      <ExperimentSlide />
      <SpreadSlide />
      <ValidationSlide />
      <CompetitionSlide />
      <MoatSlide />
      <BusinessModelSlide />
      <TeamSlide />
      <AskSlide />
    </main>
  );
}
