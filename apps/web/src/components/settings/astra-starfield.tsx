"use client";

import { useEffect, useRef } from "react";

import styles from "./assistant-model-artwork.module.css";

// Fixed positions keep the sky consistent across server rendering and hydration.
const BACKGROUND_STARS = Array.from({ length: 64 }, (_, index) => ({
  x: 2 + ((index * 61.8034) % 96),
  y: 4 + ((index * 37.719 + 23) % 92),
  depth: index % 8 === 0 ? 2 : index % 3 === 0 ? 1 : 0,
}));

const SPIRAL_STARS = Array.from({ length: 128 }, (_, index) => {
  const progress = (Math.floor(index / 2) + 0.5) / 64;
  const angle = progress * 5.2 + (index % 2) * Math.PI;
  const scatter = ((index * 0.754877) % 1) - 0.5;
  const radius = 4 + progress * 40 + scatter * 6;
  const across = Math.cos(angle) * radius;
  const along = Math.sin(angle) * radius;

  return {
    x: 50 + across + scatter * 2,
    y: 50 + along + scatter * 3,
    depth: index % 19 === 0 ? 2 : index % 4 === 0 ? 1 : 0,
  };
});

const CORE_STARS = Array.from({ length: 16 }, (_, index) => {
  const angle = index * 2.39996;
  const radius = Math.sqrt((index + 0.5) / 16) * 7;
  return {
    x: 50 + Math.cos(angle) * radius,
    y: 50 + Math.sin(angle) * radius,
    depth: index % 7 === 0 ? 1 : 0,
  };
});

const STARS = [...BACKGROUND_STARS, ...SPIRAL_STARS, ...CORE_STARS];

type Particle = { x: number; y: number; vx: number; vy: number };
type Point = { x: number; y: number };

function advanceParticle(particle: Particle, pull: Point | null, step: number) {
  const dx = (pull?.x ?? particle.x) - particle.x;
  const dy = (pull?.y ?? particle.y) - particle.y;
  const distance = Math.hypot(dx, dy);
  const gravity = Math.max(0, 1 - distance / 80) ** 2 * 0.028 / Math.max(distance, 8);
  const damping = 0.88 ** step;
  particle.vx = (particle.vx + (dx * gravity - particle.x * 0.01) * step) * damping;
  particle.vy = (particle.vy + (dy * gravity - particle.y * 0.01) * step) * damping;
  particle.x += particle.vx * step;
  particle.y += particle.vy * step;
  return Math.hypot(particle.x, particle.y, particle.vx, particle.vy) > 0.015;
}

export function AstraStarfield() {
  const fieldRef = useRef<HTMLSpanElement>(null);
  const galaxyRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const field = fieldRef.current;
    const galaxy = galaxyRef.current;
    const card = field?.closest("label");
    if (!field || !galaxy || !card) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stars = Array.from(field.querySelectorAll<HTMLElement>("[data-depth]"));
    const particles = STARS.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 }));
    let pointer: Point | null = null;
    let frame = 0;
    let previousTime = 0;

    function reset() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pointer = null;
      particles.forEach((particle, index) => {
        Object.assign(particle, { x: 0, y: 0, vx: 0, vy: 0 });
        stars[index]!.style.translate = "0px 0px";
      });
    }

    function animate(time: number) {
      frame = 0;
      const step = Math.min((time - previousTime) / (1000 / 60), 2);
      previousTime = time;
      const bounds = field!.getBoundingClientRect();
      const center = { x: bounds.width * 0.71, y: bounds.height * 0.6 };
      const cursor = pointer ? { x: pointer.x - bounds.left, y: pointer.y - bounds.top } : null;
      const spinStyle = getComputedStyle(galaxy!);
      const diameter = parseFloat(spinStyle.width);
      const projection = new DOMMatrix(getComputedStyle(galaxy!.parentElement!).transform);
      // The card center owns placement; project only the disk's local vectors.
      projection.e = 0;
      projection.f = 0;
      const rotation = projection.multiply(new DOMMatrix(spinStyle.transform));
      const inverse = rotation.inverse();
      let moving = false;
      stars.forEach((star, index) => {
        const position = STARS[index]!;
        const galactic = index >= BACKGROUND_STARS.length;
        const projected = rotation.transformPoint({
          x: (position.x / 100 - 0.5) * diameter,
          y: (position.y / 100 - 0.5) * diameter,
        });
        const base = galactic ? { x: center.x + projected.x, y: center.y + projected.y }
          : { x: position.x / 100 * bounds.width, y: position.y / 100 * bounds.height };
        const pull = cursor ? { x: cursor.x - base.x, y: cursor.y - base.y } : null;
        const particle = particles[index]!;
        moving = advanceParticle(particle, pull, step) || moving;
        const offset = galactic ? inverse.transformPoint(particle) : particle;
        star.style.translate = `${offset.x}px ${offset.y}px`;
      });
      if (pointer || moving) frame = requestAnimationFrame(animate);
    }

    function start() {
      if (frame || motion.matches || document.hidden) return;
      previousTime = performance.now();
      frame = requestAnimationFrame(animate);
    }

    function attract(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      pointer = { x: event.clientX, y: event.clientY };
      start();
    }

    function release() {
      pointer = null;
      start();
    }

    card.addEventListener("pointermove", attract);
    card.addEventListener("pointerleave", release);
    card.addEventListener("pointercancel", release);
    motion.addEventListener("change", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      reset();
      card.removeEventListener("pointermove", attract);
      card.removeEventListener("pointerleave", release);
      card.removeEventListener("pointercancel", release);
      motion.removeEventListener("change", reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, []);

  return (
    <span className={styles.stars} ref={fieldRef}>
      {BACKGROUND_STARS.map((star, index) => renderStar(star, index, true))}
      <span className={styles.galaxyPlane}>
        <span className={styles.galaxy} ref={galaxyRef}>
          {[...SPIRAL_STARS, ...CORE_STARS].map((star, index) => renderStar(star, index))}
        </span>
      </span>
    </span>
  );
}

function renderStar({ x, y, depth }: typeof STARS[number], index: number, background = false) {
  return (
    <span
      key={index}
      className={styles.star}
      data-depth={depth}
      style={{
        left: `${x.toFixed(3)}%`,
        top: `${y.toFixed(3)}%`,
        opacity: background && x < 43 && y < 62 ? 0.2 : 1,
      }}
    >
      <span className={styles.starlight} style={{ animationDelay: `${-(index % 17)}s` }} />
    </span>
  );
}
