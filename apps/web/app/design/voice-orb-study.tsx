"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import { createOrbRenderer } from "./voice-orb-shader";
import styles from "./voice-orb-study.module.css";

const PALETTES = [
  { name: "Iris", image: "/design/voice-orb/iris.png", color: "#6557ff", ink: [0.35, 0.27, 1], mist: [0.73, 0.80, 1] },
  { name: "Ember", image: "/design/voice-orb/ember.png", color: "#d77652", ink: [0.78, 0.24, 0.16], mist: [1, 0.82, 0.63] },
  { name: "Sage", image: "/design/voice-orb/sage.png", color: "#7a8c6e", ink: [0.28, 0.43, 0.30], mist: [0.80, 0.88, 0.68] },
] as const;

export function VoiceOrbStudy() {
  const [palette, setPalette] = useState(0);
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [night, setNight] = useState(false);
  const [speed, setSpeed] = useState(0.7);
  const [detail, setDetail] = useState(0.5);
  const [size, setSize] = useState(200);
  const [graphicsAvailable, setGraphicsAvailable] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<[number, number]>([0, 0]);
  const settings = useRef({ palette, active, paused, speed, detail });
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    settings.current = { palette, active, paused, speed, detail };
    redraw.current();
  }, [palette, active, paused, speed, detail]);

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
        setGraphicsAvailable(false);
        return;
      }
      const current = settings.current;
      const moving = !current.paused && !reduced.matches;
      const delta = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
      lastTime = now;
      const targetEnergy = current.active ? 1 : 0;
      energy = moving ? energy + (targetEnergy - energy) * Math.min(delta * 5, 1) : targetEnergy;
      if (moving) elapsed += delta * current.speed * (1 + energy * 1.8);
      position = moving
        ? [position[0] + (pointer.current[0] - position[0]) * 0.08,
           position[1] + (pointer.current[1] - position[1]) * 0.08]
        : [0, 0];
      renderer.draw({ time: elapsed, energy, detail: current.detail, pointer: position, ...PALETTES[current.palette] });
      if (canvas.style.opacity !== "1") {
        canvas.style.opacity = "1";
        setGraphicsAvailable(true);
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
      setGraphicsAvailable(false);
      cancelAnimationFrame(frameId);
      if (canvas) canvas.style.opacity = "0";
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
    redraw.current = wake;
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
  }, []);

  function reset() {
    setPalette(0);
    setActive(false);
    setPaused(false);
    setNight(false);
    setSpeed(0.7);
    setDetail(0.5);
    setSize(200);
    pointer.current = [0, 0];
  }

  return (
    <section className={styles.study} id="voice-orb" aria-labelledby="voice-orb-title">
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Motion study / 01</p>
        <h1 id="voice-orb-title">A little presence.</h1>
        <p>A soft, living orb. Move around it. Tap to wake it up.</p>
      </header>
      <div className={styles.playground}>
        <div className={styles.stage} data-night={night} data-active={active}>
          <span className={styles.stageLabel}>Voice orb</span>
          <button type="button" className={styles.surfaceToggle} aria-pressed={night} onClick={() => setNight(!night)}>
            {night ? "Light surface" : "Dark surface"}
          </button>
          <button
            type="button"
            className={styles.orb}
            aria-label="Activate orb demo"
            aria-pressed={active}
            aria-describedby="voice-orb-hint"
            onClick={() => setActive(!active)}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              pointer.current = [(event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2];
            }}
            onPointerLeave={() => { pointer.current = [0, 0]; }}
            onPointerCancel={() => { pointer.current = [0, 0]; }}
            style={{ "--orb-size": `${size}px`, "--orb-color": PALETTES[palette].color } as CSSProperties}
          >
            <Image className={styles.fallback} src={PALETTES[palette].image} width={640} height={640} alt="" aria-hidden="true" unoptimized priority />
            <canvas ref={canvasRef} width={640} height={640} aria-hidden="true" />
          </button>
          <div className={styles.caption}>
            <p role="status">{active ? "Awake" : "At ease"}<span className={styles.statusDot} /></p>
            <p id="voice-orb-hint">{active ? "Tap to settle" : "Tap to wake"}</p>
          </div>
          <span className={styles.demoNote}>{graphicsAvailable ? "Visual demo · no microphone" : "Static image · animation unavailable"}</span>
        </div>
        <aside className={styles.controls} aria-label="Orb appearance">
          <div className={styles.controlHeading}><h2>Make it yours</h2><button type="button" onClick={reset}>Reset</button></div>
          <fieldset className={styles.palette}>
            <legend>Palette</legend>
            {PALETTES.map((item, index) => (
              <label key={item.name}>
                <input type="radio" name="orb-palette" value={item.name} checked={palette === index} onChange={() => setPalette(index)} />
                <span className={styles.swatch} style={{ background: item.color }} />
                {item.name}
              </label>
            ))}
          </fieldset>
          <label className={styles.range} htmlFor="voice-orb-drift">
            <span>Drift <output>{speed.toFixed(1)}×</output></span>
            <input id="voice-orb-drift" type="range" min="0.2" max="2" step="0.1" value={speed} disabled={!graphicsAvailable} onChange={(event) => setSpeed(Number(event.target.value))} />
          </label>
          <label className={styles.range} htmlFor="voice-orb-detail">
            <span>Cloud detail <output>{Math.round(detail * 100)}%</output></span>
            <input id="voice-orb-detail" type="range" min="0" max="1" step="0.05" value={detail} disabled={!graphicsAvailable} onChange={(event) => setDetail(Number(event.target.value))} />
          </label>
          <label className={styles.range} htmlFor="voice-orb-size">
            <span>Size <output>{size}px</output></span>
            <input id="voice-orb-size" type="range" min="120" max="280" step="10" value={size} onChange={(event) => setSize(Number(event.target.value))} />
          </label>
          <button type="button" className={styles.pause} aria-pressed={paused} disabled={!graphicsAvailable} onClick={() => setPaused(!paused)}>
            {paused ? "Resume motion" : "Pause motion"}
          </button>
          <p className={styles.controlNote}>Try Ember for a warmer feel, or Sage for something closer to Murph.</p>
        </aside>
      </div>
    </section>
  );
}
