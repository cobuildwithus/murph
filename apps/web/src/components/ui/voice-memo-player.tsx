"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/src/lib/utils";

const DEFAULT_BAR_COUNT = 32;

// Fixed-precision strings: the server and client build pipelines stringify
// raw floats at different precision, which trips React hydration on the
// style attribute.
function buildBarHeights(count: number): ReadonlyArray<string> {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const base = Math.sin(t * Math.PI) * 0.6 + 0.3;
    const wobble = Math.sin(t * Math.PI * 3.7 + 0.4) * 0.18;
    return `${(Math.max(0.22, Math.min(1, base + wobble)) * 100).toFixed(2)}%`;
  });
}

const barHeightsCache = new Map<number, ReadonlyArray<string>>();

function barHeightsFor(count: number): ReadonlyArray<string> {
  const cached = barHeightsCache.get(count);
  if (cached) return cached;
  const built = buildBarHeights(count);
  barHeightsCache.set(count, built);
  return built;
}

export function VoiceMemoPlayer({
  src,
  caption,
  accentClassName = "bg-[#5e5530]",
  fillClassName = "bg-[#5e5530]",
  trackClassName = "bg-[#5e5530]/25",
  containerClassName = "rounded-full bg-[#f5f0e8] px-3 py-2 ring-1 ring-black/[0.05]",
  bars = DEFAULT_BAR_COUNT,
}: {
  src: string;
  caption?: string;
  accentClassName?: string;
  fillClassName?: string;
  trackClassName?: string;
  // Chrome around the play row; pass "" when the parent supplies the bubble.
  containerClassName?: string;
  // Waveform density: scale with the rendered width so wide players do not
  // look sparse and narrow ones do not look granular.
  bars?: number;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const probedDurationRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      setCurrent(a.currentTime);
      // Some encodes only report a usable duration after playback starts.
      if (Number.isFinite(a.duration) && a.duration > 0) {
        setDuration((prev) => (prev > 0 ? prev : a.duration));
      }
    };
    const onDurationKnown = () => {
      if (Number.isFinite(a.duration) && a.duration > 0) {
        setDuration(a.duration);
        if (probedDurationRef.current && a.currentTime > 1e6 && a.paused) {
          a.currentTime = 0;
        }
        return;
      }
      // VBR mp3s report Infinity until the browser is forced to scan the
      // file: seek far past the end once, and durationchange re-fires with
      // the real value.
      if (a.duration === Infinity && !probedDurationRef.current) {
        probedDurationRef.current = true;
        a.currentTime = 1e7;
      }
    };
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDurationKnown);
    a.addEventListener("durationchange", onDurationKnown);
    a.addEventListener("canplaythrough", onDurationKnown);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDurationKnown);
      a.removeEventListener("durationchange", onDurationKnown);
      a.removeEventListener("canplaythrough", onDurationKnown);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play().catch(() => setPlaying(false));
      setPlaying(true);
    }
  };

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  // When the duration is still unknown, count up while playing instead of
  // sitting frozen at 0:00.
  const displayTime = duration > 0 ? (playing ? current : duration) : current;

  return (
    <div className="w-full">
      <div className={cn("flex items-center gap-3", containerClassName)}>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause voice memo" : "Play voice memo"}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-white transition-transform active:scale-[0.96]",
            accentClassName,
          )}
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <rect x="2.5" y="2" width="2.5" height="8" rx="0.6" />
              <rect x="7" y="2" width="2.5" height="8" rx="0.6" />
            </svg>
          ) : (
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="currentColor"
              className="translate-x-[1px]"
              aria-hidden="true"
            >
              <path d="M2.5 1.6 L10 6 L2.5 10.4 Z" />
            </svg>
          )}
        </button>

        <div className="flex h-7 flex-1 items-center justify-between">
          {barHeightsFor(bars).map((h, i) => {
            const filled = (i + 1) / bars <= progress;
            return (
              <span
                key={i}
                className={cn(
                  "block w-[3px] rounded-full transition-colors",
                  filled ? fillClassName : trackClassName,
                )}
                style={{ height: h }}
              />
            );
          })}
        </div>

        <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#736a58]">
          {formatTime(displayTime)}
        </span>
      </div>

      {caption ? (
        <p className="mt-2 text-[0.75rem] leading-[1.5] text-[#736a58]">
          {caption}
        </p>
      ) : null}

      <audio ref={audioRef} src={src} preload="auto" className="hidden" />
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
