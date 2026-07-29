"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Download,
  Mic,
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
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

const MAX_RECORDING_MS = 3 * 60 * 1_000;

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

type RecordingState = "idle" | "recording" | "ready" | "sending";

export function EnvironmentVoiceCapture({
  contactAction,
  compact = false,
  triggerLabel = "Tell Murph by voice",
}: {
  contactAction: MurphContactOption | null;
  compact?: boolean;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RecordingState>("idle");
  const [topicIndex, setTopicIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordingFile, setRecordingFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const autoFinishRef = useRef<(() => void) | null>(null);

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
    },
    [],
  );

  const reset = () => {
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    chunksRef.current = [];
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
        "This browser cannot record audio here. Send Murph a voice memo in Messages or Telegram instead.",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
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
          const mimeType =
            recorder.mimeType || chunksRef.current[0]?.type || "audio/webm";
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
    setRecordingFile(file);
    setState("ready");
    return file;
  };

  const shareRecording = async (file: File) => {
    setState("sending");
    setNotice(null);
    try {
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({
          files: [file],
          title: "My home environment for Murph",
          text: "Please extract the clear facts from this voice memo and save them to my Habitat record. Skip anything uncertain.",
        });
        setState("ready");
        setNotice(
          "The share sheet closed. If you did not choose Murph, open it again or download the recording.",
        );
        return;
      }

      downloadRecording(file);
      setState("ready");
      setNotice(
        "The recording was downloaded. Open Murph and attach it as a voice message.",
      );
    } catch (error) {
      setState("ready");
      if (isShareDismissal(error)) {
        setNotice("The recording is still ready whenever you want to send it.");
      } else {
        setNotice(
          "The share sheet did not open. Download the recording and attach it in your Murph chat.",
        );
      }
    }
  };

  const finishRecording = async (shareAfterStop: boolean) => {
    const file = await stopRecording();
    if (file && shareAfterStop) {
      await shareRecording(file);
    }
  };

  useEffect(() => {
    autoFinishRef.current = () => {
      void finishRecording(false);
    };
  });

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && state === "recording") {
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

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex max-h-[calc(100dvh-1rem)] min-h-[min(700px,calc(100dvh-1rem))] flex-col overflow-y-auto p-0 sm:max-h-[calc(100dvh-3rem)] sm:min-h-[min(620px,calc(100dvh-3rem))] sm:max-w-4xl sm:overflow-hidden"
          showCloseButton={state !== "recording"}
        >
          <DialogHeader className="border-b border-border px-6 py-5 pr-12">
            <DialogTitle>Walk Murph through your home</DialogTitle>
            <DialogDescription>
              One recording, five topics, no form. Speak naturally and move on
              when you have said enough.
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
                  <h2 className="text-balance font-serif text-xl font-semibold tracking-[-0.02em] text-foreground lg:mt-5 lg:text-2xl">
                    About two minutes is enough
                  </h2>
                  <p className="mt-2 text-pretty text-base leading-relaxed text-muted-foreground sm:text-sm lg:mt-3">
                    <span className="lg:hidden">
                      Preview the topics, then start when you are ready.
                    </span>
                    <span className="hidden lg:inline">
                      Use the arrows to preview each topic. Murph will save
                      clear facts and leave uncertain details alone.
                    </span>
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
                    {state === "recording" ? "Recording" : "Recording ready"}
                  </div>
                  <p className="mt-3 font-mono text-lg tabular-nums text-foreground">
                    {elapsedLabel}
                    <span className="text-sm text-muted-foreground">
                      {" "}
                      / 3:00
                    </span>
                  </p>
                  <p className="mt-5 text-pretty text-base leading-relaxed text-muted-foreground sm:text-sm">
                    Speak naturally. Move between topics whenever you have said
                    enough.
                  </p>

                  <div className="mt-6 lg:mt-auto">
                    {state === "recording" ? (
                      <div className="flex flex-col items-start gap-2">
                        <Button
                          type="button"
                          size="lg"
                          onClick={() => void finishRecording(true)}
                        >
                          <CircleStop
                            data-icon="inline-start"
                            aria-hidden="true"
                          />
                          Finish and choose Murph
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={cancelRecording}
                        >
                          Cancel recording
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="lg"
                        disabled={!recordingFile || state === "sending"}
                        onClick={() =>
                          recordingFile
                            ? void shareRecording(recordingFile)
                            : undefined
                        }
                      >
                        <Send data-icon="inline-start" aria-hidden="true" />
                        {state === "sending"
                          ? "Opening share sheet…"
                          : "Choose Murph"}
                      </Button>
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
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => downloadRecording(recordingFile)}
                      >
                        <Download data-icon="inline-start" aria-hidden="true" />
                        Download
                      </Button>
                      {contactAction ? (
                        <Button
                          size="sm"
                          variant="outline"
                          render={
                            <a
                              href={contactAction.href}
                              target={contactAction.target}
                              rel={contactAction.rel}
                            />
                          }
                          nativeButton={false}
                        >
                          Open Murph
                        </Button>
                      ) : null}
                    </div>
                  ) : contactAction ? (
                    <Button
                      className="mt-3"
                      size="sm"
                      variant="outline"
                      render={
                        <a
                          href={contactAction.href}
                          target={contactAction.target}
                          rel={contactAction.rel}
                        />
                      }
                      nativeButton={false}
                    >
                      Open Murph
                    </Button>
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

export function microphoneAccessNotice(error: unknown): string {
  const errorName =
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    typeof error.name === "string"
      ? error.name
      : null;

  if (errorName === "NotAllowedError" || errorName === "SecurityError") {
    return "Microphone access is blocked for this site. Allow it in your browser's site settings, then try again — or send Murph a voice memo in your usual chat.";
  }
  if (errorName === "NotFoundError") {
    return "No microphone was found. Connect one, then try again — or send Murph a voice memo in your usual chat.";
  }
  if (errorName === "NotReadableError" || errorName === "AbortError") {
    return "The microphone is unavailable, possibly because another app is using it. Close the other app and try again — or send Murph a voice memo in your usual chat.";
  }
  return "Murph could not access the microphone. Try again or send a voice memo in your usual chat.";
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

function isShareDismissal(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
