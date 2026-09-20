"use client";

import { useRef, useState, type CSSProperties } from "react";
import { VoiceOrb, ORB_PALETTES as PALETTES } from "@/src/components/voice-orb/voice-orb";
import styles from "./voice-orb-study.module.css";

export function VoiceOrbStudy() {
  const [palette, setPalette] = useState(0);
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [night, setNight] = useState(false);
  const [speed, setSpeed] = useState(0.7);
  const [detail, setDetail] = useState(0.5);
  const [size, setSize] = useState(200);
  const [graphicsAvailable, setGraphicsAvailable] = useState(true);
  const pointer = useRef<[number, number]>([0, 0]);

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
            <VoiceOrb palette={palette} energy={active ? 1 : 0} paused={paused} speed={speed} detail={detail} pointer={pointer} onGraphicsAvailable={setGraphicsAvailable} />
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
