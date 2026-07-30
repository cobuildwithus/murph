"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Download,
  Mic,
  Pause,
  Play,
  Send,
} from "lucide-react";

import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
const MAX_RECORDING_MS = 3 * 60 * 1_000;
const RECORDING_AUDIO_BITS_PER_SECOND = 64_000;
const AUDIO_METER_BAR_COUNT = 12;
const AUDIO_NOISE_FLOOR = 0.025;
const RESTING_AUDIO_LEVELS = Array.from(
  { length: AUDIO_METER_BAR_COUNT },
  () => 0,
);

const VOICE_TOPICS = [
  {
    title: "Your bedroom",
    eyebrow: "Sleep",
    prompt:
      "Describe the temperature, darkness and noise at night. Mention windows, your mattress, overheating, and whether your phone or a TV is near the bed.",
  },
  {
    title: "The air and water",
    eyebrow: "Air & water",
    prompt:
      "Tell Murph how you ventilate, whether there is damp or mold, what you cook on, any smoke indoors, and whether you drink tap, filtered, or bottled water.",
  },
  {
    title: "Light through the day",
    eyebrow: "Light",
    prompt:
      "Describe morning daylight, where you spend the day, and whether your evening light is warm and dim or bright and cool.",
  },
  {
    title: "Recovery and devices",
    eyebrow: "Optional extras",
    prompt:
      "Mention any sauna, cold exposure, red light, scale, blood-pressure cuff or other devices you already use. None of these are required for a good grade.",
  },
  {
    title: "Where you work",
    eyebrow: "Workspace",
    prompt:
      "Describe how long you sit, your screen height, your desk and chair, how often you take breaks, and any wrist, neck or back discomfort.",
  },
] as const;

type RecordingState =
  | "idle"
  | "recording"
  | "ready"
  | "uploading"
  | "sent";

export function EnvironmentVoiceCapture({
  compact = false,
  triggerLabel = "Tell Murph by voice",
}: {
  compact?: boolean;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RecordingState>("idle");
  const [topicIndex, setTopicIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordingFile, setRecordingFile] = useState<File | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState(RESTING_AUDIO_LEVELS);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewElapsedMs, setPreviewElapsedMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const autoFinishRef = useRef<(() => void) | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  const recordingUrlRef = useRef<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const clearRecordingPreview = useCallback(() => {
    previewAudioRef.current?.pause();
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = null;
    }
    setRecordingUrl(null);
    setPreviewPlaying(false);
    setPreviewElapsedMs(0);
  }, []);

  const stopAudioMeter = useCallback(() => {
    if (audioFrameRef.current !== null) {
      window.cancelAnimationFrame(audioFrameRef.current);
      audioFrameRef.current = null;
    }
    audioSourceRef.current?.disconnect();
    audioSourceRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
    setAudioLevels(RESTING_AUDIO_LEVELS);
  }, []);

  const startAudioMeter = useCallback(
    (stream: MediaStream) => {
      stopAudioMeter();
      if (typeof AudioContext === "undefined") {
        return;
      }

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      audioSourceRef.current = source;
      if (audioContext.state === "suspended") {
        void audioContext.resume().catch(() => undefined);
      }

      const frequencies = new Uint8Array(analyser.frequencyBinCount);
      const timeDomain = new Uint8Array(analyser.fftSize);
      let lastRenderedAt = 0;
      let smoothedVoiceLevel = 0;
      const updateLevels = (renderedAt: number) => {
        if (renderedAt - lastRenderedAt >= 50) {
          analyser.getByteTimeDomainData(timeDomain);
          analyser.getByteFrequencyData(frequencies);
          let squareSum = 0;
          for (const sample of timeDomain) {
            const normalizedSample = (sample - 128) / 128;
            squareSum += normalizedSample * normalizedSample;
          }
          const rootMeanSquare = Math.sqrt(squareSum / timeDomain.length);
          const gatedVoiceLevel = Math.max(
            0,
            Math.min(
              1,
              (rootMeanSquare - AUDIO_NOISE_FLOOR) / 0.14,
            ),
          );
          const smoothing =
            gatedVoiceLevel > smoothedVoiceLevel ? 0.55 : 0.18;
          smoothedVoiceLevel +=
            (gatedVoiceLevel - smoothedVoiceLevel) * smoothing;
          if (smoothedVoiceLevel < 0.025) {
            smoothedVoiceLevel = 0;
          }
          setAudioLevels(
            RESTING_AUDIO_LEVELS.map((_, index) => {
              const frequencyIndex = Math.min(
                frequencies.length - 1,
                index + 1,
              );
              const frequencyLevel =
                (frequencies[frequencyIndex] ?? 0) / 255;
              return Math.min(
                1,
                smoothedVoiceLevel *
                  (0.4 + Math.max(0, frequencyLevel - 0.05) * 1.4),
              );
            }),
          );
          lastRenderedAt = renderedAt;
        }
        audioFrameRef.current = window.requestAnimationFrame(updateLevels);
      };
      audioFrameRef.current = window.requestAnimationFrame(updateLevels);
    },
    [stopAudioMeter],
  );

  useEffect(() => {
    if (state !== "recording") {
      return;
    }

    const timer = window.setInterval(() => {
      const nextElapsed = Date.now() - startedAtRef.current;
      setElapsedMs(nextElapsed);
      if (nextElapsed >= MAX_RECORDING_MS) {
        autoFinishRef.current?.();
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(
    () => () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      stopAudioMeter();
      clearRecordingPreview();
    },
    [clearRecordingPreview, stopAudioMeter],
  );

  const reset = () => {
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    chunksRef.current = [];
    stopAudioMeter();
    clearRecordingPreview();
    setState("idle");
    setTopicIndex(0);
    setElapsedMs(0);
    setRecordingFile(null);
    setNotice(null);
  };

  const startRecording = async () => {
    setNotice(null);
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setNotice(
        "This browser cannot record audio here. Open this page in a current version of Chrome or Safari and try again.",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, {
            audioBitsPerSecond: RECORDING_AUDIO_BITS_PER_SECOND,
            mimeType,
          })
        : new MediaRecorder(stream, {
            audioBitsPerSecond: RECORDING_AUDIO_BITS_PER_SECOND,
          });
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      startAudioMeter(stream);
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });
      recorder.start();
      startedAtRef.current = Date.now();
      setTopicIndex(0);
      setElapsedMs(0);
      setState("recording");
    } catch (error) {
      setNotice(microphoneAccessNotice(error));
    }
  };

  const cancelRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];
    stopAudioMeter();
    clearRecordingPreview();
    setState("idle");
    setTopicIndex(0);
    setElapsedMs(0);
    setRecordingFile(null);
    setNotice(null);
    setOpen(false);
  };

  const stopRecording = async (): Promise<File | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return recordingFile;
    }

    const file = await new Promise<File>((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          const recorderMimeType =
            recorder.mimeType || chunksRef.current[0]?.type || "audio/webm";
          const mimeType =
            recorderMimeType.split(";", 1)[0]?.trim() || "audio/webm";
          const extension = mimeType.includes("mp4") ? "m4a" : "webm";
          resolve(
            new File(chunksRef.current, `murph-environment.${extension}`, {
              type: mimeType,
            }),
          );
        },
        { once: true },
      );
      recorder.stop();
    });

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    stopAudioMeter();
    clearRecordingPreview();
    const previewUrl = URL.createObjectURL(file);
    recordingUrlRef.current = previewUrl;
    setRecordingUrl(previewUrl);
    setRecordingFile(file);
    setState("ready");
    return file;
  };

  const uploadRecording = async (file: File) => {
    setState("uploading");
    setNotice(null);
    try {
      const bytes = await file.arrayBuffer();
      const captureId = await sha256Hex(bytes);
      const response = await fetch("/api/environment/voice", {
        body: bytes,
        credentials: "same-origin",
        headers: {
          "content-type": file.type,
          "x-murph-environment-voice-capture-id": captureId,
          "x-murph-environment-voice-captured-at": new Date(
            file.lastModified,
          ).toISOString(),
          "x-murph-environment-voice-duration-ms": String(
            Math.max(1_000, Math.min(MAX_RECORDING_MS, Math.round(elapsedMs))),
          ),
        },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readEnvironmentVoiceUploadError(response));
      }
      setState("sent");
      setNotice(null);
    } catch (error) {
      setState("ready");
      setNotice(
        error instanceof Error && error.message
          ? error.message
          : "Murph could not receive the recording. It is still safe in this browser.",
      );
    }
  };

  const finishRecording = async () => {
    await stopRecording();
  };

  const toggleRecordingPreview = async () => {
    const audio = previewAudioRef.current;
    if (!audio) {
      return;
    }
    setNotice(null);
    if (!audio.paused) {
      audio.pause();
      setPreviewPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPreviewPlaying(true);
    } catch {
      setNotice("Murph could not play this recording in the browser.");
    }
  };

  useEffect(() => {
    autoFinishRef.current = () => {
      void finishRecording();
    };
  });

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (state === "recording" || state === "uploading")) {
      return;
    }
    setOpen(nextOpen);
    if (!nextOpen) {
      reset();
    }
  };

  const topic = VOICE_TOPICS[topicIndex];
  const elapsedLabel = formatElapsed(elapsedMs);
  return (
    <>
      <Button
        type="button"
        size={compact ? "sm" : "lg"}
        onClick={() => setOpen(true)}
      >
        <Mic data-icon="inline-start" aria-hidden="true" />
        {triggerLabel}
      </Button>

      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        disablePointerDismissal={
          state === "recording" || state === "uploading"
        }
      >
        <DialogContent
          className="flex max-h-[calc(100dvh-1rem)] min-h-[min(700px,calc(100dvh-1rem))] flex-col overflow-y-auto p-0 sm:max-h-[calc(100dvh-3rem)] sm:min-h-[min(620px,calc(100dvh-3rem))] sm:max-w-4xl sm:overflow-hidden"
          showCloseButton={state !== "recording" && state !== "uploading"}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setTopicIndex((index) => Math.max(0, index - 1));
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              setTopicIndex((index) =>
                Math.min(VOICE_TOPICS.length - 1, index + 1),
              );
            }
          }}
        >
          <DialogHeader className="border-b border-border px-6 py-5 pr-12">
            <DialogTitle>Walk Murph through your home</DialogTitle>
            <DialogDescription className="sr-only">
              Record one voice memo while moving through five short home topics.
            </DialogDescription>
          </DialogHeader>

          <div className="grid flex-1 lg:grid-cols-[17rem_minmax(0,1fr)]">
            <div className="flex flex-col border-b border-border bg-muted/20 px-6 py-5 lg:border-b-0 lg:border-r lg:py-7">
              {state === "idle" ? (
                <>
                  <Mic
                    className="hidden size-6 shrink-0 text-primary lg:block"
                    aria-hidden="true"
                  />
                  <h2 className="text-balance font-serif text-xl font-semibold tracking-[-0.02em] text-foreground lg:mt-5">
                    Ready when you are
                  </h2>
                  <p className="mt-2 text-pretty text-base leading-relaxed text-muted-foreground sm:text-sm lg:mt-3">
                    Preview the topics with the arrows, then record one
                    continuous memo.
                  </p>
                  <Button
                    className="mt-4 self-start lg:mt-6"
                    size="lg"
                    onClick={startRecording}
                  >
                    <Mic data-icon="inline-start" aria-hidden="true" />
                    Start recording
                  </Button>
                </>
              ) : state === "sent" ? (
                <div className="flex h-full flex-col">
                  <CheckCircle2
                    className="size-7 text-primary"
                    aria-hidden="true"
                  />
                  <h2 className="mt-5 text-balance font-serif text-2xl font-semibold tracking-[-0.02em] text-foreground">
                    Sent securely
                  </h2>
                  <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">
                    Murph is transcribing this in the background and will add
                    only clear facts to your report. The audio is deleted after
                    processing.
                  </p>
                  <Button
                    className="mt-6 self-start lg:mt-auto"
                    size="lg"
                    onClick={() => setOpen(false)}
                  >
                    Done
                  </Button>
                </div>
              ) : (
                <>
                  <div
                    className="inline-flex items-center gap-2 text-base font-medium text-destructive sm:text-sm"
                    role="status"
                  >
                    <span
                      className={`size-2 rounded-full bg-destructive ${
                        state === "recording" ? "animate-pulse" : ""
                      }`}
                      aria-hidden="true"
                    />
                    {state === "recording"
                      ? "Recording"
                      : state === "uploading"
                        ? "Sending securely"
                        : "Recording ready"}
                  </div>
                  <p className="mt-3 font-mono text-lg tabular-nums text-foreground">
                    {elapsedLabel}
                    <span className="text-sm text-muted-foreground">
                      {" "}
                      / 3:00
                    </span>
                  </p>
                  {state === "recording" ? (
                    <AudioActivityMeter levels={audioLevels} />
                  ) : null}

                  <div className="mt-6 lg:mt-auto">
                    {state === "recording" ? (
                      <div className="flex min-w-0 flex-col items-stretch gap-2">
                        <Button
                          type="button"
                          size="lg"
                          className="w-full min-w-0"
                          onClick={() => void finishRecording()}
                        >
                          <CircleStop
                            data-icon="inline-start"
                            aria-hidden="true"
                          />
                          Finish recording
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={cancelRecording}
                        >
                          Discard recording
                        </Button>
                      </div>
                    ) : (
                      <>
                        {recordingUrl ? (
                          <div>
                            <audio
                              ref={previewAudioRef}
                              src={recordingUrl}
                              preload="metadata"
                              onEnded={() => {
                                setPreviewPlaying(false);
                                setPreviewElapsedMs(0);
                                if (previewAudioRef.current) {
                                  previewAudioRef.current.currentTime = 0;
                                }
                              }}
                              onPause={() => setPreviewPlaying(false)}
                              onTimeUpdate={(event) =>
                                setPreviewElapsedMs(
                                  event.currentTarget.currentTime * 1_000,
                                )
                              }
                            >
                            </audio>
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full min-w-0 justify-start"
                              onClick={() => void toggleRecordingPreview()}
                            >
                              {previewPlaying ? (
                                <Pause
                                  data-icon="inline-start"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Play
                                  data-icon="inline-start"
                                  aria-hidden="true"
                                />
                              )}
                              {previewPlaying ? "Pause preview" : "Play preview"}
                              <span className="ml-auto font-mono text-xs font-normal tabular-nums text-muted-foreground">
                                {formatElapsed(previewElapsedMs)} /{" "}
                                {elapsedLabel}
                              </span>
                            </Button>
                            <div
                              className="mt-2 h-1 overflow-hidden rounded-full bg-secondary"
                              aria-hidden="true"
                            >
                              <span
                                className="block h-full rounded-full bg-primary transition-[width] duration-100"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    elapsedMs > 0
                                      ? (previewElapsedMs / elapsedMs) * 100
                                      : 0,
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        ) : null}

                        <Button
                          type="button"
                          size="lg"
                          className="mt-4 w-full min-w-0"
                          disabled={!recordingFile || state === "uploading"}
                          onClick={() =>
                            recordingFile
                              ? void uploadRecording(recordingFile)
                              : undefined
                          }
                        >
                          <Send data-icon="inline-start" aria-hidden="true" />
                          {state === "uploading"
                            ? "Sending securely…"
                            : "Send to Murph"}
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )}

              {notice ? (
                <div
                  className="mt-5 border-t border-border pt-5 text-base text-muted-foreground sm:text-sm"
                  role="status"
                >
                  <p>{notice}</p>
                  {recordingFile ? (
                    <div className="mt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => downloadRecording(recordingFile)}
                      >
                        <Download data-icon="inline-start" aria-hidden="true" />
                        Download
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <section
              aria-labelledby="environment-voice-topic-title"
              className="flex min-h-[25rem] flex-col px-6 py-6 sm:px-8 sm:py-8 lg:px-10"
            >
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
                  Topic {topicIndex + 1} of {VOICE_TOPICS.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="icon-lg"
                    variant="outline"
                    disabled={topicIndex === 0}
                    aria-label="Previous topic"
                    aria-keyshortcuts="ArrowLeft"
                    onClick={() => setTopicIndex((index) => index - 1)}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-lg"
                    variant="outline"
                    disabled={topicIndex === VOICE_TOPICS.length - 1}
                    aria-label="Next topic"
                    aria-keyshortcuts="ArrowRight"
                    onClick={() => setTopicIndex((index) => index + 1)}
                  >
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              </div>

              <div className="my-auto py-8">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-primary">
                  {topic.eyebrow}
                </p>
                <h2
                  id="environment-voice-topic-title"
                  className="mt-3 max-w-[18ch] text-balance font-serif text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-5xl"
                >
                  {topic.title}
                </h2>
                <p className="mt-5 max-w-[48ch] text-pretty text-lg leading-relaxed text-foreground sm:mt-6 sm:text-xl">
                  {topic.prompt}
                </p>
              </div>

              <div
                className="flex gap-2"
                aria-label={`Topic ${topicIndex + 1} of ${VOICE_TOPICS.length}`}
              >
                {VOICE_TOPICS.map((voiceTopic, index) => (
                  <span
                    key={voiceTopic.title}
                    className={`h-1 flex-1 rounded-full ${
                      index === topicIndex ? "bg-primary" : "bg-secondary"
                    }`}
                    aria-hidden="true"
                  />
                ))}
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function preferredMimeType(): string | undefined {
  for (const mimeType of [
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
  ]) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return undefined;
}

function AudioActivityMeter({ levels }: { levels: readonly number[] }) {
  return (
    <div className="mt-5">
      <div
        className="flex h-10 items-center gap-1 rounded-lg border border-border bg-background/60 px-3"
        aria-hidden="true"
      >
        {levels.map((level, index) => (
          <span
            key={index}
            className="w-1 flex-1 rounded-full bg-primary transition-[height,opacity] duration-75"
            style={{
              height: `${Math.max(3, Math.round(level * 30))}px`,
              opacity: level === 0 ? 0.35 : 1,
            }}
          />
        ))}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Microphone active
      </p>
    </div>
  );
}

export function microphoneAccessNotice(error: unknown): string {
  const name = errorName(error);

  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked for this site. Allow it in your browser's site settings, then try again.";
  }
  if (name === "NotFoundError") {
    return "No microphone was found. Connect one, then try again.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "The microphone is unavailable, possibly because another app is using it. Close the other app and try again.";
  }
  return "Murph could not access the microphone. Check your browser's microphone settings and try again.";
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.min(
    Math.floor(milliseconds / 1_000),
    MAX_RECORDING_MS / 1_000,
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function downloadRecording(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function errorName(error: unknown): string | null {
  return error !== null &&
    typeof error === "object" &&
    "name" in error &&
    typeof error.name === "string"
    ? error.name
    : null;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function readEnvironmentVoiceUploadError(
  response: Response,
): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (
      payload
      && typeof payload === "object"
      && "error" in payload
      && payload.error
      && typeof payload.error === "object"
      && "message" in payload.error
      && typeof payload.error.message === "string"
      && payload.error.message.trim()
    ) {
      return payload.error.message.trim();
    }
  } catch {
    // The fallback below is intentionally generic and keeps response bodies
    // out of the UI and logs.
  }
  return "Murph could not receive the recording. It is still safe in this browser.";
}
