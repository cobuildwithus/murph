#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateElevenLabsSpeechMp3 } from "./elevenlabs-speech-generation.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(
  REPO_ROOT,
  "apps/web/public/audio/garmin-historical-data-memos",
);
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_v3";
const DEFAULT_CLASSIC_VOICE_ID = "tCM7x6cGUkyoHo8AMYRn";
const MEMO_TEXT =
  "Hey, quick heads-up. When Garmin opens, turn on Historical Data before you approve, so I can see the recent history Garmin shares.";

await loadLocalEnvFile(".env.local");
await loadLocalEnvFile(".env");

const apiKey = normalizeEnvString(process.env.ELEVENLABS_API_KEY);
if (!apiKey) {
  throw new Error(
    "ELEVENLABS_API_KEY is required to generate Garmin Historical Data voice memos.",
  );
}

const assistantVoiceOptions = await readAssistantVoiceOptions();
const classicVoiceId =
  normalizeEnvString(process.env.MURPH_ELEVENLABS_VOICE_ID) ??
  DEFAULT_CLASSIC_VOICE_ID;
const modelId =
  normalizeEnvString(process.env.MURPH_ELEVENLABS_MODEL_ID) ??
  DEFAULT_ELEVENLABS_MODEL_ID;

await mkdir(OUTPUT_DIR, { recursive: true });

for (const option of assistantVoiceOptions) {
  const voiceId = option.elevenLabsVoiceId ?? classicVoiceId;
  const bytes = await generateElevenLabsSpeechMp3({
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
