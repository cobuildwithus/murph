#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "apps/web/public/audio/whoop-sync-memos");
const ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";
// Matches the voice-preview clips: 64 kbps mono keeps ~20 seconds of speech
// around 150 KB per clip. Changing this rewrites every committed clip.
const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_64";
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_v3";
// Played from the WHOOP Apple Health fallback card on /connect, in the voice
// the member picked during onboarding.
const MEMO_TEXT =
  "Hey, it's Murph. Sorry about this one. WHOOP is weirdly annoying about "
  + "sharing your data, and I want the full picture. Sleep, strain, recovery, "
  + "all of it. Never fear, the fix is easy: grab the Murph app, sign in, and "
  + "I'll walk you through the rest. Two minutes, tops. See you in there.";

await loadLocalEnvFile(".env.local");
await loadLocalEnvFile(".env");

const apiKey = normalizeEnvString(process.env.ELEVENLABS_API_KEY);
if (!apiKey) {
  throw new Error("ELEVENLABS_API_KEY is required to generate WHOOP sync voice memos.");
}

const assistantVoiceOptions = await readAssistantVoiceOptions();
const classicVoiceId = normalizeEnvString(process.env.MURPH_ELEVENLABS_VOICE_ID);
const modelId =
  normalizeEnvString(process.env.MURPH_ELEVENLABS_MODEL_ID) ??
  DEFAULT_ELEVENLABS_MODEL_ID;

await mkdir(OUTPUT_DIR, { recursive: true });

for (const option of assistantVoiceOptions) {
  const voiceId = option.elevenLabsVoiceId ?? classicVoiceId;
  if (!voiceId) {
    throw new Error("MURPH_ELEVENLABS_VOICE_ID is required to generate the classic memo.");
  }

  const bytes = await generateElevenLabsMemo({
    apiKey,
    modelId,
    text: MEMO_TEXT,
    voiceId,
  });
  const outputPath = path.join(OUTPUT_DIR, `${option.id}.mp3`);
  await writeFile(outputPath, bytes);
  console.log(`wrote ${path.relative(REPO_ROOT, outputPath)}`);
}

async function readAssistantVoiceOptions() {
  const contractsEntry = path.join(REPO_ROOT, "packages/contracts/dist/index.js");
  if (!existsSync(contractsEntry)) {
    throw new Error(
      "Build packages/contracts before generating memos: pnpm --dir packages/contracts build",
    );
  }

  const contracts = await import(pathToFileURL(contractsEntry).href);
  if (!Array.isArray(contracts.assistantVoiceOptions)) {
    throw new Error("packages/contracts did not export assistantVoiceOptions.");
  }

  return contracts.assistantVoiceOptions;
}

async function generateElevenLabsMemo(input) {
  const url = new URL(
    `/v1/text-to-speech/${encodeURIComponent(input.voiceId)}`,
    ELEVENLABS_API_BASE_URL,
  );
  url.searchParams.set("output_format", ELEVENLABS_OUTPUT_FORMAT);

  const response = await fetch(url, {
    body: JSON.stringify({
      model_id: input.modelId,
      text: input.text,
    }),
    headers: {
      accept: "audio/mpeg",
      "content-type": "application/json",
      "xi-api-key": input.apiKey,
    },
    method: "POST",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `ElevenLabs memo generation failed for voice ${input.voiceId}: ${response.status} ${text.slice(0, 160)}`,
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function loadLocalEnvFile(relativePath) {
  const envPath = path.join(REPO_ROOT, relativePath);
  if (!existsSync(envPath)) {
    return;
  }

  const body = await readFile(envPath, "utf8");
  for (const line of body.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(trimmed);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = unquoteEnvValue(rawValue);
  }
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeEnvString(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
