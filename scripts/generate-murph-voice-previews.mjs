#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "apps/web/public/audio/murph-voices");
const ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";
// 64 kbps mono is transparent enough for a few seconds of speech and keeps the
// voice step's 22 preview clips near 700 KB in total. Changing this rewrites
// every committed clip.
const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_64";
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_v3";
const PREVIEW_TEXT = "hey, it's murph. i'll send you voice memos that sound like this.";

await loadLocalEnvFile(".env.local");
await loadLocalEnvFile(".env");

const apiKey = normalizeEnvString(process.env.ELEVENLABS_API_KEY);
if (!apiKey) {
  throw new Error("ELEVENLABS_API_KEY is required to generate Murph voice previews.");
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
    throw new Error("MURPH_ELEVENLABS_VOICE_ID is required to generate the classic preview.");
  }

  const bytes = await generateElevenLabsPreview({
    apiKey,
    modelId,
    text: PREVIEW_TEXT,
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
      "Build packages/contracts before generating previews: pnpm --dir packages/contracts build",
    );
  }

  const contracts = await import(pathToFileURL(contractsEntry).href);
  if (!Array.isArray(contracts.assistantVoiceOptions)) {
    throw new Error("packages/contracts did not export assistantVoiceOptions.");
  }

  return contracts.assistantVoiceOptions;
}

async function generateElevenLabsPreview(input) {
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
      `ElevenLabs preview generation failed for voice ${input.voiceId}: ${response.status} ${text.slice(0, 160)}`,
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
