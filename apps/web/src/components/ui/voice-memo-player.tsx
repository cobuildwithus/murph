"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { PauseIcon, PlayIcon } from "lucide-react";

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

export interface VoiceMemoPlayerHandle {
  // Start playback from the current position; the exclusive group pauses any
  // sibling player. Lets a surrounding surface (e.g. a clickable card) preview
  // this memo without duplicating the audio wiring.
  play: () => void;
}

interface VoiceMemoPlayerProps {
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
  exclusiveGroupId?: string;
  preload?: "none" | "metadata" | "auto";
  unavailableLabel?: string;
}

export const VoiceMemoPlayer = forwardRef<
  VoiceMemoPlayerHandle,
  VoiceMemoPlayerProps
>(function VoiceMemoPlayer(
  {
    src,
    caption,
    accentClassName = "bg-[#5e5530]",
    fillClassName = "bg-[#5e5530]",
    trackClassName = "bg-[#5e5530]/25",
    containerClassName = "rounded-full bg-[#f5f0e8] px-3 py-2 ring-1 ring-black/[0.05]",
    bars = DEFAULT_BAR_COUNT,
    exclusiveGroupId,
    preload = "metadata",
    unavailableLabel = "Unavailable",
  },
  ref,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const probedDurationRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onLoadStart = () => {
      probedDurationRef.current = false;
      setCurrent(0);
      setDuration(0);
      setPlaying(false);
      setUnavailable(false);
    };
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
    const onPlay = () => {
      pauseOtherVoiceMemos(exclusiveGroupId, a);
      setUnavailable(false);
      setPlaying(true);
    };
    const onPause = () => {
      setPlaying(false);
    };
    const onError = () => {
      setUnavailable(true);
      setPlaying(false);
    };
    a.addEventListener("loadstart", onLoadStart);
    a.addEventListener("emptied", onLoadStart);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDurationKnown);
    a.addEventListener("durationchange", onDurationKnown);
    a.addEventListener("canplaythrough", onDurationKnown);
    a.addEventListener("ended", onEnd);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("error", onError);
    return () => {
      a.removeEventListener("loadstart", onLoadStart);
      a.removeEventListener("emptied", onLoadStart);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDurationKnown);
      a.removeEventListener("durationchange", onDurationKnown);
      a.removeEventListener("canplaythrough", onDurationKnown);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("error", onError);
    };
  }, [exclusiveGroupId, src]);

  const start = useCallback(() => {
    const a = audioRef.current;
    if (!a || unavailable) return;
    a.play().catch(() => setPlaying(false));
    setPlaying(true);
  }, [unavailable]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a || unavailable) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      start();
    }
  };

  useImperativeHandle(ref, () => ({ play: start }), [start]);

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
          disabled={unavailable}
          aria-label={playing ? "Pause voice memo" : "Play voice memo"}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-white transition-transform active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-55",
            accentClassName,
          )}
        >
          {playing ? (
            <PauseIcon
              className="size-3.5"
              strokeWidth={3}
              aria-hidden="true"
            />
          ) : (
            <PlayIcon
              className="size-3.5 translate-x-[1px]"
              fill="currentColor"
              strokeWidth={0}
              aria-hidden="true"
            />
          )}
        </button>

        <button
          type="button"
          onClick={toggle}
          disabled={unavailable}
          aria-label={
            playing
              ? "Pause voice memo from waveform"
              : "Play voice memo from waveform"
          }
          data-voice-memo-waveform
          className="flex h-7 flex-1 cursor-pointer items-center justify-between rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed"
        >
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
        </button>

        <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#736a58]">
          {unavailable ? unavailableLabel : formatTime(displayTime)}
        </span>
      </div>

      {caption ? (
        <p className="mt-2 text-[0.75rem] leading-[1.5] text-[#736a58]">
          {caption}
        </p>
      ) : null}

      <audio
        ref={audioRef}
        src={src}
        preload={preload}
        className="hidden"
        data-voice-memo-group={exclusiveGroupId}
      />
    </div>
  );
});

function pauseOtherVoiceMemos(
  groupId: string | undefined,
  currentAudio: HTMLAudioElement,
): void {
  if (!groupId || typeof document === "undefined") {
    return;
  }

  document
    .querySelectorAll<HTMLAudioElement>("audio[data-voice-memo-group]")
    .forEach((audio) => {
      if (audio !== currentAudio && audio.dataset.voiceMemoGroup === groupId) {
        audio.pause();
      }
    });
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
