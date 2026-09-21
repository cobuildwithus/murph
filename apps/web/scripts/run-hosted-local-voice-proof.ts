import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import {
  buildHostedLocalBrowserSessionCookie,
  clearHostedLocalBrowserEnvironment,
  formatHostedLocalBrowserResult,
  readHostedLocalBrowserEnvironmentValue,
} from "./hosted-local-browser-process.ts";

declare global {
  interface Window {
    voiceProof: {
      context: AudioContext;
      destination: MediaStreamAudioDestinationNode;
      peers: RTCPeerConnection[];
    };
  }
}

const keys = ["MURPH_E2E_WEB_BASE_URL", "MURPH_E2E_HOSTED_SESSION_COOKIE", "MURPH_E2E_VOICE_AUDIO_PATH"] as const;

async function main(): Promise<void> {
  const [webBaseUrl, sessionCookie, audioPath] = keys.map((key) =>
    readHostedLocalBrowserEnvironmentValue(process.env, key, "Hosted voice proof"),
  );
  clearHostedLocalBrowserEnvironment(keys);
  const audio = [...await readFile(audioPath!)];
  const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  let phase = "navigation";
  const controls: { action: unknown; status: number; kind: unknown; providerConfirmed: unknown }[] = [];
  try {
    const context = await browser.newContext({ baseURL: webBaseUrl, viewport: { width: 390, height: 844 } });
    await context.addCookies([buildHostedLocalBrowserSessionCookie({ sessionCookie: sessionCookie!, webBaseUrl: webBaseUrl! })]);
    // Replace only the physical microphone. Network, WebRTC, auth, and call controls are real.
    await context.addInitScript(() => {
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      window.voiceProof = { context, destination, peers: [] };
      navigator.mediaDevices.getUserMedia = async () => destination.stream;
      const NativePeer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends NativePeer {
        constructor(configuration?: RTCConfiguration) {
          super(configuration);
          window.voiceProof.peers.push(this);
        }
      };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    page.on("response", async (response) => {
      if (new URL(response.url()).pathname !== "/api/voice") return;
      const body: unknown = await response.json().catch(() => null);
      const result = body && typeof body === "object" ? body : {};
      controls.push({
        action: response.request().postDataJSON()?.action,
        status: response.status(),
        kind: "kind" in result ? result.kind : null,
        providerConfirmed: "providerConfirmed" in result ? result.providerConfirmed : null,
      });
    });
    const startedAt = Date.now();
    assert((await page.goto("/voice"))?.ok(), "voice_navigation_failed");
    await page.getByRole("button", { name: "Start call", exact: true }).click();
    phase = "connect";
    await page.getByRole("status").filter({ hasText: "Microphone on" }).waitFor();
    const connectedMs = Date.now() - startedAt;
    await page.getByRole("button", { name: "Mute", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Microphone muted" }).waitFor();
    await page.getByRole("button", { name: "Unmute", exact: true }).click();
    phase = "answer";
    const inputAt = Date.now();
    await page.evaluate(async (bytes) => {
      const { context, destination } = window.voiceProof;
      await context.resume();
      const source = context.createBufferSource();
      source.buffer = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
      source.connect(destination);
      source.start();
    }, audio);
    await page.getByRole("region", { name: "Murph's spoken answer" })
      .filter({ hasText: /blue[ -]?(?:42|forty[ -]?two)/i }).waitFor();
    const answerMs = Date.now() - inputAt;
    await page.waitForFunction(async () => {
      for (const peer of window.voiceProof.peers) {
        for (const stat of (await peer.getStats()).values()) {
          if (stat.type === "inbound-rtp" && stat.kind === "audio" && stat.totalAudioEnergy > 0) return true;
        }
      }
      return false;
    });
    phase = "close";
    await page.getByRole("button", { name: "End call", exact: true }).click();
    const microphoneStopped = await page.evaluate(() => window.voiceProof.destination.stream.getTracks().every((track) => track.readyState === "ended"));
    assert(microphoneStopped, "microphone_not_stopped");
    await page.getByRole("button", { name: "Start another call", exact: true }).waitFor();
    assert(controls.some((result) => result.action === "close" && result.kind === "closed" && result.providerConfirmed === true), "provider_close_not_confirmed");
    process.stdout.write(formatHostedLocalBrowserResult({ ok: true, receivedAudio: true, providerConfirmed: true, microphoneStopped, connectedMs, answerMs }));
  } catch {
    // No cookies, SDP, provider errors, or member transcript in failure output.
    throw new Error(`Hosted voice proof failed at ${phase}: ${JSON.stringify(controls)}`);
  } finally {
    await browser.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown browser setup error.";
  process.stderr.write(`${message
    .replace(/\/(?:Users|home)\/[^/\s]+/gu, "<HOME_DIR>")
    .replace(/https?:\/\/[^\s)]+/gu, "[redacted-url]")
    .slice(0, 1000)}\n`);
  process.exitCode = 1;
});
