import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";

import type { RecapVideoRenderer } from "./renderer.js";
import { RecapVideoRefusal, type RecapVideoScore } from "./types.js";

/** Four stored parts of two megabytes each. A larger file is refused. */
export const RECAP_VIDEO_MAX_BYTES = 8_000_000;
const AUDIO_KBPS = 128;

export interface RecapVideoEncodeOptions {
  ffmpegPath?: string;
  /** x264's preset. Slower presets spend more time for the same picture in fewer bytes. */
  preset?: string;
  maxBytes?: number;
}

export interface RecapVideoEncodeResult {
  bytes: number;
  frames: number;
  /** Time spent drawing frames, apart from encoding them. */
  drawMs: number;
  /** ffmpeg's own account of itself. */
  encoder: { userSeconds: number; systemSeconds: number; maxRssBytes: number } | null;
}

/** The video bitrate ceiling that keeps a file of this length under its byte budget, with room for the container. */
export function videoKbpsCeiling(durationMs: number, maxBytes: number): number {
  return Math.floor(maxBytes * 0.92 * 8 / durationMs) - AUDIO_KBPS;
}

/**
 * Draws every frame in order and pipes it to ffmpeg, which only encodes and
 * adds the score. The picture is constant quality under a ceiling sized to the
 * byte budget.
 */
export async function encodeRecapVideo(renderer: RecapVideoRenderer, score: RecapVideoScore, outPath: string, options: RecapVideoEncodeOptions = {}): Promise<RecapVideoEncodeResult> {
  const maxBytes = options.maxBytes ?? RECAP_VIDEO_MAX_BYTES;
  const { durationMs, frameCount } = renderer.timeline;
  const ceiling = videoKbpsCeiling(durationMs, maxBytes);
  if (ceiling < 300) throw new RecapVideoRefusal("too_large", "The recap is too long for a video of this size.");
  const args = [
    // Info level, without the running progress line, so ffmpeg reports its own time and memory when it ends.
    "-v", "info", "-nostats", "-benchmark", "-y",
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${renderer.width}x${renderer.height}`, "-r", String(renderer.fps), "-i", "pipe:0",
    "-i", score.path,
    "-map", "0:v", "-map", "1:a",
    // The picture outlasts the music by a second, or more for the last screen's hold.
    "-af", "apad",
    "-vf", "scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p",
    "-t", (frameCount / renderer.fps).toFixed(3),
    "-c:v", "libx264", "-profile:v", "high", "-preset", options.preset ?? "medium", "-crf", "21",
    "-maxrate", `${ceiling}k`, "-bufsize", `${ceiling * 2}k`, "-g", String(renderer.fps * 2),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`, "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", outPath,
  ];
  const ffmpeg = spawn(options.ffmpegPath ?? "ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  ffmpeg.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-8192);
  });
  // ffmpeg quitting early, or never starting, surfaces as its exit code, not as a broken pipe or a wait that never ends.
  ffmpeg.stdin.on("error", () => {});
  let ended = false;
  const closed = new Promise<number | null>(resolve => {
    const finish = (code: number | null): void => {
      ended = true;
      resolve(code);
    };
    ffmpeg.on("error", () => finish(null));
    ffmpeg.on("close", finish);
  });
  let drawMs = 0, finished = false;
  try {
    for (let frame = 0; frame < frameCount && !ended; frame++) {
      const started = performance.now();
      const pixels = renderer.drawFrame(frame * 1000 / renderer.fps).data();
      drawMs += performance.now() - started;
      if (!ffmpeg.stdin.write(pixels)) await Promise.race([new Promise<void>(resolve => ffmpeg.stdin.once("drain", resolve)), closed]);
    }
    ffmpeg.stdin.end();
    const code = await closed;
    if (code === null) throw new RecapVideoRefusal("encoder_failed", "ffmpeg could not be started, or was stopped.");
    if (code !== 0) throw new RecapVideoRefusal("encoder_failed", `ffmpeg exited ${code}: ${stderr.trim().split("\n").at(-1) ?? ""}`);
    const bytes = (await stat(outPath)).size;
    if (bytes > maxBytes) throw new RecapVideoRefusal("too_large", `The video came out at ${bytes} bytes, over its ${maxBytes} byte budget.`);
    const times = /utime=([\d.]+)s stime=([\d.]+)s/u.exec(stderr), rss = /maxrss=(\d+)\s*(?:kB|KiB)/u.exec(stderr);
    finished = true;
    return {
      bytes, frames: frameCount, drawMs,
      // macOS counts peak memory in bytes where Linux counts kilobytes, and ffmpeg prints either as kilobytes.
      encoder: times && rss ? { userSeconds: Number(times[1]), systemSeconds: Number(times[2]), maxRssBytes: Number(rss[1]) * (process.platform === "darwin" ? 1 : 1024) } : null,
    };
  } finally {
    if (!finished) {
      // However it went wrong, ffmpeg is gone and nothing of the file is left by the time this returns.
      ffmpeg.stdin.destroy();
      if (!ended) ffmpeg.kill("SIGKILL");
      await closed;
      await rm(outPath, { force: true });
    }
  }
}
