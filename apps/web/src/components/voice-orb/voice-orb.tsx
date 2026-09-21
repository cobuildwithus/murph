"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import Image from "next/image";
import { createOrbRenderer } from "./voice-orb-shader";
import styles from "./voice-orb.module.css";

export const ORB_PALETTES = [
  { name: "Iris", image: "/design/voice-orb/iris.png", color: "#6557ff", ink: [0.35, 0.27, 1], mist: [0.73, 0.80, 1] },
  { name: "Ember", image: "/design/voice-orb/ember.png", color: "#d77652", ink: [0.78, 0.24, 0.16], mist: [1, 0.82, 0.63] },
  { name: "Sage", image: "/design/voice-orb/sage.png", color: "#7a8c6e", ink: [0.28, 0.43, 0.30], mist: [0.80, 0.88, 0.68] },
] as const;

/** Shared cloud visual; the caller owns interaction and audio. */
export function VoiceOrb({ palette = 0, energy: targetEnergy = 0, paused = false, speed = 0.7, detail = 0.5, pointer, onGraphicsAvailable }: {
  palette?: number;
  energy?: number;
  paused?: boolean;
  speed?: number;
  detail?: number;
  pointer?: RefObject<[number, number]>;
  onGraphicsAvailable?: (available: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = useRef({ palette, energy: targetEnergy, paused, speed, detail, onGraphicsAvailable });
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    settings.current = { palette, energy: targetEnergy, paused, speed, detail, onGraphicsAvailable };
    redraw.current();
  }, [palette, targetEnergy, paused, speed, detail, onGraphicsAvailable]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer = createOrbRenderer(canvas);
    let frameId = 0;
    let lastTime = 0;
    let elapsed = 3;
    let energy = 0;
    let visible = true;
    let lost = false;
    let position: [number, number] = [0, 0];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    function draw(now: number) {
      frameId = 0;
      if (!canvas || lost || !visible || document.hidden) return;
      if (!renderer) {
        settings.current.onGraphicsAvailable?.(false);
        return;
      }
      const current = settings.current;
      const moving = !current.paused && !reduced.matches;
      const delta = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
      lastTime = now;
      const targetEnergy = reduced.matches ? 0 : current.energy;
      energy = moving ? energy + (targetEnergy - energy) * Math.min(delta * 5, 1) : targetEnergy;
      if (moving) elapsed += delta * current.speed * (1 + energy * 1.8);
      position = moving
        ? [position[0] + ((pointer?.current ?? [0, 0])[0] - position[0]) * 0.08,
           position[1] + ((pointer?.current ?? [0, 0])[1] - position[1]) * 0.08]
        : [0, 0];
      renderer.draw({ time: elapsed, energy, detail: current.detail, pointer: position, ...ORB_PALETTES[current.palette] });
      if (canvas.style.opacity !== "1") {
        canvas.style.opacity = "1";
        canvas.dataset.rendered = "true";
        settings.current.onGraphicsAvailable?.(true);
      }
      if (moving) frameId = requestAnimationFrame(draw);
    }
    function wake() {
      cancelAnimationFrame(frameId);
      lastTime = 0;
      frameId = requestAnimationFrame(draw);
    }
    function onLost(event: Event) {
      event.preventDefault();
      lost = true;
      settings.current.onGraphicsAvailable?.(false);
      cancelAnimationFrame(frameId);
      if (canvas) {
        canvas.style.opacity = "0";
        delete canvas.dataset.rendered;
      }
    }
    function onRestored() {
      renderer?.dispose();
      renderer = canvas ? createOrbRenderer(canvas) : null;
      lost = false;
      wake();
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      wake();
    });
    observer.observe(canvas);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    document.addEventListener("visibilitychange", wake);
    reduced.addEventListener("change", wake);
    redraw.current = () => { if (!frameId) wake(); };
    wake();
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      document.removeEventListener("visibilitychange", wake);
      reduced.removeEventListener("change", wake);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      renderer?.dispose();
      redraw.current = () => {};
    };
  }, [pointer]);

  return <>
    <Image className={styles.fallback} style={{ "--orb-color": ORB_PALETTES[palette].color } as CSSProperties} src={ORB_PALETTES[palette].image} width={640} height={640} alt="" aria-hidden="true" unoptimized priority />
    <canvas className={styles.canvas} ref={canvasRef} width={640} height={640} aria-hidden="true" />
  </>;
}
