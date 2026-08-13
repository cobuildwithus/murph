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

import { AuthButton } from "@/src/components/ui/auth-button";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";

import {
  DEFAULT_ENVIRONMENT_VOICE_SCRIPT,
  type EnvironmentVoiceScript,
} from "./environment-voice-script";

const MAX_RECORDING_MS = 3 * 60 * 1_000;
const UPLOAD_TIMEOUT_MS = 60 * 1_000;
const RECORDING_AUDIO_BITS_PER_SECOND = 64_000;
const AUDIO_METER_BAR_COUNT = 12;
const AUDIO_NOISE_FLOOR = 0.025;
const RESTING_AUDIO_LEVELS = Array.from(
  { length: AUDIO_METER_BAR_COUNT },
  () => 0,
);

type RecordingState =
  | "idle"
  | "recording"
  | "ready"
  | "uploading"
  | "sent";

export function EnvironmentVoiceCapture({
  triggerSize = "lg",
  disabled = false,
  onAccepted,
  onUploadStarted,
  script = DEFAULT_ENVIRONMENT_VOICE_SCRIPT,
  triggerLabel = "Tell Murph by voice",
  triggerVariant = "default",
}: {
  triggerSize?: "sm" | "default" | "lg";
  disabled?: boolean;
  onAccepted?: () => void;
  onUploadStarted?: () => void;
  script?: EnvironmentVoiceScript;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RecordingState>("idle");
  const [topicIndex, setTopicIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordingFile, setRecordingFile] = useState<File | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requestingMicrophone, setRequestingMicrophone] = useState(false);
  const [audioLevels, setAudioLevels] = useState(RESTING_AUDIO_LEVELS);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewElapsedMs, setPreviewElapsedMs] = useState(0);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  const topicCount = script.topics.length;
  const recorderRef = useRef<MediaRecorder | null>(null);
  const microphoneRequestPendingRef = useRef(false);
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

  useEffect(() => {
    if (!hasUnsentRecording(state)) {
      return;
    }

    const preventAccidentalReload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventAccidentalReload);
    return () =>
      window.removeEventListener("beforeunload", preventAccidentalReload);
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
    microphoneRequestPendingRef.current = false;
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
    setRequestingMicrophone(false);
    setDiscardConfirmationOpen(false);
  };

  const startRecording = async () => {
    if (microphoneRequestPendingRef.current) {
      return;
    }
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

    microphoneRequestPendingRef.current = true;
    setRequestingMicrophone(true);
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
      setElapsedMs(0);
      setState("recording");
    } catch (error) {
      setNotice(microphoneAccessNotice(error));
    } finally {
      microphoneRequestPendingRef.current = false;
      setRequestingMicrophone(false);
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
    setDiscardConfirmationOpen(false);
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
      try {
        recorder.stop();
      } finally {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    });

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
    onUploadStarted?.();
    setState("uploading");
    setNotice(null);
    const abortController = new AbortController();
    const uploadTimeout = window.setTimeout(
      () => abortController.abort(),
      UPLOAD_TIMEOUT_MS,
    );
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
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error(await readEnvironmentVoiceUploadError(response));
      }
      onAccepted?.();
      setState("sent");
      setNotice(null);
    } catch (error) {
      setState("ready");
      setNotice(
        error instanceof Error && error.name === "AbortError"
          ? "Sending took too long. The recording is still safe here, so you can try again."
          : error instanceof Error && error.message
          ? error.message
          : "Murph could not receive the recording. It is still safe in this browser.",
      );
    } finally {
      window.clearTimeout(uploadTimeout);
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

  useEffect(() => {
    const finishWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        autoFinishRef.current?.();
      }
    };
    const finishWhenLeaving = () => {
      autoFinishRef.current?.();
    };

    document.addEventListener("visibilitychange", finishWhenHidden);
    window.addEventListener("pagehide", finishWhenLeaving);
    return () => {
      document.removeEventListener("visibilitychange", finishWhenHidden);
      window.removeEventListener("pagehide", finishWhenLeaving);
    };
  }, []);

  const onOpenChange = (nextOpen: boolean) => {
    if (
      !nextOpen
      && (
        microphoneRequestPendingRef.current
        || hasUnsentRecording(state)
      )
    ) {
      return;
    }
    setOpen(nextOpen);
    if (!nextOpen) {
      reset();
    }
  };

  const activeTopicIndex = Math.min(topicIndex, topicCount - 1);
  const topic = script.topics[activeTopicIndex] ?? script.topics[0];
  const elapsedLabel = formatElapsed(elapsedMs);
  const preventCaptureDismissal =
    requestingMicrophone || hasUnsentRecording(state);
  return (
    <>
      <AuthButton
        type="button"
        size={triggerSize}
        variant={triggerVariant}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Mic data-icon="inline-start" aria-hidden="true" />
        {triggerLabel}
      </AuthButton>

      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        disablePointerDismissal={preventCaptureDismissal}
      >
        <DialogContent
          className="flex max-h-[calc(100dvh-1rem)] min-h-[min(700px,calc(100dvh-1rem))] flex-col overflow-y-auto p-0 sm:max-h-[calc(100dvh-3rem)] sm:min-h-[min(620px,calc(100dvh-3rem))] sm:max-w-4xl sm:overflow-hidden"
          showCloseButton={!preventCaptureDismissal}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setTopicIndex((index) =>
                Math.max(0, Math.min(index, topicCount - 1) - 1),
              );
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              setTopicIndex((index) =>
                Math.min(topicCount - 1, index + 1),
              );
            }
          }}
        >
          <DialogHeader className="border-b border-border px-6 py-5 pr-12">
            <DialogTitle>{script.dialogTitle}</DialogTitle>
            <DialogDescription className="sr-only">
              Record one voice memo while moving through {topicCount}{" "}
              {topicCount === 1 ? "topic" : "topics"}.
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
                    {script.idleTitle}
                  </h2>
                  <p className="mt-2 text-pretty text-base leading-relaxed text-muted-foreground sm:text-sm lg:mt-3">
                    {script.idleDescription}
                  </p>
                  <Button
                    className="mt-4 self-start lg:mt-6"
                    size="lg"
                    disabled={requestingMicrophone}
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
                    Recording received
                  </h2>
                  <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">
                    You can close this and keep browsing. Murph will refresh
                    this page when your report is ready. The recording is
                    deleted after processing.
                  </p>
                  <Button
                    className="mt-6 self-start lg:mt-auto"
                    size="lg"
                    onClick={() => onOpenChange(false)}
                  >
                    Close
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
                        {!discardConfirmationOpen ? (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setDiscardConfirmationOpen(true)}
                          >
                            Discard recording
                          </Button>
                        ) : (
                          <DiscardRecordingConfirmation
                            onDiscard={cancelRecording}
                            onKeep={() => setDiscardConfirmationOpen(false)}
                          />
                        )}
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
                        {state === "ready" && !discardConfirmationOpen ? (
                          <Button
                            type="button"
                            variant="ghost"
                            className="mt-2 w-full"
                            onClick={() => setDiscardConfirmationOpen(true)}
                          >
                            Discard recording
                          </Button>
                        ) : null}
                        {state === "ready" && discardConfirmationOpen ? (
                          <DiscardRecordingConfirmation
                            onDiscard={cancelRecording}
                            onKeep={() => setDiscardConfirmationOpen(false)}
                          />
                        ) : null}
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
              className="flex min-h-[25rem] min-w-0 flex-col overflow-y-auto px-6 py-6 sm:px-8 sm:py-8 lg:px-10"
            >
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
                  Topic {activeTopicIndex + 1} of {topicCount}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="icon-lg"
                    variant="outline"
                    disabled={activeTopicIndex === 0}
                    aria-label="Previous topic"
                    aria-keyshortcuts="ArrowLeft"
                    onClick={() => setTopicIndex(activeTopicIndex - 1)}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-lg"
                    variant="outline"
                    disabled={activeTopicIndex === topicCount - 1}
                    aria-label="Next topic"
                    aria-keyshortcuts="ArrowRight"
                    onClick={() => setTopicIndex(activeTopicIndex + 1)}
                  >
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              </div>

              <div className="my-auto min-w-0 py-8">
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
                {topic.focus ? (
                  <ul
                    className="mt-6 grid gap-x-8 gap-y-2 text-base text-muted-foreground sm:grid-cols-2 sm:text-sm"
                    role="list"
                  >
                    {topic.focus.map((item) => (
                      <li key={item} className="flex min-w-0 items-start gap-2">
                        <span
                          className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 text-pretty">{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <nav
                className="flex gap-1"
                aria-label="Walkthrough topics"
              >
                {script.topics.map((voiceTopic, index) => (
                  <button
                    key={voiceTopic.id}
                    type="button"
                    onClick={() => setTopicIndex(index)}
                    aria-label={`Go to topic ${index + 1}: ${voiceTopic.title}`}
                    aria-current={
                      index === activeTopicIndex ? "step" : undefined
                    }
                    className="group flex h-8 flex-1 cursor-pointer items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <span
                      className={`h-1 w-full rounded-full transition-colors duration-150 motion-reduce:transition-none ${
                        index === activeTopicIndex
                          ? "bg-primary"
                          : "bg-secondary group-hover:bg-secondary/70"
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </nav>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DiscardRecordingConfirmation({
  onDiscard,
  onKeep,
}: {
  onDiscard: () => void;
  onKeep: () => void;
}) {
  return (
    <div
      className="mt-2 flex flex-col gap-3 border-t border-border pt-4"
      role="group"
      aria-labelledby="discard-recording-title"
    >
      <div className="flex flex-col gap-1">
        <p
          id="discard-recording-title"
          className="font-medium text-foreground"
        >
          Discard this recording?
        </p>
        <p className="text-sm text-muted-foreground">
          It cannot be recovered.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" onClick={onKeep}>
          Keep recording
        </Button>
        <Button type="button" variant="destructive" onClick={onDiscard}>
          Discard permanently
        </Button>
      </div>
    </div>
  );
}

function hasUnsentRecording(state: RecordingState): boolean {
  return state === "recording" || state === "ready" || state === "uploading";
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
