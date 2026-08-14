#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateElevenLabsSpeechMp3 } from "./elevenlabs-speech-generation.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "apps/web/public/audio/murph-personas");
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_v3";

await loadLocalEnvFile(".env.local");
await loadLocalEnvFile(".env");

const apiKey = normalizeEnvString(process.env.ELEVENLABS_API_KEY);
if (!apiKey) {
  throw new Error("ELEVENLABS_API_KEY is required to generate Murph persona previews.");
}

const contracts = await readContracts();
const classicVoiceId = normalizeEnvString(process.env.MURPH_ELEVENLABS_VOICE_ID);
const modelId = normalizeEnvString(process.env.MURPH_ELEVENLABS_MODEL_ID)
  ?? DEFAULT_ELEVENLABS_MODEL_ID;
const voiceById = new Map(
  contracts.assistantVoiceOptions.map((voice) => [voice.id, voice]),
);

for (const persona of contracts.assistantBasePersonaOptions) {
  const personaDir = path.join(OUTPUT_DIR, persona.id);
  await mkdir(personaDir, { recursive: true });
  for (const voiceOptionId of persona.recommendedVoiceIds) {
    const option = voiceById.get(voiceOptionId);
    if (!option) throw new Error(`Unknown voice ${voiceOptionId} for ${persona.id}.`);
    const voiceId = option.elevenLabsVoiceId ?? classicVoiceId;
    if (!voiceId) {
      throw new Error("MURPH_ELEVENLABS_VOICE_ID is required for the classic voice.");
    }
    const bytes = await generateElevenLabsSpeechMp3({
      apiKey,
      modelId,
      text: persona.previewText,
      voiceId,
    });
    const outputPath = path.join(personaDir, `${option.id}.mp3`);
    await writeFile(outputPath, bytes);
    console.log(`wrote ${path.relative(REPO_ROOT, outputPath)}`);
  }
}

async function readContracts() {
  const entry = path.join(REPO_ROOT, "packages/contracts/dist/index.js");
  if (!existsSync(entry)) {
    throw new Error("Build packages/contracts before generating persona previews.");
  }
  const contracts = await import(pathToFileURL(entry).href);
  if (
    !Array.isArray(contracts.assistantBasePersonaOptions)
    || !Array.isArray(contracts.assistantVoiceOptions)
  ) {
    throw new Error("packages/contracts did not export the persona and voice catalogs.");
  }
  return contracts;
}

async function loadLocalEnvFile(relativePath) {
  const envPath = path.join(REPO_ROOT, relativePath);
  if (!existsSync(envPath)) return;
  const body = await readFile(envPath, "utf8");
  for (const line of body.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquoteEnvValue(rawValue);
  }
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
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
